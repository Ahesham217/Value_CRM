import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, EmptyState, FilterChip, Menu, PageHeader, Pagination, Select, StatusBadge, controlClass, tdClass, thClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { displayNumber, formatDate, formatMoney } from "../lib/format";
import { can } from "../lib/permissions";
import { presetFilterOptions } from "../lib/presets";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { PiListRow, Profile } from "../lib/types";
import { piListFilterChips } from "../lib/workspace-view";

export function PiListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canEdit = can(profile, "can_edit_drafts");
  const filtersId = useId();
  const [query, setQuery] = useState("");
  const [office, setOffice] = useState("");
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PiListRow[]>([]);
  const [count, setCount] = useState(0);
  const [people, setPeople] = useState<Pick<Profile, "id" | "full_name">[]>([]);
  const [presetOptions, setPresetOptions] = useState<{ code: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from("profiles").select("id, full_name").eq("is_salesperson", true).order("full_name").then(({ data }) => {
      setPeople((data ?? []) as Pick<Profile, "id" | "full_name">[]);
    });
    supabase.from("company_presets").select("code, display_name, archived_at").order("display_name").then(({ data, error: presetError }) => {
      if (presetError) {
        setPresetOptions([]);
        setError(errorText(presetError));
        return;
      }
      setPresetOptions(presetFilterOptions((data ?? []) as { code: string; display_name: string; archived_at: string | null }[]));
    });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    let request = supabase.from("pi_list").select("*", { count: "exact" }).order("created_at", { ascending: false });
    const term = sanitizeSearch(query);
    if (term) request = request.or(`pi_number.ilike.%${term}%,client_name.ilike.%${term}%`);
    if (office) request = request.eq("preset_code", office);
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

  const salespersonName = people.find((person) => person.id === salesperson)?.full_name ?? (salesperson ? "Selected salesperson" : "");
  const chips = piListFilterChips({
    office,
    officeName: presetOptions.find((preset) => preset.code === office)?.label ?? "",
    currency,
    status,
    salespersonName,
    fromDate,
    toDate,
  });
  const hiddenFilterCount = chips.filter((chip) => chip.id !== "status").length;

  function removeChip(id: string) {
    if (id === "status") setStatus("");
    if (id === "office") setOffice("");
    if (id === "currency") setCurrency("");
    if (id === "salesperson") setSalesperson("");
    if (id === "dates") {
      setFromDate("");
      setToDate("");
    }
    setPage(1);
  }

  function clearFilters() {
    setOffice("");
    setCurrency("");
    setStatus("");
    setSalesperson("");
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Proforma invoices"
        actions={canEdit ? <Button variant="primary" type="button" onClick={() => void createDraft()} disabled={creating}>{creating ? "Creating…" : "New PI"}</Button> : null}
      />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">
          <span className="mb-1 block font-medium text-slate-700">Search</span>
          <input className={controlClass} placeholder="PI number or client" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <label className="w-36 text-sm">
          <span className="mb-1 block font-medium text-slate-700">Status</span>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </label>
        <Button type="button" variant="secondary" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen((current) => !current)}>
          {hiddenFilterCount > 0 ? `Filters (${hiddenFilterCount})` : "Filters"}
        </Button>
      </div>
      {filtersOpen ? (
        <div id={filtersId} className="mb-3 grid gap-3 rounded-[10px] border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Office</span>
            <Select value={office} onChange={(event) => { setOffice(event.target.value); setPage(1); }}>
              <option value="">All</option>
              {presetOptions.map((preset) => <option key={preset.code} value={preset.code}>{preset.label}</option>)}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Currency</span>
            <Select value={currency} onChange={(event) => { setCurrency(event.target.value); setPage(1); }}>
              <option value="">All</option>
              <option>EGP</option>
              <option>USD</option>
              <option>EUR</option>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Salesperson</span>
            <Select value={salesperson} onChange={(event) => { setSalesperson(event.target.value); setPage(1); }}>
              <option value="">All</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">From</span>
              <input className={controlClass} type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">To</span>
              <input className={controlClass} type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} />
            </label>
          </div>
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => <FilterChip key={chip.id} label={chip.label} onRemove={() => removeChip(chip.id)} />)}
          <button type="button" className="text-sm text-navy-800 underline" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : null}
      {error ? <p className="mb-3 text-sm text-red-800" role="alert">{error}</p> : null}
      {loading ? <p className="mb-2 text-sm text-slate-600" aria-live="polite">Loading PIs…</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState title="No proforma invoices" body={canEdit ? "Use New PI to start a draft, or change the filters." : "No proforma invoices match."} />
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={thClass} scope="col">PI number</th>
                <th className={thClass} scope="col">Client</th>
                <th className={thClass} scope="col">Date</th>
                <th className={`${thClass} text-right`} scope="col">Total</th>
                <th className={thClass} scope="col">Lead salesperson</th>
                <th className={thClass} scope="col">Status</th>
                <th className={thClass} scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-canvas"
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest("a, button")) return;
                    navigate(`/pis/${row.id}`);
                  }}
                >
                  <td className={tdClass}>
                    <Link className="font-medium text-navy-900 underline" to={`/pis/${row.id}`}>{displayNumber(row.pi_number, row.latest_revision)}</Link>
                    {row.has_open_revision ? <span className="mt-0.5 block text-xs text-slate-500">Revision draft open</span> : null}
                  </td>
                  <td className={tdClass}>{row.client_name || "—"}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{formatDate(row.pi_date)}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{formatMoney(row.display_total, row.currency)}</td>
                  <td className={tdClass}>{row.lead_name || "—"}</td>
                  <td className={tdClass}><StatusBadge status={row.display_status} /></td>
                  <td className={tdClass} onClick={(event) => event.stopPropagation()}>
                    {canEdit && row.draft_open ? (
                      <Menu label="Actions" items={[{ label: "Edit draft", onSelect: () => navigate(`/pis/${row.id}/edit`) }]} />
                    ) : null}
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
