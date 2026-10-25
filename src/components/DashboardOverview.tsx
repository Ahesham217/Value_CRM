import Decimal from "decimal.js";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { displayStatusLabel, formatDate, formatMoney } from "../lib/format";
import {
  COLLECTION_BUCKET_LABELS,
  COLLECTION_BUCKETS,
  DASHBOARD_CURRENCIES,
  DUE_BUCKET_LABELS,
  DUE_BUCKETS,
  PI_STATUSES,
  bucketAmount,
  collectionPath,
  dueBucketAmount,
  dueBucketPath,
  moneyIsPositive,
  quotedForCurrency,
  type ActiveReport,
  type CollectionCurrency,
  type CurrencyCode,
  type DueBucket,
  type PiStatus,
} from "../lib/reporting";
import { Button, segmentItemClass, Segmented } from "./ui";

const cardClass = "min-w-0 rounded-lg border border-line bg-white p-5";
const linkCardClass = `${cardClass} block hover:border-primary`;

export function CurrencySelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (currency: CurrencyCode) => void;
}) {
  return (
    <Segmented label="Currency">
      {DASHBOARD_CURRENCIES.map((currency) => (
        <button
          key={currency}
          type="button"
          className={segmentItemClass(currency === value)}
          aria-pressed={currency === value}
          onClick={() => onChange(currency)}
        >
          {currency}
        </button>
      ))}
    </Segmented>
  );
}

function CardIcon({ name, className }: { name: "pis" | "quoted" | "clock" | "overdue"; className: string }) {
  const common = `h-4 w-4 shrink-0 ${className}`;
  if (name === "pis") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="2" width="10" height="12" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "quoted") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 5.2V8l2 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5.2v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="10.8" r="0.7" fill="currentColor" />
    </svg>
  );
}

function CardLabel({ icon, children }: { icon: "pis" | "quoted" | "clock" | "overdue"; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[13px] font-medium text-secondary">
      <CardIcon name={icon} className="text-muted" />
      {children}
    </p>
  );
}

export function SummaryCards({
  currency,
  report,
  collection,
  collectionFailed,
  activeHref,
  outstandingHref,
  overdueHref,
}: {
  currency: CurrencyCode;
  report: ActiveReport;
  collection: CollectionCurrency | null;
  collectionFailed: boolean;
  activeHref: string;
  outstandingHref: string;
  overdueHref: string;
}) {
  const quoted = quotedForCurrency(report.totals, currency);
  const overduePositive = collection ? moneyIsPositive(collection.overdue) : false;
  const noPlan = collection ? collection.planCount === 0 : false;
  const collectionPending = collectionFailed ? "Collections could not be loaded" : "Loading collections…";
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Link className={linkCardClass} to={activeHref}>
        <CardLabel icon="pis">Active PIs</CardLabel>
        <p className="mt-3 text-[30px] leading-9 font-semibold text-ink tabular-nums">{report.count}</p>
        <p className="mt-2 text-[13px] text-secondary">In the selected PI period</p>
      </Link>
      <article className={cardClass}>
        <CardLabel icon="quoted">Issued quoted value</CardLabel>
        <p className="mt-3 text-[28px] leading-9 font-semibold text-ink tabular-nums">{formatMoney(quoted.issued, currency)}</p>
        <p className="mt-2 text-[13px] text-secondary">Latest issued versions · not revenue</p>
        {moneyIsPositive(quoted.draft) ? (
          <p className="mt-1 text-[13px] text-muted tabular-nums">Draft quoted value {formatMoney(quoted.draft, currency)} · not included</p>
        ) : null}
      </article>
      {collection && !noPlan ? (
        <Link className={linkCardClass} to={outstandingHref}>
          <CardLabel icon="clock">Tracked outstanding</CardLabel>
          <p className="mt-3 text-[28px] leading-9 font-semibold text-ink tabular-nums">{formatMoney(collection.outstanding, currency)}</p>
          <p className="mt-2 text-[13px] text-secondary">All tracked payment plans</p>
        </Link>
      ) : (
        <article className={cardClass}>
          <CardLabel icon="clock">Tracked outstanding</CardLabel>
          <p className="mt-3 text-[28px] leading-9 font-semibold text-ink">{collection ? "—" : "…"}</p>
          <p className="mt-2 text-[13px] text-secondary">All tracked payment plans</p>
          <p className="mt-1 text-[13px] text-muted">{collection ? "No payment plan in this currency" : collectionPending}</p>
        </article>
      )}
      {collection && !noPlan ? (
        <Link className={linkCardClass} to={overdueHref}>
          <p className="flex items-center gap-2 text-[13px] font-medium text-secondary">
            <CardIcon name="overdue" className={overduePositive ? "text-danger" : "text-muted"} />
            Overdue
          </p>
          <p className={`mt-3 text-[28px] leading-9 font-semibold tabular-nums ${overduePositive ? "text-danger" : "text-ink"}`}>
            {formatMoney(collection.overdue, currency)}
          </p>
          <p className="mt-2 text-[13px] text-secondary">Independent of the PI period</p>
        </Link>
      ) : (
        <article className={cardClass}>
          <p className="flex items-center gap-2 text-[13px] font-medium text-secondary">
            <CardIcon name="overdue" className="text-muted" />
            Overdue
          </p>
          <p className="mt-3 text-[28px] leading-9 font-semibold text-ink">{collection ? "—" : "…"}</p>
          <p className="mt-2 text-[13px] text-secondary">Independent of the PI period</p>
          <p className="mt-1 text-[13px] text-muted">{collection ? "No payment plan in this currency" : collectionPending}</p>
        </article>
      )}
    </div>
  );
}

