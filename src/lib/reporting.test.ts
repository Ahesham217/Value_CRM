import { describe, expect, it } from "vitest";
import { HOME_PATH, mainNavigation } from "./navigation";
import { addDays } from "./payment-schedule";
import {
  chooseDashboardCurrency,
  collectionPath,
  coverageText,
  customRangeMessage,
  dueBucketPath,
  keepPreviousOnFailure,
  leadLabel,
  moneyIsPositive,
  parseDashboardLocation,
  parsePaymentLocation,
  paymentSearchParams,
  paymentTrackingPath,
  paymentsPath,
  quotedForCurrency,
  readActiveReport,
  readCollectionSummary,
  reportingWindow,
  showsOverdueMarker,
  statusCountTotal,
  withListChange,
  type PaymentRow,
} from "./reporting";

describe("reporting windows", () => {
  it("uses Cairo calendar ranges and includes both ends", () => {
    expect(reportingWindow("last_7", null, null, "2026-10-24", true)).toEqual({
      unbounded: false,
      start: "2026-10-18",
      end: "2026-10-24",
    });
    expect(reportingWindow("this_month", null, null, "2026-10-24", true)).toEqual({
      unbounded: false,
      start: "2026-10-01",
      end: "2026-10-24",
    });
    expect(reportingWindow("last_30", null, null, "2026-10-24", true)).toEqual({
      unbounded: false,
      start: "2026-09-25",
      end: "2026-10-24",
    });
    expect(reportingWindow("last_7", null, null, "2026-03-01", true).start).toBe("2026-02-23");
    expect(reportingWindow("this_month", null, null, "2026-03-01", true)).toEqual({
      unbounded: false,
      start: "2026-03-01",
      end: "2026-03-01",
    });
    expect(reportingWindow("custom", "2026-01-02", "2026-01-05", "2026-10-24", true)).toEqual({
      unbounded: false,
      start: "2026-01-02",
      end: "2026-01-05",
    });
    expect(reportingWindow("all", null, null, "2026-10-24", true).unbounded).toBe(true);
  });

  it("rejects an incomplete, inverted, or receipt-wide range", () => {
    expect(() => reportingWindow("custom", "2026-02-02", "2026-02-01", "2026-10-24", true)).toThrow(/on or before the end date/);
    expect(customRangeMessage("", "2026-02-01")).toMatch(/Enter both dates/);
    expect(() => reportingWindow("all", null, null, "2026-10-24", false)).toThrow(/Choose a date range/);
    expect(() => reportingWindow("yesterday", null, null, "2026-10-24", true)).toThrow(/Choose a date range/);
  });
});

