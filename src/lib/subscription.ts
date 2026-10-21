import Decimal from "decimal.js";
import { formatMoney } from "./format";
import { roundMoney } from "./money";
import {
  previewPaymentSchedule,
  type CanonicalPaymentRow,
  type PaymentPreview,
  type PaymentSchedule,
  type ResidualTarget,
  type ScheduleIssue,
} from "./payment-schedule";
import type {
  AllocatedCanonicalPayment,
  BillingType,
  CurrencyCode,
  LaterYearRule,
  StoredAllocationLine,
  SubscriptionObligation,
} from "./types";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const YEAR_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export const NO_ONE_TIME_AMOUNT_MESSAGE =
  "This PI has no one-time amount. Remove those payment rows. The subscription charge is payable 100% in advance and cannot be split into instalments.";

export type PortionLine = {
  position: number;
  billingType: BillingType;
  lineTotal: string | null;
  obligationId: string | null;
  productId: string | null;
};

export type AllocationResult = {
  ready: boolean;
  residualRequired: boolean;
  residualApplied: boolean;
  message: string | null;
  subscriptionTotal: string | null;
  oneTimeTotal: string | null;
  lines: StoredAllocationLine[];
};

export type CommitmentWording = {
  currency: CurrencyCode;
  commitmentYears: number;
  currentYearUnitPrice: string;
  laterYearRule: LaterYearRule | null;
  laterYearBaseUnitPrice: string | null;
};

export function commitmentHeading(years: number): string {
  if (!Number.isInteger(years) || years < 1) return "Subscription commitment";
  if (years <= 10) return `${YEAR_WORDS[years]}-year commitment`;
  return `${years}-year commitment`;
}

export function laterYearsLabel(years: number): string {
  if (years <= 1) return "";
  if (years === 2) return "Year 2";
  if (years === 3) return "Years 2 and 3";
  const middle = [];
  for (let year = 2; year < years; year += 1) middle.push(String(year));
  return `Years ${middle.join(", ")} and ${years}`;
}

/** Customer wording is generated from the saved agreement. It is not edited on its own. */
export function commitmentCustomerText(input: CommitmentWording): string {
  const yearOne = formatMoney(input.currentYearUnitPrice, input.currency);
  const heading = commitmentHeading(input.commitmentYears);
  if (input.commitmentYears <= 1 || input.laterYearRule == null || input.laterYearBaseUnitPrice == null) {
    return `${heading}. Year 1: ${yearOne} per unit. This charge is payable 100% in advance and is included in this PI total.`;
  }
  const later = formatMoney(input.laterYearBaseUnitPrice, input.currency);
  const span = laterYearsLabel(input.commitmentYears);
  const advance = "Each year is payable 100% in advance. Only Year 1 is included in this PI total.";
  if (input.laterYearRule === "fixed_annual") {
    return `${heading}. Year 1: ${yearOne} per unit. ${span}: ${later} per unit. ${advance}`;
  }
  const each = input.commitmentYears === 2 ? "for that year" : "for each year";
  const adjustment = input.commitmentYears === 2
    ? `The adjustment is applied independently to the ${later} base.`
    : `Each annual adjustment is applied independently to the ${later} base.`;
  return `${heading}. Year 1: ${yearOne} per unit. ${span}: ${later} per unit plus the applicable vendor-confirmed CPI adjustment ${each}. ${adjustment} ${advance}`;
}

