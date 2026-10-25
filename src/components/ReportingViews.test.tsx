import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ActivePiRow, ActiveReport, CollectionSummary, PaymentLocation, PaymentRegister, PaymentRow } from "../lib/reporting";
import { emptyPaymentLocation } from "../lib/reporting";
import {
  ActivePiSummary,
  ActivePiTable,
  CollectionSummaryTable,
  CoverageNote,
  PaymentTable,
  PaymentTotals,
  activePiCopy,
  collectionCopy,
  emptyPaymentsCopy,
} from "./ReportingViews";

const issued: ActivePiRow = {
  id: "issued-1",
  piNumber: "EG-2026-00001",
  displayNumber: "EG-2026-00001",
  clientName: "Visible Client",
  piDate: "2026-10-24",
  presetCode: "EG-EGP",
  presetDisplayName: "Egypt — EGP",
  presetArchived: false,
  currency: "EGP",
  total: "1000.00",
  amountKind: "issued",
  leadSalespersonId: "lead-1",
  leadName: "Ada",
  leadActive: true,
  displayStatus: "issued",
  revisionDraftOpen: true,
  latestRevision: 0,
};

const draft: ActivePiRow = {
  ...issued,
  id: "draft-1",
  piNumber: null,
  displayNumber: "Draft",
  currency: "USD",
  total: "200.00",
  amountKind: "draft",
  displayStatus: "draft",
  revisionDraftOpen: false,
  presetDisplayName: "Archive Office",
  presetArchived: true,
};

const report: ActiveReport = {
  count: 2,
  set: "active",
  period: { unbounded: false, start: "2026-10-18", end: "2026-10-24", today: "2026-10-24" },
  totals: [
    { currency: "EGP", issued: "1000.00", draft: "0.00" },
    { currency: "USD", issued: "0.00", draft: "200.00" },
  ],
  rows: [issued, draft],
  leads: [],
};

const summary: CollectionSummary = {
  today: "2026-10-24",
  parentStatus: "cancelled",
  receiptPeriod: { unbounded: false, start: "2026-10-18", end: "2026-10-24" },
  currencies: [
    { currency: "EGP", outstanding: "80.00", overdue: "80.00", dueToday: "0.00", next7: "0.00", next30: "0.00", unresolved: "0.00", received: "30.00" },
    { currency: "USD", outstanding: "0.00", overdue: "0.00", dueToday: "0.00", next7: "0.00", next30: "0.00", unresolved: "0.00", received: "0.00" },
    { currency: "EUR", outstanding: "25.00", overdue: "0.00", dueToday: "0.00", next7: "25.00", next30: "25.00", unresolved: "15.00", received: "0.00" },
  ],
  untrackedCount: 3,
};

function payment(overrides: Partial<PaymentRow>): PaymentRow {
  return {
    id: "ob-1",
    piId: "pi-1",
    dueDate: "2026-10-20",
    dueLabel: "2026-10-20",
    dueTiming: "fixed",
    dueState: "overdue",
    clientName: "Visible Client",
    piNumber: "EG-2026-00001",
    trackedRevision: 0,
    trackedDisplayNumber: "EG-2026-00001",
    latestRevision: 1,
    revisionDiffers: true,
    label: "Balance · Instalment 1",
    kind: "instalment",
    originalAmount: "50.00",
    paidAmount: "0.00",
    outstandingAmount: "50.00",
    currency: "EGP",
    collectionStatus: "unpaid",
    leadSalespersonId: "lead-1",
    leadName: "Ada",
    leadActive: true,
    parentStatus: "cancelled",
    presetCode: "EG-EGP",
    presetDisplayName: "Egypt — EGP",
    presetArchived: false,
    position: 1,
    ...overrides,
  };
}

const register: PaymentRegister = {
  today: "2026-10-24",
  view: "outstanding",
  count: 2,
  totals: [{ currency: "EGP", original: "50.00", paid: "0.00", outstanding: "50.00" }],
  rows: [payment({})],
  leads: [],
};

function html(node: ReactNode): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node));
}

