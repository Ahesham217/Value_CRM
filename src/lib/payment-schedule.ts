import Decimal from "decimal.js";
import { formatMoney } from "./format";
import { roundMoney } from "./money";
import type { CurrencyCode } from "./types";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const PAYMENT_SCHEMA_VERSION = 1 as const;
export const MAX_PAYMENT_ROWS = 20;
export const MAX_INSTALMENTS = 120;
export const MAX_OFFSET_DAYS = 36600;
export const MAX_OFFSET_MONTHS = 1200;

const CURRENCIES = new Set<CurrencyCode>(["EGP", "USD", "EUR"]);
const STANDARD_EVENTS = ["order_confirmation", "shipment", "delivery", "commissioning"] as const;
const DECIMAL_TEXT = /^\d+(\.\d*)?$/;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SMALL_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export type StandardEventCode = (typeof STANDARD_EVENTS)[number];

export type PaymentEvent =
  | { type: "standard"; code: StandardEventCode }
  | { type: "custom"; id: string; label: string };

export type AmountBasis =
  | { type: "unset" }
  | { type: "percent"; percent: string | null }
  | { type: "fixed"; amount: string | null }
  | { type: "remainder" };

export type DueRule =
  | { type: "unset" }
  | { type: "date"; date: string | null }
  | { type: "on_event"; event: PaymentEvent | null }
  | { type: "after_event"; event: PaymentEvent | null; offset: number | null; unit: "days" | "months" | null }
  | { type: "before_shipment"; deadline: string | null };

export type InstalmentFirst =
  | { type: "unset" }
  | { type: "date"; date: string | null }
  | { type: "after_event"; event: PaymentEvent | null; offset: number | null; unit: "days" | "months" | null };

export type InstalmentPlan = {
  count: number | null;
  frequency: "monthly" | "yearly" | null;
  first: InstalmentFirst;
};

export type PaymentRow = {
  id: string;
  label: string;
  amount: AmountBasis;
  due: DueRule;
  instalments: InstalmentPlan | null;
};

export type PaymentSchedule = {
  schema_version: typeof PAYMENT_SCHEMA_VERSION;
  no_payment_due: boolean;
  dates_need_review: boolean;
  rows: PaymentRow[];
};

export type ScheduleIssue = {
  rowId: string | null;
  message: string;
};

export type CanonicalInstalment = {
  parent_id: string;
  sequence: number;
  count: number;
  amount: string;
  due_date: string | null;
  due_formula: string;
};

export type CanonicalPaymentRow = {
  id: string;
  position: number;
  label: string;
  amount_basis: AmountBasis;
  amount: string;
  due: DueRule;
  due_date: string | null;
  due_formula: string;
  instalment_plan: InstalmentPlan | null;
  instalments: CanonicalInstalment[] | null;
};

export type CanonicalPayment = {
  schema_version: typeof PAYMENT_SCHEMA_VERSION;
  currency: CurrencyCode;
  grand_total: string;
  customer_text: string;
  presentation: "paragraph" | "table";
  no_payment_due: boolean;
  rows: CanonicalPaymentRow[];
};

export type PaymentRowPreview = {
  id: string;
  amount: string | null;
  contractual: string | null;
  pending: string | null;
  instalments: CanonicalInstalment[] | null;
};

export type PaymentPreview = {
  issues: ScheduleIssue[];
  ready: boolean;
  customerText: string | null;
  presentation: "paragraph" | "table" | null;
  canonical: CanonicalPayment | null;
  allocated: string | null;
  unallocated: string | null;
  overallocated: string | null;
  rows: PaymentRowPreview[];
};

type ResolvedAmount = {
  row: PaymentRow;
  index: number;
  basis: "percent" | "fixed" | "remainder";
  percent: Decimal | null;
  amount: Decimal | null;
  independentAmount: Decimal | null;
};

export function emptyPaymentSchedule(): PaymentSchedule {
  return {
    schema_version: PAYMENT_SCHEMA_VERSION,
    no_payment_due: false,
    dates_need_review: false,
    rows: [],
  };
}

export function createPaymentRow(): PaymentRow {
  return {
    id: crypto.randomUUID(),
    label: "",
    amount: { type: "unset" },
    due: { type: "unset" },
    instalments: null,
  };
}

export function fullAdvanceTemplate(): PaymentSchedule {
  return {
    schema_version: PAYMENT_SCHEMA_VERSION,
    no_payment_due: false,
    dates_need_review: false,
    rows: [{
      id: crypto.randomUUID(),
      label: "advance payment",
      amount: { type: "percent", percent: "100" },
      due: { type: "on_event", event: { type: "standard", code: "order_confirmation" } },
      instalments: null,
    }],
  };
}

export function advanceThenShipmentTemplate(): PaymentSchedule {
  return {
    schema_version: PAYMENT_SCHEMA_VERSION,
    no_payment_due: false,
    dates_need_review: false,
    rows: [
      {
        id: crypto.randomUUID(),
        label: "advance payment",
        amount: { type: "percent", percent: "30" },
        due: { type: "on_event", event: { type: "standard", code: "order_confirmation" } },
        instalments: null,
      },
      {
        id: crypto.randomUUID(),
        label: "before shipment",
        amount: { type: "percent", percent: "70" },
        due: { type: "before_shipment", deadline: null },
        instalments: null,
      },
    ],
  };
}

