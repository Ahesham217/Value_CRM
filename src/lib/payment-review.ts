import { REPORT_CURRENCIES } from "./reporting";
import type { CurrencyCode } from "./types";

export const INTERNAL_REFERENCE_LIMIT = 80;
export const REVIEW_NOTE_LIMIT = 400;

export const REVIEW_DISPLAY_STATUSES = [
  "awaiting_review",
  "needs_clarification",
  "verified",
  "reversed",
  "reversed_previously_verified",
] as const;

export const RECEIVED_FILTERS = ["awaiting", "clarification", "verified", "open", "reversed"] as const;

export const REVIEW_ACTIONS = ["verify", "clarify", "reopen"] as const;

export type ReviewDisplayStatus = (typeof REVIEW_DISPLAY_STATUSES)[number];
export type ReceivedFilter = (typeof RECEIVED_FILTERS)[number];
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export type StoredReviewStatus = "awaiting_review" | "needs_clarification" | "verified";

export const RECEIVED_FILTER_LABELS: Record<ReceivedFilter, string> = {
  awaiting: "Awaiting review",
  clarification: "Needs clarification",
  verified: "Verified",
  open: "All non-reversed",
  reversed: "Reversed",
};

const MONEY = /^\d+\.\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReceivedLocation = {
  status: ReceivedFilter;
  search: string;
  currency: "" | CurrencyCode;
  receivedFrom: string;
  receivedTo: string;
  page: number;
  receiptId: string;
};

export type ReceivedRow = {
  id: string;
  receivedOn: string;
  clientName: string;
  piId: string;
  piNumber: string | null;
  trackedRevision: number | null;
  trackedDisplayNumber: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  internalReference: string | null;
  recordedBy: string;
  recordedByName: string;
  reviewStatus: ReviewDisplayStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  version: number;
};

export type ReceivedRegister = {
  status: ReceivedFilter;
  count: number;
  rows: ReceivedRow[];
};

export type ReviewAllocation = {
  obligationId: string;
  label: string;
  amount: string;
};

export type ReviewEvent = {
  id: string;
  action: "verified" | "needs_clarification" | "reopened";
  fromStatus: StoredReviewStatus;
  toStatus: StoredReviewStatus;
  internalReference: string | null;
  note: string | null;
  actorId: string;
  actorName: string;
  actedAt: string;
  version: number;
};

export type ReceiptReviewDetail = {
  receipt: {
    id: string;
    planId: string;
    receivedOn: string;
    amount: string;
    currency: string;
    method: string;
    reference: string | null;
    note: string | null;
    recordedBy: string;
    recordedByName: string;
    recordedAt: string;
    reversedAt: string | null;
    reversedBy: string | null;
    reversedByName: string | null;
    reversalReason: string | null;
  };
  allocations: ReviewAllocation[];
  source: {
    piId: string;
    piNumber: string | null;
    trackedRevision: number | null;
    trackedDisplayNumber: string;
    sourceVersionId: string;
    clientName: string;
    currency: string;
    agreedTotal: string;
  };
  review: {
    status: StoredReviewStatus;
    displayStatus: ReviewDisplayStatus;
    internalReference: string | null;
    note: string | null;
    reviewedBy: string | null;
    reviewedByName: string | null;
    reviewedAt: string | null;
    version: number;
    everVerified: boolean;
  };
  history: ReviewEvent[];
  canReview: boolean;
  alreadyApplied: boolean | null;
  action: ReviewAction | null;
};

export function defaultReceivedFilter(canReview: boolean): ReceivedFilter {
  return canReview ? "awaiting" : "open";
}

export function reviewStatusLabel(status: ReviewDisplayStatus): string {
  switch (status) {
    case "awaiting_review":
      return "Awaiting review";
    case "needs_clarification":
      return "Needs clarification";
    case "verified":
      return "Verified";
    case "reversed":
      return "Reversed";
    case "reversed_previously_verified":
      return "Reversed · previously verified";
  }
}

export function compactReviewLabel(status: ReviewDisplayStatus): string {
  switch (status) {
    case "awaiting_review":
      return "Awaiting finance review";
    case "needs_clarification":
      return "Needs clarification";
    case "verified":
      return "Finance verified";
    case "reversed":
      return "Reversed";
    case "reversed_previously_verified":
      return "Reversed · previously verified";
  }
}

export function receiptReviewDisplay(input: {
  reversed: boolean;
  status: string | null;
  everVerified: boolean;
}): ReviewDisplayStatus {
  if (input.reversed && (input.everVerified || input.status === "verified")) return "reversed_previously_verified";
  if (input.reversed) return "reversed";
  if (input.status === "needs_clarification") return "needs_clarification";
  if (input.status === "verified") return "verified";
  return "awaiting_review";
}

