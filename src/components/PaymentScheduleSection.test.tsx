import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { advanceThenShipmentTemplate } from "../lib/payment-schedule";
import { NO_ONE_TIME_AMOUNT_MESSAGE, previewAllocatedPayment } from "../lib/subscription";
import type { PaymentSchedule } from "../lib/payment-schedule";
import { PaymentScheduleSection } from "./PaymentScheduleSection";

const ZERO_TOTAL = "This PI total is zero. Mark the schedule as no payment due, or change the PI total.";

function markup(props: Partial<Parameters<typeof PaymentScheduleSection>[0]> & {
  schedule: PaymentSchedule;
  grandTotal: string | null;
}): string {
  const element = createElement(PaymentScheduleSection, {
    mode: "structured",
    legacyText: "",
    currency: "USD",
    canEdit: true,
    showLegacyCancel: false,
    onLegacyText: () => undefined,
    onReplaceLegacy: () => undefined,
    onCancelReplacement: () => undefined,
    onSchedule: () => undefined,
    percentageOf: "one_time",
    ...props,
  }) as ReactElement;
  return renderToStaticMarkup(element);
}

function emptyAllocation(residual: null = null): PaymentSchedule {
  return {
    schema_version: 2,
    no_payment_due: false,
    dates_need_review: false,
    residual_target: residual,
    rows: [],
  };
}

describe("payment section allocation output", () => {
  it("treats an empty one-time portion as valid when the subscription advance covers the PI", () => {
    const customerText = "Subscription charges of USD 1,950.00 are payable 100% in advance.";
    const html = markup({
      schedule: emptyAllocation(),
      grandTotal: "1950.00",
      percentageBase: "0.00",
      customerText,
      allocationIssues: [],
    });
    expect(html).toContain(customerText);
    expect(html).toContain("payable 100% in advance");
    expect(html).not.toContain(ZERO_TOTAL);
    expect(html).not.toContain("No payment due");
  });

  it("still reports leftover one-time rows when the subscription covers the total", () => {
    const schedule: PaymentSchedule = {
      ...advanceThenShipmentTemplate(),
      schema_version: 2,
      residual_target: null,
    };
    const html = markup({
      schedule,
      grandTotal: "1950.00",
      percentageBase: "0.00",
      customerText: "Subscription charges of USD 1,950.00 are payable 100% in advance.",
    });
    expect(html).toContain(NO_ONE_TIME_AMOUNT_MESSAGE);
    expect(html).not.toContain(ZERO_TOTAL);
    expect(html).not.toContain("No payment due");
  });

  it("shows the one-time amounts for a mixed PI and does not call the total zero", () => {
    const schedule: PaymentSchedule = {
      ...advanceThenShipmentTemplate(),
      schema_version: 2,
      residual_target: null,
    };
    const allocated = previewAllocatedPayment({
      schedule,
      currency: "USD",
      lines: [
        { position: 1, billingType: "one_time", lineTotal: "10000.00", obligationId: null, productId: "machine" },
        { position: 2, billingType: "subscription", lineTotal: "1950.00", obligationId: "sub-1", productId: "plan" },
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
    const html = markup({
      schedule,
      grandTotal: "11950.00",
      percentageBase: "10000.00",
      customerText: allocated.customerText,
      allocationIssues: allocated.issues,
      allocationNote: allocated.explanation,
    });
    expect(html).toContain("USD 3,000.00");
    expect(html).toContain("USD 7,000.00");
    expect(html).toContain("Subscription charges of USD 1,950.00 are payable 100% in advance");
    expect(html).toContain("USD 10,000.00 for one-time items");
    expect(html).not.toContain(ZERO_TOTAL);
    expect(html).not.toContain("No payment due");
  });

  it("recommends no payment due only when the PI total is actually zero", () => {
    const schedule = emptyAllocation();
    const allocated = previewAllocatedPayment({
      schedule,
      currency: "USD",
      lines: [
        { position: 1, billingType: "one_time", lineTotal: "0.00", obligationId: null, productId: "machine" },
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
      grandTotal: "0.00",
    });
    const html = markup({
      schedule,
      grandTotal: "0.00",
      percentageBase: "0.00",
      allocationIssues: allocated.issues,
      customerText: allocated.customerText,
    });
    expect(html).toContain(ZERO_TOTAL);
    expect(html).toContain("No payment due");
    expect(allocated.ready).toBe(false);
  });
});