export function isCurrencyCode(value: string | null | undefined): value is CurrencyCode {
  return value === "EGP" || value === "USD" || value === "EUR";
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatLongDate(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

/** Add calendar months to the original anchor, clamping only the target month. */
export function addCalendarMonths(isoDate: string, months: number): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed || !Number.isInteger(months)) {
    throw new Error("Invalid calendar date.");
  }
  const index = parsed.year * 12 + (parsed.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return formatIsoDate(year, month, day);
}

export function addDays(isoDate: string, days: number): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed || !Number.isInteger(days)) throw new Error("Invalid calendar date.");
  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day + days);
  const shifted = new Date(utc);
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function eventName(event: PaymentEvent): string {
  if (event.type === "custom") return event.label.trim();
  switch (event.code) {
    case "order_confirmation":
      return "order confirmation";
    case "shipment":
      return "shipment";
    case "delivery":
      return "delivery";
    case "commissioning":
      return "commissioning";
    default:
      return "";
  }
}

export function pendingEventStatus(event: PaymentEvent | null): string | null {
  if (!event) return null;
  if (event.type === "custom") {
    const label = event.label.trim();
    return label ? `Awaiting ${label} date` : "Awaiting milestone date";
  }
  switch (event.code) {
    case "order_confirmation":
      return "Awaiting confirmation date";
    case "shipment":
      return "Awaiting shipment date";
    case "delivery":
      return "Awaiting delivery date";
    case "commissioning":
      return "Awaiting commissioning date";
    default:
      return null;
  }
}

export function issueList(issues: ScheduleIssue[]): string {
  return issues.map((issue) => issue.message).join(" ");
}

export function readPaymentSchedule(value: unknown): PaymentSchedule | null {
  if (value == null) return null;
  return parsePaymentSchedule(value);
}

export function parsePaymentSchedule(value: unknown): PaymentSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The saved payment schedule could not be read.");
  }
  const record = value as Record<string, unknown>;
  if (record.schema_version !== PAYMENT_SCHEMA_VERSION) {
    throw new Error("This payment schedule uses a version this application cannot read.");
  }
  if (!Array.isArray(record.rows)) {
    throw new Error("The saved payment schedule could not be read.");
  }
  if (record.rows.length > MAX_PAYMENT_ROWS) {
    throw new Error(`A payment schedule can contain at most ${MAX_PAYMENT_ROWS} payments.`);
  }
  return {
    schema_version: PAYMENT_SCHEMA_VERSION,
    no_payment_due: record.no_payment_due === true,
    dates_need_review: record.dates_need_review === true,
    rows: record.rows.map((row, index) => parseRow(row, index)),
  };
}