export function apportionMoney(total: Decimal, weights: Decimal[], capAtWeight = false): Decimal[] | null {
  if (weights.length === 0) return [];
  if (total.isNegative()) throw new Error("An allocated amount cannot be negative.");
  if (total.isZero()) return weights.map(() => new Decimal(0));
  const sum = weights.reduce((totalWeight, weight) => totalWeight.plus(weight), new Decimal(0));
  if (sum.isZero()) return null;
  const exact = weights.map((weight) => total.mul(weight).div(sum));
  const cents = exact.map((value, index) => {
    let rounded = value.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    if (capAtWeight) {
      const cap = roundMoney(weights[index] ?? new Decimal(0)).mul(100);
      if (rounded.gt(cap)) rounded = cap;
    }
    if (rounded.isNegative()) rounded = new Decimal(0);
    return rounded;
  });
  const totalCents = roundMoney(total).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  let drift = totalCents.minus(cents.reduce((sumCents, value) => sumCents.plus(value), new Decimal(0)));
  while (!drift.isZero()) {
    let best: number | null = null;
    let bestScore: Decimal | null = null;
    for (let index = 0; index < cents.length; index += 1) {
      const current = cents[index] ?? new Decimal(0);
      if (drift.gt(0)) {
        if (capAtWeight && current.gte(roundMoney(weights[index] ?? new Decimal(0)).mul(100))) continue;
        const score = (exact[index] ?? new Decimal(0)).mul(100).minus(current);
        if (best === null || (bestScore !== null && score.gt(bestScore))) {
          best = index;
          bestScore = score;
        }
      } else if (current.gt(0)) {
        const score = current.minus((exact[index] ?? new Decimal(0)).mul(100));
        if (best === null || (bestScore !== null && score.gt(bestScore))) {
          best = index;
          bestScore = score;
        }
      }
    }
    if (best === null) throw new Error("The allocation could not be reconciled to the cent.");
    cents[best] = (cents[best] ?? new Decimal(0)).plus(drift.gt(0) ? 1 : -1);
    drift = drift.plus(drift.gt(0) ? -1 : 1);
  }
  return cents.map((value) => value.div(100));
}

function money(value: Decimal): string {
  return roundMoney(value).toFixed(2);
}

function decimalMoney(value: string, label: string): Decimal {
  const amount = new Decimal(value);
  if (amount.isNegative()) throw new Error(`${label} cannot be negative.`);
  return roundMoney(amount);
}

function notReady(message: string, residualRequired = false, lines: StoredAllocationLine[] = []): AllocationResult {
  return {
    ready: false,
    residualRequired,
    residualApplied: false,
    message,
    subscriptionTotal: null,
    oneTimeTotal: null,
    lines,
  };
}

function sumAllocated(lines: StoredAllocationLine[], billing: BillingType): Decimal {
  return lines
    .filter((line) => line.billing_type === billing)
    .reduce((total, line) => total.plus(line.allocated_total), new Decimal(0));
}

/**
 * Split the already calculated PI total into the current subscription charge
 * and the one-time amount. Future subscription years are not weights.
 * Discounts follow current line totals. Charges follow discounted line totals.
 * Tax follows the same exclusions as the PI total and uses the saved tax amount.
 */
