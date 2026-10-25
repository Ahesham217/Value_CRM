import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { EmptyState, PageHeader, Pagination, buttonClass, controlClass, tdClass, thClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { can } from "../lib/permissions";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { Client } from "../lib/types";

export function ClientsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Client[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const manage = can(profile, "can_manage_clients");

  useEffect(() => {
    let active = true;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    let request = supabase.from("clients").select("*", { count: "exact" }).order("company_name");
    const term = sanitizeSearch(query);
    if (term) request = request.ilike("company_name", `%${term}%`);
    if (!showArchived) request = request.is("archived_at", null);
    request.range(from, from + PAGE_SIZE - 1).then(({ data, error: queryError, count: total }) => {
      if (!active) return;
      if (queryError) setError(errorText(queryError));
      else {
        setRows((data ?? []) as Client[]);
        setCount(total ?? 0);
        setError(null);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [page, query, showArchived]);

  return (
    <div>
      <PageHeader
        title="Clients"
        actions={manage ? <Link to="/clients/new" className={buttonClass("primary")}>Add client</Link> : null}
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm">
          <span className="mb-1 block font-medium text-secondary">Search</span>
          <input className={controlClass} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Company name" />
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); setPage(1); }} />
          Show archived
        </label>
      </div>
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      {loading ? <p className="text-sm text-muted">Loading clients…</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState title="No clients yet" body={manage ? "Use Add client to save a company before you prepare a PI." : "No clients are available."} />
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-table">
              <tr>
                <th className={thClass} scope="col">Company</th>
                <th className={thClass} scope="col">Country</th>
                <th className={thClass} scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((client) => (
                <tr
                  key={client.id}
                  className="cursor-pointer border-t border-line hover:bg-canvas"
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest("a, button")) return;
                    navigate(`/clients/${client.id}`);
                  }}
                >
                  <td className={tdClass}><Link className="font-medium text-navy-900 underline" to={`/clients/${client.id}`}>{client.company_name}</Link></td>
                  <td className={tdClass}>{client.country || "—"}</td>
                  <td className={tdClass}>{client.archived_at ? "Archived" : "Active"}</td>
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