export function previewPaymentSchedule(
  schedule: PaymentSchedule,
  currency: CurrencyCode | null,
  grandTotal: string | null,
): PaymentPreview {
  const issues: ScheduleIssue[] = [];
  if (!currency || !CURRENCIES.has(currency)) {
    issues.push({ rowId: null, message: "Choose an office and currency before the payment amounts can be calculated." });
    return emptyPreview(issues);
  }
  if (grandTotal == null || grandTotal.trim() === "") {
    issues.push({ rowId: null, message: "Enter a price on every item before the payment amounts can be calculated." });
    return emptyPreview(issues);
  }
  let total: Decimal;
  try {
    total = moneyDecimal(grandTotal, "Grand total");
  } catch (caught) {
    issues.push({ rowId: null, message: caught instanceof Error ? caught.message : "The grand total is not a valid amount." });
    return emptyPreview(issues);
  }
  if (total.isNegative()) {
    issues.push({ rowId: null, message: "The grand total cannot be negative." });
    return emptyPreview(issues);
  }

  if (schedule.no_payment_due) {
    if (schedule.rows.length > 0) {
      issues.push({ rowId: null, message: "Remove the payment rows, or turn off no payment due." });
    }
    if (!total.isZero()) {
      issues.push({ rowId: null, message: "No payment due does not match the grand total. The PI total is not zero." });
    }
    if (issues.length > 0) return emptyPreview(issues);
    const canonical = canonicalNoPayment(currency, money(total));
    return {
      issues: [],
      ready: true,
      customerText: canonical.customer_text,
      presentation: canonical.presentation,
      canonical,
      allocated: money(total),
      unallocated: money(new Decimal(0)),
      overallocated: null,
      rows: [],
    };
  }

  if (total.isZero()) {
    issues.push({
      rowId: null,
      message: "This PI total is zero. Mark the schedule as no payment due, or change the PI total.",
    });
    return emptyPreview(issues);
  }

  if (schedule.rows.length === 0) {
    issues.push({ rowId: null, message: "Add a payment before issuing." });
    return emptyPreview(issues);
  }
  if (schedule.rows.length > MAX_PAYMENT_ROWS) {
    issues.push({ rowId: null, message: `A payment schedule can contain at most ${MAX_PAYMENT_ROWS} payments.` });
  }

  const seen = new Set<string>();
  let remainderCount = 0;
  const resolved: ResolvedAmount[] = [];
  for (let index = 0; index < schedule.rows.length; index += 1) {
    const row = schedule.rows[index]!;
    const name = rowName(row, index);
    if (!row.id || seen.has(row.id)) {
      issues.push({ rowId: row.id || null, message: `${name} needs its own payment identifier.` });
    }
    seen.add(row.id);
    if (row.label.trim().length > 80) {
      issues.push({ rowId: row.id, message: `${name} has a label that is too long.` });
    }
    if (row.amount.type === "remainder") remainderCount += 1;
    resolved.push(resolveRowAmount(row, index, total, currency, issues));
    validateTiming(row, index, issues);
  }
  if (remainderCount > 1) {
    issues.push({ rowId: null, message: "Only one payment can be the remaining balance." });
  }

  const computable = resolved.every((entry) => entry.basis === "remainder" || entry.amount !== null) && remainderCount <= 1;
  let allocated: Decimal | null = null;
  let unallocated: Decimal | null = null;
  let overallocated: Decimal | null = null;

  if (computable && remainderCount <= 1) {
    const balance = balanceAmounts(resolved, total, issues);
    allocated = balance.allocated;
    unallocated = balance.unallocated;
    overallocated = balance.overallocated;
    for (const entry of resolved) {
      if (!entry.amount || entry.amount.lte(0) || !entry.row.instalments) continue;
      const expanded = expandInstalments(entry.row, entry.amount, currency, entry.index);
      if (expanded.error) issues.push({ rowId: entry.row.id, message: expanded.error });
    }
  } else if (remainderCount <= 1) {
    const known = resolved.filter((entry) => entry.amount !== null);
    allocated = known.length > 0
      ? known.reduce((sum, entry) => sum.plus(entry.amount ?? 0), new Decimal(0))
      : null;
  }

  const previews = resolved.map((entry) => previewRow(entry, currency));
  const ready = issues.length === 0 && allocated !== null && overallocated === null && unallocated?.isZero() === true;
  if (!ready) {
    return {
      issues,
      ready: false,
      customerText: null,
      presentation: null,
      canonical: null,
      allocated: allocated ? money(allocated) : null,
      unallocated: unallocated ? money(unallocated) : null,
      overallocated: overallocated ? money(overallocated) : null,
      rows: previews,
    };
  }

  const canonicalRows = resolved.map((entry, index) => canonicalRow(entry, index, currency));
  const customerText = customerWording(canonicalRows, resolved, total, currency);
  const presentation = choosePresentation(customerText, canonicalRows);
  const canonical: CanonicalPayment = {
    schema_version: PAYMENT_SCHEMA_VERSION,
    currency,
    grand_total: money(total),
    customer_text: customerText,
    presentation,
    no_payment_due: false,
    rows: canonicalRows,
  };
  return {
    issues: [],
    ready: true,
    customerText,
    presentation,
    canonical,
    allocated: money(total),
    unallocated: money(new Decimal(0)),
    overallocated: null,
    rows: previews.map((preview, index) => ({
      ...preview,
      amount: canonicalRows[index]?.amount ?? preview.amount,
      instalments: canonicalRows[index]?.instalments ?? preview.instalments,
      contractual: canonicalRows[index]?.due_formula ?? preview.contractual,
    })),
  };
}

export function copyPaymentScheduleForDuplicate(schedule: PaymentSchedule): PaymentSchedule {
  const eventIds = new Map<string, string>();
  let cleared = false;
  const rows = schedule.rows.map((row) => {
    const due = structuredClone(row.due);
    const instalments = row.instalments ? structuredClone(row.instalments) : null;
    if (due.type === "date" && due.date) {
      due.date = null;
      cleared = true;
    }
    if (due.type === "before_shipment" && due.deadline) {
      due.deadline = null;
      cleared = true;
    }
    if (due.type === "on_event" || due.type === "after_event") {
      due.event = remapEvent(due.event, eventIds);
    }
    if (instalments?.first.type === "date" && instalments.first.date) {
      instalments.first.date = null;
      cleared = true;
    }
    if (instalments?.first.type === "after_event") {
      instalments.first.event = remapEvent(instalments.first.event, eventIds);
    }
    return {
      ...row,
      id: crypto.randomUUID(),
      due,
      instalments,
    };
  });
  return {
    schema_version: PAYMENT_SCHEMA_VERSION,
    no_payment_due: schedule.no_payment_due,
    dates_need_review: cleared,
    rows,
  };
}

function remapEvent(event: PaymentEvent | null, eventIds: Map<string, string>): PaymentEvent | null {
  if (!event || event.type !== "custom") return event;
  let id = eventIds.get(event.id);
  if (!id) {
    id = crypto.randomUUID();
    eventIds.set(event.id, id);
  }
  return { ...event, id };
}

function emptyPreview(issues: ScheduleIssue[]): PaymentPreview {
  return {
    issues,
    ready: false,
    customerText: null,
    presentation: null,
    canonical: null,
    allocated: null,
    unallocated: null,
    overallocated: null,
    rows: [],
  };
}

function canonicalNoPayment(currency: CurrencyCode, grandTotal: string): CanonicalPayment {
  return {
    schema_version: PAYMENT_SCHEMA_VERSION,
    currency,
    grand_total: grandTotal,
    customer_text: "No payment due.",
    presentation: "paragraph",
    no_payment_due: true,
    rows: [],
  };
}

