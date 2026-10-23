import { formatDate } from "./format";
import { addDays, formatIsoDate, parseIsoDate } from "./payment-schedule";
import type { CurrencyCode, DisplayStatus } from "./types";

export const PAYMENT_TRACKING_ANCHOR = "payment-tracking";

export const PI_PERIODS = ["last_7", "this_month", "last_30", "custom", "all"] as const;
export const RECEIPT_PERIODS = ["last_7", "this_month", "last_30", "custom"] as const;
export const PAYMENT_VIEWS = ["outstanding", "overdue", "due_today", "next_7", "next_30", "awaiting", "paid", "all"] as const;
export const COLLECTION_BUCKETS = ["outstanding", "overdue", "due_today", "next_7", "next_30", "unresolved"] as const;
export const REPORT_CURRENCIES = ["EGP", "USD", "EUR"] as const satisfies readonly CurrencyCode[];

export type PiPeriod = (typeof PI_PERIODS)[number];
export type ReceiptPeriod = (typeof RECEIPT_PERIODS)[number];
export type PaymentView = (typeof PAYMENT_VIEWS)[number];
export type CollectionBucket = (typeof COLLECTION_BUCKETS)[number];

export const PI_PERIOD_LABELS: Record<PiPeriod, string> = {
  last_7: "Last 7 days",
  this_month: "This month",
  last_30: "Last 30 days",
  custom: "Custom dates",
  all: "All active",
};

export const RECEIPT_PERIOD_LABELS: Record<ReceiptPeriod, string> = {
  last_7: "Last 7 days",
  this_month: "This month",
  last_30: "Last 30 days",
  custom: "Custom dates",
};

export const PAYMENT_VIEW_LABELS: Record<PaymentView, string> = {
  outstanding: "Outstanding",
  overdue: "Overdue",
  due_today: "Due today",
  next_7: "Next 7 days",
  next_30: "Next 30 days",
  awaiting: "Awaiting date",
  paid: "Paid",
  all: "All",
};

export const COLLECTION_BUCKET_LABELS: Record<CollectionBucket, string> = {
  outstanding: "Outstanding",
  overdue: "Overdue",
  due_today: "Due today",
  next_7: "Due in the next 7 days",
  next_30: "Due in the next 30 days",
  unresolved: "Outstanding, date not set",
};

export const ACTIVE_PI_NOTE =
  "Active PIs are drafts, issued, sent, and accepted documents. Cancelled PIs are left out. Each PI is counted once. The amount is the latest issued revision, or the saved draft total when nothing has been issued. An open revision does not change that issued total. These are quoted amounts, not revenue.";

export const COLLECTION_NOTE =
  "Tracked balances use the remaining amount on each payment obligation. They do not follow the PI date above, and they are not revenue. EGP, USD, and EUR stay separate. Overdue means the due date is before today. Due today is today. The next 7 days and the next 30 days both start tomorrow, and the next 7 days sit inside the next 30 days. A zero means nothing tracked is due in that window. It does not mean every invoice has been paid.";

export const PAYMENTS_NOTE =
  "Each row is one obligation already on a payment plan, including a separate instalment or subscription advance. Future subscription years that have not been invoiced are not listed. This page does not record payments.";

export const EMPTY_PAYMENTS =
  "No tracked payment obligations match. Issued PIs without a payment plan are not listed here, and an empty list does not mean those invoices are paid.";

export type DateWindow = {
  unbounded: boolean;
  start: string | null;
  end: string | null;
};

export function reportingWindow(
  preset: string,
  from: string | null,
  to: string | null,
  today: string,
  allowAll: boolean,
): DateWindow {
  if (!parseIsoDate(today)) throw new Error("Choose a date range.");
  if (preset === "all") {
    if (!allowAll) throw new Error("Choose a date range.");
    return { unbounded: true, start: null, end: null };
  }
  if (preset === "last_7") return { unbounded: false, start: addDays(today, -6), end: today };
  if (preset === "this_month") {
    const parsed = parseIsoDate(today);
    if (!parsed) throw new Error("Choose a date range.");
    return { unbounded: false, start: formatIsoDate(parsed.year, parsed.month, 1), end: today };
  }
  if (preset === "last_30") return { unbounded: false, start: addDays(today, -29), end: today };
  if (preset === "custom") {
    const message = customRangeMessage(from ?? "", to ?? "");
    if (message) throw new Error(message);
    return { unbounded: false, start: from, end: to };
  }
  throw new Error("Choose a date range.");
}

