import { describe, expect, it } from "vitest";
import { HOME_PATH, mainNavigation } from "./navigation";
import {
  collectionPath,
  coverageText,
  customRangeMessage,
  keepPreviousOnFailure,
  leadLabel,
  parsePaymentLocation,
  paymentSearchParams,
  paymentTrackingPath,
  paymentsPath,
  readActiveReport,
  readCollectionSummary,
  reportingWindow,
  showsOverdueMarker,
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
    expect(() => readActiveReport({ count: 0, set: "active", period: { unbounded: true, start: null, end: null, today: "2026-10-24" }, totals: [{ currency: "EGP" }], rows: [], leads: [] })).toThrow(/quoted total/);
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
    });
    expect(report.totals.map((total) => total.currency)).toEqual(["EGP", "USD"]);
    expect(report.totals[0]?.issued).toBe("1000.10");
    expect(report.leads[0]?.active).toBe(false);
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
