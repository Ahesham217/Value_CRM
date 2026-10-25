import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageHeader, Pagination, Select, controlClass, tdClass, thClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { formatDate, formatQuantity } from "../lib/format";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "../lib/useDebouncedValue";
import { supabase } from "../lib/supabase";

type SubscriptionListRow = {
  id: string;
  client_name: string;
  product_model: string;
  product_description: string;
  quantity: string | number;
  commitment_years: number;
  start_date: string;
  commitment_end_date: string;
  next_payment_on: string | null;
  currency: string;
  state: string;
};

export function SubscriptionsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [currency, setCurrency] = useState("");
  const [state, setState] = useState("");
  const [years, setYears] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SubscriptionListRow[]>([]);
  const [count, setCount] = useState(0);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [yearOptions, setYearOptions] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("subscription_list").select("currency, commitment_years").then(({ data, error: optionError }) => {
      if (optionError) return;
      const visible = (data ?? []) as { currency: string; commitment_years: number }[];
      setCurrencies([...new Set(visible.map((item) => item.currency))].sort());
      setYearOptions([...new Set(visible.map((item) => item.commitment_years))].sort((left, right) => left - right));
    });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const term = sanitizeSearch(debouncedQuery);
    let request = supabase.from("subscription_list").select("*", { count: "exact" }).order("start_date", { ascending: false }).order("client_name");
    if (term) request = request.or(`client_name.ilike.%${term}%,product_model.ilike.%${term}%,product_description.ilike.%${term}%`);
    if (currency) request = request.eq("currency", currency);
    if (state) request = request.eq("state", state);
    if (years) request = request.eq("commitment_years", Number(years));
    request.range(from, from + PAGE_SIZE - 1).then(({ data, error: queryError, count: total }) => {
      if (!active) return;
      if (queryError) setError(errorText(queryError));
      else {
        setRows((data ?? []) as SubscriptionListRow[]);
        setCount(total ?? 0);
        setError(null);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [currency, debouncedQuery, page, state, years]);

  return (
    <div>
      <PageHeader title="Subscriptions" />
      <p className="mb-3 max-w-3xl text-sm text-muted">
        Active subscriptions start when the first-year obligation is fully paid. Renewal invoicing and reminders are not implemented yet.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">
          <span className="mb-1 block font-medium text-secondary">Search</span>
          <input className={controlClass} placeholder="Client or product" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <label className="w-32 text-sm">
          <span className="mb-1 block font-medium text-secondary">Currency</span>
          <Select value={currency} onChange={(event) => { setCurrency(event.target.value); setPage(1); }}>
            <option value="">All</option>
            {currencies.map((item) => <option key={item}>{item}</option>)}
          </Select>
        </label>
        <label className="w-40 text-sm">
          <span className="mb-1 block font-medium text-secondary">Commitment</span>
          <Select value={years} onChange={(event) => { setYears(event.target.value); setPage(1); }}>
            <option value="">All</option>
            {yearOptions.map((item) => <option key={item} value={item}>{item === 1 ? "1 year" : `${item} years`}</option>)}
          </Select>
        </label>
        <label className="w-44 text-sm">
          <span className="mb-1 block font-medium text-secondary">Payment review</span>
          <Select value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="active">No review flag</option>
            <option value="payment_review_required">Payment review required</option>
          </Select>
        </label>
      </div>
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      {loading ? <p className="text-sm text-muted">Loading subscriptions…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No subscriptions" body="A subscription appears here after its first-year obligation is fully paid, or after an authorised no-charge activation." /> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-table">
              <tr>
                <th className={thClass} scope="col">Client</th>
                <th className={thClass} scope="col">Product</th>
                <th className={thClass} scope="col">Qty</th>
                <th className={thClass} scope="col">Commitment</th>
                <th className={thClass} scope="col">Start</th>
                <th className={thClass} scope="col">Next committed payment</th>
                <th className={thClass} scope="col">Commitment end</th>
                <th className={thClass} scope="col">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-line hover:bg-canvas"
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest("a, button")) return;
                    navigate(`/subscriptions/${row.id}`);
                  }}
                >
                  <td className={tdClass}>{row.client_name}</td>
                  <td className={tdClass}>
                    <Link className="font-medium text-navy-900 underline" to={`/subscriptions/${row.id}`}>{row.product_model}</Link>
                    {row.product_description ? <span className="mt-0.5 block text-xs text-muted">{row.product_description}</span> : null}
                  </td>
                  <td className={tdClass}>{formatQuantity(row.quantity)}</td>
                  <td className={tdClass}>{row.commitment_years === 1 ? "1 year" : `${row.commitment_years} years`}</td>
                  <td className={tdClass}>{formatDate(row.start_date)}</td>
                  <td className={tdClass}>{row.next_payment_on ? formatDate(row.next_payment_on) : "—"}</td>
                  <td className={tdClass}>{formatDate(row.commitment_end_date)}</td>
                  <td className={tdClass}>
                    {row.state === "payment_review_required" ? (
                      <span className="inline-flex rounded-md bg-warning-soft px-2 py-0.5 text-[12px] font-medium text-warning">Payment review required</span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pagination page={page} pageCount={Math.ceil(count / PAGE_SIZE)} onPage={setPage} />
    </div>
  );
}