function resolveRowAmount(
  row: PaymentRow,
  index: number,
  total: Decimal,
  currency: CurrencyCode,
  issues: ScheduleIssue[],
): ResolvedAmount {
  const name = rowName(row, index);
  if (row.amount.type === "unset") {
    issues.push({ rowId: row.id, message: `${name}: choose an amount.` });
    return { row, index, basis: "fixed", percent: null, amount: null, independentAmount: null };
  }
  if (row.amount.type === "remainder") {
    return { row, index, basis: "remainder", percent: null, amount: null, independentAmount: null };
  }
  if (row.amount.type === "percent") {
    if (row.amount.percent == null || row.amount.percent.trim() === "") {
      issues.push({ rowId: row.id, message: `${name}: enter the percentage.` });
      return { row, index, basis: "percent", percent: null, amount: null, independentAmount: null };
    }
    const percent = decimalOrIssue(row.amount.percent, `${name}: the percentage`, 4, issues, row.id);
    if (!percent) return { row, index, basis: "percent", percent: null, amount: null, independentAmount: null };
    if (percent.isZero()) {
      issues.push({ rowId: row.id, message: `${name}: the percentage must be greater than zero.` });
    } else if (percent.gt(100)) {
      issues.push({ rowId: row.id, message: `${name}: the percentage cannot be more than 100.` });
    }
    const independent = roundMoney(total.mul(percent).div(100));
    if (independent.lte(0)) {
      issues.push({ rowId: row.id, message: `${name}: the percentage rounds to zero. Increase it or use a fixed amount.` });
    }
    return { row, index, basis: "percent", percent, amount: independent, independentAmount: independent };
  }
  if (row.amount.amount == null || row.amount.amount.trim() === "") {
    issues.push({ rowId: row.id, message: `${name}: enter the amount.` });
    return { row, index, basis: "fixed", percent: null, amount: null, independentAmount: null };
  }
  const amount = decimalOrIssue(row.amount.amount, `${name}: the amount`, 2, issues, row.id);
  if (!amount) return { row, index, basis: "fixed", percent: null, amount: null, independentAmount: null };
  if (amount.isZero()) {
    issues.push({ rowId: row.id, message: `${name}: the amount must be greater than zero.` });
  }
  if (currency && amount.gt(0)) {
    return { row, index, basis: "fixed", percent: null, amount, independentAmount: amount };
  }
  return { row, index, basis: "fixed", percent: null, amount, independentAmount: amount };
}

function balanceAmounts(
  resolved: ResolvedAmount[],
  total: Decimal,
  issues: ScheduleIssue[],
): { allocated: Decimal | null; unallocated: Decimal | null; overallocated: Decimal | null; roundingAdjusted: boolean } {
  const remainder = resolved.find((entry) => entry.basis === "remainder") ?? null;
  const others = resolved.filter((entry) => entry.basis !== "remainder");
  if (others.some((entry) => entry.amount === null)) {
    return { allocated: null, unallocated: null, overallocated: null, roundingAdjusted: false };
  }
  let sum = others.reduce((totalAmount, entry) => totalAmount.plus(entry.amount ?? 0), new Decimal(0));
  let roundingAdjusted = false;
  const percentOnly = !remainder && others.length > 0 && others.every((entry) => entry.basis === "percent" && entry.percent !== null);
  if (percentOnly) {
    const percentSum = others.reduce((totalPercent, entry) => totalPercent.plus(entry.percent ?? 0), new Decimal(0));
    if (percentSum.eq(100)) {
      const diff = total.minus(sum);
      if (!diff.isZero()) {
        const limit = new Decimal(others.length).mul("0.01");
        if (diff.abs().gt(limit)) {
          issues.push({
            rowId: null,
            message: `The percentage payments differ from the grand total by ${money(diff.abs())}, which is too large to treat as rounding.`,
          });
          return { allocated: sum, unallocated: diff.isPositive() ? diff : new Decimal(0), overallocated: diff.isNegative() ? diff.abs() : null, roundingAdjusted: false };
        }
        const last = others[others.length - 1]!;
        const adjusted = (last.amount ?? new Decimal(0)).plus(diff);
        if (adjusted.lte(0)) {
          issues.push({ rowId: last.row.id, message: `${rowName(last.row, last.index)}: rounding would remove this payment. Adjust the percentages.` });
          return { allocated: sum, unallocated: null, overallocated: null, roundingAdjusted: false };
        }
        last.amount = adjusted;
        sum = total;
        roundingAdjusted = true;
      }
    }
  }

  if (remainder) {
    if (sum.gt(total)) {
      const over = sum.minus(total);
      issues.push({
        rowId: null,
        message: `The other payments allocate ${money(sum)} against a grand total of ${money(total)}. Reduce a payment before the remaining balance can be used.`,
      });
      return { allocated: sum, unallocated: new Decimal(0), overallocated: over, roundingAdjusted };
    }
    const remaining = total.minus(sum);
    if (remaining.lte(0)) {
      issues.push({ rowId: remainder.row.id, message: `${rowName(remainder.row, remainder.index)}: the remaining balance is not positive.` });
      return { allocated: sum, unallocated: new Decimal(0), overallocated: null, roundingAdjusted };
    }
    remainder.amount = remaining;
    remainder.independentAmount = remaining;
    return { allocated: total, unallocated: new Decimal(0), overallocated: null, roundingAdjusted };
  }

  if (sum.gt(total)) {
    const over = sum.minus(total);
    issues.push({
      rowId: null,
      message: `The payment schedule allocates ${money(sum)} against a grand total of ${money(total)}. Reduce a payment before issuing.`,
    });
    return { allocated: sum, unallocated: new Decimal(0), overallocated: over, roundingAdjusted };
  }
  if (sum.lt(total)) {
    const gap = total.minus(sum);
    issues.push({
      rowId: null,
      message: `The payment schedule allocates ${money(sum)} of ${money(total)}. ${money(gap)} is still unallocated. Add a payment or a remaining-balance row before issuing.`,
    });
    return { allocated: sum, unallocated: gap, overallocated: null, roundingAdjusted };
  }
  if (resolved.some((entry) => entry.amount !== null && entry.amount.lte(0))) {
    issues.push({ rowId: null, message: "Every scheduled payment must be greater than zero." });
  }
  return { allocated: total, unallocated: new Decimal(0), overallocated: null, roundingAdjusted };
}

