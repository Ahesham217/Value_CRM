/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE } from "../lib/records";
import { SEARCH_DEBOUNCE_MS } from "../lib/useDebouncedValue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RpcArgs = Record<string, unknown>;

const state = vi.hoisted(() => ({
  piCalls: 0,
  collectionCalls: 0,
  currencies: ["USD"] as string[],
  planCounts: { EGP: 0, USD: 0, EUR: 0 } as Record<string, number>,
  failPi: false,
  failCollectionOn: 0,
  settled: false,
  received: "30.00",
  count: 25,
  issued: "1000.00",
  draft: "200.00",
}));

function money(currency: string) {
  const planCount = state.planCounts[currency] ?? 0;
  const active = currency === "USD" && planCount > 0 && !state.settled;
  return {
    currency,
    outstanding: active ? "40.00" : "0.00",
    overdue: active ? "10.00" : "0.00",
    due_today: "0.00",
    next_7: active ? "5.00" : "0.00",
    next_30: active ? "20.00" : "0.00",
    unresolved: active ? "3.00" : "0.00",
    due_1_7: active ? "5.00" : "0.00",
    due_8_30: active ? "15.00" : "0.00",
    due_after_30: active ? "7.00" : "0.00",
    plan_count: planCount,
    received: currency === "USD" ? state.received : "0.00",
  };
}

function report(args: RpcArgs) {
  const currency = typeof args.p_currency === "string" ? args.p_currency : "";
  return {
    count: state.count,
    set: "active",
    period: {
      preset: args.p_period,
      unbounded: args.p_period === "all",
      start: args.p_period === "all" ? null : "2026-10-19",
      end: args.p_period === "all" ? null : "2026-10-25",
      today: "2026-10-25",
    },
    totals: currency
      ? [{ currency, issued: currency === "USD" ? state.issued : "10.00", draft: currency === "USD" ? state.draft : "0.00" }, { currency: "EGP", issued: "9999.00", draft: "1.00" }]
      : [{ currency: "EGP", issued: "10.00", draft: "0.00" }],
    status_counts: { draft: 4, issued: 21, sent: 0, accepted: 0 },
    currencies: currency ? [currency, ...state.currencies.filter((item) => item !== currency)] : state.currencies,
    rows: [{
      id: args.p_offset ? "page-row" : "issued-1",
      pi_number: "AE-2026-00002",
      display_number: "AE-2026-00002",
      client_name: "Visible Client",
      pi_date: "2026-10-24",
      preset_code: "AE-USD",
      preset_display_name: "UAE — USD",
      preset_archived: false,
      currency: currency || "USD",
      total: "1000.00",
      amount_kind: "issued",
      lead_salesperson_id: null,
      lead_name: "Ada",
      lead_active: true,
      display_status: "issued",
      revision_draft_open: true,
      latest_revision: 1,
    }],
    leads: [],
  };
}

const dashboard = vi.hoisted(() => ({
  rpc: vi.fn((name: string, args: RpcArgs): Promise<{ data: unknown; error: { message: string } | null }> => {
    if (name === "collection_summary") {
      state.collectionCalls += 1;
      if (state.failCollectionOn > 0 && state.collectionCalls >= state.failCollectionOn) {
        return Promise.resolve({ data: null, error: { message: "Collections failed." } });
      }
      return Promise.resolve({
        data: {
          today: "2026-10-25",
          parent_status: args.p_parent_status,
          receipt_period: { preset: args.p_receipt_period, start: "2026-10-19", end: "2026-10-25" },
          untracked_count: 9,
          currencies: [money("EGP"), money("USD"), money("EUR")],
        },
        error: null,
      });
    }
    state.piCalls += 1;
    if (state.failPi) return Promise.resolve({ data: null, error: { message: "The PI report failed." } });
    return Promise.resolve({ data: report(args), error: null });
  }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: dashboard.rpc,
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  },
}));

import { DashboardPage } from "./Dashboard";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</p>;
}

function renderDashboard(entry = "/dashboard?currency=USD") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <DashboardPage />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  return container;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle() {
  await flush();
  await flush();
  await flush();
}

function text(container: ParentNode): string {
  return container.textContent ?? "";
}

function locationText(container: ParentNode): string {
  return container.querySelector("[data-testid=location]")?.textContent ?? "";
}

function buttons(container: ParentNode, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")].filter((node): node is HTMLButtonElement => node.textContent?.trim() === label);
}

