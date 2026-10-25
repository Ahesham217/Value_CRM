import { useEffect, useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ActivePiSummary,
  ActivePiTable,
  CollectionSummaryTable,
  CoverageNote,
  FiguresDisclosure,
  PeriodChoices,
  piPeriodChoices,
  receiptPeriodChoices,
} from "../components/ReportingViews";
import {
  EmptyState,
  Field,
  FilterChip,
  FilterPanel,
  FiltersButton,
  LoadingNote,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Toolbar,
  controlClass,
  quietActionClass,
} from "../components/ui";
import { errorText } from "../lib/errors";
import { displayStatusLabel } from "../lib/format";
import { presetFilterOptions } from "../lib/presets";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import {
  customRangeMessage,
  leadLabel,
  readActiveReport,
  readCollectionSummary,
  withListChange,
  type ActiveReport,
  type CollectionSummary,
  type PiPeriod,
  type ReceiptPeriod,
} from "../lib/reporting";
import { supabase } from "../lib/supabase";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "../lib/useDebouncedValue";

type ActiveFilters = {
  period: PiPeriod;
  from: string;
  to: string;
  status: string;
  preset: string;
  currency: string;
  lead: string;
  search: string;
  page: number;
};

const INITIAL_FILTERS: ActiveFilters = {
  period: "last_7",
  from: "",
  to: "",
  status: "",
  preset: "",
  currency: "",
  lead: "",
  search: "",
  page: 1,
};

