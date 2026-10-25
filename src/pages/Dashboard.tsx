import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CollectionsPanel, CurrencySelector, StatusChart, SummaryCards, dashboardRangeLabel } from "../components/DashboardOverview";
import {
  ActivePiTable,
  FiguresDisclosure,
  PeriodChoices,
  piPeriodChoices,
  receiptPeriodChoices,
} from "../components/ReportingViews";
import {
  Button,
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
  chooseDashboardCurrency,
  collectionForCurrency,
  customRangeMessage,
  dashboardPath,
  dashboardSearchParams,
  leadLabel,
  parseDashboardLocation,
  paymentsPath,
  readActiveReport,
  readCollectionSummary,
  type ActiveReport,
  type CollectionSummary,
  type CurrencyCode,
  type DashboardLocation,
  type PiPeriod,
  type PiStatus,
  type ReceiptPeriod,
} from "../lib/reporting";
import { supabase } from "../lib/supabase";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "../lib/useDebouncedValue";

function piKey(location: DashboardLocation): string {
  return [
    location.currency,
    location.period,
    location.period === "custom" ? location.from : "",
    location.period === "custom" ? location.to : "",
    location.status,
    location.preset,
    location.lead,
    sanitizeSearch(location.search),
    location.page,
  ].join("|");
}

function collectionKey(location: DashboardLocation): string {
  return [
    location.receiptPeriod,
    location.receiptPeriod === "custom" ? location.receiptFrom : "",
    location.receiptPeriod === "custom" ? location.receiptTo : "",
    location.parentStatus,
  ].join("|");
}

