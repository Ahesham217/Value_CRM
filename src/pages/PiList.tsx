import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, EmptyState, PageHeader, Pagination, Select, StatusBadge, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { displayNumber, formatDate, formatMoney, officeLabel } from "../lib/format";
import { can } from "../lib/permissions";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { PiListRow, Profile } from "../lib/types";

export function PiListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canEdit = can(profile, "can_edit_drafts");
  const [query, setQuery] = useState("");
  const [office, setOffice] = useState("");
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PiListRow[]>([]);
  const [count, setCount] = useState(0);
  const [people, setPeople] = useState<Pick<Profile, "id" | "full_name">[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from("profiles").select("id, full_name").eq("is_salesperson", true).order("full_name").then(({ data }) => {
      setPeople((data ?? []) as Pick<Profile, "id" | "full_name">[]);
    });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    let request = supabase.from("pi_list").select("*", { count: "exact" }).order("created_at", { ascending: false });
    const term = sanitizeSearch(query);
    if (term) request = request.or(`pi_number.ilike.%${term}%,client_name.ilike.%${term}%`);
    if (office) request = request.eq("office", office);
    if (currency) request = request.eq("currency", currency);
    if (status) request = request.eq("display_status", status);
    if (salesperson) request = request.contains("salesperson_ids", [salesperson]);
    if (fromDate) request = request.gte("pi_date", fromDate);
    if (toDate) request = request.lte("pi_date", toDate);
    request.range(from, from + PAGE_SIZE - 1).then(({ data, error: queryError, count: total }) => {
      if (!active) return;
      if (queryError) setError(errorText(queryError));
      else {
        setRows((data ?? []) as PiListRow[]);
        setCount(total ?? 0);
        setError(null);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [currency, fromDate, office, page, query, salesperson, status, toDate]);

  async function createDraft() {
    setCreating(true);
    setError(null);
    const { data, error: createError } = await supabase.rpc("create_pi_draft");
    setCreating(false);
    if (createError) {
      setError(errorText(createError));
      return;
    }
    navigate(`/pis/${data as string}/edit`);
  }

  return (
    <div>
      <PageHeader
        title="Proforma invoices"
        subtitle="Drafts, issued versions, and revisions. Totals are never added across currencies."
        actions={canEdit ? <Button variant="primary" type="button" onClick={() => void createDraft()} disabled={creating}>{creating ? "Creating…" : "New PI"}</Button> : null}
      />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <label className="text-sm md:col-span-2"><span className="mb-1 block font-medium">Search</span>
          <input className={controlClass} placeholder="PI number or client" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <label className="text-sm"><span className="mb-1 block font-medium">Office</span>
          <Select value={office} onChange={(event) => { setOffice(event.target.value); setPage(1); }}><option value="">All</option><option value="EG">Egypt</option><option value="AE">UAE</option></Select>
        </label>
        <label className="text-sm"><span className="mb-1 block font-medium">Currency</span>
          <Select value={currency} onChange={(event) => { setCurrency(event.target.value); setPage(1); }}><option value="">All</option><option>EGP</option><option>USD</option><option>EUR</option></Select>
        </label>
        <label className="text-sm"><span className="mb-1 block font-medium">Status</span>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </label>
        <label className="text-sm"><span className="mb-1 block font-medium">Salesperson</span>
          <Select value={salesperson} onChange={(event) => { setSalesperson(event.target.value); setPage(1); }}>
            <option value="">All</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
          </Select>
        </label>
        <label className="text-sm"><span className="mb-1 block font-medium">From</span><input className={controlClass} type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">To</span><input className={controlClass} type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></label>
      </div>
      {error ? <p className="mb-3 text-sm text-red-800">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-600">Loading PIs…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No proforma invoices" body="Create a draft, or adjust the filters." action={canEdit ? <Button variant="primary" type="button" onClick={() => void createDraft()}>New PI</Button> : null} /> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {["PI", "Revision", "Client", "Date", "Office", "Currency", "Total", "Lead", "Prepared by", "Status"].map((heading) => (
                  <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><Link className="font-medium text-navy-800 underline" to={`/pis/${row.id}`}>{row.pi_number ?? "Draft"}</Link></td>
                  <td className="px-3 py-2">
                    {row.latest_revision === null ? "—" : displayNumber(row.pi_number, row.latest_revision)}
                    {row.has_open_revision ? <span className="ml-1 text-xs text-slate-500">Open draft</span> : null}
                  </td>
                  <td className="px-3 py-2">{row.client_name || "—"}</td>
                  <td className="px-3 py-2">{formatDate(row.pi_date)}</td>
                  <td className="px-3 py-2">{officeLabel(row.office)}</td>
                  <td className="px-3 py-2">{row.currency || "—"}</td>
                  <td className="px-3 py-2">{formatMoney(row.display_total, row.currency)}</td>
                  <td className="px-3 py-2">{row.lead_name || "—"}</td>
                  <td className="px-3 py-2">{row.prepared_by_name || "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={row.display_status} /></td>
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