export function formatReviewedAt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${datePart}, ${timePart} Cairo`;
}

export function reviewEventText(event: ReviewEvent): string {
  const when = formatReviewedAt(event.actedAt);
  if (event.action === "verified") {
    const note = event.note ? ` Note: ${event.note}` : "";
    return `Verified with internal reference ${event.internalReference} by ${event.actorName} on ${when}.${note}`;
  }
  if (event.action === "needs_clarification") {
    const reference = event.internalReference ? ` Reference noted: ${event.internalReference}.` : "";
    return `Needs clarification: ${event.note} — ${event.actorName} on ${when}.${reference}`;
  }
  const previous = event.internalReference ? ` Previous internal reference ${event.internalReference}.` : "";
  return `Reopened by ${event.actorName} on ${when}. ${event.note}.${previous}`;
}

export function validateReviewAction(
  action: ReviewAction,
  input: { internalReference: string; note: string },
): string | null {
  const reference = input.internalReference.trim();
  const note = input.note.trim();
  if (reference.length > INTERNAL_REFERENCE_LIMIT) {
    return "The internal payment reference must be 80 characters or fewer.";
  }
  if (action === "verify") {
    if (!reference) return "Enter the internal payment reference.";
    if (note.length > REVIEW_NOTE_LIMIT) return "The finance note must be 400 characters or fewer.";
    return null;
  }
  if (note.length > REVIEW_NOTE_LIMIT) return "The reason must be 400 characters or fewer.";
  if (!note && action === "clarify") return "Enter a reason for the clarification.";
  if (!note && action === "reopen") return "Enter a reason for reopening this review.";
  return null;
}

export function receivedRangeMessage(from: string, to: string): string | null {
  if (from && to && from > to) return "The start date must be on or before the end date.";
  return null;
}

export function emptyReceivedLocation(canReview: boolean): ReceivedLocation {
  return {
    status: defaultReceivedFilter(canReview),
    search: "",
    currency: "",
    receivedFrom: "",
    receivedTo: "",
    page: 1,
    receiptId: "",
  };
}

export function parseReceivedLocation(params: URLSearchParams, canReview: boolean): ReceivedLocation {
  const page = Number(params.get("rpage") ?? "1");
  const receiptId = params.get("rid") ?? "";
  const status = RECEIVED_FILTERS.find((item) => item === params.get("review")) ?? defaultReceivedFilter(canReview);
  return {
    status,
    search: params.get("rq") ?? "",
    currency: REPORT_CURRENCIES.find((item) => item === params.get("rcurrency")) ?? "",
    receivedFrom: DATE.test(params.get("rfrom") ?? "") ? (params.get("rfrom") as string) : "",
    receivedTo: DATE.test(params.get("rto") ?? "") ? (params.get("rto") as string) : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    receiptId: UUID.test(receiptId) ? receiptId : "",
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

export function withReceivedLocation(current: URLSearchParams, location: ReceivedLocation): URLSearchParams {
  const params = new URLSearchParams(current);
  params.set("tab", "received");
  params.set("review", location.status);
  setOrDelete(params, "rq", location.search);
  setOrDelete(params, "rcurrency", location.currency);
  setOrDelete(params, "rfrom", location.receivedFrom);
  setOrDelete(params, "rto", location.receivedTo);
  if (location.page > 1) params.set("rpage", String(location.page));
  else params.delete("rpage");
  setOrDelete(params, "rid", location.receiptId);
  return params;
}

export function receivedReceiptPath(receiptId: string): string {
  return `/payments?tab=received&rid=${encodeURIComponent(receiptId)}`;
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} could not be read.`);
  return value as Record<string, unknown>;
}

function readText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} could not be read.`);
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} could not be read.`);
  return value;
}

function readOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("A receipt field could not be read.");
  return value;
}

function readMoney(value: unknown, label: string): string {
  if (typeof value !== "string" || !MONEY.test(value)) throw new Error(`${label} could not be read.`);
  return value;
}

function readDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE.test(value.slice(0, 10))) throw new Error(`${label} could not be read.`);
  return value.slice(0, 10);
}

function readTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} could not be read.`);
  return value;
}

function readOptionalTimestamp(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return readTimestamp(value, label);
}

function readCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("The receipt count could not be read.");
  return value;
}

function readVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("The review version could not be read.");
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} could not be read.`);
  return value;
}

function readDisplayStatus(value: unknown): ReviewDisplayStatus {
  const status = REVIEW_DISPLAY_STATUSES.find((item) => item === value);
  if (!status) throw new Error("The review status could not be read.");
  return status;
}

function readStoredStatus(value: unknown): StoredReviewStatus {
  if (value === "awaiting_review" || value === "needs_clarification" || value === "verified") return value;
  throw new Error("The review status could not be read.");
}

function readFilter(value: unknown): ReceivedFilter {
  const status = RECEIVED_FILTERS.find((item) => item === value);
  if (!status) throw new Error("The review filter could not be read.");
  return status;
}

