import { describe, expect, it } from "vitest";
import { calculateDocument } from "./money";
import { advanceThenShipmentTemplate, previewPaymentSchedule } from "./payment-schedule";
import { emptyPaymentSchedule, fullAdvanceTemplate } from "./payment-schedule";
import {
  adjustScheduleForSubscriptionSelection,
  allocateCurrentPortions,
  applySubscriptionConversion,
  apportionMoney,
  catalogueDriftMessage,
  commitmentCustomerText,
  convertScheduleToAllocation,
  negotiationNote,
  previewAllocatedPayment,
  subscriptionConversionPlan,
} from "./subscription";
import type { PortionLine } from "./subscription";
import Decimal from "decimal.js";

function line(partial: Partial<PortionLine> & Pick<PortionLine, "billingType" | "lineTotal">): PortionLine {
  return {
    position: partial.position ?? 1,
    billingType: partial.billingType,
    lineTotal: partial.lineTotal,
    obligationId: partial.obligationId ?? null,
    productId: partial.productId ?? null,
  };
}

function totalsFor(lines: { quantity: string; unitPrice: string }[], adjustments: Parameters<typeof calculateDocument>[1] = {
  discountType: "none",
  discountValue: null,
  shipping: null,
  installation: null,
  bankCharge: null,
  taxEnabled: false,
  taxPercent: null,
  taxExcludesShipping: false,
  taxExcludesInstallation: false,
  taxExcludesBankCharge: false,
}) {
  return calculateDocument(lines, adjustments);
}

describe("subscription commitment wording", () => {
  it("prices one year at the first-year amount and does not invent later years", () => {
    expect(commitmentCustomerText({
      currency: "USD",
      commitmentYears: 1,
      currentYearUnitPrice: "2200",
      laterYearRule: null,
      laterYearBaseUnitPrice: null,
    })).toBe(
      "One-year commitment. Year 1: USD 2,200.00 per unit. This charge is payable 100% in advance and is included in this PI total.",
    );
  });

  it("prices year 1 of a three-year commitment from the saved base and keeps each later adjustment independent", () => {
    const text = commitmentCustomerText({
      currency: "USD",
      commitmentYears: 3,
      currentYearUnitPrice: "1950",
      laterYearRule: "vendor_confirmed_base_adjustment",
      laterYearBaseUnitPrice: "1950",
    });
    expect(text).toBe(
      "Three-year commitment. Year 1: USD 1,950.00 per unit. Years 2 and 3: USD 1,950.00 per unit plus the applicable vendor-confirmed CPI adjustment for each year. Each annual adjustment is applied independently to the USD 1,950.00 base. Each year is payable 100% in advance. Only Year 1 is included in this PI total.",
    );
    expect(text).not.toMatch(/year 2.*year 2/i);
    expect(text).not.toContain("currently due");
  });

  it("uses a negotiated year 1 price without changing the later-year base in the wording", () => {
    const text = commitmentCustomerText({
      currency: "USD",
      commitmentYears: 3,
      currentYearUnitPrice: "1800",
      laterYearRule: "vendor_confirmed_base_adjustment",
      laterYearBaseUnitPrice: "1950",
    });
    expect(text).toContain("Year 1: USD 1,800.00 per unit");
    expect(text).toContain("Years 2 and 3: USD 1,950.00 per unit plus the applicable vendor-confirmed CPI adjustment");
    expect(negotiationNote("USD", "1800", "1950", "1950", "1950")).toContain("catalogue Year 1 price is USD 1,950.00");
    expect(negotiationNote("USD", "1800", "1950", "1950", "1950")).not.toContain("later-year base");
  });

  it("states a fixed later-year price without calling it an amount due now", () => {
    const text = commitmentCustomerText({
      currency: "USD",
      commitmentYears: 3,
      currentYearUnitPrice: "1950",
      laterYearRule: "fixed_annual",
      laterYearBaseUnitPrice: "1950",
    });
    expect(text).toContain("Years 2 and 3: USD 1,950.00 per unit.");
    expect(text).toContain("Only Year 1 is included in this PI total.");
    expect(text).not.toContain("CPI");
  });
});

