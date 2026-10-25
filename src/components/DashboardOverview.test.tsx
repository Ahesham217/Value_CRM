import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ActiveReport, CollectionCurrency } from "../lib/reporting";
import { CollectionsPanel, StatusChart, SummaryCards } from "./DashboardOverview";

const report: ActiveReport = {
  count: 25,
  set: "active",
  period: { unbounded: false, start: "2026-10-19", end: "2026-10-25", today: "2026-10-25" },
  totals: [
    { currency: "EGP", issued: "9999.00", draft: "50.00" },
    { currency: "USD", issued: "1000.00", draft: "200.00" },
  ],
  statusCounts: { draft: 4, issued: 21, sent: 0, accepted: 0 },
  currencies: ["EGP", "USD"],
  rows: [],
  leads: [],
};

function money(patch: Partial<CollectionCurrency> = {}): CollectionCurrency {
  return {
    currency: "USD",
    outstanding: "0.00",
    overdue: "0.00",
    dueToday: "0.00",
    next7: "0.00",
    next30: "0.00",
    unresolved: "0.00",
    due1To7: "0.00",
    due8To30: "0.00",
    dueAfter30: "0.00",
    planCount: 0,
    received: "0.00",
    ...patch,
  };
}

function html(node: ReactNode): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node));
}

