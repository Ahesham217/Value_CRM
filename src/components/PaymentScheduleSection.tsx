import { Banner, Button, Field, Select, TextArea, controlClass } from "./ui";
import { formatMoney } from "../lib/format";
import {
  advanceThenShipmentTemplate,
  createPaymentRow,
  emptyPaymentSchedule,
  formatLongDate,
  fullAdvanceTemplate,
  previewPaymentSchedule,
  type AmountBasis,
  type DueRule,
  type InstalmentFirst,
  type InstalmentPlan,
  type PaymentEvent,
  type PaymentRow,
  type PaymentSchedule,
  type StandardEventCode,
} from "../lib/payment-schedule";
import { NO_ONE_TIME_AMOUNT_MESSAGE } from "../lib/subscription";
import type { ScheduleIssue } from "../lib/payment-schedule";
import type { CurrencyCode } from "../lib/types";

const EVENTS: { code: StandardEventCode; label: string }[] = [
  { code: "order_confirmation", label: "Order confirmation" },
  { code: "shipment", label: "Shipment" },
  { code: "delivery", label: "Delivery" },
  { code: "commissioning", label: "Commissioning" },
];

/** Turn off an existing no-payment mark without replacing rows, dates, or schema version. */
export function recoverPaymentSchedule(schedule: PaymentSchedule): PaymentSchedule {
  return { ...schedule, no_payment_due: false };
}