describe("dashboard and payments views", () => {
  it("keeps issued and draft quoted totals separate from revenue", () => {
    const markup = html(createElement("div", null, createElement("p", null, activePiCopy()), createElement(ActivePiSummary, { report }), createElement(ActivePiTable, { rows: report.rows })));
    expect(markup).toContain("not revenue");
    expect(markup).toContain("Issued quoted total");
    expect(markup).toContain("Draft total");
    expect(markup).toContain("EGP 1,000.00");
    expect(markup).toContain("USD 200.00");
    expect(markup).not.toContain("EGP 1,200.00");
    expect(markup).toContain("Revision draft open");
    expect(markup).toContain(">Draft<");
    expect(markup).toContain("Archive Office (archived)");
    expect(markup).toContain("PI date: 18 Oct 2026 – 24 Oct 2026");
  });

  it("shows an error without inventing zero totals, and keeps the last figures after a failed refresh", () => {
    const failed = html(createElement("div", null, createElement("p", { role: "alert" }, "The report failed.")));
    expect(failed).toContain("The report failed.");
    expect(failed).not.toContain("0.00");
    expect(failed).not.toContain("Issued quoted total");
    const stale = html(createElement("div", null, createElement("p", { role: "alert" }, "The active PI figures could not be refreshed."), createElement(ActivePiSummary, { report })));
    expect(stale).toContain("could not be refreshed");
    expect(stale).toContain("EGP 1,000.00");
  });

  it("links collection windows without adding the 7-day amount to the 30-day amount", () => {
    const markup = html(createElement("div", null, createElement("p", null, collectionCopy()), createElement(CollectionSummaryTable, { summary }), createElement(CoverageNote, { count: summary.untrackedCount })));
    expect(markup).toContain("sit inside the next 30 days");
    expect(markup).toContain("does not mean every invoice has been paid");
    expect(markup).toContain('href="/payments?view=overdue&amp;currency=EGP&amp;pi_status=cancelled"');
    expect(markup).toContain('href="/payments?view=awaiting&amp;balance=outstanding&amp;currency=EUR&amp;pi_status=cancelled"');
    expect(markup).toContain('href="/payments?view=next_7&amp;currency=EUR&amp;pi_status=cancelled"');
    expect(markup).toContain("EGP 30.00");
    expect(markup).not.toContain('href="/payments?view=received');
    expect(markup).toContain("3 issued PIs have no payment plan");
    expect(markup).toContain('href="/dashboard?coverage=untracked"');
    expect(markup).toContain("not included in the tracked balances");
  });

  it("keeps instalments separate and does not call a paid or unresolved row overdue", () => {
    const rows = [
      payment({ id: "open", label: "Balance · Instalment 1" }),
      payment({ id: "second", label: "Balance · Instalment 2", position: 2 }),
      payment({
        id: "paid",
        dueState: "settled",
        collectionStatus: "paid",
        outstandingAmount: "0.00",
        paidAmount: "50.00",
        dueDate: "2026-10-01",
        label: "Settled obligation",
      }),
      payment({
        id: "waiting",
        dueDate: null,
        dueLabel: "Awaiting delivery date",
        dueTiming: "awaiting_event",
        dueState: "unscheduled",
        kind: "payment_row",
        label: "On delivery",
      }),
    ];
    const markup = html(createElement("div", null, createElement(PaymentTotals, { register }), createElement(PaymentTable, { rows })));
    expect(markup).toContain("Balance · Instalment 1");
    expect(markup).toContain("Balance · Instalment 2");
    expect(markup).toContain('href="/pis/pi-1#payment-tracking"');
    expect(markup).toContain("Latest issued differs");
    expect(markup).toContain("Awaiting delivery date");
    expect(markup).toContain("Cancelled");
    const settledAt = markup.indexOf("Settled obligation");
    const settledRow = markup.slice(markup.lastIndexOf("<tr", settledAt), markup.indexOf("</tr>", settledAt));
    expect(settledRow).toContain("Paid");
    expect(settledRow).not.toContain("Overdue");
    const waitingAt = markup.indexOf("Awaiting delivery date");
    const waitingRow = markup.slice(markup.lastIndexOf("<tr", waitingAt), markup.indexOf("</tr>", waitingAt));
    expect(waitingRow).not.toContain("Overdue");
    expect(markup).toContain("Overdue");
    expect(emptyPaymentsCopy()).toContain("does not mean those invoices are paid");
    const location: PaymentLocation = { ...emptyPaymentLocation(), view: "outstanding" };
    expect(location.view).toBe("outstanding");
  });
});