function validateTiming(row: PaymentRow, index: number, issues: ScheduleIssue[]) {
  const name = rowName(row, index);
  if (row.instalments) {
    validateInstalmentPlan(row.instalments, name, row.id, issues);
    return;
  }
  validateDue(row.due, name, row.id, issues);
}

function validateDue(due: DueRule, name: string, rowId: string, issues: ScheduleIssue[]) {
  if (due.type === "unset") {
    issues.push({ rowId, message: `${name}: choose when it is due.` });
    return;
  }
  if (due.type === "date") {
    if (!due.date) issues.push({ rowId, message: `${name}: enter the due date.` });
    else if (!parseIsoDate(due.date)) issues.push({ rowId, message: `${name}: the due date is not a real calendar date.` });
    return;
  }
  if (due.type === "before_shipment") {
    if (due.deadline && !parseIsoDate(due.deadline)) {
      issues.push({ rowId, message: `${name}: the before-shipment deadline is not a real calendar date.` });
    }
    return;
  }
  if (due.type === "on_event") {
    validateEvent(due.event, name, rowId, issues);
    return;
  }
  validateEvent(due.event, name, rowId, issues);
  validateOffset(due.offset, due.unit, name, rowId, issues);
}

function validateInstalmentPlan(plan: InstalmentPlan, name: string, rowId: string, issues: ScheduleIssue[]) {
  if (plan.count == null) {
    issues.push({ rowId, message: `${name}: enter the number of instalments.` });
  } else if (!Number.isInteger(plan.count) || plan.count < 2 || plan.count > MAX_INSTALMENTS) {
    issues.push({ rowId, message: `${name}: instalments must be a whole number from 2 to ${MAX_INSTALMENTS}.` });
  }
  if (plan.frequency !== "monthly" && plan.frequency !== "yearly") {
    issues.push({ rowId, message: `${name}: choose monthly or yearly instalments.` });
  }
  if (plan.first.type === "unset") {
    issues.push({ rowId, message: `${name}: choose when the first instalment is due.` });
    return;
  }
  if (plan.first.type === "date") {
    if (!plan.first.date) issues.push({ rowId, message: `${name}: enter the first instalment date.` });
    else if (!parseIsoDate(plan.first.date)) issues.push({ rowId, message: `${name}: the first instalment date is not a real calendar date.` });
    return;
  }
  validateEvent(plan.first.event, name, rowId, issues);
  validateOffset(plan.first.offset, plan.first.unit, name, rowId, issues);
}

function validateEvent(event: PaymentEvent | null, name: string, rowId: string, issues: ScheduleIssue[]) {
  if (!event) {
    issues.push({ rowId, message: `${name}: choose the milestone.` });
    return;
  }
  if (event.type === "standard") {
    if (!STANDARD_EVENTS.includes(event.code)) {
      issues.push({ rowId, message: `${name}: choose a supported milestone.` });
    }
    return;
  }
  if (!UUID_TEXT.test(event.id)) {
    issues.push({ rowId, message: `${name}: the custom milestone needs a stable identifier.` });
  }
  if (!event.label.trim()) {
    issues.push({ rowId, message: `${name}: enter a name for the custom milestone.` });
  } else if (event.label.trim().length > 80) {
    issues.push({ rowId, message: `${name}: the custom milestone name is too long.` });
  }
}

function validateOffset(
  offset: number | null,
  unit: "days" | "months" | null,
  name: string,
  rowId: string,
  issues: ScheduleIssue[],
) {
  if (unit !== "days" && unit !== "months") {
    issues.push({ rowId, message: `${name}: choose days or calendar months.` });
    return;
  }
  if (offset == null) {
    issues.push({ rowId, message: `${name}: enter how many ${unit} after the milestone.` });
    return;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    issues.push({ rowId, message: `${name}: the milestone offset must be a whole number of ${unit}.` });
    return;
  }
  const max = unit === "days" ? MAX_OFFSET_DAYS : MAX_OFFSET_MONTHS;
  if (offset > max) {
    issues.push({ rowId, message: `${name}: the milestone offset is too large.` });
  }
}

function previewRow(entry: ResolvedAmount, currency: CurrencyCode): PaymentRowPreview {
  const timing = contractualTiming(entry.row);
  return {
    id: entry.row.id,
    amount: entry.amount ? money(entry.amount) : null,
    contractual: timing.contractual,
    pending: timing.pending,
    instalments: entry.amount && entry.row.instalments
      ? expandInstalments(entry.row, entry.amount, currency, entry.index).instalments
      : null,
  };
}