function barWidth(amount: string, max: string): string {
  if (!moneyIsPositive(max) || !moneyIsPositive(amount)) return "0%";
  const limit = new Decimal(max);
  if (!limit.isFinite() || limit.lte(0)) return "0%";
  const ratio = new Decimal(amount).div(limit).times(100);
  if (!ratio.isFinite() || ratio.lte(0)) return "0%";
  return `${Math.min(100, ratio.toNumber())}%`;
}

function widestAmount(amounts: string[]): string {
  return amounts.reduce((best, amount) => (new Decimal(amount).gt(best) ? amount : best), "0.00");
}

function countWidth(count: number, max: number): string {
  if (max <= 0 || count <= 0) return "0%";
  return `${Math.min(100, (count / max) * 100)}%`;
}

export function StatusChart({
  counts,
  hrefFor,
  current,
}: {
  counts: ActiveReport["statusCounts"];
  hrefFor: (status: PiStatus) => string;
  current: string;
}) {
  const max = Math.max(...PI_STATUSES.map((status) => counts[status]));
  return (
    <section className="min-w-0 overflow-x-auto rounded-lg border border-line bg-white p-5" aria-labelledby="status-chart-heading">
      <h2 id="status-chart-heading" className="text-[18px] leading-6 font-semibold text-ink">Active PIs by status</h2>
      <p className="mt-1 text-[13px] text-secondary">PI period · count</p>
      <ul className="mt-4 space-y-3">
        {PI_STATUSES.map((status) => {
          const count = counts[status];
          const label = displayStatusLabel(status);
          return (
            <li key={status}>
              <Link
                className="block min-w-0 rounded-md hover:bg-canvas"
                to={hrefFor(status)}
                aria-current={current === status ? "page" : undefined}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink">{label}</span>
                  <span className="shrink-0 text-sm font-medium text-ink tabular-nums">{count}</span>
                </span>
                <span className="mt-1.5 block h-2 rounded-full bg-table">
                  <span className="block h-2 rounded-full bg-primary" style={{ width: countWidth(count, max) }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function dueBarClass(bucket: DueBucket, amount: string): string {
  if (!moneyIsPositive(amount)) return "bg-line";
  if (bucket === "overdue") return "bg-danger";
  if (bucket === "unresolved") return "bg-muted";
  return "bg-primary";
}

export function CollectionsPanel({
  currency,
  row,
  today,
  parentStatus,
  loading,
  error,
  onRetry,
  controls,
  parentControl,
}: {
  currency: CurrencyCode;
  row: CollectionCurrency | null;
  today: string;
  parentStatus: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  controls: ReactNode;
  parentControl: ReactNode;
}) {
  const outstanding = row && moneyIsPositive(row.outstanding);
  const settled = row && row.planCount > 0 && !moneyIsPositive(row.outstanding);
  const noPlan = row && row.planCount === 0;
  const max = row ? widestAmount(DUE_BUCKETS.map((bucket) => dueBucketAmount(row, bucket))) : "0.00";
  return (
    <section className="min-w-0 overflow-x-auto rounded-lg border border-line bg-white p-5" aria-labelledby="collections-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="collections-heading" className="text-[18px] leading-6 font-semibold text-ink">Collections</h2>
          <p className="mt-1 text-[13px] text-secondary">All tracked balances · independent of PI period</p>
        </div>
        <div className="min-w-0">{controls}</div>
      </div>
      {error ? (
        <div className="mt-4" role="alert">
          <p className="text-sm text-danger">{row ? `The collection figures could not be refreshed. ${error}` : error}</p>
          {row ? null : <Button className="mt-3" type="button" onClick={onRetry}>Retry</Button>}
        </div>
      ) : null}
      {loading && !row ? <p className="mt-4 text-sm text-muted" aria-live="polite">Loading collections…</p> : null}
      {noPlan ? (
        <div className="mt-5 rounded-lg border border-line bg-canvas px-4 py-8 text-center">
          <h3 className="text-sm font-semibold text-ink">No active collections</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-secondary">
            There is no payment plan in {currency}. Quoted offers stay in Active PIs and are not money due.
          </p>
        </div>
      ) : null}
      {settled ? (
        <div className="mt-5 rounded-lg border border-line bg-canvas px-4 py-8 text-center">
          <h3 className="text-sm font-semibold text-ink">Nothing outstanding</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-secondary">
            Tracked obligations in {currency} are settled. Offers without a payment plan are not included.
          </p>
        </div>
      ) : null}
      {outstanding && row ? (
        <ul className="mt-5 space-y-3">
          {DUE_BUCKETS.map((bucket) => {
            const amount = dueBucketAmount(row, bucket);
            const positiveOverdue = bucket === "overdue" && moneyIsPositive(amount);
            return (
              <li key={bucket}>
                <Link className="block min-w-0 rounded-md hover:bg-canvas" to={dueBucketPath({ bucket, currency, today, parentStatus })}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={`text-sm ${positiveOverdue ? "text-danger" : "text-ink"}`}>{DUE_BUCKET_LABELS[bucket]}</span>
                    <span className={`shrink-0 text-right text-sm font-medium whitespace-nowrap tabular-nums ${positiveOverdue ? "text-danger" : "text-ink"}`}>
                      {formatMoney(amount, currency)}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-2 rounded-full bg-table">
                    <span className={`block h-2 rounded-full ${dueBarClass(bucket, amount)}`} style={{ width: barWidth(amount, max) }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {row ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-secondary">Received</p>
            <p className="text-sm font-semibold text-ink tabular-nums">{formatMoney(row.received, currency)}</p>
          </div>
          <p className="mt-1 text-[12px] text-muted">Counts each non-reversed receipt once by the date it was received. This is not revenue.</p>
          {row.planCount > 0 ? (
            <div className="mt-4">
              <h3 className="text-[13px] font-medium text-secondary">Existing views</h3>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {COLLECTION_BUCKETS.map((bucket) => (
                  <li key={bucket}>
                    <Link className="text-[13px] text-primary underline" to={collectionPath({ bucket, currency, parentStatus })}>
                      {COLLECTION_BUCKET_LABELS[bucket]} <span className="tabular-nums">{formatMoney(bucketAmount(row, bucket), currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">Next 7 days sits inside next 30 days. The chart above keeps those dates separate.</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 max-w-xs">{parentControl}</div>
    </section>
  );
}

export function dashboardRangeLabel(report: ActiveReport): string {
  if (report.period.unbounded) return "All active";
  if (!report.period.start || !report.period.end) return "";
  return `${formatDate(report.period.start)} – ${formatDate(report.period.end)}`;
}