export function allocateCurrentPortions(input: {
  lines: PortionLine[];
  discountAmount: string;
  shipping: string;
  installation: string;
  bankCharge: string;
  taxAmount: string;
  taxEnabled: boolean;
  taxExcludesShipping: boolean;
  taxExcludesInstallation: boolean;
  taxExcludesBankCharge: boolean;
  grandTotal: string;
  residualTarget: ResidualTarget | null;
}): AllocationResult {
  if (input.lines.some((line) => line.lineTotal == null)) {
    return notReady("Enter a price on every item before the subscription and one-time amounts can be separated.");
  }
  let grand: Decimal;
  let discount: Decimal;
  let shipping: Decimal;
  let installation: Decimal;
  let bank: Decimal;
  let tax: Decimal;
  try {
    grand = decimalMoney(input.grandTotal, "Grand total");
    discount = decimalMoney(input.discountAmount, "Discount");
    shipping = decimalMoney(input.shipping, "Shipping");
    installation = decimalMoney(input.installation, "Installation");
    bank = decimalMoney(input.bankCharge, "Bank charge");
    tax = decimalMoney(input.taxAmount, "Tax");
  } catch (caught) {
    return notReady(caught instanceof Error ? caught.message : "The PI amounts could not be allocated.");
  }

  const weights = input.lines.map((line) => decimalMoney(line.lineTotal ?? "0", "Line total"));
  const discounts = apportionMoney(discount, weights, true);
  if (discounts === null) {
    return notReady("The invoice discount could not be allocated.");
  }
  const discounted = weights.map((weight, index) => weight.minus(discounts[index] ?? 0));
  const discountedSum = discounted.reduce((total, value) => total.plus(value), new Decimal(0));
  const hasSubscription = input.lines.some((line) => line.billingType === "subscription");
  const hasOneTime = input.lines.some((line) => line.billingType === "one_time");

  const baseLines = (): StoredAllocationLine[] => input.lines.map((line, index) => ({
    position: line.position,
    billing_type: line.billingType,
    obligation_id: line.obligationId,
    product_id: line.productId,
    line_total: money(weights[index] ?? new Decimal(0)),
    discount: money(discounts[index] ?? new Decimal(0)),
    discounted: money(discounted[index] ?? new Decimal(0)),
    shipping: "0.00",
    installation: "0.00",
    bank_charge: "0.00",
    tax: "0.00",
    allocated_total: money(discounted[index] ?? new Decimal(0)),
  }));

  if (discountedSum.isZero() && grand.gt(0)) {
    if (!hasSubscription && !hasOneTime) {
      return notReady("Add an item before the charges can be allocated.");
    }
    const allowed: ResidualTarget[] = [];
    if (hasSubscription) allowed.push("subscription");
    if (hasOneTime) allowed.push("one_time");
    if (input.residualTarget == null || !allowed.includes(input.residualTarget)) {
      const choice = allowed.length === 1
        ? `The only place they can go is the ${allowed[0] === "subscription" ? "subscription advance" : "one-time schedule"}.`
        : "Choose the subscription advance or the one-time schedule.";
      return notReady(
        `The PI total is ${money(grand)} but every current line is zero after discounts, so shipping, installation, bank charges, and tax cannot be shared by line value. ${choice} This does not create a subscription price.`,
        true,
        baseLines(),
      );
    }
    const bucket = input.lines
      .map((line, index) => ({ line, index, weight: weights[index] ?? new Decimal(0) }))
      .filter((entry) => entry.line.billingType === input.residualTarget);
    const bucketWeightSum = bucket.reduce((total, entry) => total.plus(entry.weight), new Decimal(0));
    const splitWeights = bucketWeightSum.gt(0)
      ? bucket.map((entry) => entry.weight)
      : bucket.map(() => new Decimal(1));
    const shares = apportionMoney(grand, splitWeights);
    if (shares === null) return notReady("The residual charges could not be allocated.");
    const lines = baseLines();
    bucket.forEach((entry, shareIndex) => {
      const share = money(shares[shareIndex] ?? new Decimal(0));
      const line = lines[entry.index];
      if (!line) return;
      line.allocated_total = share;
    });
    return finish(lines, grand, true);
  }

  const shippingShares = apportionMoney(shipping, discounted) ?? discounted.map(() => new Decimal(0));
  const installationShares = apportionMoney(installation, discounted) ?? discounted.map(() => new Decimal(0));
  const bankShares = apportionMoney(bank, discounted) ?? discounted.map(() => new Decimal(0));
  const taxable = discounted.map((value, index) => {
    let amount = value;
    if (!input.taxExcludesShipping) amount = amount.plus(shippingShares[index] ?? 0);
    if (!input.taxExcludesInstallation) amount = amount.plus(installationShares[index] ?? 0);
    if (!input.taxExcludesBankCharge) amount = amount.plus(bankShares[index] ?? 0);
    return amount;
  });
  const taxShares = !input.taxEnabled || tax.isZero()
    ? taxable.map(() => new Decimal(0))
    : apportionMoney(tax, taxable) ?? taxable.map(() => new Decimal(0));
  const lines = input.lines.map((line, index) => {
    const allocated = (discounted[index] ?? new Decimal(0))
      .plus(shippingShares[index] ?? 0)
      .plus(installationShares[index] ?? 0)
      .plus(bankShares[index] ?? 0)
      .plus(taxShares[index] ?? 0);
    return {
      position: line.position,
      billing_type: line.billingType,
      obligation_id: line.obligationId,
      product_id: line.productId,
      line_total: money(weights[index] ?? new Decimal(0)),
      discount: money(discounts[index] ?? new Decimal(0)),
      discounted: money(discounted[index] ?? new Decimal(0)),
      shipping: money(shippingShares[index] ?? new Decimal(0)),
      installation: money(installationShares[index] ?? new Decimal(0)),
      bank_charge: money(bankShares[index] ?? new Decimal(0)),
      tax: money(taxShares[index] ?? new Decimal(0)),
      allocated_total: money(allocated),
    };
  });
  return finish(lines, grand, false);

  function finish(allocatedLines: StoredAllocationLine[], total: Decimal, residualApplied: boolean): AllocationResult {
    let drift = total.minus(allocatedLines.reduce((sum, line) => sum.plus(line.allocated_total), new Decimal(0)));
    const limit = new Decimal(allocatedLines.length).mul("0.01");
    if (drift.abs().gt(limit)) {
      return notReady("The payment allocation does not match the PI total.");
    }
    for (let index = allocatedLines.length - 1; index >= 0 && !drift.isZero(); index -= 1) {
      const line = allocatedLines[index];
      if (!line) continue;
      const next = new Decimal(line.allocated_total).plus(drift);
      if (next.isNegative()) continue;
      line.allocated_total = money(next);
      drift = new Decimal(0);
    }
    if (!drift.isZero()) return notReady("The payment allocation does not match the PI total.");
    const subscriptionTotal = sumAllocated(allocatedLines, "subscription");
    const oneTimeTotal = sumAllocated(allocatedLines, "one_time");
    if (!subscriptionTotal.plus(oneTimeTotal).eq(total)) {
      return notReady("The subscription and one-time amounts do not add up to the PI total.");
    }
    return {
      ready: true,
      residualRequired: false,
      residualApplied,
      message: null,
      subscriptionTotal: money(subscriptionTotal),
      oneTimeTotal: money(oneTimeTotal),
      lines: allocatedLines,
    };
  }
}

