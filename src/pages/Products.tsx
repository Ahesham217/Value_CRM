import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, EmptyState, PageHeader, Pagination, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { formatMoney } from "../lib/format";
import { can } from "../lib/permissions";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { Product } from "../lib/types";

export function ProductsPage() {
  const { profile } = useAuth();
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
      <PageHeader title="Products" subtitle="Catalogue items. Invoice lines keep their own copy of the description and price." actions={manage ? <Link to="/products/new"><Button variant="primary">New product</Button></Link> : null} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm">
          <span className="mb-1 block font-medium">Search</span>
          <input className={controlClass} value={query} placeholder="Brand, model, or description" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); setPage(1); }} />
          Show archived
        </label>
      </div>
      {error ? <p className="text-sm text-red-800">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-600">Loading products…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No products yet" body="A PI can also use a custom line when the item is not in the catalogue." /> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">EGP</th>
                <th className="px-3 py-2 font-medium">USD</th>
                <th className="px-3 py-2 font-medium">EUR</th>
                {seeCost ? <th className="px-3 py-2 font-medium">Purchase</th> : null}
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => (
                <tr key={product.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><Link className="font-medium text-navy-800 underline" to={`/products/${product.id}`}>{product.model_code}</Link></td>
                  <td className="px-3 py-2">{product.brand || "—"}</td>
                  <td className="px-3 py-2">{product.vendors?.company_name || "—"}</td>
                  <td className="px-3 py-2">{formatMoney(product.sell_price_egp)}</td>
                  <td className="px-3 py-2">{formatMoney(product.sell_price_usd)}</td>
                  <td className="px-3 py-2">{formatMoney(product.sell_price_eur)}</td>
                  {seeCost ? <td className="px-3 py-2">{costs[product.id] || "—"}</td> : null}
                  <td className="px-3 py-2">{product.archived_at ? "Archived" : "Active"}</td>
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
