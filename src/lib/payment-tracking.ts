import Decimal from "decimal.js";
import { formatIsoDate, isLeapYear, parseIsoDate } from "./payment-schedule";
import { roundMoney } from "./money";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DatedAmount = {
  receivedOn: string;
  recordedAt: string;
  id: string;
  amount: string;
};

export type AllocationTarget = {
  id: string;
  outstanding: string;
  position: number;
};

export type SuggestedAllocation = {
  obligationId: string;
  amount: string;
};

const MONEY = /^\d+(\.\d+)?$/;

export function cairoToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole years from the original anchor. 29 February clamps only in non-leap years. */
export function anniversaryDate(anchor: string, years: number): string {
  const parsed = parseIsoDate(anchor);
  if (!parsed || !Number.isInteger(years) || years < 0) {
    throw new Error("Invalid anniversary.");
  }
  const year = parsed.year + years;
  const day = parsed.month === 2 && parsed.day === 29 && !isLeapYear(year) ? 28 : parsed.day;
  return formatIsoDate(year, parsed.month, day);
}

export function commitmentPeriods(start: string, years: number): { year: number; startsOn: string; endsOn: string }[] {
  if (!Number.isInteger(years) || years < 1) throw new Error("Invalid commitment.");
  return Array.from({ length: years }, (_, index) => ({
    year: index + 1,
    startsOn: anniversaryDate(start, index),
    endsOn: anniversaryDate(start, index + 1),
  }));
}

/** The next committed year start. A one-year commitment has none. The end date is not a payment. */
export function nextCommittedPaymentDate(start: string, years: number, today: string): string | null {
  if (!Number.isInteger(years) || years < 2) return null;
  let next: string | null = null;
  for (let year = 2; year <= years; year += 1) {
    const date = anniversaryDate(start, year - 1);
    if (date >= today && (next == null || date < next)) next = date;
  }
  return next;
}

/**
 * Preview the activation date for a typed allocation.
 * Blank, incomplete, invalid, negative, and overly precise amounts return null
 * and are not treated as money. Recording still uses validateAllocation.
 */
export function pendingActivationDate(input: {
  existing: DatedAmount[];
  pendingAmount: string;
  required: string;
  receivedOn: string;
}): string | null {
  const pending = moneyAmount(input.pendingAmount);
  const required = moneyAmount(input.required);
  if (pending == null || pending.lte(0) || required == null || required.lte(0)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) || parseIsoDate(input.receivedOn) == null) return null;
  const existing = input.existing.flatMap((entry) => {
    const amount = moneyAmount(entry.amount);
    if (amount == null || amount.lte(0)) return [];
    return [{ ...entry, amount: amount.toFixed(2) }];
  });
  return completionReceivedOn([
    ...existing,
    {
      id: "new",
      receivedOn: input.receivedOn,
      recordedAt: "9999-12-31T00:00:00Z",
      amount: pending.toFixed(2),
    },
  ], required.toFixed(2));
}

export function completionReceivedOn(entries: DatedAmount[], required: string): string | null {
  const need = new Decimal(required);
  if (need.lte(0)) return null;
  const ordered = [...entries].sort((left, right) =>
    left.receivedOn.localeCompare(right.receivedOn)
    || left.recordedAt.localeCompare(right.recordedAt)
    || left.id.localeCompare(right.id));
  let running = new Decimal(0);
  for (const entry of ordered) {
    running = running.plus(entry.amount);
    if (running.gte(need)) return entry.receivedOn;
  }
  return null;
}

export function moneyAmount(value: string): Decimal | null {
  const trimmed = value.trim();
  if (!MONEY.test(trimmed)) return null;
  const amount = new Decimal(trimmed);
  if (!amount.eq(roundMoney(amount))) return null;
  return amount;
}

/** Fill obligations in document order. The result is a suggestion, not a saved allocation. */
export function suggestAllocation(obligations: AllocationTarget[], amount: string): SuggestedAllocation[] {
  const parsed = moneyAmount(amount);
  if (parsed == null || parsed.lte(0)) return [];
  let remaining = parsed;
  const result: SuggestedAllocation[] = [];
  const ordered = [...obligations].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  for (const obligation of ordered) {
    if (remaining.lte(0)) break;
    const unpaid = moneyAmount(obligation.outstanding);
    if (unpaid == null || unpaid.lte(0)) continue;
    const slice = unpaid.lt(remaining) ? unpaid : remaining;
    result.push({ obligationId: obligation.id, amount: slice.toFixed(2) });
    remaining = remaining.minus(slice);
  }
  return result;
}