export function allocationExplanation(
  result: AllocationResult,
  currency: CurrencyCode | null,
  grandTotal: string | null,
): string | null {
  if (!result.ready || !currency || result.subscriptionTotal == null || result.oneTimeTotal == null) {
    return result.message;
  }
  const subscription = formatMoney(result.subscriptionTotal, currency);
  const oneTime = formatMoney(result.oneTimeTotal, currency);
  const total = grandTotal ? formatMoney(grandTotal, currency) : "the PI total";
  if (result.subscriptionTotal === "0.00") {
    return `There is no current subscription charge in the PI total. The one-time schedule covers ${oneTime}.`;
  }
  return `Subscription advance ${subscription} is payable 100% in advance. It includes that portion's share of any invoice discount, tax, and shipping, installation, or bank charges. The one-time schedule covers ${oneTime}. Percentages in that schedule are of the one-time amount, not of the PI total ${total}. Later subscription years are not included.`;
}

export function subscriptionScheduleMessage(kind: "legacy" | "grand_total"): string {
  if (kind === "legacy") {
    return "This draft still uses a legacy payment paragraph. A subscription is payable 100% in advance and cannot be mixed into that paragraph. Choose an allocation-aware payment schedule before saving. The paragraph stays until that schedule is saved.";
  }
  return "This payment schedule is a percentage of the whole PI total. Subscription charges cannot be spread across those instalments. Update the payment allocation so the one-time percentages use only the one-time amount. The current schedule stays until the update is saved.";
}