function canonicalRow(entry: ResolvedAmount, index: number, currency: CurrencyCode): CanonicalPaymentRow {
  const amount = entry.amount ?? new Decimal(0);
  const expanded = entry.row.instalments ? expandInstalments(entry.row, amount, currency, entry.index) : null;
  const timing = contractualTiming(entry.row);
  return {
    id: entry.row.id,
    position: index + 1,
    label: entry.row.label.trim(),
    amount_basis: entry.row.amount,
    amount: money(amount),
    due: entry.row.instalments ? { type: "unset" } : entry.row.due,
    due_date: expanded ? null : timing.dueDate,
    due_formula: expanded?.groupFormula || timing.contractual || "",
    instalment_plan: entry.row.instalments,
    instalments: expanded?.instalments ?? null,
  };
}

function contractualTiming(row: PaymentRow): { contractual: string | null; pending: string | null; dueDate: string | null } {
  if (row.instalments) {
    const plan = row.instalments;
    if (plan.first.type === "date" && plan.first.date && parseIsoDate(plan.first.date)) {
      return { contractual: `first instalment on ${formatLongDate(plan.first.date)}`, pending: null, dueDate: plan.first.date };
    }
    if (plan.first.type === "after_event" && plan.first.event && plan.first.offset != null && plan.first.unit) {
      return {
        contractual: `first instalment ${offsetPhrase(plan.first.offset, plan.first.unit, eventName(plan.first.event))}`,
        pending: pendingEventStatus(plan.first.event),
        dueDate: null,
      };
    }
    return { contractual: null, pending: null, dueDate: null };
  }
  const due = row.due;
  if (due.type === "date" && due.date && parseIsoDate(due.date)) {
    return { contractual: formatLongDate(due.date), pending: null, dueDate: due.date };
  }
  if (due.type === "on_event" && due.event && eventName(due.event)) {
    return { contractual: `upon ${eventName(due.event)}`, pending: pendingEventStatus(due.event), dueDate: null };
  }
  if (due.type === "after_event" && due.event && due.offset != null && due.unit && eventName(due.event)) {
    return {
      contractual: offsetPhrase(due.offset, due.unit, eventName(due.event)),
      pending: pendingEventStatus(due.event),
      dueDate: null,
    };
  }
  if (due.type === "before_shipment") {
    if (due.deadline && parseIsoDate(due.deadline)) {
      return {
        contractual: `before shipment, and no later than ${formatLongDate(due.deadline)}`,
        pending: null,
        dueDate: due.deadline,
      };
    }
    return { contractual: "before shipment", pending: "Deadline to be set", dueDate: null };
  }
  return { contractual: null, pending: null, dueDate: null };
}

function expandInstalments(
  row: PaymentRow,
  amount: Decimal,
  currency: CurrencyCode,
  index: number,
): { instalments: CanonicalInstalment[]; groupFormula: string; error: string | null } {
  const plan = row.instalments;
  if (!plan || plan.count == null || !plan.frequency || plan.first.type === "unset") {
    return { instalments: [], groupFormula: "", error: null };
  }
  const parts = splitInstalments(amount, plan.count);
  if (parts.some((part) => part.lte(0))) {
    return {
      instalments: [],
      groupFormula: "",
      error: `${rowName(row, index)}: an instalment would be zero. Use fewer instalments or a larger amount.`,
    };
  }
  const instalments = parts.map((part, index) => {
    const sequence = index + 1;
    const due = instalmentDue(plan, sequence);
    return {
      parent_id: row.id,
      sequence,
      count: plan.count!,
      amount: money(part),
      due_date: due.dueDate,
      due_formula: due.formula,
    };
  });
  const groupFormula = instalmentGroupFormula(plan, parts, currency);
  return { instalments, groupFormula, error: null };
}

export function splitInstalments(total: Decimal, count: number): Decimal[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("Invalid instalment count.");
  const regular = roundMoney(total.div(count));
  const amounts: Decimal[] = [];
  let sum = new Decimal(0);
  for (let index = 0; index < count - 1; index += 1) {
    amounts.push(regular);
    sum = sum.plus(regular);
  }
  amounts.push(roundMoney(total.minus(sum)));
  return amounts;
}

function instalmentDue(plan: InstalmentPlan, sequence: number): { dueDate: string | null; formula: string } {
  const first = plan.first;
  const frequency = plan.frequency ?? "monthly";
  if (first.type === "date" && first.date && parseIsoDate(first.date)) {
    const step = frequency === "yearly" ? 12 : 1;
    const dueDate = addCalendarMonths(first.date, (sequence - 1) * step);
    return { dueDate, formula: formatLongDate(dueDate) };
  }
  if (first.type !== "after_event" || !first.event || first.offset == null || !first.unit) {
    return { dueDate: null, formula: "" };
  }
  const name = eventName(first.event);
  if (first.unit === "months") {
    const step = frequency === "yearly" ? 12 : 1;
    const totalMonths = first.offset + (sequence - 1) * step;
    return { dueDate: null, formula: offsetPhrase(totalMonths, "months", name) };
  }
  if (sequence === 1) {
    return { dueDate: null, formula: offsetPhrase(first.offset, "days", name) };
  }
  const gap = sequence - 1;
  const later = frequency === "yearly"
    ? `${gap === 1 ? "one year" : `${smallNumber(gap)} years`} after the first instalment, which is due ${offsetPhrase(first.offset, "days", name)}`
    : `${gap === 1 ? "one calendar month" : `${smallNumber(gap)} calendar months`} after the first instalment, which is due ${offsetPhrase(first.offset, "days", name)}`;
  return { dueDate: null, formula: later };
}