export function allocationSum(allocations: { amount: string }[]): string {
  return allocations.reduce((sum, item) => {
    const parsed = moneyAmount(item.amount);
    return parsed == null ? sum : sum.plus(parsed);
  }, new Decimal(0)).toFixed(2);
}

export function validateAllocation(input: {
  amount: string;
  receivedOn: string;
  today: string;
  method: string;
  obligations: AllocationTarget[];
  allocations: { obligationId: string; amount: string }[];
}): string | null {
  const amount = moneyAmount(input.amount);
  if (amount == null || amount.lte(0)) return "Amount received must be greater than zero, with at most two decimal places.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) || parseIsoDate(input.receivedOn) == null) return "Enter a valid date received.";
  if (input.receivedOn > input.today) return "The received date cannot be in the future.";
  if (!["bank_transfer", "cash", "cheque", "other"].includes(input.method)) {
    return "Choose a payment method: bank transfer, cash, cheque, or other.";
  }
  const entered = input.allocations.filter((item) => item.amount.trim() !== "");
  if (entered.length === 0) return "Choose how this receipt is allocated. Nothing is allocated automatically.";
  const seen = new Set<string>();
  let sum = new Decimal(0);
  for (const item of entered) {
    if (seen.has(item.obligationId)) return "Allocate each obligation once on this receipt.";
    seen.add(item.obligationId);
    const slice = moneyAmount(item.amount);
    if (slice == null || slice.lte(0)) return "Each allocation must be greater than zero, with at most two decimal places.";
    const obligation = input.obligations.find((candidate) => candidate.id === item.obligationId);
    const unpaid = obligation ? moneyAmount(obligation.outstanding) : null;
    if (!obligation || unpaid == null) return "One of the selected payment obligations is not on this PI.";
    if (slice.gt(unpaid)) {
      return `That allocation is more than the unpaid balance of ${unpaid.toFixed(2)}.`;
    }
    sum = sum.plus(slice);
  }
  if (!sum.eq(amount)) {
    return `The allocations add up to ${sum.toFixed(2)}. The amount received is ${amount.toFixed(2)}. They must be equal. This PI does not keep an unallocated credit.`;
  }
  const outstanding = input.obligations.reduce((total, item) => {
    const unpaid = moneyAmount(item.outstanding);
    return unpaid == null ? total : total.plus(unpaid);
  }, new Decimal(0));
  if (amount.gt(outstanding)) {
    return `This receipt is more than the outstanding balance of ${outstanding.toFixed(2)}.`;
  }
  return null;
}

export function methodLabel(method: string): string {
  switch (method) {
    case "bank_transfer":
      return "Bank transfer";
    case "cash":
      return "Cash";
    case "cheque":
      return "Cheque";
    case "other":
      return "Other";
    default:
      return method;
  }
}

export function collectionLabel(status: string): string {
  switch (status) {
    case "unpaid":
      return "Unpaid";
    case "partial":
      return "Partially paid";
    case "paid":
      return "Paid";
    case "no_charge":
      return "No charge";
    default:
      return status;
  }
}

export function dueScheduleLabel(input: {
  dueTiming: string;
  dueDate: string | null;
  awaitingLabel: string;
  dueFormula: string;
  dueState: string;
}): { schedule: string; timing: string | null } {
  if (input.dueState === "settled") {
    return { schedule: input.dueDate ?? input.dueFormula, timing: null };
  }
  if (input.dueTiming === "advance" || input.dueState === "unscheduled" && input.dueTiming === "advance") {
    return { schedule: "Payable 100% in advance", timing: null };
  }
  if (input.dueTiming === "deadline_unset") return { schedule: "Deadline to be set", timing: null };
  if (input.dueTiming === "awaiting_event" || input.dueState === "unscheduled") {
    return { schedule: input.awaitingLabel || input.dueFormula || "Awaiting date", timing: null };
  }
  const timing = input.dueState === "overdue" ? "Overdue" : input.dueState === "due_today" ? "Due today" : input.dueState === "upcoming" ? "Upcoming" : null;
  return { schedule: input.dueDate ?? input.dueFormula, timing };
}