export function convertScheduleToAllocation(schedule: PaymentSchedule | null): PaymentSchedule {
  if (schedule == null || schedule.schema_version === 1) {
    return {
      schema_version: 2,
      no_payment_due: schedule?.no_payment_due ?? false,
      dates_need_review: schedule?.dates_need_review ?? false,
      rows: schedule?.rows ?? [],
      residual_target: null,
    };
  }
  return { ...schedule, residual_target: schedule.residual_target ?? null };
}

function replaceTotalName(preview: PaymentPreview): PaymentPreview {
  return {
    ...preview,
    issues: preview.issues.map((issue) => ({
      ...issue,
      message: issue.message.replaceAll("grand total", "one-time amount").replaceAll("Grand total", "One-time amount"),
    })),
  };
}

export type DocumentPaymentPreview = {
  hasSubscription: boolean;
  needsConversion: boolean;
  conversionMessage: string | null;
  allocation: AllocationResult | null;
  explanation: string | null;
  customerText: string | null;
  canonical: AllocatedCanonicalPayment | null;
  oneTimePreview: PaymentPreview | null;
  ready: boolean;
  issues: ScheduleIssue[];
};

export function previewAllocatedPayment(input: {
  schedule: PaymentSchedule;
  currency: CurrencyCode | null;
  lines: PortionLine[];
  discountAmount: string;
  shipping: string;
  installation: string;
  bankCharge: string;
  taxAmount: string;
  taxEnabled: boolean;
  taxExcludesShipping: boolean;
  taxExcludesInstallation: boolean;
  taxExcludesBankCharge: boolean;
  grandTotal: string | null;
}): DocumentPaymentPreview {
  const hasSubscription = input.lines.some((line) => line.billingType === "subscription");
  const allocation = input.grandTotal == null
    ? notReady("Enter a price on every item before the subscription and one-time amounts can be separated.")
    : allocateCurrentPortions({
      lines: input.lines,
      discountAmount: input.discountAmount,
      shipping: input.shipping,
      installation: input.installation,
      bankCharge: input.bankCharge,
      taxAmount: input.taxAmount,
      taxEnabled: input.taxEnabled,
      taxExcludesShipping: input.taxExcludesShipping,
      taxExcludesInstallation: input.taxExcludesInstallation,
      taxExcludesBankCharge: input.taxExcludesBankCharge,
      grandTotal: input.grandTotal,
      residualTarget: input.schedule.residual_target ?? null,
    });
  const explanation = allocationExplanation(allocation, input.currency, input.grandTotal);
  if (!allocation.ready || !input.currency || allocation.subscriptionTotal == null || allocation.oneTimeTotal == null) {
    return {
      hasSubscription,
      needsConversion: false,
      conversionMessage: null,
      allocation,
      explanation,
      customerText: null,
      canonical: null,
      oneTimePreview: null,
      ready: false,
      issues: [{ rowId: null, message: allocation.message ?? "The payment allocation is incomplete." }],
    };
  }

  const subscriptionTotal = new Decimal(allocation.subscriptionTotal);
  const oneTimeTotal = new Decimal(allocation.oneTimeTotal);
  const grand = new Decimal(input.grandTotal ?? "0");
  if (input.schedule.no_payment_due) {
    const issues: ScheduleIssue[] = [];
    if (input.schedule.rows.length > 0) issues.push({ rowId: null, message: "Remove the payment rows, or turn off no payment due." });
    if (!grand.isZero()) issues.push({ rowId: null, message: "No payment due does not match the grand total. The PI total is not zero." });
    if (issues.length > 0) {
      return emptyAllocated(hasSubscription, allocation, explanation, issues);
    }
    return readyAllocated(input.currency, allocation, explanation, "No payment due.", "paragraph", true, [], null);
  }
  if (grand.isZero()) {
    return emptyAllocated(hasSubscription, allocation, explanation, [{
      rowId: null,
      message: "This PI total is zero. Mark the schedule as no payment due, or change the PI total.",
    }]);
  }
  if (oneTimeTotal.isZero()) {
    if (input.schedule.rows.length > 0) {
      return emptyAllocated(hasSubscription, allocation, explanation, [{
        rowId: null,
        message: NO_ONE_TIME_AMOUNT_MESSAGE,
      }]);
    }
    const text = subscriptionTotal.gt(0)
      ? `Subscription charges of ${formatMoney(allocation.subscriptionTotal, input.currency)} are payable 100% in advance.`
      : "No payment due.";
    return readyAllocated(input.currency, allocation, explanation, text, "paragraph", false, [], null);
  }

  const oneTimePreview = replaceTotalName(previewPaymentSchedule(
    { ...input.schedule, schema_version: 1 },
    input.currency,
    allocation.oneTimeTotal,
    { base: "one_time" },
  ));
  if (!oneTimePreview.ready || !oneTimePreview.canonical || !oneTimePreview.customerText) {
    return emptyAllocated(hasSubscription, allocation, explanation, oneTimePreview.issues);
  }
  const oneTimeSentence = oneTimePreview.customerText.replace(/\.$/, "");
  const text = subscriptionTotal.gt(0)
    ? `Subscription charges of ${formatMoney(allocation.subscriptionTotal, input.currency)} are payable 100% in advance. Of the remaining ${formatMoney(allocation.oneTimeTotal, input.currency)} for one-time items, ${oneTimeSentence}.`
    : oneTimePreview.customerText;
  const presentation = oneTimePreview.presentation === "table" || text.length > 420 ? "table" : "paragraph";
  return readyAllocated(
    input.currency,
    allocation,
    explanation,
    text,
    presentation,
    false,
    oneTimePreview.canonical.rows,
    oneTimePreview,
  );

  function emptyAllocated(
    subscription: boolean,
    current: AllocationResult,
    note: string | null,
    issues: ScheduleIssue[],
  ): DocumentPaymentPreview {
    return {
      hasSubscription: subscription,
      needsConversion: false,
      conversionMessage: null,
      allocation: current,
      explanation: note,
      customerText: null,
      canonical: null,
      oneTimePreview: null,
      ready: false,
      issues,
    };
  }

  function readyAllocated(
    currency: CurrencyCode,
    current: AllocationResult,
    note: string | null,
    customerText: string,
    presentation: "paragraph" | "table",
    noPaymentDue: boolean,
    rows: CanonicalPaymentRow[],
    oneTimePreview: PaymentPreview | null,
  ): DocumentPaymentPreview {
    const obligations: SubscriptionObligation[] = current.lines
      .filter((line) => line.billing_type === "subscription" && line.obligation_id)
      .map((line) => ({
        id: line.obligation_id as string,
        product_id: line.product_id,
        position: line.position,
        amount: line.allocated_total,
        due_formula: "payable 100% in advance",
      }));
    return {
      hasSubscription,
      needsConversion: false,
      conversionMessage: null,
      allocation: current,
      explanation: note,
      customerText,
      oneTimePreview,
      ready: true,
      issues: [],
      canonical: {
        schema_version: 2,
        currency,
        grand_total: money(grand),
        subscription_total: current.subscriptionTotal ?? "0.00",
        one_time_total: current.oneTimeTotal ?? "0.00",
        customer_text: customerText,
        presentation,
        no_payment_due: noPaymentDue,
        subscription_obligations: obligations,
        rows,
        allocation: {
          residual_target: input.schedule.residual_target ?? null,
          residual_applied: current.residualApplied,
          lines: current.lines,
        },
      },
    };
  }
}