describe("dashboard overview", () => {
  it("uses the selected currency and keeps draft value out of the issued total", () => {
    const markup = html(createElement(SummaryCards, {
      currency: "USD",
      report,
      collection: money({ planCount: 2, outstanding: "40.00", overdue: "0.00" }),
      collectionFailed: false,
      activeHref: "/dashboard?currency=USD#active-proforma-invoices",
      outstandingHref: "/payments?view=outstanding&currency=USD",
      overdueHref: "/payments?view=overdue&currency=USD",
    }));
    expect(markup).toContain("USD 1,000.00");
    expect(markup).toContain("Draft quoted value USD 200.00");
    expect(markup).toContain("not revenue");
    expect(markup).not.toContain("USD 1,200.00");
    expect(markup).not.toContain("9,999.00");
    expect(markup).toContain(">25<");
    expect(markup).toContain('href="/payments?view=outstanding&amp;currency=USD"');
    expect(markup).toContain('href="/payments?view=overdue&amp;currency=USD"');
    const overdueAt = markup.indexOf(">Overdue<");
    const overdueCard = markup.slice(Math.max(0, markup.lastIndexOf("<a", overdueAt)), markup.indexOf("</a>", overdueAt));
    expect(overdueCard).toContain("USD 0.00");
    expect(overdueCard).not.toContain("text-danger");
  });

  it("keeps a positive overdue amount in red and a missing plan off zero", () => {
    const positive = html(createElement(SummaryCards, {
      currency: "EGP",
      report,
      collection: money({ currency: "EGP", planCount: 1, outstanding: "80.00", overdue: "80.00" }),
      collectionFailed: false,
      activeHref: "/dashboard?currency=EGP#active-proforma-invoices",
      outstandingHref: "/payments?view=outstanding&currency=EGP",
      overdueHref: "/payments?view=overdue&currency=EGP",
    }));
    const overdueAt = positive.indexOf(">Overdue<");
    const overdueCard = positive.slice(Math.max(0, positive.lastIndexOf("<a", overdueAt)), positive.indexOf("</a>", overdueAt));
    expect(overdueCard).toContain("text-danger");
    expect(overdueCard).toContain("EGP 80.00");

    const none = html(createElement(SummaryCards, {
      currency: "USD",
      report,
      collection: money(),
      collectionFailed: false,
      activeHref: "/dashboard",
      outstandingHref: "/payments",
      overdueHref: "/payments",
    }));
    expect(none).toContain("No payment plan in this currency");
    expect(none).not.toContain("USD 0.00");
    expect(none).not.toContain("text-danger");

    const failed = html(createElement(SummaryCards, {
      currency: "USD",
      report,
      collection: null,
      collectionFailed: true,
      activeHref: "/dashboard",
      outstandingHref: "/payments",
      overdueHref: "/payments",
    }));
    expect(failed).toContain("Collections could not be loaded");
    expect(failed).not.toContain("USD 0.00");
  });

  it("counts every status from the supplied totals and links the filtered list", () => {
    const markup = html(createElement(StatusChart, {
      counts: report.statusCounts,
      current: "",
      hrefFor: (status) => `/dashboard?currency=USD&status=${status}#active-proforma-invoices`,
    }));
    expect(markup).toContain(">21<");
    expect(markup).toContain(">4<");
    expect(markup).toContain('href="/dashboard?currency=USD&amp;status=issued#active-proforma-invoices"');
    expect(markup).toContain('href="/dashboard?currency=USD&amp;status=draft#active-proforma-invoices"');
    expect(markup).not.toContain("NaN");
  });

  it("separates no plans, settled plans, and outstanding buckets", () => {
    const none = html(createElement(CollectionsPanel, {
      currency: "USD",
      row: money({ received: "0.00" }),
      today: "2026-10-25",
      parentStatus: "",
      loading: false,
      error: null,
      onRetry: () => undefined,
      controls: null,
      parentControl: null,
    }));
    expect(none).toContain("No active collections");
    expect(none).not.toContain("awaiting payment tracking");
    expect(none).not.toContain("Start tracking");
    expect(none).not.toContain("Review PIs");
    expect(none).not.toContain("href=\"/payments");

    const settled = html(createElement(CollectionsPanel, {
      currency: "EUR",
      row: money({ currency: "EUR", planCount: 1, outstanding: "0.00", overdue: "0.00", received: "12.00" }),
      today: "2026-10-25",
      parentStatus: "",
      loading: false,
      error: null,
      onRetry: () => undefined,
      controls: null,
      parentControl: null,
    }));
    expect(settled).toContain("Nothing outstanding");
    expect(settled).not.toContain("No active collections");
    expect(settled).toContain("EUR 12.00");
    expect(settled).toContain("not revenue");
    const receivedAt = settled.indexOf(">Received<");
    const receivedBlock = settled.slice(receivedAt, settled.indexOf("Existing views"));
    expect(receivedBlock).not.toContain("href=");

    const open = html(createElement(CollectionsPanel, {
      currency: "USD",
      row: money({
        planCount: 3,
        outstanding: "40.00",
        overdue: "10.00",
        dueToday: "0.00",
        due1To7: "5.00",
        due8To30: "15.00",
        dueAfter30: "7.00",
        unresolved: "3.00",
        next7: "5.00",
        next30: "20.00",
        received: "8.00",
      }),
      today: "2026-10-25",
      parentStatus: "cancelled",
      loading: false,
      error: null,
      onRetry: () => undefined,
      controls: null,
      parentControl: null,
    }));
    expect(open).toContain('href="/payments?view=overdue&amp;currency=USD&amp;pi_status=cancelled"');
    expect(open).toContain('href="/payments?view=next_7&amp;currency=USD&amp;pi_status=cancelled"');
    expect(open).toContain("due_from=2026-11-02");
    expect(open).toContain("due_to=2026-11-24");
    expect(open).toContain("due_from=2026-11-25");
    expect(open).toContain("view=awaiting");
    expect(open).toContain("balance=outstanding");
    expect(open).toContain("view=next_30");
    expect(open).not.toContain("No active collections");
    const overdueAt = open.indexOf(">Overdue<");
    const overdueRow = open.slice(Math.max(0, open.lastIndexOf("<a", overdueAt)), open.indexOf("</a>", overdueAt));
    expect(overdueRow).toContain("text-danger");
    const unsetAt = open.indexOf(">Date not set<");
    const unsetRow = open.slice(Math.max(0, open.lastIndexOf("<a", unsetAt)), open.indexOf("</a>", unsetAt));
    expect(unsetRow).not.toContain("text-danger");
    expect(unsetRow).toContain("view=awaiting");
  });

  it("treats a zero-balance plan as nothing outstanding", () => {
    const row = money({ planCount: 1, outstanding: "0.00", overdue: "0.00", received: "0.00" });
    const panel = html(createElement(CollectionsPanel, {
      currency: "USD",
      row,
      today: "2026-10-25",
      parentStatus: "",
      loading: false,
      error: null,
      onRetry: () => undefined,
      controls: null,
      parentControl: null,
    }));
    expect(panel).toContain("Nothing outstanding");
    expect(panel).not.toContain("No active collections");
    const cards = html(createElement(SummaryCards, {
      currency: "USD",
      report,
      collection: row,
      collectionFailed: false,
      activeHref: "/dashboard?currency=USD#active-proforma-invoices",
      outstandingHref: "/payments?view=outstanding&currency=USD",
      overdueHref: "/payments?view=overdue&currency=USD",
    }));
    expect(cards).toContain("USD 0.00");
    expect(cards).not.toContain("No payment plan in this currency");
    expect(cards).not.toContain("No active collections");
  });

  it("does not present a failed or loading collection as an empty plan", () => {
    const loading = html(createElement(CollectionsPanel, {
      currency: "USD",
      row: null,
      today: "",
      parentStatus: "",
      loading: true,
      error: null,
      onRetry: () => undefined,
      controls: null,
      parentControl: null,
    }));
    expect(loading).toContain("Loading collections");
    expect(loading).not.toContain("0.00");
    expect(loading).not.toContain("No active collections");

    const failed = html(createElement(CollectionsPanel, {
      currency: "USD",
      row: null,
      today: "",
      parentStatus: "",
      loading: false,
      error: "The report failed.",
      onRetry: () => undefined,
      controls: null,
      parentControl: null,
    }));
    expect(failed).toContain("The report failed.");
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("0.00");
    expect(failed).not.toContain("No active collections");
  });
});
