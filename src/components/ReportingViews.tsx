import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { displayStatusLabel, formatDate, formatMoney } from "../lib/format";
import { collectionLabel } from "../lib/payment-tracking";
import {
  ACTIVE_PI_NOTE,
  COLLECTION_BUCKET_LABELS,
  COLLECTION_BUCKETS,
  COLLECTION_NOTE,
  EMPTY_PAYMENTS,
  PAYMENT_VIEW_LABELS,
  PAYMENT_VIEWS,
  PAYMENTS_NOTE,
  REPORT_CURRENCIES,
  bucketAmount,
  collectionPath,
  coverageText,
  leadLabel,
  officePresetLabel,
  paymentTrackingPath,
  paymentsPath,
  piDateLabel,
  receivedLabel,
  showsOverdueMarker,
  type ActivePiRow,
  type ActiveReport,
  type CollectionSummary,
  type PaymentLocation,
  type PaymentRegister,
  type PaymentRow,
  type PiPeriod,
  type ReceiptPeriod,
  PI_PERIOD_LABELS,
  RECEIPT_PERIOD_LABELS,
} from "../lib/reporting";
import {
  CurrencyBlock,
  CurrencyStrip,
  Disclosure,
  Segmented,
  StatusBadge,
  bodyRowClass,
  clickableRowClass,
  linkClass,
  segmentItemClass,
  tableWrapClass,
  tdClass,
  thClass,
  theadClass,
} from "./ui";

export function PeriodChoices({
  label,
  periods,
  value,
  onChange,
}: {
  label: string;
  periods: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Segmented label={label}>
      {periods.map((period) => (
        <button
          key={period.id}
          type="button"
          className={segmentItemClass(period.id === value)}
          aria-pressed={period.id === value}
          onClick={() => onChange(period.id)}
        >
          {period.label}
        </button>
      ))}
    </Segmented>
  );
}

export function piPeriodChoices(): { id: PiPeriod; label: string }[] {
  return (Object.keys(PI_PERIOD_LABELS) as PiPeriod[]).map((id) => ({ id, label: PI_PERIOD_LABELS[id] }));
}

export function receiptPeriodChoices(): { id: ReceiptPeriod; label: string }[] {
  return (Object.keys(RECEIPT_PERIOD_LABELS) as ReceiptPeriod[]).map((id) => ({ id, label: RECEIPT_PERIOD_LABELS[id] }));
}

export function ActivePiSummary({ report }: { report: ActiveReport }) {
  const totals = REPORT_CURRENCIES.flatMap((currency) => {
    const total = report.totals.find((item) => item.currency === currency);
    return total ? [total] : [];
  });
  return (
    <div className="mb-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="active-pis-heading" className="text-[18px] leading-6 font-semibold text-ink">Active PIs</h2>
        <p className="text-sm text-secondary">{report.count} {report.count === 1 ? "PI" : "PIs"}</p>
      </div>
      <p className="mb-3 text-[13px] text-muted">Latest issued version per PI. {piDateLabel(report.period)}.</p>
      {totals.length === 0 ? (
        <p className="text-sm text-secondary">No quoted totals in this result.</p>
      ) : (
        <CurrencyStrip columns={totals.length}>
          {totals.map((total) => (
            <CurrencyBlock
              key={total.currency}
              code={total.currency}
              lines={[
                { label: "Issued quoted total", value: formatMoney(total.issued, total.currency), tone: "strong" },
                { label: "Draft total", value: formatMoney(total.draft, total.currency) },
              ]}
            />
          ))}
        </CurrencyStrip>
      )}
    </div>
  );
}