describe("reporting access and money parsing", () => {
  it("keeps the previous result when a refresh fails", () => {
    expect(keepPreviousOnFailure({ count: 2 }, { ok: false })).toEqual({ data: { count: 2 }, error: true });
    expect(keepPreviousOnFailure(null, { ok: false })).toEqual({ data: null, error: true });
    expect(keepPreviousOnFailure({ count: 2 }, { ok: true, data: { count: 4 } })).toEqual({ data: { count: 4 }, error: false });
  });

  it("rejects a payload that would look like a zero total", () => {
    expect(() => readActiveReport({ count: 0, set: "active", period: { unbounded: true, start: null, end: null, today: "2026-10-24" }, totals: [{ currency: "EGP" }], rows: [], leads: [], currencies: [], status_counts: { draft: 0, issued: 0, sent: 0, accepted: 0 } })).toThrow(/quoted total/);
    expect(() => readActiveReport({ count: 0, set: "active", period: { unbounded: true, start: null, end: null, today: "2026-10-24" }, totals: [], rows: [], leads: [], currencies: [] })).toThrow(/status counts/);
    expect(() => readCollectionSummary({ today: "2026-10-24", parent_status: null, receipt_period: { start: "2026-10-18", end: "2026-10-24" }, currencies: [], untracked_count: 0 })).toThrow(/collection summary/);
  });

  it("keeps money as exact text and does not merge currencies", () => {
    const report = readActiveReport({
      count: 2,
      set: "active",
      period: { unbounded: false, start: "2026-10-18", end: "2026-10-24", today: "2026-10-24" },
      totals: [
        { currency: "EGP", issued: "1000.10", draft: "0.00" },
        { currency: "USD", issued: "0.00", draft: "20.00" },
      ],
      rows: [],
      leads: [{ id: "11111111-1111-4111-8111-111111111111", name: "Ada", active: false }],
      currencies: ["EGP", "USD"],
      status_counts: { draft: 1, issued: 1, sent: 0, accepted: 0 },
    });
    expect(report.totals.map((total) => total.currency)).toEqual(["EGP", "USD"]);
    expect(report.totals[0]?.issued).toBe("1000.10");
    expect(quotedForCurrency(report.totals, "USD").draft).toBe("20.00");
    expect(quotedForCurrency(report.totals, "EUR")).toEqual({ currency: "EUR", issued: "0.00", draft: "0.00" });
    expect(statusCountTotal(report.statusCounts)).toBe(2);
    expect(report.leads[0]?.active).toBe(false);
    expect(moneyIsPositive("0.00")).toBe(false);
    expect(moneyIsPositive("0.01")).toBe(true);
  });
});

const money = {
  outstanding: "0.00",
  overdue: "0.00",
  due_today: "0.00",
  next_7: "0.00",
  next_30: "0.00",
  unresolved: "0.00",
  due_1_7: "0.00",
  due_8_30: "0.00",
  due_after_30: "0.00",
  plan_count: 0,
  received: "0.00",
};

describe("dashboard currency and due buckets", () => {
  it("keeps an explicit currency and otherwise chooses visible activity, with USD last", () => {
    expect(chooseDashboardCurrency({ explicit: "EUR", piCurrencies: ["USD"], planCounts: { EGP: 1 } })).toBe("EUR");
    expect(chooseDashboardCurrency({ explicit: null, piCurrencies: ["EGP", "USD"], planCounts: {} })).toBe("USD");
    expect(chooseDashboardCurrency({ explicit: null, piCurrencies: ["EGP"], planCounts: { USD: 4 } })).toBe("EGP");
    expect(chooseDashboardCurrency({ explicit: null, piCurrencies: [], planCounts: { EUR: 1 } })).toBe("EUR");
    expect(chooseDashboardCurrency({ explicit: null, piCurrencies: [], planCounts: {} })).toBe("USD");
    expect(parseDashboardLocation(new URLSearchParams("currency=EGP&period=this_month")).currency).toBe("EGP");
    expect(parseDashboardLocation(new URLSearchParams("currency=GBP")).currency).toBe("");
  });

  it("opens each disjoint due bucket on its own payment range", () => {
    const today = "2026-10-24";
    expect(dueBucketPath({ bucket: "overdue", currency: "USD", today })).toBe("/payments?view=overdue&currency=USD");
    expect(dueBucketPath({ bucket: "due_today", currency: "USD", today })).toBe("/payments?view=due_today&currency=USD");
    expect(dueBucketPath({ bucket: "due_1_7", currency: "EGP", today, parentStatus: "cancelled" })).toBe("/payments?view=next_7&currency=EGP&pi_status=cancelled");
    expect(dueBucketPath({ bucket: "due_8_30", currency: "USD", today })).toBe(
      `/payments?view=outstanding&currency=USD&due_from=${addDays(today, 8)}&due_to=${addDays(today, 30)}`,
    );
    expect(dueBucketPath({ bucket: "due_after_30", currency: "EUR", today })).toBe(
      `/payments?view=outstanding&currency=EUR&due_from=${addDays(today, 31)}`,
    );
    const unresolved = dueBucketPath({ bucket: "unresolved", currency: "USD", today });
    expect(unresolved).toContain("view=awaiting");
    expect(unresolved).toContain("balance=outstanding");
    expect(unresolved).not.toContain("view=overdue");
    expect(dueBucketPath({ bucket: "due_8_30", currency: "USD", today: "2026-01-31" })).toContain("due_from=2026-02-08");
    expect(dueBucketPath({ bucket: "due_8_30", currency: "USD", today: "2026-01-31" })).toContain("due_to=2026-03-02");
    expect(readCollectionSummary({
      today,
      parent_status: null,
      receipt_period: { start: "2026-10-18", end: today },
      untracked_count: 0,
      currencies: [
        { currency: "EGP", ...money, plan_count: 0 },
        { currency: "USD", ...money, outstanding: "40.00", overdue: "10.00", due_1_7: "5.00", due_8_30: "15.00", due_after_30: "7.00", unresolved: "3.00", plan_count: 2, received: "8.00" },
        { currency: "EUR", ...money },
      ],
    }).currencies[1]).toMatchObject({ due1To7: "5.00", due8To30: "15.00", dueAfter30: "7.00", planCount: 2, received: "8.00" });
  });
});

