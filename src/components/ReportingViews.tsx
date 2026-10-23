import type { ReactNode } from "react";
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
import { StatusBadge, tdClass, thClass } from "./ui";

export function choiceClass(selected: boolean): string {
  return `h-10 rounded-md px-3 text-sm ${selected ? "bg-primary-soft font-medium text-primary" : "border border-line bg-white text-ink hover:bg-canvas"}`;
}

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
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {periods.map((period) => (
        <button key={period.id} type="button" className={choiceClass(period.id === value)} aria-pressed={period.id === value} onClick={() => onChange(period.id)}>
          {period.label}
        </button>
      ))}
    </div>
  );
}

export function piPeriodChoices(): { id: PiPeriod; label: string }[] {
  return (Object.keys(PI_PERIOD_LABELS) as PiPeriod[]).map((id) => ({ id, label: PI_PERIOD_LABELS[id] }));
}

export function receiptPeriodChoices(): { id: ReceiptPeriod; label: string }[] {
  return (Object.keys(RECEIPT_PERIOD_LABELS) as ReceiptPeriod[]).map((id) => ({ id, label: RECEIPT_PERIOD_LABELS[id] }));
}

export function ActivePiSummary({ report }: { report: ActiveReport }) {
  return (
    <div className="mb-3">
      <p className="text-sm text-slate-700">{report.count} matching {report.count === 1 ? "PI" : "PIs"}. {piDateLabel(report.period)}.</p>
      {report.totals.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No quoted totals in this result.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-[10px] border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={thClass} scope="col">Currency</th>
                <th className={`${thClass} text-right`} scope="col">Issued quoted total</th>
                <th className={`${thClass} text-right`} scope="col">Draft total</th>
              </tr>
            </thead>
            <tbody>
              {report.totals.map((total) => (
                <tr key={total.currency} className="border-t border-slate-100">
                  <td className={tdClass}>{total.currency}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(total.issued, total.currency)}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(total.draft, total.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ActivePiTable({ rows, amountCaption, onOpen }: { rows: ActivePiRow[]; amountCaption?: string; onOpen?: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={thClass} scope="col">PI number</th>
            <th className={thClass} scope="col">Client</th>
            <th className={thClass} scope="col">PI date</th>
            <th className={thClass} scope="col">Office</th>
            <th className={`${thClass} text-right`} scope="col">{amountCaption ?? "Quoted total"}</th>
            <th className={thClass} scope="col">Lead salesperson</th>
            <th className={thClass} scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`border-t border-slate-100 ${onOpen ? "cursor-pointer hover:bg-canvas" : ""}`}
              onClick={(event) => {
                if (!onOpen) return;
                if (event.target instanceof Element && event.target.closest("a")) return;
                onOpen(row.id);
              }}
            >
              <td className={tdClass}>
                <Link className="font-medium text-navy-900 underline" to={`/pis/${row.id}`}>{row.displayNumber}</Link>
                {row.amountKind === "draft" ? <span className="mt-0.5 block text-xs text-slate-500">Draft total</span> : null}
                {row.revisionDraftOpen ? <span className="mt-0.5 block text-xs text-slate-500">Revision draft open</span> : null}
              </td>
              <td className={tdClass}>{row.clientName || "—"}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{formatDate(row.piDate)}</td>
              <td className={tdClass}>{officePresetLabel(row.presetDisplayName, row.presetArchived)}</td>
              <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{formatMoney(row.total, row.currency)}</td>
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
      <p className="mb-2 text-sm text-slate-700">{receivedLabel(summary.receiptPeriod)}.</p>
      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className={thClass} scope="col">Tracked balance</th>
              {summary.currencies.map((currency) => (
                <th key={currency.currency} className={`${thClass} text-right`} scope="col">{currency.currency}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COLLECTION_BUCKETS.map((bucket) => (
              <tr key={bucket} className="border-t border-slate-100">
                <th className={`${tdClass} font-medium`} scope="row">{COLLECTION_BUCKET_LABELS[bucket]}</th>
                {summary.currencies.map((currency) => (
                  <td key={currency.currency} className={`${tdClass} text-right tabular-nums`}>
                    <Link className="text-navy-900 underline" to={collectionPath({ bucket, currency: currency.currency, parentStatus: summary.parentStatus ?? "" })}>
                      {formatMoney(bucketAmount(currency, bucket), currency.currency)}
                    </Link>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-slate-100">
              <th className={`${tdClass} font-medium`} scope="row">Received</th>
              {summary.currencies.map((currency) => (
                <td key={currency.currency} className={`${tdClass} text-right tabular-nums`}>{formatMoney(currency.received, currency.currency)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-slate-600">Received counts each receipt once, by the date it was received. It is not a list of obligations, so it does not open Payments.</p>
    </div>
  );
}

export function CoverageNote({ count }: { count: number }) {
  return (
    <p className="text-sm text-slate-700">
      {coverageText(count)}{" "}
      <Link className="text-navy-900 underline" to="/dashboard?coverage=untracked">View these PIs</Link>
    </p>
  );
}

export function PaymentViewChoices({ location }: { location: PaymentLocation }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Payment view">
      {PAYMENT_VIEWS.map((view) => {
        const href = paymentsPath({
          ...location,
          view,
          page: 1,
          balance: view === "awaiting" ? location.balance : "",
          dueFrom: view === "awaiting" ? "" : location.dueFrom,
          dueTo: view === "awaiting" ? "" : location.dueTo,
        });
        return (
          <Link key={view} className={choiceClass(location.view === view)} to={href} aria-current={location.view === view ? "page" : undefined}>
            {PAYMENT_VIEW_LABELS[view]}
          </Link>
        );
      })}
    </div>
  );
}

export function PaymentTotals({ register }: { register: PaymentRegister }) {
  if (register.totals.length === 0) return null;
  return (
    <div className="mb-3 overflow-x-auto rounded-[10px] border border-line bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={thClass} scope="col">Currency</th>
            <th className={`${thClass} text-right`} scope="col">Original</th>
            <th className={`${thClass} text-right`} scope="col">Paid</th>
            <th className={`${thClass} text-right`} scope="col">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {register.totals.map((total) => (
            <tr key={total.currency} className="border-t border-slate-100">
              <td className={tdClass}>{total.currency}</td>
              <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(total.original, total.currency)}</td>
              <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(total.paid, total.currency)}</td>
              <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(total.outstanding, total.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentTable({ rows, onOpen }: { rows: PaymentRow[]; onOpen?: (piId: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={thClass} scope="col">Due</th>
            <th className={thClass} scope="col">Client</th>
            <th className={thClass} scope="col">PI</th>
            <th className={thClass} scope="col">Payment</th>
            <th className={`${thClass} text-right`} scope="col">Original</th>
            <th className={`${thClass} text-right`} scope="col">Paid</th>
            <th className={`${thClass} text-right`} scope="col">Outstanding</th>
            <th className={thClass} scope="col">Currency</th>
            <th className={thClass} scope="col">Collection status</th>
            <th className={thClass} scope="col">Lead salesperson</th>
            <th className={thClass} scope="col">PI status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`border-t border-slate-100 ${onOpen ? "cursor-pointer hover:bg-canvas" : ""}`}
              onClick={(event) => {
                if (!onOpen) return;
                if (event.target instanceof Element && event.target.closest("a")) return;
                onOpen(row.piId);
              }}
            >
              <td className={tdClass}>
                <span className="whitespace-nowrap">{row.dueDate ? formatDate(row.dueDate) : row.dueLabel}</span>
                {showsOverdueMarker(row) ? <span className="mt-0.5 block text-xs text-red-800">Overdue</span> : null}
              </td>
              <td className={tdClass}>{row.clientName || "—"}</td>
              <td className={tdClass}>
                <Link className="font-medium text-navy-900 underline" to={paymentTrackingPath(row.piId)}>{row.trackedDisplayNumber}</Link>
                <span className="mt-0.5 block text-xs text-slate-500">Tracked {row.trackedRevision && row.trackedRevision > 0 ? `R${row.trackedRevision}` : "original"}</span>
                {row.revisionDiffers ? <span className="mt-0.5 block text-xs text-slate-500">Latest issued differs. Tracking stays on this revision.</span> : null}
              </td>
              <td className={tdClass}>{row.label}</td>
              <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(row.originalAmount, row.currency)}</td>
              <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(row.paidAmount, row.currency)}</td>
              <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(row.outstandingAmount, row.currency)}</td>
              <td className={tdClass}>{row.currency}</td>
              <td className={tdClass}>{collectionLabel(row.collectionStatus)}</td>
              <td className={tdClass}>{leadLabel(row.leadName, row.leadActive)}</td>
              <td className={tdClass}>{displayStatusLabel(row.parentStatus)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportCopy({ children }: { children: ReactNode }) {
  return <p className="mb-3 max-w-3xl text-sm text-slate-600">{children}</p>;
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