export function readReceivedRegister(data: unknown): ReceivedRegister {
  const row = readObject(data, "The received payment register");
  if (!Array.isArray(row.rows)) throw new Error("The received payment register could not be read.");
  return {
    status: readFilter(row.status),
    count: readCount(row.count),
    rows: row.rows.map((item) => {
      const payment = readObject(item, "A receipt");
      const revision = payment.tracked_revision;
      return {
        id: readText(payment.id, "A receipt"),
        receivedOn: readDate(payment.received_on, "A received date"),
        clientName: readString(payment.client_name, "A client"),
        piId: readText(payment.pi_id, "A PI"),
        piNumber: readOptionalText(payment.pi_number),
        trackedRevision: typeof revision === "number" ? revision : null,
        trackedDisplayNumber: readText(payment.tracked_display_number, "A PI number"),
        amount: readMoney(payment.amount, "A receipt amount"),
        currency: readText(payment.currency, "A currency"),
        method: readText(payment.method, "A payment method"),
        reference: readOptionalText(payment.reference),
        internalReference: readOptionalText(payment.internal_reference),
        recordedBy: readText(payment.recorded_by, "A recorder"),
        recordedByName: readString(payment.recorded_by_name, "A recorder"),
        reviewStatus: readDisplayStatus(payment.review_status),
        reviewedBy: readOptionalText(payment.reviewed_by),
        reviewedAt: readOptionalTimestamp(payment.reviewed_at, "A review time"),
        version: readVersion(payment.version),
      };
    }),
  };
}

export function readReceiptReview(data: unknown): ReceiptReviewDetail {
  const row = readObject(data, "The receipt");
  const receipt = readObject(row.receipt, "The receipt");
  const source = readObject(row.source, "The source PI");
  const review = readObject(row.review, "The finance review");
  if (!Array.isArray(row.allocations) || !Array.isArray(row.history)) throw new Error("The receipt could not be read.");
  const revision = source.tracked_revision;
  const action = row.action;
  return {
    receipt: {
      id: readText(receipt.id, "The receipt"),
      planId: readText(receipt.plan_id, "The receipt"),
      receivedOn: readDate(receipt.received_on, "A received date"),
      amount: readMoney(receipt.amount, "A receipt amount"),
      currency: readText(receipt.currency, "A currency"),
      method: readText(receipt.method, "A payment method"),
      reference: readOptionalText(receipt.reference),
      note: readOptionalText(receipt.note),
      recordedBy: readText(receipt.recorded_by, "A recorder"),
      recordedByName: readString(receipt.recorded_by_name, "A recorder"),
      recordedAt: readTimestamp(receipt.recorded_at, "A recorded time"),
      reversedAt: readOptionalTimestamp(receipt.reversed_at, "A reversal time"),
      reversedBy: readOptionalText(receipt.reversed_by),
      reversedByName: readOptionalText(receipt.reversed_by_name),
      reversalReason: readOptionalText(receipt.reversal_reason),
    },
    allocations: row.allocations.map((item) => {
      const allocation = readObject(item, "An allocation");
      return {
        obligationId: readText(allocation.obligation_id, "An allocation"),
        label: readString(allocation.label, "An allocation"),
        amount: readMoney(allocation.amount, "An allocation"),
      };
    }),
    source: {
      piId: readText(source.pi_id, "The source PI"),
      piNumber: readOptionalText(source.pi_number),
      trackedRevision: typeof revision === "number" ? revision : null,
      trackedDisplayNumber: readText(source.tracked_display_number, "A PI number"),
      sourceVersionId: readText(source.source_version_id, "The source PI"),
      clientName: typeof source.client_name === "string" ? source.client_name : "",
      currency: readText(source.currency, "A currency"),
      agreedTotal: readMoney(source.agreed_total, "The agreed total"),
    },
    review: {
      status: readStoredStatus(review.status),
      displayStatus: readDisplayStatus(review.display_status),
      internalReference: readOptionalText(review.internal_reference),
      note: readOptionalText(review.note),
      reviewedBy: readOptionalText(review.reviewed_by),
      reviewedByName: readOptionalText(review.reviewed_by_name),
      reviewedAt: readOptionalTimestamp(review.reviewed_at, "A review time"),
      version: readVersion(review.version),
      everVerified: readBoolean(review.ever_verified, "The review history"),
    },
    history: row.history.map((item) => {
      const event = readObject(item, "A review event");
      const eventAction = event.action;
      if (eventAction !== "verified" && eventAction !== "needs_clarification" && eventAction !== "reopened") {
        throw new Error("A review event could not be read.");
      }
      return {
        id: readText(event.id, "A review event"),
        action: eventAction,
        fromStatus: readStoredStatus(event.from_status),
        toStatus: readStoredStatus(event.to_status),
        internalReference: readOptionalText(event.internal_reference),
        note: readOptionalText(event.note),
        actorId: readText(event.actor_id, "A reviewer"),
        actorName: readString(event.actor_name, "A reviewer"),
        actedAt: readTimestamp(event.acted_at, "A review time"),
        version: readVersion(event.version),
      };
    }),
    canReview: readBoolean(row.can_review, "The review permission"),
    alreadyApplied: row.already_applied === undefined ? null : readBoolean(row.already_applied, "The review result"),
    action: action === undefined || action === null
      ? null
      : REVIEW_ACTIONS.find((item) => item === action) ?? null,
  };
}