export function customRangeMessage(from: string, to: string): string | null {
  if (!from || !to || !parseIsoDate(from) || !parseIsoDate(to)) return "Enter both dates for a custom range.";
  if (from > to) return "The start date must be on or before the end date.";
  return null;
}

export function piDateLabel(window: DateWindow): string {
  if (window.unbounded) return "PI date: all active PIs";
  if (!window.start || !window.end) return "PI date";
  return `PI date: ${formatDate(window.start)} – ${formatDate(window.end)} (Africa/Cairo)`;
}

export function receivedLabel(window: DateWindow): string {
  if (!window.start || !window.end) return "Received on";
  return `Received on: ${formatDate(window.start)} – ${formatDate(window.end)} (Africa/Cairo)`;
}

export type ReportLead = {
  id: string;
  name: string;
  active: boolean | null;
};

export type QuotedTotal = {
  currency: CurrencyCode;
  issued: string;
  draft: string;
};

export type ActivePiRow = {
  id: string;
  piNumber: string | null;
  displayNumber: string;
  clientName: string;
  piDate: string | null;
  presetCode: string | null;
  presetDisplayName: string;
  presetArchived: boolean;
  currency: string | null;
  total: string;
  amountKind: "issued" | "draft";
  leadSalespersonId: string | null;
  leadName: string;
  leadActive: boolean | null;
  displayStatus: DisplayStatus;
  revisionDraftOpen: boolean;
  latestRevision: number | null;
};

export type ActiveReport = {
  count: number;
  set: "active" | "untracked";
  period: DateWindow & { today: string };
  totals: QuotedTotal[];
  rows: ActivePiRow[];
  leads: ReportLead[];
};

export type CollectionCurrency = {
  currency: CurrencyCode;
  outstanding: string;
  overdue: string;
  dueToday: string;
  next7: string;
  next30: string;
  unresolved: string;
  received: string;
};

export type CollectionSummary = {
  today: string;
  parentStatus: string | null;
  receiptPeriod: DateWindow;
  currencies: CollectionCurrency[];
  untrackedCount: number;
};

export type PaymentTotal = {
  currency: CurrencyCode;
  original: string;
  paid: string;
  outstanding: string;
};

export type PaymentRow = {
  id: string;
  piId: string;
  dueDate: string | null;
  dueLabel: string;
  dueTiming: string;
  dueState: string;
  clientName: string;
  piNumber: string | null;
  trackedRevision: number | null;
  trackedDisplayNumber: string;
  latestRevision: number | null;
  revisionDiffers: boolean;
  label: string;
  kind: string;
  originalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  currency: string;
  collectionStatus: string;
  leadSalespersonId: string | null;
  leadName: string;
  leadActive: boolean | null;
  parentStatus: string;
  presetCode: string | null;
  presetDisplayName: string;
  presetArchived: boolean;
  position: number;
};

export type PaymentRegister = {
  today: string;
  view: PaymentView;
  count: number;
  totals: PaymentTotal[];
  rows: PaymentRow[];
  leads: ReportLead[];
};

export type PaymentLocation = {
  view: PaymentView;
  balance: "" | "outstanding";
  search: string;
  currency: string;
  preset: string;
  lead: string;
  collectionStatus: string;
  dueFrom: string;
  dueTo: string;
  parentStatus: string;
  page: number;
};

const MONEY = /^\d+\.\d{2}$/;

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} could not be read.`);
  return value as Record<string, unknown>;
}

function readMoney(value: unknown, label: string): string {
  if (typeof value !== "string" || !MONEY.test(value)) throw new Error(`${label} could not be read.`);
  return value;
}

function readCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("The report count could not be read.");
  return value;
}

function readText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} could not be read.`);
  return value;
}

function readOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : null;
}

function readDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) throw new Error(`${label} could not be read.`);
  return value.slice(0, 10);
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} could not be read.`);
  return value;
}

function readOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return typeof value === "boolean" ? value : null;
}

function readCurrency(value: unknown): CurrencyCode {
  if (value !== "EGP" && value !== "USD" && value !== "EUR") throw new Error("A currency total could not be read.");
  return value;
}

function readLeads(value: unknown): ReportLead[] {
  if (!Array.isArray(value)) throw new Error("The lead list could not be read.");
  return value.map((item) => {
    const row = readObject(item, "A lead");
    const id = readText(row.id, "A lead");
    return { id, name: readText(row.name, "A lead"), active: readOptionalBoolean(row.active) };
  });
}

export function readActiveReport(data: unknown): ActiveReport {
  const row = readObject(data, "The PI report");
  const period = readObject(row.period, "The PI date");
  const set = row.set === "untracked" ? "untracked" : row.set === "active" ? "active" : null;
  if (!set) throw new Error("The PI report could not be read.");
  if (!Array.isArray(row.totals) || !Array.isArray(row.rows)) throw new Error("The PI report could not be read.");
  return {
    count: readCount(row.count),
    set,
    period: {
      unbounded: readBoolean(period.unbounded, "The PI date"),
      start: readDate(period.start, "The PI date"),
      end: readDate(period.end, "The PI date"),
      today: readDate(period.today, "The PI date") ?? "",
    },
    totals: row.totals.map((item) => {
      const total = readObject(item, "A quoted total");
      return {
        currency: readCurrency(total.currency),
        issued: readMoney(total.issued, "An issued quoted total"),
        draft: readMoney(total.draft, "A draft total"),
      };
    }),
    rows: row.rows.map((item) => {
      const pi = readObject(item, "A PI row");
      const kind = pi.amount_kind === "issued" || pi.amount_kind === "draft" ? pi.amount_kind : null;
      if (!kind) throw new Error("A PI row could not be read.");
      const status = pi.display_status;
      if (status !== "draft" && status !== "issued" && status !== "sent" && status !== "accepted" && status !== "cancelled") {
        throw new Error("A PI row could not be read.");
      }
      return {
        id: readText(pi.id, "A PI row"),
        piNumber: readOptionalText(pi.pi_number),
        displayNumber: readText(pi.display_number, "A PI row"),
        clientName: readText(pi.client_name, "A PI row"),
        piDate: readDate(pi.pi_date, "A PI date"),
        presetCode: readOptionalText(pi.preset_code),
        presetDisplayName: readText(pi.preset_display_name, "A preset"),
        presetArchived: readBoolean(pi.preset_archived, "A preset"),
        currency: readOptionalText(pi.currency),
        total: readMoney(pi.total, "A quoted total"),
        amountKind: kind,
        leadSalespersonId: readOptionalText(pi.lead_salesperson_id),
        leadName: readText(pi.lead_name, "A lead"),
        leadActive: readOptionalBoolean(pi.lead_active),
        displayStatus: status,
        revisionDraftOpen: readBoolean(pi.revision_draft_open, "A revision"),
        latestRevision: typeof pi.latest_revision === "number" ? pi.latest_revision : null,
      };
    }),
    leads: readLeads(row.leads),
  };
}

export function readCollectionSummary(data: unknown): CollectionSummary {
  const row = readObject(data, "The collection summary");
  const period = readObject(row.receipt_period, "The receipt period");
  if (!Array.isArray(row.currencies)) throw new Error("The collection summary could not be read.");
  const currencies = row.currencies.map((item) => {
    const money = readObject(item, "A collection total");
    return {
      currency: readCurrency(money.currency),
      outstanding: readMoney(money.outstanding, "Outstanding"),
      overdue: readMoney(money.overdue, "Overdue"),
      dueToday: readMoney(money.due_today, "Due today"),
      next7: readMoney(money.next_7, "The next 7 days"),
      next30: readMoney(money.next_30, "The next 30 days"),
      unresolved: readMoney(money.unresolved, "An unresolved balance"),
      received: readMoney(money.received, "Received"),
    };
  });
  if (currencies.length !== 3 || currencies.some((item, index) => item.currency !== REPORT_CURRENCIES[index])) {
    throw new Error("The collection summary could not be read.");
  }
  return {
    today: readDate(row.today, "Today") ?? "",
    parentStatus: readOptionalText(row.parent_status),
    receiptPeriod: {
      unbounded: false,
      start: readDate(period.start, "The receipt period"),
      end: readDate(period.end, "The receipt period"),
    },
    currencies,
    untrackedCount: readCount(row.untracked_count),
  };
}

export function readPaymentRegister(data: unknown): PaymentRegister {
  const row = readObject(data, "The payment register");
  const view = PAYMENT_VIEWS.find((item) => item === row.view);
  if (!view || !Array.isArray(row.totals) || !Array.isArray(row.rows)) throw new Error("The payment register could not be read.");
  return {
    today: readDate(row.today, "Today") ?? "",
    view,
    count: readCount(row.count),
    totals: row.totals.map((item) => {
      const total = readObject(item, "A payment total");
      return {
        currency: readCurrency(total.currency),
        original: readMoney(total.original, "An original amount"),
        paid: readMoney(total.paid, "A paid amount"),
        outstanding: readMoney(total.outstanding, "An outstanding amount"),
      };
    }),
    rows: row.rows.map((item) => {
      const payment = readObject(item, "A payment row");
      return {
        id: readText(payment.id, "A payment row"),
        piId: readText(payment.pi_id, "A payment row"),
        dueDate: readDate(payment.due_date, "A due date"),
        dueLabel: readText(payment.due_label, "A due date"),
        dueTiming: readText(payment.due_timing, "A due date"),
        dueState: readText(payment.due_state, "A due date"),
        clientName: readText(payment.client_name, "A payment row"),
        piNumber: readOptionalText(payment.pi_number),
        trackedRevision: typeof payment.tracked_revision === "number" ? payment.tracked_revision : null,
        trackedDisplayNumber: readText(payment.tracked_display_number, "A payment row"),
        latestRevision: typeof payment.latest_revision === "number" ? payment.latest_revision : null,
        revisionDiffers: readBoolean(payment.revision_differs, "A tracked revision"),
        label: readText(payment.label, "A payment row"),
        kind: readText(payment.kind, "A payment row"),
        originalAmount: readMoney(payment.original_amount, "An original amount"),
        paidAmount: readMoney(payment.paid_amount, "A paid amount"),
        outstandingAmount: readMoney(payment.outstanding_amount, "An outstanding amount"),
        currency: readText(payment.currency, "A currency"),
        collectionStatus: readText(payment.collection_status, "A collection status"),
        leadSalespersonId: readOptionalText(payment.lead_salesperson_id),
        leadName: readText(payment.lead_name, "A lead"),
        leadActive: readOptionalBoolean(payment.lead_active),
        parentStatus: readText(payment.parent_status, "A PI status"),
        presetCode: readOptionalText(payment.preset_code),
        presetDisplayName: readText(payment.preset_display_name, "A preset"),
        presetArchived: readBoolean(payment.preset_archived, "A preset"),
        position: typeof payment.position === "number" ? payment.position : 0,
      };
    }),
    leads: readLeads(row.leads),
  };
}

export function paymentTrackingPath(piId: string): string {
  return `/pis/${piId}#${PAYMENT_TRACKING_ANCHOR}`;
}