export function PaymentScheduleSection({
  mode,
  legacyText,
  schedule,
  currency,
  grandTotal,
  percentageOf = "grand_total",
  percentageBase = null,
  allocationNote = null,
  customerText = null,
  conversionMessage = null,
  onConvert,
  residualRequired = false,
  allocationIssues = null,
  canEdit,
  showLegacyCancel,
  onLegacyText,
  onReplaceLegacy,
  onCancelReplacement,
  onSchedule,
}: {
  mode: "legacy" | "structured";
  legacyText: string;
  schedule: PaymentSchedule;
  currency: CurrencyCode | null;
  grandTotal: string | null;
  percentageOf?: "grand_total" | "one_time";
  percentageBase?: string | null;
  allocationNote?: string | null;
  customerText?: string | null;
  conversionMessage?: string | null;
  onConvert?: () => void;
  residualRequired?: boolean;
  /** Schema version 2 issues from the allocation preview. Null when that preview has not been run. */
  allocationIssues?: ScheduleIssue[] | null;
  canEdit: boolean;
  showLegacyCancel: boolean;
  onLegacyText: (value: string) => void;
  onReplaceLegacy: () => void;
  onCancelReplacement: () => void;
  onSchedule: (schedule: PaymentSchedule) => void;
}) {
  if (mode === "legacy") {
    return (
      <div>
        <h3 className="text-[15px] font-semibold text-ink">Legacy payment terms</h3>
        <p className="mt-1 text-sm text-slate-600">
          This draft still uses a payment paragraph. It can be issued as written. Replacing it creates a structured schedule. Opening or saving this draft does not erase the paragraph.
        </p>
        <div className="mt-3">
          <Field label="Payment paragraph">
            <TextArea rows={3} disabled={!canEdit} value={legacyText} onChange={(event) => onLegacyText(event.target.value)} />
          </Field>
        </div>
        {canEdit ? (
          <Button className="mt-3" type="button" variant="secondary" onClick={onReplaceLegacy}>
            Replace with a structured schedule
          </Button>
        ) : null}
      </div>
    );
  }

  const usingAllocation = schedule.schema_version === 2 && percentageOf === "one_time";
  const subscriptionCoversTotal = usingAllocation
    && percentageBase === "0.00"
    && grandTotal != null
    && grandTotal !== "0.00";
  const previewInput = usingAllocation ? { ...schedule, schema_version: 1 as const } : schedule;
  const rawPreview = subscriptionCoversTotal
    ? null
    : previewPaymentSchedule(
      previewInput,
      currency,
      usingAllocation ? percentageBase : grandTotal,
      usingAllocation ? { base: "one_time" } : undefined,
    );
  const preview = rawPreview == null
    ? null
    : usingAllocation
      ? {
        ...rawPreview,
        issues: rawPreview.issues.map((issue) => ({
          ...issue,
          message: issue.message.replaceAll("grand total", "one-time amount").replaceAll("Grand total", "One-time amount"),
        })),
      }
      : rawPreview;
  const issues: ScheduleIssue[] = usingAllocation && allocationIssues != null
    ? allocationIssues
    : subscriptionCoversTotal
      ? (schedule.rows.length > 0 ? [{ rowId: null, message: NO_ONE_TIME_AMOUNT_MESSAGE }] : [])
      : (preview?.issues ?? []);
  const summaryText = customerText ?? preview?.customerText ?? null;
  const remainderUsed = schedule.rows.some((row) => row.amount.type === "remainder");
  const update = (next: PaymentSchedule) => onSchedule({
    ...next,
    schema_version: schedule.schema_version === 2 ? 2 : next.schema_version,
    residual_target: schedule.schema_version === 2 ? (next.residual_target ?? schedule.residual_target ?? null) : next.residual_target,
    dates_need_review: next.dates_need_review,
  });
  const oneTimeIsZero = usingAllocation && percentageBase === "0.00";

  function updateRow(id: string, patch: Partial<PaymentRow>) {
    update({
      ...schedule,
      rows: schedule.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= schedule.rows.length) return;
    const rows = [...schedule.rows];
    const [item] = rows.splice(index, 1);
    if (!item) return;
    rows.splice(target, 0, item);
    update({ ...schedule, rows });
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">Payment schedule</h3>
        {summaryText ? (
          <p className="text-sm text-slate-600">{summaryText}</p>
        ) : (
          <p className="text-sm text-slate-600">
            {schedule.rows.length === 0 ? "No payments yet." : `${schedule.rows.length} ${schedule.rows.length === 1 ? "payment" : "payments"}`}
          </p>
        )}
      </div>
      {conversionMessage ? (
        <div className="mt-3">
          <Banner tone="info">
            {conversionMessage}
            {canEdit && onConvert ? (
              <button type="button" className="ml-2 underline" onClick={onConvert}>Update payment allocation</button>
            ) : null}
          </Banner>
        </div>
      ) : null}
      {allocationNote ? <p className="mt-3 text-sm text-slate-700">{allocationNote}</p> : null}
      {residualRequired && schedule.schema_version === 2 ? (
        <div className="mt-3">
          <p className="text-sm text-slate-700">These charges are not on a priced line. Choose where they belong. This does not create a subscription price.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant={schedule.residual_target === "subscription" ? "primary" : "secondary"} onClick={() => update({ ...schedule, residual_target: "subscription" })}>Subscription advance</Button>
            <Button type="button" variant={schedule.residual_target === "one_time" ? "primary" : "secondary"} onClick={() => update({ ...schedule, residual_target: "one_time" })}>One-time schedule</Button>
          </div>
        </div>
      ) : null}
      {schedule.dates_need_review ? (
        <div className="mt-3">
          <Banner tone="info">
            Fixed dates and before-shipment deadlines were cleared on this copy. Review them before issuing.
            {canEdit ? (
              <button type="button" className="ml-2 underline" onClick={() => update({ ...schedule, dates_need_review: false })}>
                Mark dates reviewed
              </button>
            ) : null}
          </Banner>
        </div>
      ) : null}
      {schedule.no_payment_due ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p>No payment due. This is only valid when the PI total is zero.</p>
            {canEdit ? (
              <button type="button" className="text-primary underline" onClick={() => onSchedule(recoverPaymentSchedule(schedule))}>
                Use a payment schedule
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {!schedule.no_payment_due && grandTotal === "0.00" && canEdit ? (
        <div className="mt-3">
          <Button type="button" variant="secondary" onClick={() => update({ ...emptyPaymentSchedule(), no_payment_due: true })}>
            No payment due
          </Button>
        </div>
      ) : null}
      {oneTimeIsZero ? (
        <p className="mt-3 text-sm text-slate-700">The current charge is payable 100% in advance. There is no one-time amount to split into instalments.</p>
      ) : null}
      {!schedule.no_payment_due && !oneTimeIsZero && schedule.rows.length === 0 && canEdit ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => update(fullAdvanceTemplate())}>100% on confirmation</Button>
          <Button type="button" variant="secondary" onClick={() => update(advanceThenShipmentTemplate())}>30% / 70% before shipment</Button>
          <Button type="button" variant="secondary" onClick={() => updateRowNew(schedule, update)}>Add payment</Button>
        </div>
      ) : null}
      {!schedule.no_payment_due ? (
        <div className="mt-3 space-y-3">
          {schedule.rows.map((row, index) => {
            const rowPreview = preview?.rows.find((item) => item.id === row.id);
            return (
              <PaymentRowEditor
                key={row.id}
                row={row}
                index={index}
                count={schedule.rows.length}
                currency={currency}
                amount={rowPreview?.amount ?? null}
                contractual={rowPreview?.contractual ?? null}
                pending={rowPreview?.pending ?? null}
                instalments={rowPreview?.instalments ?? null}
                canEdit={canEdit}
                remainderUsed={remainderUsed}
                onChange={(patch) => updateRow(row.id, patch)}
                onMove={(direction) => move(index, direction)}
                onRemove={() => update({ ...schedule, rows: schedule.rows.filter((item) => item.id !== row.id) })}
              />
            );
          })}
          {canEdit && schedule.rows.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              disabled={schedule.rows.length >= 20}
              onClick={() => update({ ...schedule, rows: [...schedule.rows, createPaymentRow()] })}
            >
              Add payment
            </Button>
          ) : null}
        </div>
      ) : null}
      {preview?.allocated && (usingAllocation ? percentageBase : grandTotal) ? (
        <p className="mt-3 text-sm tabular-nums text-ink">
          Allocated {formatMoney(preview.allocated, currency)} of {formatMoney(usingAllocation ? percentageBase : grandTotal, currency)}
          {usingAllocation ? " of the one-time amount" : ""}
          {preview.unallocated && preview.unallocated !== "0.00" ? ` · Unallocated ${formatMoney(preview.unallocated, currency)}` : ""}
          {preview.overallocated ? ` · Over-allocated by ${formatMoney(preview.overallocated, currency)}` : ""}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-red-800">
          {issues.map((issue) => <li key={`${issue.rowId ?? "schedule"}-${issue.message}`}>{issue.message}</li>)}
        </ul>
      ) : null}
      <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2">
        <p className="text-xs font-medium text-muted">Customer payment terms</p>
        <p className="mt-1 text-sm text-ink">
          {summaryText ?? "The payment terms appear here when the schedule is complete. They are generated from the schedule and are not edited separately."}
        </p>
      </div>
      {showLegacyCancel && canEdit ? (
        <button type="button" className="mt-3 text-sm text-primary underline" onClick={onCancelReplacement}>
          Keep the legacy paragraph
        </button>
      ) : null}
    </div>
  );
}

function updateRowNew(schedule: PaymentSchedule, update: (schedule: PaymentSchedule) => void) {
  update({ ...schedule, rows: [createPaymentRow()] });
}

function PaymentRowEditor({
  row,
  index,
  count,
  currency,
  amount,
  contractual,
  pending,
  instalments,
  canEdit,
  remainderUsed,
  onChange,
  onMove,
  onRemove,
}: {
  row: PaymentRow;
  index: number;
  count: number;
  currency: CurrencyCode | null;
  amount: string | null;
  contractual: string | null;
  pending: string | null;
  instalments: { sequence: number; amount: string; due_date: string | null; due_formula: string }[] | null;
  canEdit: boolean;
  remainderUsed: boolean;
  onChange: (patch: Partial<PaymentRow>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const title = row.label.trim() || `Payment ${index + 1}`;
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">{title}{amount && currency ? ` · ${formatMoney(amount, currency)}` : ""}</p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" className="text-primary underline disabled:text-slate-400" disabled={index === 0} onClick={() => onMove(-1)}>Move up</button>
            <button type="button" className="text-primary underline disabled:text-slate-400" disabled={index === count - 1} onClick={() => onMove(1)}>Move down</button>
            <button type="button" className="text-red-800 underline" onClick={onRemove}>Remove</button>
          </div>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Label">
          <input className={controlClass} disabled={!canEdit} value={row.label} placeholder="Advance payment" onChange={(event) => onChange({ label: event.target.value })} />
        </Field>
        <AmountFields row={row} canEdit={canEdit} remainderUsed={remainderUsed} onChange={onChange} />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={row.instalments !== null}
          onChange={(event) => onChange(event.target.checked ? enableInstalments(row) : disableInstalments(row))}
        />
        Split into equal instalments
      </label>
      {row.instalments ? (
        <InstalmentFields plan={row.instalments} canEdit={canEdit} onChange={(instalments) => onChange({ instalments })} />
      ) : (
        <DueFields due={row.due} canEdit={canEdit} onChange={(due) => onChange({ due })} />
      )}
      {contractual ? <p className="mt-2 text-sm text-ink">Contractual: {contractual}</p> : null}
      {pending ? <p className="mt-1 text-xs text-slate-500">Status: {pending}. This is not a due date and is not printed on the PI.</p> : null}
      {instalments && instalments.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {instalments.map((item) => (
            <li key={item.sequence} className="flex flex-wrap justify-between gap-2 tabular-nums">
              <span>Instalment {item.sequence}</span>
              <span>{currency ? formatMoney(item.amount, currency) : item.amount}</span>
              <span>{item.due_date ? formatLongDate(item.due_date) : item.due_formula}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AmountFields({
  row,
  canEdit,
  remainderUsed,
  onChange,
}: {
  row: PaymentRow;
  canEdit: boolean;
  remainderUsed: boolean;
  onChange: (patch: Partial<PaymentRow>) => void;
}) {
  return (
    <div className="grid gap-3">
      <Field label="Amount" hint="Percentages use the PI grand total.">
        <Select disabled={!canEdit} value={row.amount.type} onChange={(event) => onChange({ amount: amountFromType(event.target.value, row.amount) })}>
          <option value="unset">Choose</option>
          <option value="percent">Percentage of total</option>
          <option value="fixed">Fixed amount</option>
          <option value="remainder" disabled={remainderUsed && row.amount.type !== "remainder"}>Remaining balance</option>
        </Select>
      </Field>
      {row.amount.type === "percent" ? (
        <Field label="Percentage">
          <input className={controlClass} inputMode="decimal" disabled={!canEdit} value={row.amount.percent ?? ""} onChange={(event) => onChange({ amount: { type: "percent", percent: blankToNull(event.target.value) } })} />
        </Field>
      ) : null}
      {row.amount.type === "fixed" ? (
        <Field label="Fixed amount">
          <input className={controlClass} inputMode="decimal" disabled={!canEdit} value={row.amount.amount ?? ""} onChange={(event) => onChange({ amount: { type: "fixed", amount: blankToNull(event.target.value) } })} />
        </Field>
      ) : null}
      {row.amount.type === "remainder" ? <p className="text-xs text-slate-500">This row takes whatever remains of the grand total after the other payments.</p> : null}
    </div>
  );
}

function DueFields({ due, canEdit, onChange }: { due: DueRule; canEdit: boolean; onChange: (due: DueRule) => void }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field label="Due">
        <Select disabled={!canEdit} value={due.type} onChange={(event) => onChange(dueFromType(event.target.value, due))}>
          <option value="unset">Choose</option>
          <option value="date">On a date</option>
          <option value="on_event">On a milestone</option>
          <option value="after_event">After a milestone</option>
          <option value="before_shipment">Before shipment</option>
        </Select>
      </Field>
      {due.type === "date" ? (
        <Field label="Due date">
          <input className={controlClass} type="date" disabled={!canEdit} value={due.date ?? ""} onChange={(event) => onChange({ type: "date", date: event.target.value || null })} />
        </Field>
      ) : null}
      {due.type === "before_shipment" ? (
        <Field label="Payment deadline" hint="Optional. A blank deadline stays unset. It is not taken from the shipment date.">
          <input className={controlClass} type="date" disabled={!canEdit} value={due.deadline ?? ""} onChange={(event) => onChange({ type: "before_shipment", deadline: event.target.value || null })} />
        </Field>
      ) : null}
      {due.type === "on_event" ? <EventFields event={due.event} canEdit={canEdit} onChange={(event) => onChange({ type: "on_event", event })} /> : null}
      {due.type === "after_event" ? (
        <>
          <EventFields event={due.event} canEdit={canEdit} onChange={(event) => onChange({ ...due, event })} />
          <OffsetFields offset={due.offset} unit={due.unit} canEdit={canEdit} onChange={(offset, unit) => onChange({ ...due, offset, unit })} />
        </>
      ) : null}
    </div>
  );
}

function InstalmentFields({ plan, canEdit, onChange }: { plan: InstalmentPlan; canEdit: boolean; onChange: (plan: InstalmentPlan) => void }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field label="Number of instalments">
        <input
          className={controlClass}
          inputMode="numeric"
          disabled={!canEdit}
          value={plan.count ?? ""}
          onChange={(event) => onChange({ ...plan, count: wholeNumber(event.target.value) })}
        />
      </Field>
      <Field label="Frequency">
        <Select disabled={!canEdit} value={plan.frequency ?? ""} onChange={(event) => onChange({ ...plan, frequency: event.target.value === "monthly" || event.target.value === "yearly" ? event.target.value : null })}>
          <option value="">Choose</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </Select>
      </Field>
      <Field label="First instalment">
        <Select disabled={!canEdit} value={plan.first.type} onChange={(event) => onChange({ ...plan, first: firstFromType(event.target.value, plan.first) })}>
          <option value="unset">Choose</option>
          <option value="date">On a date</option>
          <option value="after_event">After a milestone</option>
        </Select>
      </Field>
      {plan.first.type === "date" ? (
        <Field label="First due date">
          <input className={controlClass} type="date" disabled={!canEdit} value={plan.first.date ?? ""} onChange={(event) => onChange({ ...plan, first: { type: "date", date: event.target.value || null } })} />
        </Field>
      ) : null}
      {plan.first.type === "after_event" ? (
        <>
          <EventFields
            event={plan.first.event}
            canEdit={canEdit}
            onChange={(nextEvent) => onChange({
              ...plan,
              first: { type: "after_event", event: nextEvent, offset: plan.first.type === "after_event" ? plan.first.offset : null, unit: plan.first.type === "after_event" ? plan.first.unit : null },
            })}
          />
          <OffsetFields
            offset={plan.first.offset}
            unit={plan.first.unit}
            canEdit={canEdit}
            onChange={(offset, unit) => onChange({ ...plan, first: { type: "after_event", event: plan.first.type === "after_event" ? plan.first.event : null, offset, unit } })}
          />
        </>
      ) : null}
    </div>
  );
}

function EventFields({ event, canEdit, onChange }: { event: PaymentEvent | null; canEdit: boolean; onChange: (event: PaymentEvent | null) => void }) {
  const value = !event ? "" : event.type === "custom" ? "custom" : event.code;
  return (
    <>
      <Field label="Milestone">
        <Select
          disabled={!canEdit}
          value={value}
          onChange={(change) => {
            const next = change.target.value;
            if (!next) onChange(null);
            else if (next === "custom") onChange(event?.type === "custom" ? event : { type: "custom", id: crypto.randomUUID(), label: "" });
            else onChange({ type: "standard", code: next as StandardEventCode });
          }}
        >
          <option value="">Choose</option>
          {EVENTS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          <option value="custom">Custom milestone</option>
        </Select>
      </Field>
      {event?.type === "custom" ? (
        <Field label="Milestone name">
          <input className={controlClass} disabled={!canEdit} value={event.label} onChange={(change) => onChange({ ...event, label: change.target.value })} />
        </Field>
      ) : null}
    </>
  );
}

function OffsetFields({
  offset,
  unit,
  canEdit,
  onChange,
}: {
  offset: number | null;
  unit: "days" | "months" | null;
  canEdit: boolean;
  onChange: (offset: number | null, unit: "days" | "months" | null) => void;
}) {
  return (
    <>
      <Field label="Number">
        <input className={controlClass} inputMode="numeric" disabled={!canEdit} value={offset ?? ""} onChange={(event) => onChange(wholeNumber(event.target.value), unit)} />
      </Field>
      <Field label="Unit">
        <Select disabled={!canEdit} value={unit ?? ""} onChange={(event) => onChange(offset, event.target.value === "days" || event.target.value === "months" ? event.target.value : null)}>
          <option value="">Choose</option>
          <option value="days">Days</option>
          <option value="months">Calendar months</option>
        </Select>
      </Field>
    </>
  );
}

function amountFromType(value: string, current: AmountBasis): AmountBasis {
  if (value === "percent") return { type: "percent", percent: current.type === "percent" ? current.percent : null };
  if (value === "fixed") return { type: "fixed", amount: current.type === "fixed" ? current.amount : null };
  if (value === "remainder") return { type: "remainder" };
  return { type: "unset" };
}

function dueFromType(value: string, current: DueRule): DueRule {
  if (value === "date") return { type: "date", date: current.type === "date" ? current.date : null };
  if (value === "on_event") return { type: "on_event", event: current.type === "on_event" ? current.event : null };
  if (value === "after_event") {
    return current.type === "after_event"
      ? current
      : { type: "after_event", event: null, offset: null, unit: null };
  }
  if (value === "before_shipment") return { type: "before_shipment", deadline: current.type === "before_shipment" ? current.deadline : null };
  return { type: "unset" };
}

function firstFromType(value: string, current: InstalmentFirst): InstalmentFirst {
  if (value === "date") return { type: "date", date: current.type === "date" ? current.date : null };
  if (value === "after_event") {
    return current.type === "after_event" ? current : { type: "after_event", event: null, offset: null, unit: null };
  }
  return { type: "unset" };
}

function enableInstalments(row: PaymentRow): Partial<PaymentRow> {
  let first: InstalmentFirst = { type: "unset" };
  if (row.due.type === "date") first = { type: "date", date: row.due.date };
  if (row.due.type === "after_event") first = { type: "after_event", event: row.due.event, offset: row.due.offset, unit: row.due.unit };
  return { due: { type: "unset" }, instalments: { count: null, frequency: null, first } };
}

function disableInstalments(row: PaymentRow): Partial<PaymentRow> {
  const first = row.instalments?.first;
  let due: DueRule = { type: "unset" };
  if (first?.type === "date") due = { type: "date", date: first.date };
  if (first?.type === "after_event") due = { type: "after_event", event: first.event, offset: first.offset, unit: first.unit };
  return { due, instalments: null };
}

function blankToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  return Number(trimmed);
}