export function negotiationNote(
  currency: CurrencyCode | null,
  yearOne: string,
  catalogueYearOne: string | null,
  laterBase: string | null,
  catalogueLaterBase: string | null,
): string | null {
  if (!currency) return null;
  const notes: string[] = [];
  if (catalogueYearOne != null && !sameMoney(yearOne, catalogueYearOne)) {
    notes.push(`Negotiated Year 1 price. The catalogue Year 1 price is ${formatMoney(catalogueYearOne, currency)}.`);
  }
  if (laterBase != null && catalogueLaterBase != null && !sameMoney(laterBase, catalogueLaterBase)) {
    notes.push(`Negotiated later-year base. The catalogue base is ${formatMoney(catalogueLaterBase, currency)}. Changing Year 1 does not change this base.`);
  }
  return notes.length > 0 ? notes.join(" ") : null;
}

function sameMoney(left: string | null, right: string | null): boolean {
  if (left == null || left.trim() === "") return right == null || right.trim() === "";
  if (right == null || right.trim() === "") return false;
  try {
    return new Decimal(left).eq(new Decimal(right));
  } catch {
    return false;
  }
}

export type LineSubscription = {
  obligationId: string;
  optionId: string;
  commitmentYears: number;
  currency: CurrencyCode;
  catalogueFirstYearUnitPrice: string;
  laterYearRule: LaterYearRule | null;
  laterYearBaseUnitPrice: string | null;
  catalogueLaterYearBaseUnitPrice: string | null;
  customerText: string;
};