export function DashboardPage() {
  const navigate = useNavigate();
  const filtersId = useId();
  const [params, setParams] = useSearchParams();
  const showUntracked = params.get("coverage") === "untracked";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ActiveFilters>(INITIAL_FILTERS);
  const [receiptPeriod, setReceiptPeriod] = useState<ReceiptPeriod>("last_7");
  const [receiptFrom, setReceiptFrom] = useState("");
  const [receiptTo, setReceiptTo] = useState("");
  const [parentStatus, setParentStatus] = useState("");
  const [presetOptions, setPresetOptions] = useState<{ code: string; label: string }[]>([]);
  const [report, setReport] = useState<ActiveReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [untracked, setUntracked] = useState<ActiveReport | null>(null);
  const [untrackedError, setUntrackedError] = useState<string | null>(null);
  const [untrackedLoading, setUntrackedLoading] = useState(false);
  const [untrackedPage, setUntrackedPage] = useState(1);

  const debouncedSearch = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const dateMessage = filters.period === "custom" ? customRangeMessage(filters.from, filters.to) : null;
  const receiptMessage = receiptPeriod === "custom" ? customRangeMessage(receiptFrom, receiptTo) : null;

  useEffect(() => {
    supabase.from("company_presets").select("code, display_name, archived_at").then(({ data, error }) => {
      if (error) {
        setReportError(errorText(error));
        return;
      }
      setPresetOptions(presetFilterOptions((data ?? []) as { code: string; display_name: string; archived_at: string | null }[]));
    });
  }, []);

  useEffect(() => {
    if (dateMessage) {
      setReportLoading(false);
      return;
    }
    let active = true;
    setReportLoading(true);
    supabase.rpc("active_pi_report", {
      p_period: filters.period,
      p_from: filters.period === "custom" ? filters.from : null,
      p_to: filters.period === "custom" ? filters.to : null,
      p_status: filters.status || null,
      p_preset: filters.preset || null,
      p_currency: filters.currency || null,
      p_lead: filters.lead || null,
      p_search: sanitizeSearch(debouncedSearch) || null,
      p_limit: PAGE_SIZE,
      p_offset: (filters.page - 1) * PAGE_SIZE,
      p_set: "active",
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setReportError(errorText(error));
        setReportLoading(false);
        return;
      }
      try {
        const next = readActiveReport(data);
        setReport(next);
        setReportError(null);
        const pageCount = Math.max(1, Math.ceil(next.count / PAGE_SIZE));
        if (filters.page > pageCount) setFilters((current) => ({ ...current, page: pageCount }));
      } catch (caught) {
        setReportError(errorText(caught));
      }
      setReportLoading(false);
    });
    return () => {
      active = false;
    };
  }, [dateMessage, debouncedSearch, filters.currency, filters.from, filters.lead, filters.page, filters.period, filters.preset, filters.status, filters.to]);

  useEffect(() => {
    if (receiptMessage) {
      setSummaryLoading(false);
      return;
    }
    let active = true;
    setSummaryLoading(true);
    supabase.rpc("collection_summary", {
      p_receipt_period: receiptPeriod,
      p_receipt_from: receiptPeriod === "custom" ? receiptFrom : null,
      p_receipt_to: receiptPeriod === "custom" ? receiptTo : null,
      p_parent_status: parentStatus || null,
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setSummaryError(errorText(error));
        setSummaryLoading(false);
        return;
      }
      try {
        setSummary(readCollectionSummary(data));
        setSummaryError(null);
      } catch (caught) {
        setSummaryError(errorText(caught));
      }
      setSummaryLoading(false);
    });
    return () => {
      active = false;
    };
  }, [parentStatus, receiptFrom, receiptMessage, receiptPeriod, receiptTo]);

  useEffect(() => {
    if (!showUntracked) return;
    let active = true;
    setUntrackedLoading(true);
    supabase.rpc("active_pi_report", {
      p_period: "all",
      p_from: null,
      p_to: null,
      p_status: null,
      p_preset: null,
      p_currency: null,
      p_lead: null,
      p_search: null,
      p_limit: PAGE_SIZE,
      p_offset: (untrackedPage - 1) * PAGE_SIZE,
      p_set: "untracked",
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setUntrackedError(errorText(error));
        setUntrackedLoading(false);
        return;
      }
      try {
        const next = readActiveReport(data);
        setUntracked(next);
        setUntrackedError(null);
        const pageCount = Math.max(1, Math.ceil(next.count / PAGE_SIZE));
        if (untrackedPage > pageCount) setUntrackedPage(pageCount);
      } catch (caught) {
        setUntrackedError(errorText(caught));
      }
      setUntrackedLoading(false);
    });
    return () => {
      active = false;
    };
  }, [showUntracked, untrackedPage]);

  function updateFilters(patch: Partial<ActiveFilters>) {
    setFilters((current) => withListChange(current, patch));
  }

  const leadName = report?.leads.find((lead) => lead.id === filters.lead);
  const chips = [
    filters.status ? { id: "status", label: `Status: ${displayStatusLabel(filters.status)}` } : null,
    filters.preset ? { id: "preset", label: `Office: ${presetOptions.find((preset) => preset.code === filters.preset)?.label ?? "Selected office"}` } : null,
    filters.currency ? { id: "currency", label: `Currency: ${filters.currency}` } : null,
    filters.lead ? { id: "lead", label: `Lead salesperson: ${leadName ? leadLabel(leadName.name, leadName.active) : "Selected lead"}` } : null,
  ].filter((chip): chip is { id: string; label: string } => chip !== null);
  const hiddenFilterCount = chips.filter((chip) => chip.id !== "status").length;
  const pageCount = Math.max(1, Math.ceil((report?.count ?? 0) / PAGE_SIZE));
  const untrackedPageCount = Math.max(1, Math.ceil((untracked?.count ?? 0) / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Active proforma invoices and collections" />
      <div className="mb-6">
        <PeriodChoices
          label="PI date"
          periods={piPeriodChoices()}
          value={filters.period}
          onChange={(value) => updateFilters({ period: value as PiPeriod })}
        />
      </div>
      {filters.period === "custom" ? (
        <div className="mb-4 grid max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="PI date from">
            <input className={controlClass} type="date" value={filters.from} onChange={(event) => updateFilters({ from: event.target.value })} />
          </Field>
          <Field label="PI date to">
            <input className={controlClass} type="date" value={filters.to} onChange={(event) => updateFilters({ to: event.target.value })} />
          </Field>
        </div>
      ) : null}
      {dateMessage ? <p className="mb-4 text-sm text-danger" role="alert">{dateMessage}</p> : null}

      <section className="mb-8" aria-labelledby="active-pis-heading">
        {report ? <ActivePiSummary report={report} /> : (
          <h2 id="active-pis-heading" className="mb-3 text-[18px] leading-6 font-semibold text-ink">Active PIs</h2>
        )}
        <div className="mb-3">
          <Toolbar>
            <SearchField label="Search PI or client" placeholder="Search PI or client" value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} />
            <label className="w-40 shrink-0">
              <span className="sr-only">Status</span>
              <Select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value })}>
                <option value="">All active</option>
                <option value="draft">Draft</option>
                <option value="issued">Issued</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
              </Select>
            </label>
            <FiltersButton count={hiddenFilterCount} expanded={filtersOpen} controls={filtersId} onClick={() => setFiltersOpen((current) => !current)} />
          </Toolbar>
        </div>
        {filtersOpen ? (
          <div className="mb-3">
            <FilterPanel id={filtersId}>
              <Field label="Office">
                <Select value={filters.preset} onChange={(event) => updateFilters({ preset: event.target.value })}>
                  <option value="">All</option>
                  {presetOptions.map((preset) => <option key={preset.code} value={preset.code}>{preset.label}</option>)}
                </Select>
              </Field>
              <Field label="Currency">
                <Select value={filters.currency} onChange={(event) => updateFilters({ currency: event.target.value })}>
                  <option value="">All</option>
                  <option>EGP</option>
                  <option>USD</option>
                  <option>EUR</option>
                </Select>
              </Field>
              <Field label="Lead salesperson">
                <Select value={filters.lead} onChange={(event) => updateFilters({ lead: event.target.value })}>
                  <option value="">All</option>
                  {(report?.leads ?? []).map((lead) => <option key={lead.id} value={lead.id}>{leadLabel(lead.name, lead.active)}</option>)}
                </Select>
              </Field>
            </FilterPanel>
          </div>
        ) : null}
        {chips.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <FilterChip
                key={chip.id}
                label={chip.label}
                onRemove={() => updateFilters(chip.id === "status" ? { status: "" } : chip.id === "preset" ? { preset: "" } : chip.id === "currency" ? { currency: "" } : { lead: "" })}
              />
            ))}
            <button type="button" className={quietActionClass} onClick={() => updateFilters({ status: "", preset: "", currency: "", lead: "", search: "" })}>Reset filters</button>
          </div>
        ) : null}
        {reportError ? <p className="mb-3 text-sm text-danger" role="alert">{report ? `The active PI figures could not be refreshed. ${reportError}` : reportError}</p> : null}
        {reportLoading ? <LoadingNote>Loading active PIs…</LoadingNote> : null}
        {!reportLoading && !report && !reportError ? <EmptyState title="No active proforma invoices" body="Active PIs will appear here. Cancelled PIs are not included." /> : null}
        {report && report.rows.length === 0 ? (
          <EmptyState title="No matching proforma invoices" body={filters.period === "all" ? "No active proforma invoices are visible." : "No active proforma invoices match this PI date and filters."} />
        ) : null}
        {report && report.rows.length > 0 ? <ActivePiTable rows={report.rows} onOpen={(id) => navigate(`/pis/${id}`)} /> : null}
        {report ? <Pagination page={filters.page} pageCount={pageCount} total={report.count} onPage={(page) => updateFilters({ page })} /> : null}
      </section>

      <section className="mb-8" aria-labelledby="collections-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="collections-heading" className="text-[18px] leading-6 font-semibold text-ink">Collections</h2>
            <p className="mt-1 text-sm text-secondary">All tracked balances · independent of PI date.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-secondary">Received</p>
              <PeriodChoices
                label="Received on"
                periods={receiptPeriodChoices()}
                value={receiptPeriod}
                onChange={(value) => setReceiptPeriod(value as ReceiptPeriod)}
              />
            </div>
            <label className="w-52">
              <span className="mb-1.5 block text-[13px] font-medium text-secondary">PI status</span>
              <Select value={parentStatus} onChange={(event) => setParentStatus(event.target.value)}>
                <option value="">All, including cancelled</option>
                <option value="issued">Issued</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </label>
          </div>
        </div>
        {receiptPeriod === "custom" ? (
          <div className="mb-4 grid max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Received from">
              <input className={controlClass} type="date" value={receiptFrom} onChange={(event) => setReceiptFrom(event.target.value)} />
            </Field>
            <Field label="Received to">
              <input className={controlClass} type="date" value={receiptTo} onChange={(event) => setReceiptTo(event.target.value)} />
            </Field>
          </div>
        ) : null}
        {receiptMessage ? <p className="mb-3 text-sm text-danger" role="alert">{receiptMessage}</p> : null}
        {summaryError ? <p className="mb-3 text-sm text-danger" role="alert">{summary ? `The collection figures could not be refreshed. ${summaryError}` : summaryError}</p> : null}
        {summaryLoading ? <LoadingNote>Loading collections…</LoadingNote> : null}
        {summary ? <CollectionSummaryTable summary={summary} /> : null}
        {!summaryLoading && !summary && !summaryError ? (
          <EmptyState title="No tracked collections" body="Tracked outstanding balances appear here after payment tracking is started. An empty result does not mean every invoice is paid." />
        ) : null}
        {summary ? (
          <div className="mt-4">
            <CoverageNote count={summary.untrackedCount} />
          </div>
        ) : null}
        {showUntracked ? (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[17px] font-semibold text-ink">Issued PIs with no payment plan</h3>
              <button type="button" className={quietActionClass} onClick={() => setParams({})}>Close</button>
            </div>
            <p className="mb-2 text-sm text-secondary">The amounts below are quoted totals. They are not outstanding balances, and they are not included in the tracked figures above.</p>
            {untrackedError ? <p className="mb-3 text-sm text-danger" role="alert">{untracked ? `This list could not be refreshed. ${untrackedError}` : untrackedError}</p> : null}
            {untrackedLoading ? <LoadingNote>Loading untracked PIs…</LoadingNote> : null}
            {untracked && untracked.rows.length === 0 ? <EmptyState title="No untracked issued PIs" body="Every visible issued PI that is not cancelled has a payment plan, or none are visible to you." /> : null}
            {untracked && untracked.rows.length > 0 ? <ActivePiTable rows={untracked.rows} amountCaption="Quoted total" onOpen={(id) => navigate(`/pis/${id}`)} /> : null}
            {untracked ? <Pagination page={untrackedPage} pageCount={untrackedPageCount} total={untracked.count} onPage={setUntrackedPage} /> : null}
          </div>
        ) : null}
      </section>
      <FiguresDisclosure />
    </div>
  );
}