describe("current-year payment allocation", () => {
  it("excludes future years and keeps quantity on the current charge", () => {
    const calculated = totalsFor([{ quantity: "2", unitPrice: "1950" }]);
    expect(calculated.grandTotal).toBe("3900.00");
    const result = allocateCurrentPortions({
      lines: [line({ billingType: "subscription", lineTotal: "3900.00", obligationId: "sub-1" })],
      discountAmount: calculated.discountAmount,
      shipping: calculated.shipping,
      installation: calculated.installation,
      bankCharge: calculated.bankCharge,
      taxAmount: calculated.taxAmount,
      taxEnabled: false,
      taxExcludesShipping: false,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: calculated.grandTotal,
      residualTarget: null,
    });
    expect(result.subscriptionTotal).toBe("3900.00");
    expect(result.oneTimeTotal).toBe("0.00");
  });

  it("allocates the machine schedule to the machine amount, not the mixed total", () => {
    const calculated = totalsFor([
      { quantity: "1", unitPrice: "10000" },
      { quantity: "1", unitPrice: "1950" },
    ]);
    expect(calculated.grandTotal).toBe("11950.00");
    const result = allocateCurrentPortions({
      lines: [
        line({ position: 1, billingType: "one_time", lineTotal: "10000.00" }),
        line({ position: 2, billingType: "subscription", lineTotal: "1950.00", obligationId: "sub-1" }),
      ],
      discountAmount: "0.00",
      shipping: "0.00",
      installation: "0.00",
      bankCharge: "0.00",
      taxAmount: "0.00",
      taxEnabled: false,
      taxExcludesShipping: false,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: "11950.00",
      residualTarget: null,
    });
    expect(result.subscriptionTotal).toBe("1950.00");
    expect(result.oneTimeTotal).toBe("10000.00");
    const schedule = convertScheduleToAllocation(advanceThenShipmentTemplate());
    const preview = previewAllocatedPayment({
      schedule,
      currency: "USD",
      lines: [
        line({ position: 1, billingType: "one_time", lineTotal: "10000.00", productId: "machine" }),
        line({ position: 2, billingType: "subscription", lineTotal: "1950.00", obligationId: "sub-1", productId: "plan" }),
      ],
      discountAmount: "0.00",
      shipping: "0.00",
      installation: "0.00",
      bankCharge: "0.00",
      taxAmount: "0.00",
      taxEnabled: false,
      taxExcludesShipping: false,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: "11950.00",
    });
    expect(preview.ready).toBe(true);
    expect(preview.canonical?.subscription_total).toBe("1950.00");
    expect(preview.canonical?.one_time_total).toBe("10000.00");
    expect(preview.canonical?.rows[0]?.amount).toBe("3000.00");
    expect(preview.canonical?.rows[1]?.amount).toBe("7000.00");
    expect(preview.canonical?.subscription_obligations).toEqual([
      expect.objectContaining({ id: "sub-1", amount: "1950.00", due_formula: "payable 100% in advance" }),
    ]);
    expect(preview.customerText).toContain("Subscription charges of USD 1,950.00 are payable 100% in advance");
    expect(preview.customerText).toContain("USD 10,000.00 for one-time items");
    expect(preview.customerText).not.toContain("30% advance payment upon order confirmation, and the remaining 70% before shipment.");
    const misread = previewPaymentSchedule(schedule, "USD", "11950.00");
    expect(misread.ready).toBe(false);
    expect(misread.issues[0]?.message).toMatch(/cannot be read as a percentage of the PI total/);
  });

  it("puts a subscription-only charge entirely in advance and offers no instalments", () => {
    const schedule = convertScheduleToAllocation({
      schema_version: 1,
      no_payment_due: false,
      dates_need_review: false,
      rows: [],
    });
    const preview = previewAllocatedPayment({
      schedule,
      currency: "USD",
      lines: [line({ billingType: "subscription", lineTotal: "2200.00", obligationId: "year-1" })],
      discountAmount: "0.00",
      shipping: "0.00",
      installation: "0.00",
      bankCharge: "0.00",
      taxAmount: "0.00",
      taxEnabled: false,
      taxExcludesShipping: false,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: "2200.00",
    });
    expect(preview.ready).toBe(true);
    expect(preview.canonical?.rows).toEqual([]);
    expect(preview.canonical?.subscription_obligations[0]?.amount).toBe("2200.00");
    expect(preview.customerText).toBe("Subscription charges of USD 2,200.00 are payable 100% in advance.");
    const withInstalments = previewAllocatedPayment({
      ...{
        schedule: convertScheduleToAllocation(advanceThenShipmentTemplate()),
        currency: "USD" as const,
        lines: [line({ billingType: "subscription", lineTotal: "2200.00", obligationId: "year-1" })],
        discountAmount: "0.00",
        shipping: "0.00",
        installation: "0.00",
        bankCharge: "0.00",
        taxAmount: "0.00",
        taxEnabled: false,
        taxExcludesShipping: false,
        taxExcludesInstallation: false,
        taxExcludesBankCharge: false,
        grandTotal: "2200.00",
      },
    });
    expect(withInstalments.ready).toBe(false);
    expect(withInstalments.issues.map((issue) => issue.message).join(" ")).toMatch(/cannot be split into instalments/);
  });

  it("shares discounts, tax, exclusions, and charges and reconciles to the grand total", () => {
    const calculated = totalsFor(
      [
        { quantity: "1", unitPrice: "10000" },
        { quantity: "1", unitPrice: "1950" },
      ],
      {
        discountType: "percent",
        discountValue: "10",
        shipping: "100",
        installation: "50",
        bankCharge: "25",
        taxEnabled: true,
        taxPercent: "14",
        taxExcludesShipping: true,
        taxExcludesInstallation: false,
        taxExcludesBankCharge: false,
      },
    );
    const result = allocateCurrentPortions({
      lines: [
        line({ position: 1, billingType: "one_time", lineTotal: calculated.lines[0]?.lineTotal ?? null }),
        line({ position: 2, billingType: "subscription", lineTotal: calculated.lines[1]?.lineTotal ?? null, obligationId: "sub" }),
      ],
      discountAmount: calculated.discountAmount,
      shipping: calculated.shipping,
      installation: calculated.installation,
      bankCharge: calculated.bankCharge,
      taxAmount: calculated.taxAmount,
      taxEnabled: true,
      taxExcludesShipping: true,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: calculated.grandTotal,
      residualTarget: null,
    });
    expect(result.ready).toBe(true);
    const subscription = new Decimal(result.subscriptionTotal ?? "0");
    const oneTime = new Decimal(result.oneTimeTotal ?? "0");
    expect(subscription.plus(oneTime).toFixed(2)).toBe(calculated.grandTotal);
    const lines = result.lines;
    expect(lines.reduce((sum, item) => sum.plus(item.discount), new Decimal(0)).toFixed(2)).toBe(calculated.discountAmount);
    expect(lines.reduce((sum, item) => sum.plus(item.shipping), new Decimal(0)).toFixed(2)).toBe("100.00");
    expect(lines.reduce((sum, item) => sum.plus(item.tax), new Decimal(0)).toFixed(2)).toBe(calculated.taxAmount);
    const taxable = lines.reduce((sum, item) => {
      return sum.plus(item.discounted).plus(item.installation).plus(item.bank_charge);
    }, new Decimal(0));
    expect(taxable.toFixed(2)).toBe(calculated.taxableBase);
  });

  it("reconciles a one-cent discount without dropping either line", () => {
    const shares = apportionMoney(new Decimal("0.01"), [new Decimal(1), new Decimal(1)], true);
    expect(shares?.map((share) => share.toFixed(2))).toEqual(["0.00", "0.01"]);
    const result = allocateCurrentPortions({
      lines: [
        line({ position: 1, billingType: "one_time", lineTotal: "1.00" }),
        line({ position: 2, billingType: "subscription", lineTotal: "1.00", obligationId: "sub" }),
      ],
      discountAmount: "0.01",
      shipping: "0.00",
      installation: "0.00",
      bankCharge: "0.00",
      taxAmount: "0.00",
      taxEnabled: false,
      taxExcludesShipping: false,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: "1.99",
      residualTarget: null,
    });
    expect(result.ready).toBe(true);
    expect(result.subscriptionTotal).toBe("0.99");
    expect(result.oneTimeTotal).toBe("1.00");
  });

  it("requires an explicit residual choice when every line weight is zero", () => {
    const blocked = allocateCurrentPortions({
      lines: [
        line({ position: 1, billingType: "one_time", lineTotal: "0.00" }),
        line({ position: 2, billingType: "subscription", lineTotal: "0.00", obligationId: "sub" }),
      ],
      discountAmount: "0.00",
      shipping: "50.00",
      installation: "0.00",
      bankCharge: "0.00",
      taxAmount: "0.00",
      taxEnabled: false,
      taxExcludesShipping: false,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: "50.00",
      residualTarget: null,
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.residualRequired).toBe(true);
    expect(blocked.message).toMatch(/does not create a subscription price/);
    const chosen = allocateCurrentPortions({
      lines: [
        line({ position: 1, billingType: "one_time", lineTotal: "0.00" }),
        line({ position: 2, billingType: "subscription", lineTotal: "0.00", obligationId: "sub" }),
      ],
      discountAmount: "0.00",
      shipping: "50.00",
      installation: "0.00",
      bankCharge: "0.00",
      taxAmount: "0.00",
      taxEnabled: false,
      taxExcludesShipping: false,
      taxExcludesInstallation: false,
      taxExcludesBankCharge: false,
      grandTotal: "50.00",
      residualTarget: "subscription",
    });
    expect(chosen.subscriptionTotal).toBe("50.00");
    expect(chosen.oneTimeTotal).toBe("0.00");
    expect(chosen.residualApplied).toBe(true);
  });

  it("does not treat a version 1 schedule as an allocation schedule", () => {
    const schedule = advanceThenShipmentTemplate();
    expect(schedule.schema_version).toBe(1);
    const preview = previewPaymentSchedule(schedule, "USD", "11950.00");
    expect(preview.canonical?.rows[0]?.amount).toBe("3585.00");
    expect(preview.canonical?.rows[1]?.amount).toBe("8365.00");
    expect(convertScheduleToAllocation(schedule).schema_version).toBe(2);
    expect(convertScheduleToAllocation(schedule).rows).toEqual(schedule.rows);
  });
});

describe("catalogue drift", () => {
  it("keeps a saved agreement readable when the option is archived or repriced", () => {
    expect(catalogueDriftMessage({
      savedYears: 3,
      savedRule: "vendor_confirmed_base_adjustment",
      savedCatalogueYearOne: "1950.00",
      savedCatalogueLaterBase: "1950.00",
      savedCurrency: "USD",
      option: {
        commitment_years: 3,
        later_year_rule: "vendor_confirmed_base_adjustment",
        first_year_unit_price: "2100.00",
        later_year_base_unit_price: "1950.00",
        currency: "USD",
        archived_at: "2026-10-21T00:00:00Z",
      },
    })).toMatch(/archived/);
    expect(catalogueDriftMessage({
      savedYears: 3,
      savedRule: "vendor_confirmed_base_adjustment",
      savedCatalogueYearOne: "1950.00",
      savedCatalogueLaterBase: "1950.00",
      savedCurrency: "USD",
      option: null,
    })).toMatch(/could not be found/);
  });
});

describe("subscription-only payment allocation", () => {
  it("prepares an empty schedule when a subscription is selected and does not remove rows by itself", () => {
    const empty = emptyPaymentSchedule();
    const prepared = adjustScheduleForSubscriptionSelection({
      mode: "structured",
      schedule: empty,
      hadSubscription: false,
      hasSubscription: true,
    });
    expect(prepared?.schema_version).toBe(2);
    expect(prepared?.rows).toEqual([]);
    expect(empty.schema_version).toBe(1);

    const entered = fullAdvanceTemplate();
    expect(adjustScheduleForSubscriptionSelection({
      mode: "structured",
      schedule: entered,
      hadSubscription: false,
      hasSubscription: true,
    })).toBeNull();
    const plan = subscriptionConversionPlan({
      mode: "structured",
      schedule: entered,
      hasSubscription: true,
      subscriptionOnly: true,
    });
    expect(plan?.removeLabels).toEqual(["advance payment"]);
    expect(plan?.confirmLabel).toMatch(/removal/);
    expect(applySubscriptionConversion(entered, true).rows).toEqual([]);
    expect(entered.rows).toHaveLength(1);
  });

  it("keeps one-time rows on a mixed PI until the allocation is confirmed", () => {
    const entered = fullAdvanceTemplate();
    const plan = subscriptionConversionPlan({
      mode: "structured",
      schedule: entered,
      hasSubscription: true,
      subscriptionOnly: false,
    });
    expect(plan?.retainLabels).toEqual(["advance payment"]);
    expect(plan?.removeLabels).toEqual([]);
    expect(applySubscriptionConversion(entered, false).rows).toHaveLength(1);
    expect(applySubscriptionConversion(entered, false).schema_version).toBe(2);
  });
});