function clickButton(container: ParentNode, label: string, index = 0) {
  const found = buttons(container, label)[index];
  if (!found) throw new Error(`Missing ${label} ${index}`);
  act(() => {
    found.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function rpcCalls(name: string): RpcArgs[] {
  return dashboard.rpc.mock.calls.filter((call) => call[0] === name).map((call) => call[1] as RpcArgs);
}

describe("dashboard currency, filters, and figures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.piCalls = 0;
    state.collectionCalls = 0;
    state.currencies = ["USD"];
    state.planCounts = { EGP: 0, USD: 2, EUR: 0 };
    state.failPi = false;
    state.failCollectionOn = 0;
    state.settled = false;
    state.received = "30.00";
    state.count = 25;
    state.issued = "1000.00";
    state.draft = "200.00";
    dashboard.rpc.mockClear();
  });

  afterEach(() => {
    while (mounted.length > 0) {
      const current = mounted.pop();
      act(() => current?.root.unmount());
      current?.container.remove();
    }
    vi.useRealTimers();
  });

  it("keeps the currency in the address and does not switch it when later data includes another currency", async () => {
    const container = renderDashboard("/dashboard?currency=EGP");
    await settle();
    expect(locationText(container)).toContain("currency=EGP");
    expect(rpcCalls("active_pi_report").at(-1)?.p_currency).toBe("EGP");
    expect(text(container)).toContain("EGP 10.00");
    expect(text(container)).not.toContain("USD 1,000.00");
    state.currencies = ["USD", "EGP", "EUR"];
    clickButton(container, "USD");
    await settle();
    expect(locationText(container)).toContain("currency=USD");
    expect(rpcCalls("active_pi_report").at(-1)?.p_currency).toBe("USD");
    expect(text(container)).toContain("USD 1,000.00");
    await settle();
    expect(locationText(container)).toContain("currency=USD");
    expect(locationText(container)).not.toContain("currency=EUR");
  });

  it("chooses a currency with visible activity once, then leaves that choice in the address", async () => {
    state.currencies = ["EGP"];
    state.planCounts = { EGP: 0, USD: 3, EUR: 0 };
    const container = renderDashboard("/dashboard");
    await settle();
    expect(locationText(container)).toContain("currency=EGP");
    expect(rpcCalls("active_pi_report")[0]?.p_currency).toBeNull();
    expect(rpcCalls("active_pi_report")[0]?.p_limit).toBe(1);
    expect(rpcCalls("active_pi_report").at(-1)?.p_currency).toBe("EGP");
    state.currencies = ["USD"];
    clickButton(container, "This month");
    await settle();
    expect(locationText(container)).toContain("currency=EGP");
    expect(locationText(container)).toContain("period=this_month");
  });

  it("falls back to a payment plan, then to USD, without treating that as a later change", async () => {
    state.currencies = [];
    state.planCounts = { EGP: 0, USD: 0, EUR: 2 };
    const plans = renderDashboard("/dashboard");
    await settle();
    expect(locationText(plans)).toContain("currency=EUR");

    state.currencies = [];
    state.planCounts = { EGP: 0, USD: 0, EUR: 0 };
    const empty = renderDashboard("/dashboard");
    await settle();
    expect(locationText(empty)).toContain("currency=USD");
    state.planCounts = { EGP: 4, USD: 0, EUR: 0 };
    clickButton(empty, "Last 30 days");
    await settle();
    expect(locationText(empty)).toContain("currency=USD");
  });

  it("shows full-population totals and status counts rather than the current page", async () => {
    const container = renderDashboard("/dashboard?currency=USD");
    await settle();
    expect(text(container)).toContain("25");
    expect(text(container)).toContain("21");
    expect(text(container)).toContain("USD 1,000.00");
    expect(text(container)).toContain("Draft quoted value USD 200.00");
    expect(text(container)).not.toContain("USD 1,200.00");
    expect(text(container)).not.toContain("9,999.00");
    expect(text(container)).toContain("Revision draft open");
    expect(container.querySelector('a[href="/dashboard?currency=USD&status=issued#active-proforma-invoices"]')).not.toBeNull();
    clickButton(container, "2");
    await settle();
    expect(rpcCalls("active_pi_report").at(-1)?.p_offset).toBe(PAGE_SIZE);
    expect(rpcCalls("active_pi_report").at(-1)?.p_currency).toBe("USD");
    expect(text(container)).toContain("21");
    expect(text(container)).toContain("USD 1,000.00");
    expect(locationText(container)).toContain("page=2");
  });

  it("does not let the PI period change collection balances, and lets the received period change receipts only", async () => {
    const container = renderDashboard("/dashboard?currency=USD");
    await settle();
    const collectionsBefore = state.collectionCalls;
    clickButton(container, "This month");
    await settle();
    expect(state.collectionCalls).toBe(collectionsBefore);
    expect(rpcCalls("active_pi_report").at(-1)?.p_period).toBe("this_month");
    expect(rpcCalls("collection_summary").every((args) => args.p_receipt_period === "last_7")).toBe(true);
    state.received = "4.00";
    clickButton(container, "Last 30 days", 1);
    await settle();
    expect(rpcCalls("collection_summary").at(-1)?.p_receipt_period).toBe("last_30");
    expect(rpcCalls("active_pi_report").at(-1)?.p_period).toBe("this_month");
    expect(text(container)).toContain("USD 4.00");
    expect(container.querySelector('a[href*="view=received"]')).toBeNull();
  });

  it("distinguishes no plans from settled plans and does not warn about untracked offers", async () => {
    state.planCounts = { EGP: 0, USD: 0, EUR: 0 };
    const none = renderDashboard("/dashboard?currency=USD&coverage=untracked");
    await settle();
    expect(text(none)).toContain("No active collections");
    expect(text(none)).toContain("No payment plan in this currency");
    expect(text(none)).not.toContain("awaiting payment tracking");
    expect(text(none)).not.toContain("Review PIs");
    expect(text(none)).not.toContain("Start payment tracking");
    expect(text(none)).not.toContain("Issued PIs with no payment plan");
    expect(rpcCalls("active_pi_report").every((args) => args.p_set === "active")).toBe(true);
    const overdue = [...none.querySelectorAll("a, article")].find((node) => node.textContent?.includes("Overdue") && node.textContent?.includes("No payment plan"));
    expect(overdue?.innerHTML ?? "").not.toContain("text-danger");

    state.planCounts = { EGP: 0, USD: 1, EUR: 0 };
    state.settled = true;
    state.received = "12.00";
    const settled = renderDashboard("/dashboard?currency=USD");
    await settle();
    expect(text(settled)).toContain("Nothing outstanding");
    expect(text(settled)).toContain("USD 12.00");
    expect(text(settled)).not.toContain("No active collections");
    const settledOverdue = [...settled.querySelectorAll("a")].find((node) => node.textContent?.includes("Overdue") && node.textContent?.includes("USD 0.00"));
    expect(settledOverdue?.innerHTML ?? "").not.toContain("text-danger");
  });

  it("links outstanding buckets without using the overlapping 30-day view for the 8–30 day bar", async () => {
    const container = renderDashboard("/dashboard?currency=USD");
    await settle();
    const due = container.querySelector('a[href*="due_from=2026-11-02"]');
    expect(due?.getAttribute("href")).toContain("due_to=2026-11-24");
    expect(due?.getAttribute("href")).toContain("view=outstanding");
    expect(due?.getAttribute("href")).not.toContain("view=next_30");
    expect(container.querySelector('a[href*="view=awaiting"]')?.getAttribute("href")).toContain("balance=outstanding");
    expect(container.querySelector('a[href="/payments?view=overdue&currency=USD"]')).not.toBeNull();
    expect(container.querySelector('a[href*="view=next_30"]')).not.toBeNull();
  });

  it("waits to search, and a late report cannot replace the currency now on screen", async () => {
    const container = renderDashboard("/dashboard?currency=USD");
    await settle();
    const callsBefore = rpcCalls("active_pi_report").length;
    const input = container.querySelector('input[placeholder="Search PI or client"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Search input missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "Acme");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush(SEARCH_DEBOUNCE_MS - 1);
    expect(rpcCalls("active_pi_report")).toHaveLength(callsBefore);
    await flush(1);
    expect(rpcCalls("active_pi_report").at(-1)?.p_search).toBe("Acme");
    expect(locationText(container)).toContain("q=Acme");

    let resolveLate: (value: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    dashboard.rpc.mockImplementationOnce((name: string) => {
      if (name !== "active_pi_report") return Promise.resolve({ data: null, error: { message: "no" } });
      return new Promise<{ data: unknown; error: { message: string } | null }>((resolve) => {
        resolveLate = resolve;
      });
    });
    clickButton(container, "EGP");
    const lateArgs = { ...rpcCalls("active_pi_report").at(-2) };
    clickButton(container, "USD");
    await settle();
    await act(async () => {
      resolveLate({
        data: report({ ...lateArgs, p_currency: "EGP", p_offset: 0 }),
        error: null,
      });
    });
    await flush();
    expect(locationText(container)).toContain("currency=USD");
    expect(text(container)).toContain("USD 1,000.00");
    expect(text(container)).not.toContain("EGP 10.00");
  });

  it("shows an error and retry instead of a zero when the first report fails, and keeps the last figures when the same figures fail to refresh", async () => {
    state.failPi = true;
    state.failCollectionOn = 1;
    const failed = renderDashboard("/dashboard?currency=USD");
    await settle();
    expect(text(failed)).toContain("The PI report failed.");
    expect(text(failed)).not.toContain("0.00");
    expect(text(failed)).not.toContain("USD 1,000.00");
    state.failPi = false;
    state.failCollectionOn = 0;
    clickButton(failed, "Retry");
    await settle();
    expect(text(failed)).toContain("USD 1,000.00");

    state.collectionCalls = 0;
    state.failCollectionOn = 2;
    const collections = renderDashboard("/dashboard?currency=USD");
    await settle();
    expect(text(collections)).toContain("USD 30.00");
    clickButton(collections, "This month", 1);
    await settle();
    expect(text(collections)).toContain("Collections failed.");
    expect(text(collections)).not.toContain("USD 30.00");
    clickButton(collections, "Last 7 days", 1);
    await settle();
    expect(text(collections)).toContain("could not be refreshed");
    expect(text(collections)).toContain("USD 30.00");
  });
});