function instalmentGroupFormula(plan: InstalmentPlan, parts: Decimal[], currency: CurrencyCode): string {
  const count = plan.count ?? parts.length;
  const frequency = plan.frequency === "yearly" ? "yearly" : "monthly";
  const first = plan.first;
  const firstPhrase = first.type === "date" && first.date
    ? `on ${formatLongDate(first.date)}`
    : first.type === "after_event" && first.event && first.offset != null && first.unit
      ? offsetPhrase(first.offset, first.unit, eventName(first.event))
      : "";
  const equal = parts.every((part) => part.eq(parts[0] ?? 0));
  if (!equal) {
    return `payable in ${count} ${frequency} instalments of ${formatMoney((parts[0] ?? new Decimal(0)).toFixed(2), currency)}, with a final instalment of ${formatMoney((parts[parts.length - 1] ?? new Decimal(0)).toFixed(2), currency)}, the first instalment due ${firstPhrase}`;
  }
  return `payable in ${count} ${frequency} instalments, with the first instalment due ${firstPhrase}`;
}

function customerWording(
  rows: CanonicalPaymentRow[],
  resolved: ResolvedAmount[],
  total: Decimal,
  currency: CurrencyCode,
): string {
  return joinClauses(rows.map((row, index) => paymentClause(row, resolved[index]!, total, currency)));
}

function paymentClause(
  row: CanonicalPaymentRow,
  entry: ResolvedAmount,
  total: Decimal,
  currency: CurrencyCode,
): string {
  const amount = amountPhrase(row, entry, total, currency);
  if (row.instalment_plan && row.due_formula) return `${amount} ${row.due_formula}`;
  return `${amount}${timingSuffix(row)}`;
}

function amountPhrase(
  row: CanonicalPaymentRow,
  entry: ResolvedAmount,
  total: Decimal,
  currency: CurrencyCode,
): string {
  const basis = row.amount_basis;
  if (basis.type === "remainder") {
    const percent = entry.amount ? cleanRemainderPercent(entry.amount, total) : null;
    if (percent) return `the remaining ${percent}%`;
    return `the remaining balance of ${formatMoney(row.amount, currency)}`;
  }
  let text = "";
  if (basis.type === "percent") {
    text = `${displayPercent(basis.percent)}%`;
    if (entry.amount && entry.independentAmount && !entry.amount.eq(entry.independentAmount)) {
      text += ` (${formatMoney(entry.amount.toFixed(2), currency)})`;
    }
  } else if (basis.type === "fixed") {
    text = formatMoney(row.amount, currency);
  }
  if (row.label && !labelIsRedundant(row.label, row)) text += ` ${row.label}`;
  return text;
}

function cleanRemainderPercent(remainder: Decimal, total: Decimal): string | null {
  if (total.lte(0) || remainder.lte(0)) return null;
  const percent = remainder.div(total).mul(100);
  const rounded = percent.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!percent.eq(rounded)) return null;
  if (!roundMoney(total.mul(rounded).div(100)).eq(remainder)) return null;
  return displayPercent(rounded.toFixed(2));
}

function labelIsRedundant(label: string, row: CanonicalPaymentRow): boolean {
  const norm = label.trim().toLowerCase();
  if (!norm) return true;
  if (row.instalment_plan) return false;
  if (row.due.type === "before_shipment" && (norm === "before shipment" || norm === "shipment")) return true;
  if (row.due.type === "on_event" && row.due.event) {
    const name = eventName(row.due.event);
    if (norm === name || norm === `upon ${name}`) return true;
  }
  return false;
}

function timingSuffix(row: CanonicalPaymentRow): string {
  const due = row.due;
  if (due.type === "date" && due.date) return ` due on ${formatLongDate(due.date)}`;
  if (due.type === "on_event" && due.event) return ` upon ${eventName(due.event)}`;
  if (due.type === "after_event" && due.event && due.offset != null && due.unit) {
    return ` due ${offsetPhrase(due.offset, due.unit, eventName(due.event))}`;
  }
  if (due.type === "before_shipment") {
    if (due.deadline) return ` before shipment, and no later than ${formatLongDate(due.deadline)}`;
    return " before shipment";
  }
  if (row.due_formula) return ` ${row.due_formula}`;
  return "";
}

function choosePresentation(customerText: string, rows: CanonicalPaymentRow[]): "paragraph" | "table" {
  const groups = rows.filter((row) => row.instalments && row.instalments.length > 0).length;
  const expanded = rows.reduce((count, row) => count + (row.instalments?.length ?? 0), 0);
  if (rows.length > 4 || groups > 1 || expanded > 12 || customerText.length > 420) return "table";
  return "paragraph";
}

