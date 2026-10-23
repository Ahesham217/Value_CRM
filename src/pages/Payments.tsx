import { useEffect, useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PaymentTable, PaymentTotals, PaymentViewChoices, ReportCopy, emptyPaymentsCopy, paymentsCopy } from "../components/ReportingViews";
import { Button, EmptyState, FilterChip, PageHeader, Pagination, Select, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { displayStatusLabel } from "../lib/format";
import { collectionLabel } from "../lib/payment-tracking";
import { presetFilterOptions } from "../lib/presets";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import {
  customRangeMessage,
  leadLabel,
  parsePaymentLocation,
  paymentSearchParams,
  paymentTrackingPath,
  readPaymentRegister,
  withListChange,
  type PaymentRegister,
} from "../lib/reporting";
import { supabase } from "../lib/supabase";

export function PaymentsPage() {
  const navigate = useNavigate();
  const filtersId = useId();
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const location = parsePaymentLocation(params);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presetOptions, setPresetOptions] = useState<{ code: string; label: string }[]>([]);
  const [register, setRegister] = useState<PaymentRegister | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dueMessage = location.dueFrom && location.dueTo ? customRangeMessage(location.dueFrom, location.dueTo) : null;

  useEffect(() => {
    supabase.from("company_presets").select("code, display_name, archived_at").then(({ data, error: presetError }) => {
      if (presetError) return;
      setPresetOptions(presetFilterOptions((data ?? []) as { code: string; display_name: string; archived_at: string | null }[]));
    });
  }, []);

  useEffect(() => {
    if (dueMessage) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    supabase.rpc("payment_register", {
      p_view: location.view,
      p_search: sanitizeSearch(location.search) || null,
      p_currency: location.currency || null,
      p_preset: location.preset || null,
      p_lead: location.lead || null,
      p_collection_status: location.collectionStatus || null,
      p_due_from: location.dueFrom || null,
      p_due_to: location.dueTo || null,
      p_parent_status: location.parentStatus || null,
      p_balance: location.balance || null,
      p_limit: PAGE_SIZE,
      p_offset: (location.page - 1) * PAGE_SIZE,
    }).then(({ data, error: queryError }) => {
      if (!active) return;
      if (queryError) {
        setError(errorText(queryError));
        setLoading(false);
        return;
      }
      try {
        const next = readPaymentRegister(data);
        setRegister(next);
        setError(null);
        const pageCount = Math.max(1, Math.ceil(next.count / PAGE_SIZE));
        if (location.page > pageCount) setParams(paymentSearchParams({ ...location, page: pageCount }), { replace: true });
      } catch (caught) {
        setError(errorText(caught));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [dueMessage, query, setParams]);

  function update(patch: Partial<typeof location>) {
    setParams(paymentSearchParams(withListChange(location, patch)));
  }

  const leadName = register?.leads.find((lead) => lead.id === location.lead);
  const chips = [
    location.currency ? { id: "currency", label: `Currency: ${location.currency}` } : null,
    location.preset ? { id: "preset", label: `Office: ${presetOptions.find((preset) => preset.code === location.preset)?.label ?? "Selected office"}` } : null,
    location.lead ? { id: "lead", label: `Lead salesperson: ${leadName ? leadLabel(leadName.name, leadName.active) : "Selected lead"}` } : null,
    location.collectionStatus ? { id: "collection", label: `Collection status: ${collectionLabel(location.collectionStatus)}` } : null,
    location.parentStatus ? { id: "pi_status", label: `PI status: ${displayStatusLabel(location.parentStatus)}` } : null,
    location.dueFrom || location.dueTo ? { id: "due", label: `Due: ${location.dueFrom || "Any start"} – ${location.dueTo || "Any end"}` } : null,
    location.balance === "outstanding" ? { id: "balance", label: "Outstanding only" } : null,
  ].filter((chip): chip is { id: string; label: string } => chip !== null);
  const pageCount = Math.max(1, Math.ceil((register?.count ?? 0) / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Payments" subtitle="What is due, when, and what remains unpaid." />
      <ReportCopy>{paymentsCopy()}</ReportCopy>
      <div className="mb-3">
        <PaymentViewChoices location={location} />
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">
          <span className="mb-1 block font-medium text-slate-700">Search</span>
          <input className={controlClass} placeholder="PI number or client" value={location.search} onChange={(event) => update({ search: event.target.value })} />
        </label>
        <Button type="button" variant="secondary" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen((current) => !current)}>
          {chips.length > 0 ? `Filters (${chips.length})` : "Filters"}
        </Button>
      </div>
      {filtersOpen ? (
        <div id={filtersId} className="mb-3 grid gap-3 rounded-[10px] border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Currency</span>
            <Select value={location.currency} onChange={(event) => update({ currency: event.target.value })}>
              <option value="">All</option>
              <option>EGP</option>
              <option>USD</option>
              <option>EUR</option>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Office</span>
            <Select value={location.preset} onChange={(event) => update({ preset: event.target.value })}>
              <option value="">All</option>
              {presetOptions.map((preset) => <option key={preset.code} value={preset.code}>{preset.label}</option>)}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Lead salesperson</span>
            <Select value={location.lead} onChange={(event) => update({ lead: event.target.value })}>
              <option value="">All</option>
              {(register?.leads ?? []).map((lead) => <option key={lead.id} value={lead.id}>{leadLabel(lead.name, lead.active)}</option>)}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Collection status</span>
            <Select value={location.collectionStatus} onChange={(event) => update({ collectionStatus: event.target.value })}>
              <option value="">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Paid</option>
              <option value="no_charge">No charge</option>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">PI status</span>
            <Select value={location.parentStatus} onChange={(event) => update({ parentStatus: event.target.value })}>
              <option value="">All, including cancelled</option>
              <option value="issued">Issued</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </label>
          {location.view !== "awaiting" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700">Due from</span>
                <input className={controlClass} type="date" value={location.dueFrom} onChange={(event) => update({ dueFrom: event.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700">Due to</span>
                <input className={controlClass} type="date" value={location.dueTo} onChange={(event) => update({ dueTo: event.target.value })} />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      {dueMessage ? <p className="mb-3 text-sm text-red-800" role="alert">{dueMessage}</p> : null}
      {chips.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <FilterChip
              key={chip.id}
              label={chip.label}
              onRemove={() => update(
                chip.id === "currency" ? { currency: "" }
                  : chip.id === "preset" ? { preset: "" }
                    : chip.id === "lead" ? { lead: "" }
                      : chip.id === "collection" ? { collectionStatus: "" }
                        : chip.id === "pi_status" ? { parentStatus: "" }
                          : chip.id === "due" ? { dueFrom: "", dueTo: "" }
                            : { balance: "" },
              )}
            />
          ))}
          <button
            type="button"
            className="text-sm text-navy-800 underline"
            onClick={() => update({ currency: "", preset: "", lead: "", collectionStatus: "", parentStatus: "", dueFrom: "", dueTo: "", balance: "", search: "" })}
          >
            Clear filters
          </button>
        </div>
      ) : null}
      <p className="mb-3 text-sm text-slate-600">Open a PI to record a payment. This list does not change receipts.</p>
      {error ? <p className="mb-3 text-sm text-red-800" role="alert">{register ? `The payment figures could not be refreshed. ${error}` : error}</p> : null}
      {loading ? <p className="mb-2 text-sm text-slate-600" aria-live="polite">Loading payments…</p> : null}
      {register ? (
        <p className="mb-2 text-sm text-slate-700">{register.count} matching {register.count === 1 ? "obligation" : "obligations"}.</p>
      ) : null}
      {register && register.totals.length > 0 ? <PaymentTotals register={register} /> : null}
      {!loading && !register && !error ? <EmptyState title="No tracked payments" body={emptyPaymentsCopy()} /> : null}
      {register && register.rows.length === 0 ? <EmptyState title="No matching payments" body={emptyPaymentsCopy()} /> : null}
      {register && register.rows.length > 0 ? <PaymentTable rows={register.rows} onOpen={(piId) => navigate(paymentTrackingPath(piId))} /> : null}
      {register ? <Pagination page={location.page} pageCount={pageCount} onPage={(page) => update({ page })} /> : null}
    </div>
  );
}