export function DashboardPage() {
  const navigate = useNavigate();
  const filtersId = useId();
  const [params, setParams] = useSearchParams();
  const location = parseDashboardLocation(params);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState(location.search);
  const debouncedSearch = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  const searchTyped = useRef(false);
  const publishedSearch = useRef<string | null>(null);
  const [presetOptions, setPresetOptions] = useState<{ code: string; label: string }[]>([]);
  const [report, setReport] = useState<ActiveReport | null>(null);
  const [reportKey, setReportKey] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [activity, setActivity] = useState<{ key: string; currencies: CurrencyCode[] } | null>(null);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [summaryKey, setSummaryKey] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const dateMessage = location.period === "custom" ? customRangeMessage(location.from, location.to) : null;
  const receiptMessage = location.receiptPeriod === "custom" ? customRangeMessage(location.receiptFrom, location.receiptTo) : null;
  const currentPiKey = location.currency ? piKey(location) : "";
  const currentCollectionKey = collectionKey(location);
  const visibleReport = report && reportKey === currentPiKey ? report : null;
  const visibleSummary = summary && summaryKey === currentCollectionKey ? summary : null;
  const activityKey = piKey({ ...location, currency: "", page: 1 });

  useEffect(() => {
    supabase.from("company_presets").select("code, display_name, archived_at").then(({ data, error }) => {
      if (error) return;
      setPresetOptions(presetFilterOptions((data ?? []) as { code: string; display_name: string; archived_at: string | null }[]));
    });
  }, []);

  useEffect(() => {
    if (publishedSearch.current !== null && publishedSearch.current === location.search) {
      publishedSearch.current = null;
      return;
    }
    publishedSearch.current = null;
    searchTyped.current = false;
    setSearchText(location.search);
  }, [location.search]);

  function update(patch: Partial<DashboardLocation>) {
    const filterKeys = ["currency", "period", "from", "to", "status", "preset", "lead", "search"] as const;
    const resetsPage = filterKeys.some((key) => patch[key] !== undefined && patch[key] !== location[key]);
    const next = { ...location, ...patch, page: patch.page ?? (resetsPage ? 1 : location.page) };
    setParams(dashboardSearchParams(next));
  }

  useEffect(() => {
    if (!searchTyped.current) return;
    if (debouncedSearch !== searchText) return;
    if (debouncedSearch === location.search) return;
    publishedSearch.current = debouncedSearch;
    searchTyped.current = false;
    update({ search: debouncedSearch });
    // `update` closes over the filters from this render. Only a search typed by the person is published.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, location.search, searchText]);

  useEffect(() => {
    if (dateMessage) {
      setReportLoading(false);
      return;
    }
    let active = true;
    const requestedKey = location.currency ? piKey(location) : activityKey;
    setReportError(null);
    setReportLoading(true);
    supabase.rpc("active_pi_report", {
      p_period: location.period,
      p_from: location.period === "custom" ? location.from : null,
      p_to: location.period === "custom" ? location.to : null,
      p_status: location.status || null,
      p_preset: location.preset || null,
      p_currency: location.currency || null,
      p_lead: location.lead || null,
      p_search: sanitizeSearch(location.search) || null,
      p_limit: location.currency ? PAGE_SIZE : 1,
      p_offset: location.currency ? (location.page - 1) * PAGE_SIZE : 0,
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
        if (location.currency) {
          setReport(next);
          setReportKey(requestedKey);
          setReportError(null);
          const pageCount = Math.max(1, Math.ceil(next.count / PAGE_SIZE));
          if (location.page > pageCount) update({ page: pageCount });
        } else {
          setActivity({ key: requestedKey, currencies: next.currencies });
          setReportError(null);
        }
      } catch (caught) {
        setReportError(errorText(caught));
      }
      setReportLoading(false);
    });
    return () => {
      active = false;
    };
    // Page correction calls update, which changes the URL and reruns this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityKey, currentPiKey, dateMessage, location.currency, reload]);

  useEffect(() => {
    if (receiptMessage) {
      setSummaryLoading(false);
      return;
    }
    let active = true;
    const requestedKey = currentCollectionKey;
    setSummaryError(null);
    setSummaryLoading(true);
    supabase.rpc("collection_summary", {
      p_receipt_period: location.receiptPeriod,
      p_receipt_from: location.receiptPeriod === "custom" ? location.receiptFrom : null,
      p_receipt_to: location.receiptPeriod === "custom" ? location.receiptTo : null,
      p_parent_status: location.parentStatus || null,
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setSummaryError(errorText(error));
        setSummaryLoading(false);
        return;
      }
      try {
        setSummary(readCollectionSummary(data));
        setSummaryKey(requestedKey);
        setSummaryError(null);
      } catch (caught) {
        setSummaryError(errorText(caught));
      }
      setSummaryLoading(false);
    });
    return () => {
      active = false;
    };
  }, [currentCollectionKey, location.parentStatus, location.receiptFrom, location.receiptPeriod, location.receiptTo, receiptMessage, reload]);

  useEffect(() => {
    if (location.currency || dateMessage || !activity || activity.key !== activityKey) return;
    if (summaryLoading && !visibleSummary) return;
    if (!visibleSummary && activity.currencies.length === 0) return;
    const planCounts = Object.fromEntries((visibleSummary?.currencies ?? []).map((item) => [item.currency, item.planCount])) as Partial<Record<CurrencyCode, number>>;
    const chosen = chooseDashboardCurrency({ explicit: null, piCurrencies: activity.currencies, planCounts });
    setParams(dashboardSearchParams({ ...location, currency: chosen }), { replace: true });
  }, [activity, activityKey, dateMessage, location, setParams, summaryLoading, visibleSummary]);

  const currency = location.currency;
  const collectionRow = currency && visibleSummary ? collectionForCurrency(visibleSummary, currency) : null;
  const leadName = visibleReport?.leads.find((lead) => lead.id === location.lead);
  const chips = [
    location.status ? { id: "status", label: `Status: ${displayStatusLabel(location.status)}` } : null,
    location.preset ? { id: "preset", label: `Office: ${presetOptions.find((preset) => preset.code === location.preset)?.label ?? "Selected office"}` } : null,
    location.lead ? { id: "lead", label: `Lead salesperson: ${leadName ? leadLabel(leadName.name, leadName.active) : "Selected lead"}` } : null,
  ].filter((chip): chip is { id: string; label: string } => chip !== null);
  const hiddenFilterCount = chips.filter((chip) => chip.id !== "status").length;
  const pageCount = Math.max(1, Math.ceil((visibleReport?.count ?? 0) / PAGE_SIZE));
  const range = visibleReport ? dashboardRangeLabel(visibleReport) : "";

  function retry() {
    setReload((current) => current + 1);
  }

  return (
    <div className="min-w-0 max-w-full">
      <PageHeader
        title="Dashboard"
        subtitle="Proforma invoices and collections"
        actions={<CurrencySelector value={currency} onChange={(next) => update({ currency: next })} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-secondary">PI period</p>
          <PeriodChoices
            label="PI period"
            periods={piPeriodChoices()}
            value={location.period}
            onChange={(value) => update({ period: value as PiPeriod })}
          />
        </div>
        {range ? <p className="text-sm text-secondary tabular-nums">{range}</p> : null}
      </div>
      {location.period === "custom" ? (
        <div className="mb-4 grid max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="PI date from">
            <input className={controlClass} type="date" value={location.from} onChange={(event) => update({ from: event.target.value })} />
          </Field>
          <Field label="PI date to">
            <input className={controlClass} type="date" value={location.to} onChange={(event) => update({ to: event.target.value })} />
          </Field>
        </div>
      ) : null}
      {dateMessage ? <p className="mb-4 text-sm text-danger" role="alert">{dateMessage}</p> : null}
      {!currency && summaryError ? (
        <div className="mb-4" role="alert">
          <p className="text-sm text-danger">{summaryError}</p>
          <Button className="mt-3" type="button" onClick={retry}>Retry</Button>
        </div>
      ) : null}

      {reportError ? (
        <div className="mb-4" role="alert">
          <p className="text-sm text-danger">{visibleReport ? `The active PI figures could not be refreshed. ${reportError}` : reportError}</p>
          {visibleReport ? null : <Button className="mt-3" type="button" onClick={retry}>Retry</Button>}
        </div>
      ) : null}
      {reportLoading && !visibleReport && !reportError ? <LoadingNote>Loading active PIs…</LoadingNote> : null}
      {currency && visibleReport ? (
        <div className="mb-4">
          <SummaryCards
            currency={currency}
            report={visibleReport}
            collection={collectionRow}
            collectionFailed={Boolean(summaryError && !collectionRow)}
            activeHref={dashboardPath(location, "#active-proforma-invoices")}
            outstandingHref={paymentsPath({ view: "outstanding", currency, parentStatus: location.parentStatus })}
            overdueHref={paymentsPath({ view: "overdue", currency, parentStatus: location.parentStatus })}
          />
        </div>
      ) : null}

      {currency ? (
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visibleReport ? (
            <StatusChart
              counts={visibleReport.statusCounts}
              current={location.status}
              hrefFor={(status: PiStatus) => dashboardPath({ ...location, status, page: 1 }, "#active-proforma-invoices")}
            />
          ) : null}
          <CollectionsPanel
            currency={currency}
            row={collectionRow}
            today={visibleSummary?.today ?? ""}
            parentStatus={location.parentStatus}
            loading={summaryLoading}
            error={summaryError}
            onRetry={retry}
            controls={(
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-secondary">Received period</p>
                <PeriodChoices
                  label="Received period"
                  periods={receiptPeriodChoices()}
                  value={location.receiptPeriod}
                  onChange={(value) => update({ receiptPeriod: value as ReceiptPeriod })}
                />
                {location.receiptPeriod === "custom" ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Received from">
                      <input className={controlClass} type="date" value={location.receiptFrom} onChange={(event) => update({ receiptFrom: event.target.value })} />
                    </Field>
                    <Field label="Received to">
                      <input className={controlClass} type="date" value={location.receiptTo} onChange={(event) => update({ receiptTo: event.target.value })} />
                    </Field>
                  </div>
                ) : null}
                {receiptMessage ? <p className="mt-2 text-sm text-danger" role="alert">{receiptMessage}</p> : null}
              </div>
            )}
            parentControl={(
              <Field label="PI status">
                <Select value={location.parentStatus} onChange={(event) => update({ parentStatus: event.target.value as DashboardLocation["parentStatus"] })}>
                  <option value="">All, including cancelled</option>
                  <option value="issued">Issued</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </Field>
            )}
          />
        </div>
      ) : null}
      <section id="active-proforma-invoices" className="mt-2 scroll-mt-20" aria-labelledby="active-pi-table-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="active-pi-table-heading" className="text-[18px] leading-6 font-semibold text-ink">Active proforma invoices</h2>
          {visibleReport ? <p className="text-sm text-secondary tabular-nums">{visibleReport.count} {visibleReport.count === 1 ? "PI" : "PIs"}</p> : null}
        </div>
        <div className="mb-3">
          <Toolbar>
            <SearchField
              label="Search PI or client"
              placeholder="Search PI or client"
              value={searchText}
              onChange={(event) => {
                searchTyped.current = true;
                setSearchText(event.target.value);
              }}
            />
            <label className="w-40 shrink-0">
              <span className="sr-only">Status</span>
              <Select value={location.status} onChange={(event) => update({ status: event.target.value as DashboardLocation["status"] })}>
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
                <Select value={location.preset} onChange={(event) => update({ preset: event.target.value })}>
                  <option value="">All</option>
                  {presetOptions.map((preset) => <option key={preset.code} value={preset.code}>{preset.label}</option>)}
                </Select>
              </Field>
              <Field label="Lead salesperson">
                <Select value={location.lead} onChange={(event) => update({ lead: event.target.value })}>
                  <option value="">All</option>
                  {(visibleReport?.leads ?? []).map((lead) => <option key={lead.id} value={lead.id}>{leadLabel(lead.name, lead.active)}</option>)}
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
                onRemove={() => update(chip.id === "status" ? { status: "" } : chip.id === "preset" ? { preset: "" } : { lead: "" })}
              />
            ))}
            <button
              type="button"
              className={quietActionClass}
              onClick={() => {
                searchTyped.current = false;
                publishedSearch.current = null;
                update({ status: "", preset: "", lead: "", search: "" });
              }}
            >
              Reset filters
            </button>
          </div>
        ) : null}
        {visibleReport && visibleReport.rows.length === 0 ? (
          <EmptyState title="No matching proforma invoices" body={location.period === "all" ? "No active proforma invoices are visible." : "No active proforma invoices match this PI period and filters."} />
        ) : null}
        {visibleReport && visibleReport.rows.length > 0 ? (
          <ActivePiTable rows={visibleReport.rows} amountCaption={`Amount (${currency})`} onOpen={(id) => navigate(`/pis/${id}`)} />
        ) : null}
        {visibleReport ? <Pagination page={location.page} pageCount={pageCount} total={visibleReport.count} onPage={(page) => update({ page })} /> : null}
      </section>
      <div className="mt-6">
        <FiguresDisclosure />
      </div>
    </div>
  );
}