export function emptyPaymentLocation(): PaymentLocation {
  return {
    view: "outstanding",
    balance: "",
    search: "",
    currency: "",
    preset: "",
    lead: "",
    collectionStatus: "",
    dueFrom: "",
    dueTo: "",
    parentStatus: "",
    page: 1,
  };
}

export function parsePaymentLocation(params: URLSearchParams): PaymentLocation {
  const view = PAYMENT_VIEWS.find((item) => item === params.get("view")) ?? "outstanding";
  const page = Number(params.get("page") ?? "1");
  return {
    view,
    balance: params.get("balance") === "outstanding" ? "outstanding" : "",
    search: params.get("q") ?? "",
    currency: REPORT_CURRENCIES.find((item) => item === params.get("currency")) ?? "",
    preset: params.get("preset") ?? "",
    lead: params.get("lead") ?? "",
    collectionStatus: ["unpaid", "partial", "paid", "no_charge"].find((item) => item === params.get("collection")) ?? "",
    dueFrom: /^\d{4}-\d{2}-\d{2}$/.test(params.get("due_from") ?? "") ? (params.get("due_from") as string) : "",
    dueTo: /^\d{4}-\d{2}-\d{2}$/.test(params.get("due_to") ?? "") ? (params.get("due_to") as string) : "",
    parentStatus: ["draft", "issued", "sent", "accepted", "cancelled"].find((item) => item === params.get("pi_status")) ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function paymentSearchParams(location: PaymentLocation): URLSearchParams {
  const params = new URLSearchParams();
  params.set("view", location.view);
  if (location.balance === "outstanding") params.set("balance", "outstanding");
  if (location.search) params.set("q", location.search);
  if (location.currency) params.set("currency", location.currency);
  if (location.preset) params.set("preset", location.preset);
  if (location.lead) params.set("lead", location.lead);
  if (location.collectionStatus) params.set("collection", location.collectionStatus);
  if (location.dueFrom) params.set("due_from", location.dueFrom);
  if (location.dueTo) params.set("due_to", location.dueTo);
  if (location.parentStatus) params.set("pi_status", location.parentStatus);
  if (location.page > 1) params.set("page", String(location.page));
  return params;
}

export function paymentsPath(location: Partial<PaymentLocation> & { view: PaymentView }): string {
  const params = paymentSearchParams({ ...emptyPaymentLocation(), ...location, page: location.page ?? 1 });
  const query = params.toString();
  return query ? `/payments?${query}` : "/payments";
}

export function collectionPath(input: { bucket: CollectionBucket; currency?: string; parentStatus?: string }): string {
  if (input.bucket === "unresolved") {
    return paymentsPath({ view: "awaiting", balance: "outstanding", currency: input.currency ?? "", parentStatus: input.parentStatus ?? "" });
  }
  const view: PaymentView =
    input.bucket === "overdue" || input.bucket === "due_today" || input.bucket === "next_7" || input.bucket === "next_30"
      ? input.bucket
      : "outstanding";
  return paymentsPath({ view, currency: input.currency ?? "", parentStatus: input.parentStatus ?? "" });
}

export function withListChange<T extends { page: number }>(current: T, patch: Partial<T>): T {
  const changesFilters = (Object.keys(patch) as (keyof T)[]).some((key) => key !== "page" && patch[key] !== current[key]);
  const page = changesFilters && patch.page === undefined ? 1 : patch.page ?? current.page;
  return { ...current, ...patch, page };
}

export function keepPreviousOnFailure<T>(previous: T | null, result: { ok: true; data: T } | { ok: false }): { data: T | null; error: boolean } {
  if (result.ok) return { data: result.data, error: false };
  return { data: previous, error: true };
}

export function leadLabel(name: string, active: boolean | null): string {
  if (!name || name === "Unassigned") return "Unassigned";
  return active === false ? `${name} (inactive)` : name;
}

export function officePresetLabel(name: string, archived: boolean): string {
  if (!name) return "—";
  return archived ? `${name} (archived)` : name;
}

export function coverageText(count: number): string {
  const noun = count === 1 ? "issued PI has" : "issued PIs have";
  return `${count} ${noun} no payment plan. Payment tracking does not know their unpaid balance, and their quoted totals are not included in the tracked balances.`;
}

export function bucketAmount(row: CollectionCurrency, bucket: CollectionBucket): string {
  switch (bucket) {
    case "outstanding":
      return row.outstanding;
    case "overdue":
      return row.overdue;
    case "due_today":
      return row.dueToday;
    case "next_7":
      return row.next7;
    case "next_30":
      return row.next30;
    case "unresolved":
      return row.unresolved;
  }
}

export function showsOverdueMarker(row: Pick<PaymentRow, "dueState" | "collectionStatus">): boolean {
  return row.dueState === "overdue" && row.collectionStatus !== "paid" && row.collectionStatus !== "no_charge";
}