function joinClauses(clauses: string[]): string {
  const cleaned = clauses.map((clause) => clause.trim()).filter(Boolean);
  if (cleaned.length === 0) return "No payment due.";
  const body = cleaned.length === 1
    ? cleaned[0]!
    : `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
  const sentence = /^[a-z]/.test(body) ? `${body.charAt(0).toUpperCase()}${body.slice(1)}` : body;
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

function offsetPhrase(offset: number, unit: "days" | "months", event: string): string {
  if (offset === 0) return `on ${event}`;
  if (unit === "months") {
    const count = offset === 1 ? "one calendar month" : `${smallNumber(offset)} calendar months`;
    return `${count} after ${event}`;
  }
  const count = offset === 1 ? "one day" : `${smallNumber(offset)} days`;
  return `${count} after ${event}`;
}

function smallNumber(value: number): string {
  if (value >= 0 && value <= 10) return SMALL_NUMBERS[value] ?? String(value);
  return String(value);
}

function displayPercent(value: string | null): string {
  if (!value) return "";
  const decimal = new Decimal(value);
  const fixed = decimal.toFixed(Math.min(4, decimal.decimalPlaces()));
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function rowName(row: PaymentRow, index: number): string {
  return row.label.trim() || `Payment ${index + 1}`;
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function moneyDecimal(value: string, label: string): Decimal {
  const parsed = decimalText(value, label, 2);
  return roundMoney(parsed);
}

function decimalOrIssue(
  value: string,
  label: string,
  scale: number,
  issues: ScheduleIssue[],
  rowId: string,
): Decimal | null {
  try {
    return decimalText(value, label, scale);
  } catch (caught) {
    issues.push({ rowId, message: caught instanceof Error ? `${caught.message.charAt(0).toUpperCase()}${caught.message.slice(1)}` : `${label} is invalid.` });
    return null;
  }
}

function decimalText(value: string, label: string, scale: number): Decimal {
  const trimmed = value.trim();
  if (!DECIMAL_TEXT.test(trimmed)) throw new Error(`${label} must be a nonnegative number.`);
  const decimal = new Decimal(trimmed);
  if (decimal.isNegative()) throw new Error(`${label} cannot be negative.`);
  if (decimal.decimalPlaces() > scale) {
    throw new Error(scale === 2 ? `${label} can have at most two decimal places.` : `${label} can have at most four decimal places.`);
  }
  return decimal;
}

function parseRow(value: unknown, index: number): PaymentRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Payment ${index + 1} could not be read.`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !UUID_TEXT.test(row.id)) {
    throw new Error(`Payment ${index + 1} could not be read.`);
  }
  if (typeof row.label !== "string") throw new Error(`Payment ${index + 1} could not be read.`);
  return {
    id: row.id,
    label: row.label,
    amount: parseAmount(row.amount, index),
    due: parseDue(row.due, index),
    instalments: parseInstalments(row.instalments, index),
  };
}

function parseAmount(value: unknown, index: number): AmountBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Payment ${index + 1} could not be read.`);
  const amount = value as Record<string, unknown>;
  if (amount.type === "unset" || amount.type === "remainder") return { type: amount.type };
  if (amount.type === "percent") return { type: "percent", percent: nullableString(amount.percent) };
  if (amount.type === "fixed") return { type: "fixed", amount: nullableString(amount.amount) };
  throw new Error(`Payment ${index + 1} could not be read.`);
}

function parseDue(value: unknown, index: number): DueRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Payment ${index + 1} could not be read.`);
  const due = value as Record<string, unknown>;
  if (due.type === "unset") return { type: "unset" };
  if (due.type === "date") return { type: "date", date: nullableString(due.date) };
  if (due.type === "before_shipment") return { type: "before_shipment", deadline: nullableString(due.deadline) };
  if (due.type === "on_event") return { type: "on_event", event: parseEvent(due.event) };
  if (due.type === "after_event") {
    return {
      type: "after_event",
      event: parseEvent(due.event),
      offset: nullableInteger(due.offset),
      unit: due.unit === "days" || due.unit === "months" ? due.unit : null,
    };
  }
  throw new Error(`Payment ${index + 1} could not be read.`);
}

function parseInstalments(value: unknown, index: number): InstalmentPlan | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Payment ${index + 1} could not be read.`);
  const plan = value as Record<string, unknown>;
  const first = plan.first;
  if (!first || typeof first !== "object" || Array.isArray(first)) throw new Error(`Payment ${index + 1} could not be read.`);
  const firstRecord = first as Record<string, unknown>;
  let parsedFirst: InstalmentFirst;
  if (firstRecord.type === "unset") parsedFirst = { type: "unset" };
  else if (firstRecord.type === "date") parsedFirst = { type: "date", date: nullableString(firstRecord.date) };
  else if (firstRecord.type === "after_event") {
    parsedFirst = {
      type: "after_event",
      event: parseEvent(firstRecord.event),
      offset: nullableInteger(firstRecord.offset),
      unit: firstRecord.unit === "days" || firstRecord.unit === "months" ? firstRecord.unit : null,
    };
  } else {
    throw new Error(`Payment ${index + 1} could not be read.`);
  }
  return {
    count: nullableInteger(plan.count),
    frequency: plan.frequency === "monthly" || plan.frequency === "yearly" ? plan.frequency : null,
    first: parsedFirst,
  };
}

function parseEvent(value: unknown): PaymentEvent | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.type === "standard" && typeof event.code === "string" && STANDARD_EVENTS.includes(event.code as StandardEventCode)) {
    return { type: "standard", code: event.code as StandardEventCode };
  }
  if (event.type === "custom" && typeof event.id === "string") {
    return { type: "custom", id: event.id, label: typeof event.label === "string" ? event.label : "" };
  }
  return null;
}

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

function nullableInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function paymentPresentation(customerText: string, rows: CanonicalPaymentRow[]): "paragraph" | "table" {
  return choosePresentation(customerText, rows);
}
