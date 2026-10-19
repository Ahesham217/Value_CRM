import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { EmptyState, PageHeader, Pagination, buttonClass, controlClass, tdClass, thClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { formatMoney } from "../lib/format";
import { can } from "../lib/permissions";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { Product } from "../lib/types";

export function ProductsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const manage = can(profile, "can_manage_products");
  const seeCost = can(profile, "can_view_purchase_prices");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Product[]>([]);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const term = sanitizeSearch(query);
    let request = supabase.from("products").select("*, vendors(company_name)", { count: "exact" }).order("model_code");
    if (term) request = request.or(`model_code.ilike.%${term}%,brand.ilike.%${term}%,description.ilike.%${term}%`);
    if (!showArchived) request = request.is("archived_at", null);
    request.range(from, from + PAGE_SIZE - 1).then(async ({ data, error: queryError, count: total }) => {
      if (!active) return;
      if (queryError) {
        setError(errorText(queryError));
        setLoading(false);
        return;
      }
      const products = (data ?? []) as Product[];
      setRows(products);
      setCount(total ?? 0);
      if (seeCost && products.length) {
        const { data: costRows } = await supabase.from("product_costs").select("product_id, purchase_price, purchase_currency").in("product_id", products.map((product) => product.id));
        if (!active) return;
        const map: Record<string, string> = {};
        for (const cost of costRows ?? []) {
          map[cost.product_id as string] = formatMoney(cost.purchase_price as string | null, cost.purchase_currency as string | null);
        }
        setCosts(map);
      } else {
        setCosts({});
      }
      setError(null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [page, query, seeCost, showArchived]);

  return (
    <div>
      <PageHeader
        title="Products"
        actions={manage ? <Link to="/products/new" className={buttonClass("primary")}>Add product</Link> : null}
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm">
          <span className="mb-1 block font-medium text-slate-700">Search</span>
          <input className={controlClass} value={query} placeholder="Model or description" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); setPage(1); }} />
          Show archived
        </label>
      </div>
      {error ? <p className="text-sm text-red-800" role="alert">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-600">Loading products…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No products yet" body={manage ? "Use Add product, or create one while preparing a proforma invoice." : "No products are available."} /> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={thClass} scope="col">Model</th>
                <th className={thClass} scope="col">Vendor</th>
                <th className={thClass} scope="col">Unit</th>
                <th className={`${thClass} text-right`} scope="col">EGP</th>
                <th className={`${thClass} text-right`} scope="col">USD</th>
                <th className={`${thClass} text-right`} scope="col">EUR</th>
                {seeCost ? <th className={`${thClass} text-right`} scope="col">Purchase</th> : null}
                <th className={thClass} scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => (
                <tr
                  key={product.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest("a, button")) return;
                    navigate(`/products/${product.id}`);
                  }}
                >
                  <td className={tdClass}>
                    <Link className="font-medium text-navy-900 underline" to={`/products/${product.id}`}>{product.model_code}</Link>
                    {product.brand ? <span className="mt-0.5 block text-xs text-slate-500">{product.brand}</span> : null}
                  </td>
                  <td className={tdClass}>{product.vendors?.company_name || "—"}</td>
                  <td className={tdClass}>{product.unit || "—"}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(product.sell_price_egp)}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(product.sell_price_usd)}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(product.sell_price_eur)}</td>
                  {seeCost ? <td className={`${tdClass} text-right tabular-nums`}>{costs[product.id] || "—"}</td> : null}
                  <td className={tdClass}>{product.archived_at ? "Archived" : "Active"}</td>
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
