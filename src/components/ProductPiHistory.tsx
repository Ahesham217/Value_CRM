import { Fragment, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { errorText } from "../lib/errors";
import { displayStatusLabel, formatDate } from "../lib/format";
import {
  PI_HISTORY_PRICE_NOTE,
  PI_HISTORY_STATUS_NOTE,
  PI_HISTORY_SUBTITLE,
  PI_HISTORY_TITLE,
  historyDiscountDetail,
  historySubscriptionDetail,
  historyLegacyDetail,
  historyRowHref,
  historySourceText,
  parseProductHistory,
  productHistoryFilterChips,
  quotedQuantityLabel,
  quotedUnitPriceLabel,
  type ProductHistoryPage,
} from "../lib/product-history";
import { can } from "../lib/permissions";
import { PAGE_SIZE } from "../lib/records";
import { supabase } from "../lib/supabase";
import { Button, FilterChip, Pagination, Select, StatusBadge, thClass, tdClass } from "./ui";

export function ProductPiHistory({ productId, refreshKey = 0 }: { productId: string; refreshKey?: number }) {
  const { profile } = useAuth();
  const canEdit = can(profile, "can_edit_drafts");
  const filtersId = useId();
  const [includeOlder, setIncludeOlder] = useState(false);
  const [client, setClient] = useState("");
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [result, setResult] = useState<ProductHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.rpc("product_pi_history", {
      p_product_id: productId,
      p_include_older: includeOlder,
      p_client: client || null,
      p_currency: currency || null,
      p_status: status || null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }).then(({ data, error: queryError }) => {
      if (!active) return;
      if (queryError) {
        setError(errorText(queryError));
        setResult(null);
      } else {
        try {
          setResult(parseProductHistory(data));
          setError(null);
        } catch (caught) {
          setError(errorText(caught));
          setResult(null);
        }
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [client, currency, includeOlder, page, productId, refreshKey, reload, status]);

  useEffect(() => {
    if (!result) return;
    const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
    if (page > pageCount) setPage(pageCount);
  }, [page, result]);

  const chips = productHistoryFilterChips({ client, currency, status });
  const clients = result?.clients ?? [];
  const currencies = result?.currencies ?? [];
  const statuses = result?.statuses ?? [];
  const clientOptions = client && !clients.includes(client) ? [client, ...clients] : clients;
  const currencyOptions = currency && !currencies.includes(currency) ? [currency, ...currencies] : currencies;
  const statusOptions = status && !statuses.includes(status) ? [status, ...statuses] : statuses;

  function resetPage() {
    setPage(1);
    setExpanded(null);
  }

  function clearFilters() {
    setClient("");
    setCurrency("");
    setStatus("");
    resetPage();
  }

  return (
    <section className="rounded-lg border border-line bg-white" aria-labelledby="pi-history-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <h2 id="pi-history-heading" className="text-[15px] font-semibold text-ink">{PI_HISTORY_TITLE}</h2>
          <p className="mt-0.5 text-sm text-muted">{PI_HISTORY_SUBTITLE}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            {chips.length > 0 ? `Filters (${chips.length})` : "Filters"}
          </Button>
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={includeOlder}
              onChange={(event) => {
                setIncludeOlder(event.target.checked);
                resetPage();
              }}
            />
            Include older revisions
          </label>
        </div>
      </div>
      <p className="px-6 pt-3 text-xs text-muted">{PI_HISTORY_PRICE_NOTE}</p>
      {filtersOpen ? (
        <div id={filtersId} className="mx-6 mt-3 grid gap-3 rounded-md border border-line bg-canvas p-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-secondary">Client</span>
            <Select value={client} onChange={(event) => { setClient(event.target.value); resetPage(); }}>
              <option value="">All</option>
              {clientOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-secondary">Currency</span>
            <Select value={currency} onChange={(event) => { setCurrency(event.target.value); resetPage(); }}>
              <option value="">All</option>
              {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-secondary">PI status</span>
            <Select value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }}>
              <option value="">All</option>
              {statusOptions.map((code) => <option key={code} value={code}>{displayStatusLabel(code)}</option>)}
            </Select>
          </label>
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-6 pt-3">
          {chips.map((chip) => (
            <FilterChip
              key={chip.id}
              label={chip.label}
              onRemove={() => {
                if (chip.id === "client") setClient("");
                if (chip.id === "currency") setCurrency("");
                if (chip.id === "status") setStatus("");
                resetPage();
              }}
            />
          ))}
          <button type="button" className="text-sm text-navy-800 underline" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : null}
      <div className="px-6 py-4">
        {!loading && error ? (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-danger">{error}</p>
            <Button type="button" variant="secondary" onClick={() => setReload((current) => current + 1)}>Retry</Button>
          </div>
        ) : null}
        {loading ? <p className="text-sm text-muted" aria-live="polite">Loading PI history…</p> : null}
        {!loading && !error && result && result.rows.length === 0 ? (
          <p className="text-sm text-muted">
            {chips.length > 0
              ? "No quotations match these filters."
              : "This product has not been quoted on a PI you can view."}
          </p>
        ) : null}
        {!loading && !error && result && result.rows.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="min-w-[960px] w-full text-left text-sm">
              <thead className="bg-table">
                <tr>
                  <th className={thClass} scope="col">PI / version</th>
                  <th className={thClass} scope="col">Client</th>
                  <th className={thClass} scope="col">PI date</th>
                  <th className={`${thClass} text-right`} scope="col">Quantity</th>
                  <th className={`${thClass} text-right`} scope="col">Quoted unit price</th>
                  <th className={thClass} scope="col">Currency</th>
                  <th className={thClass} scope="col">PI status</th>
                  <th className={thClass} scope="col"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const source = historySourceText(row);
                  const open = expanded === row.row_id;
                  const detailsId = `pi-history-${row.row_id}`;
                  const discount = historyDiscountDetail(row);
                  const legacy = historyLegacyDetail(row.match_kind);
                  return (
                    <Fragment key={row.row_id}>
                      <tr className="border-t border-line">
                        <td className={tdClass}>
                          <Link className="font-medium text-navy-900 underline" to={historyRowHref(row.source, row.pi_id, canEdit)}>
                            {source.title}
                          </Link>
                          <span className="mt-0.5 block text-xs text-muted">{source.detail}</span>
                          {row.discount_on_pi ? <span className="mt-0.5 block text-xs text-muted">Discount on PI</span> : null}
                        </td>
                        <td className={tdClass}>{row.client_name || "—"}</td>
                        <td className={`${tdClass} whitespace-nowrap`}>{formatDate(row.pi_date)}</td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{quotedQuantityLabel(row.quantity, row.unit)}</td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {quotedUnitPriceLabel(row.unit_price)}
                          {historySubscriptionDetail(row) ? <span className="mt-0.5 block text-xs font-normal text-muted">{historySubscriptionDetail(row)}</span> : null}
                        </td>
                        <td className={tdClass}>{row.currency || "—"}</td>
                        <td className={tdClass}><StatusBadge status={row.pi_status} /></td>
                        <td className={tdClass}>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-canvas"
                            aria-expanded={open}
                            aria-controls={detailsId}
                            aria-label={open ? "Hide quoted line details" : "Show quoted line details"}
                            onClick={() => setExpanded(open ? null : row.row_id)}
                          >
                            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-line bg-canvas">
                          <td id={detailsId} className="px-3 py-3" colSpan={8}>
                            <dl className="grid gap-3 text-sm sm:grid-cols-2">
                              <div>
                                <dt className="text-xs text-muted">Saved model</dt>
                                <dd>{row.model_code || "—"}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-muted">Line</dt>
                                <dd>Line {row.position}</dd>
                              </div>
                              <div className="sm:col-span-2">
                                <dt className="text-xs text-muted">Description</dt>
                                <dd className="whitespace-pre-wrap">{row.description || "—"}</dd>
                              </div>
                              {discount ? (
                                <div className="sm:col-span-2">
                                  <dt className="text-xs text-muted">Invoice-wide discount</dt>
                                  <dd>{discount}</dd>
                                </div>
                              ) : null}
                              {legacy ? (
                                <div className="sm:col-span-2">
                                  <dt className="text-xs text-muted">Product match</dt>
                                  <dd>{legacy}</dd>
                                </div>
                              ) : null}
                            </dl>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {!loading && !error && result ? (
        <div className="border-t border-line px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted" aria-live="polite">
              {result.total === 1 ? "1 result" : `${result.total} results`}
            </p>
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(result.total / PAGE_SIZE))} onPage={(next) => { setPage(next); setExpanded(null); }} />
          </div>
          <p className="mt-2 text-xs text-muted">{PI_HISTORY_STATUS_NOTE}</p>
        </div>
      ) : null}
    </section>
  );
}