export function lineSubscriptionFromAgreement(value: unknown): LineSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.option_id !== "string" || typeof record.obligation_id !== "string") return null;
  const years = Number(record.commitment_years);
  const currency = record.currency;
  if (!Number.isInteger(years) || years < 1) return null;
  if (currency !== "EGP" && currency !== "USD" && currency !== "EUR") return null;
  const rule = record.later_year_rule;
  return {
    obligationId: record.obligation_id,
    optionId: record.option_id,
    commitmentYears: years,
    currency,
    catalogueFirstYearUnitPrice: typeof record.catalogue_first_year_unit_price === "string" ? record.catalogue_first_year_unit_price : "",
    laterYearRule: rule === "fixed_annual" || rule === "vendor_confirmed_base_adjustment" ? rule : null,
    laterYearBaseUnitPrice: typeof record.later_year_base_unit_price === "string" ? record.later_year_base_unit_price : null,
    catalogueLaterYearBaseUnitPrice: typeof record.catalogue_later_year_base_unit_price === "string" ? record.catalogue_later_year_base_unit_price : null,
    customerText: typeof record.customer_text === "string" ? record.customer_text : "",
  };
}

export function catalogueDriftMessage(input: {
  savedYears: number;
  savedRule: LaterYearRule | null;
  savedCatalogueYearOne: string;
  savedCatalogueLaterBase: string | null;
  savedCurrency: CurrencyCode;
  option: {
    commitment_years: number;
    later_year_rule: LaterYearRule | null;
    first_year_unit_price: string | number;
    later_year_base_unit_price: string | number | null;
    currency: string;
    archived_at: string | null;
  } | null;
}): string | null {
  if (!input.option) {
    return "The catalogue commitment could not be found. This PI still uses the saved terms.";
  }
  const archived = input.option.archived_at
    ? "This commitment is archived. This PI still uses the saved terms. New lines cannot select it."
    : null;
  const changed = input.option.commitment_years !== input.savedYears
    || input.option.currency !== input.savedCurrency
    || input.option.later_year_rule !== input.savedRule
    || !sameMoney(String(input.option.first_year_unit_price), input.savedCatalogueYearOne)
    || !sameMoney(
      input.option.later_year_base_unit_price == null ? null : String(input.option.later_year_base_unit_price),
      input.savedCatalogueLaterBase,
    );
  if (!changed) return archived;
  const drift = "The catalogue commitment has changed since this line was saved. This PI still uses the saved terms.";
  return archived ? `${archived} ${drift}` : drift;
}