describe("payments links and pagination", () => {
  it("opens the matching payment view and resets the page when a filter changes", () => {
    expect(collectionPath({ bucket: "overdue", currency: "EGP", parentStatus: "cancelled" })).toContain("view=overdue");
    expect(collectionPath({ bucket: "overdue", currency: "EGP" })).toContain("currency=EGP");
    expect(collectionPath({ bucket: "unresolved", currency: "USD" })).toContain("view=awaiting");
    expect(collectionPath({ bucket: "unresolved", currency: "USD" })).toContain("balance=outstanding");
    expect(collectionPath({ bucket: "next_7" })).toContain("view=next_7");
    expect(collectionPath({ bucket: "next_30" })).not.toContain("view=next_7");
    const current = { ...parsePaymentLocation(new URLSearchParams("view=outstanding&page=3&currency=EGP")), page: 3 };
    expect(withListChange(current, { currency: "USD" }).page).toBe(1);
    expect(withListChange(current, { page: 2 }).page).toBe(2);
    expect(paymentTrackingPath("abc")).toBe("/pis/abc#payment-tracking");
    const params = paymentSearchParams(withListChange(current, { search: "Acme" }));
    expect(params.get("page")).toBeNull();
    expect(paymentsPath({ view: "paid", page: 1 })).toContain("view=paid");
  });

  it("does not mark a paid or unresolved obligation as overdue", () => {
    const paid = { dueState: "settled", collectionStatus: "paid" } as Pick<PaymentRow, "dueState" | "collectionStatus">;
    const awaiting = { dueState: "unscheduled", collectionStatus: "unpaid" } as Pick<PaymentRow, "dueState" | "collectionStatus">;
    const overdue = { dueState: "overdue", collectionStatus: "partial" } as Pick<PaymentRow, "dueState" | "collectionStatus">;
    expect(showsOverdueMarker(paid)).toBe(false);
    expect(showsOverdueMarker(awaiting)).toBe(false);
    expect(showsOverdueMarker(overdue)).toBe(true);
    expect(leadLabel("Report Former", false)).toBe("Report Former (inactive)");
    expect(coverageText(1)).toContain("does not know their unpaid balance");
    expect(coverageText(2)).toContain("2 issued PIs");
  });
});

describe("navigation", () => {
  it("keeps proforma invoices as the home page and adds Dashboard and Payments", () => {
    expect(HOME_PATH).toBe("/pis");
    const labels = mainNavigation(false).map((item) => item.label);
    expect(labels).toEqual(["Dashboard", "Proforma invoices", "Payments", "Subscriptions", "Clients", "Vendors", "Products"]);
    expect(mainNavigation(true).some((item) => item.to === "/settings")).toBe(true);
    expect(mainNavigation(false).some((item) => item.to === "/settings")).toBe(false);
  });
});