export function ActivePiTable({ rows, amountCaption, onOpen }: { rows: ActivePiRow[]; amountCaption?: string; onOpen?: (id: string) => void }) {
  return (
    <div className={tableWrapClass}>
      <table className="min-w-full text-left text-sm">
        <thead className={theadClass}>
          <tr>
            <th className={thClass} scope="col">PI</th>
            <th className={thClass} scope="col">Client</th>
            <th className={thClass} scope="col">PI date</th>
            <th className={thClass} scope="col">Office</th>
            <th className={`${thClass} text-right`} scope="col">{amountCaption ?? "Amount"}</th>
            <th className={thClass} scope="col">Lead</th>
            <th className={thClass} scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={onOpen ? clickableRowClass : bodyRowClass}
              onClick={(event) => {
                if (!onOpen) return;
                if (event.target instanceof Element && event.target.closest("a")) return;
                onOpen(row.id);
              }}
            >
              <td className={tdClass}>
                <Link className={linkClass} to={`/pis/${row.id}`}>{row.displayNumber}</Link>
                {row.amountKind === "draft" ? <span className="mt-0.5 block text-[12px] text-muted">Draft total</span> : null}
                {row.revisionDraftOpen ? <span className="mt-0.5 block text-[12px] text-muted">Revision draft open</span> : null}
              </td>
              <td className={tdClass}>{row.clientName || "—"}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{formatDate(row.piDate)}</td>
              <td className={tdClass}>{officePresetLabel(row.presetDisplayName, row.presetArchived)}</td>
              <td className={`${tdClass} text-right font-medium whitespace-nowrap tabular-nums`}>{formatMoney(row.total, row.currency)}</td>
              <td className={tdClass}>{leadLabel(row.leadName, row.leadActive)}</td>
              <td className={tdClass}><StatusBadge status={row.displayStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CollectionSummaryTable({ summary }: { summary: CollectionSummary }) {
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">{receivedLabel(summary.receiptPeriod)}.</p>
      <div className={tableWrapClass}>
        <table className="min-w-full text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">Status</th>
              {summary.currencies.map((currency) => (
                <th key={currency.currency} className={`${thClass} text-right`} scope="col">{currency.currency}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COLLECTION_BUCKETS.map((bucket) => {
              const overdue = bucket === "overdue";
              return (
                <tr key={bucket} className={bodyRowClass}>
                  <th className={`${tdClass} font-medium ${overdue ? "text-danger" : ""}`} scope="row">{COLLECTION_BUCKET_LABELS[bucket]}</th>
                  {summary.currencies.map((currency) => (
                    <td key={currency.currency} className={`${tdClass} text-right tabular-nums ${overdue ? "text-danger" : ""}`}>
                      <Link className={overdue ? "font-medium text-danger underline" : linkClass} to={collectionPath({ bucket, currency: currency.currency, parentStatus: summary.parentStatus ?? "" })}>
                        {formatMoney(bucketAmount(currency, bucket), currency.currency)}
                      </Link>
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className={bodyRowClass}>
              <th className={`${tdClass} font-medium`} scope="row">Received</th>
              {summary.currencies.map((currency) => (
                <td key={currency.currency} className={`${tdClass} text-right tabular-nums`}>{formatMoney(currency.received, currency.currency)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-muted">Received counts each receipt once. It is not a list of obligations, so it does not open Payments.</p>
    </div>
  );
}

export function CoverageNote({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft px-4 py-3 text-sm text-ink">
      <p>{coverageText(count)}</p>
      <Link className="shrink-0 font-medium text-primary" to="/dashboard?coverage=untracked">View PIs</Link>
    </div>
  );
}

export function FiguresDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure title="How these figures work" open={open} onToggle={() => setOpen((current) => !current)}>
      <div className="max-w-3xl space-y-2 text-sm text-secondary">
        <p>{ACTIVE_PI_NOTE}</p>
        <p>{COLLECTION_NOTE}</p>
        <p>Quoted totals are not unpaid balances. A PI without a payment plan is counted separately, and its quoted total is not turned into an outstanding amount.</p>
      </div>
    </Disclosure>
  );
}

export function PaymentViewChoices({ location }: { location: PaymentLocation }) {
  return (
    <Segmented label="Payment view">
      {PAYMENT_VIEWS.map((view) => {
        const href = paymentsPath({
          ...location,
          view,
          page: 1,
          balance: view === "awaiting" ? location.balance : "",
          dueFrom: view === "awaiting" ? "" : location.dueFrom,
          dueTo: view === "awaiting" ? "" : location.dueTo,
        });
        const selected = location.view === view;
        return (
          <Link key={view} className={segmentItemClass(selected)} to={href} aria-current={selected ? "page" : undefined}>
            {PAYMENT_VIEW_LABELS[view]}
          </Link>
        );
      })}
    </Segmented>
  );
}

export function PaymentTotals({ register }: { register: PaymentRegister }) {
  if (register.totals.length === 0) return null;
  const totals = REPORT_CURRENCIES.flatMap((currency) => {
    const total = register.totals.find((item) => item.currency === currency);
    return total ? [total] : [];
  });
  return (
    <div className="mb-4">
      <CurrencyStrip columns={totals.length}>
        {totals.map((total) => (
          <CurrencyBlock
            key={total.currency}
            code={total.currency}
            lines={[
              { label: "Original", value: formatMoney(total.original, total.currency) },
              { label: "Paid", value: formatMoney(total.paid, total.currency) },
              { label: "Outstanding", value: formatMoney(total.outstanding, total.currency), tone: "strong" },
            ]}
          />
        ))}
      </CurrencyStrip>
    </div>
  );
}

function dueTone(row: PaymentRow): string {
  if (showsOverdueMarker(row)) return "text-danger";
  if (row.dueState === "due_today" && row.collectionStatus !== "paid" && row.collectionStatus !== "no_charge") return "text-warning";
  if (!row.dueDate) return "text-secondary";
  return "text-ink";
}

function collectionTone(status: string): string {
  if (status === "paid") return "bg-success-soft text-success";
  if (status === "partial") return "bg-warning-soft text-warning";
  return "bg-table text-secondary";
}

export function PaymentTable({ rows, onOpen }: { rows: PaymentRow[]; onOpen?: (piId: string) => void }) {
  return (
    <div className={tableWrapClass}>
      <table className="min-w-[880px] text-left text-sm">
        <thead className={theadClass}>
          <tr>
            <th className={thClass} scope="col">Due</th>
            <th className={thClass} scope="col">Client and PI</th>
            <th className={thClass} scope="col">Payment</th>
            <th className={`${thClass} text-right`} scope="col">Original</th>
            <th className={`${thClass} text-right`} scope="col">Paid</th>
            <th className={`${thClass} text-right`} scope="col">Outstanding</th>
            <th className={thClass} scope="col">Lead</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={onOpen ? clickableRowClass : bodyRowClass}
              onClick={(event) => {
                if (!onOpen) return;
                if (event.target instanceof Element && event.target.closest("a")) return;
                onOpen(row.piId);
              }}
            >
              <td className={`${tdClass} ${dueTone(row)}`}>
                <span className="block font-medium whitespace-nowrap">{row.dueDate ? formatDate(row.dueDate) : row.dueLabel}</span>
                {showsOverdueMarker(row) ? <span className="mt-0.5 block text-[12px]">Overdue</span> : null}
                {row.dueState === "due_today" && row.collectionStatus !== "paid" && row.collectionStatus !== "no_charge" ? (
                  <span className="mt-0.5 block text-[12px]">Due today</span>
                ) : null}
              </td>
              <td className={tdClass}>
                <span className="block">{row.clientName || "—"}</span>
                <Link className={linkClass} to={paymentTrackingPath(row.piId)}>{row.trackedDisplayNumber}</Link>
                <span className="mt-0.5 block text-[12px] text-muted">Tracked {row.trackedRevision && row.trackedRevision > 0 ? `R${row.trackedRevision}` : "original"}</span>
                {row.revisionDiffers ? <span className="mt-0.5 block text-[12px] text-muted">Latest issued differs. Tracking stays on this revision.</span> : null}
              </td>
              <td className={tdClass}>
                <span className="block">{row.label}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[12px] font-medium ${collectionTone(row.collectionStatus)}`}>
                    {collectionLabel(row.collectionStatus)}
                  </span>
                  <span className="text-[12px] text-muted">{displayStatusLabel(row.parentStatus)}</span>
                </span>
              </td>
              <td className={`${tdClass} text-right whitespace-nowrap tabular-nums`}>{formatMoney(row.originalAmount, row.currency)}</td>
              <td className={`${tdClass} text-right whitespace-nowrap tabular-nums`}>{formatMoney(row.paidAmount, row.currency)}</td>
              <td className={`${tdClass} text-right font-semibold whitespace-nowrap tabular-nums`}>{formatMoney(row.outstandingAmount, row.currency)}</td>
              <td className={tdClass}>{leadLabel(row.leadName, row.leadActive)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportCopy({ children }: { children: ReactNode }) {
  return <p className="mb-3 max-w-3xl text-sm text-secondary">{children}</p>;
}

export function activePiCopy(): string {
  return ACTIVE_PI_NOTE;
}

export function collectionCopy(): string {
  return COLLECTION_NOTE;
}

export function paymentsCopy(): string {
  return PAYMENTS_NOTE;
}

export function emptyPaymentsCopy(): string {
  return EMPTY_PAYMENTS;
}
