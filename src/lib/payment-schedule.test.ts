import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  advanceThenShipmentTemplate,
  copyPaymentScheduleForDuplicate,
  emptyPaymentSchedule,
  fullAdvanceTemplate,
  isLeapYear,
  parsePaymentSchedule,
  previewPaymentSchedule,
  splitInstalments,
  type PaymentRow,
  type PaymentSchedule,
} from "./payment-schedule";
import Decimal from "decimal.js";

const USD = "USD" as const;
const ids = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function schedule(rows: PaymentRow[], extras: Partial<PaymentSchedule> = {}): PaymentSchedule {
  return {
    schema_version: 1,
    no_payment_due: false,
    dates_need_review: false,
    rows,
    ...extras,
  };
}

function row(partial: Partial<PaymentRow> & Pick<PaymentRow, "id">): PaymentRow {
  return {
    label: "",
    amount: { type: "unset" },
    due: { type: "unset" },
    instalments: null,
    ...partial,
  };
}

describe("payment dates", () => {
  it("keeps the original month-end anchor, including leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(addCalendarMonths("2026-01-31", 0)).toBe("2026-01-31");
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCalendarMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addCalendarMonths("2026-01-31", 3)).toBe("2026-04-30");
    expect(addCalendarMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addCalendarMonths("2024-02-29", 48)).toBe("2028-02-29");
  });

  it("builds monthly and yearly dates from the original anchor", () => {
    const monthly = schedule([
      row({
        id: ids(1),
        amount: { type: "fixed", amount: "100.00" },
        instalments: { count: 4, frequency: "monthly", first: { type: "date", date: "2026-01-31" } },
      }),
    ]);
    const preview = previewPaymentSchedule(monthly, USD, "100.00");
    expect(preview.ready).toBe(true);
    expect(preview.canonical?.rows[0]?.instalments?.map((item) => item.due_date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);

    const leap = schedule([
      row({
        id: ids(1),
        amount: { type: "fixed", amount: "40.00" },
        instalments: { count: 2, frequency: "yearly", first: { type: "date", date: "2024-02-29" } },
      }),
    ]);
    const leapPreview = previewPaymentSchedule(leap, "EGP", "40.00");
    expect(leapPreview.canonical?.rows[0]?.instalments?.map((item) => item.due_date)).toEqual([
      "2024-02-29",
      "2025-02-28",
    ]);
  });

  it("leaves event-based dates unresolved and does not invent a due date", () => {
    const preview = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        label: "balance",
        amount: { type: "percent", percent: "100" },
        due: { type: "after_event", event: { type: "standard", code: "delivery" }, offset: 14, unit: "days" },
      }),
    ]), USD, "1000.00");
    expect(preview.ready).toBe(true);
    expect(preview.canonical?.rows[0]?.due_date).toBeNull();
    expect(preview.customerText).toBe("100% balance due 14 days after delivery.");
    expect(preview.customerText).not.toContain("Awaiting");
    expect(preview.rows[0]?.pending).toBe("Awaiting delivery date");
  });

  it("keeps before shipment without turning a missing deadline into a date", () => {
    const open = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        label: "before shipment",
        amount: { type: "percent", percent: "100" },
        due: { type: "before_shipment", deadline: null },
      }),
    ]), "EUR", "50.00");
    expect(open.ready).toBe(true);
    expect(open.customerText).toBe("100% before shipment.");
    expect(open.canonical?.rows[0]?.due_date).toBeNull();
    expect(open.rows[0]?.pending).toBe("Deadline to be set");
    expect(open.customerText).not.toContain("Deadline");

    const dated = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        amount: { type: "percent", percent: "100" },
        due: { type: "before_shipment", deadline: "2026-03-15" },
      }),
    ]), "EUR", "50.00");
    expect(dated.customerText).toBe("100% before shipment, and no later than 15 March 2026.");
    expect(dated.canonical?.rows[0]?.due_date).toBe("2026-03-15");
    expect(dated.rows[0]?.pending).toBeNull();
  });
});

describe("payment amounts", () => {
  it("calculates 100% advance and 30/70 without conversion", () => {
    const advance = fullAdvanceTemplate();
    for (const currency of ["EGP", "USD", "EUR"] as const) {
      const preview = previewPaymentSchedule(advance, currency, "100000.00");
      expect(preview.ready).toBe(true);
      expect(preview.canonical?.rows[0]?.amount).toBe("100000.00");
      expect(preview.canonical?.currency).toBe(currency);
      expect(preview.customerText).toBe("100% advance payment upon order confirmation.");
    }
    const split = previewPaymentSchedule(advanceThenShipmentTemplate(), USD, "100000.00");
    expect(split.canonical?.rows.map((item) => item.amount)).toEqual(["30000.00", "70000.00"]);
    expect(split.customerText).toBe("30% advance payment upon order confirmation, and 70% before shipment.");
  });

  it("splits 30%, 15%, and the remaining balance into ten equal instalments", () => {
    const preview = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        label: "advance payment",
        amount: { type: "percent", percent: "30" },
        due: { type: "on_event", event: { type: "standard", code: "order_confirmation" } },
      }),
      row({
        id: ids(2),
        label: "before shipment",
        amount: { type: "percent", percent: "15" },
        due: { type: "before_shipment", deadline: null },
      }),
      row({
        id: ids(3),
        label: "Remaining balance",
        amount: { type: "remainder" },
        instalments: {
          count: 10,
          frequency: "monthly",
          first: {
            type: "after_event",
            event: { type: "standard", code: "delivery" },
            offset: 1,
            unit: "months",
          },
        },
      }),
    ]), USD, "100000.00");
    expect(preview.ready).toBe(true);
    expect(preview.canonical?.rows.map((item) => item.amount)).toEqual(["30000.00", "15000.00", "55000.00"]);
    expect(preview.canonical?.rows[2]?.instalments?.map((item) => item.amount)).toEqual(Array(10).fill("5500.00"));
    expect(preview.canonical?.rows[2]?.instalments?.[0]?.due_date).toBeNull();
    expect(preview.canonical?.rows[2]?.instalments?.[1]?.due_formula).toBe("two calendar months after delivery");
    expect(preview.customerText).toBe(
      "30% advance payment upon order confirmation, 15% before shipment, and the remaining 55% payable in 10 monthly instalments, with the first instalment due one calendar month after delivery.",
    );
    expect(preview.customerText).not.toContain(ids(3));
    expect(preview.customerText).not.toContain("delivery_date");
    expect(preview.customerText).not.toContain("Awaiting");
    expect(preview.presentation).toBe("paragraph");
    expect(preview.rows[2]?.pending).toBe("Awaiting delivery date");
  });

  it("keeps fixed amounts fixed when the grand total changes and recalculates percentages and the remainder", () => {
    const agreement = schedule([
      row({
        id: ids(1),
        label: "advance payment",
        amount: { type: "fixed", amount: "10000.00" },
        due: { type: "on_event", event: { type: "standard", code: "order_confirmation" } },
      }),
      row({
        id: ids(2),
        amount: { type: "percent", percent: "20" },
        due: { type: "before_shipment", deadline: null },
      }),
      row({
        id: ids(3),
        amount: { type: "remainder" },
        due: { type: "on_event", event: { type: "standard", code: "delivery" } },
      }),
    ]);
    const first = previewPaymentSchedule(agreement, USD, "100000.00");
    expect(first.canonical?.rows.map((item) => item.amount)).toEqual(["10000.00", "20000.00", "70000.00"]);
    expect(first.customerText).toBe(
      "USD 10,000.00 advance payment upon order confirmation, 20% before shipment, and the remaining 70% upon delivery.",
    );
    const changed = previewPaymentSchedule(agreement, USD, "80000.00");
    expect(changed.canonical?.rows.map((item) => item.amount)).toEqual(["10000.00", "16000.00", "54000.00"]);
    expect(changed.customerText).toContain("USD 10,000.00");
    expect(changed.customerText).toContain("the remaining 67.5%");
    expect(changed.canonical?.rows[0]?.amount).toBe("10000.00");
  });

  it("distinguishes a blank amount from an explicit zero and rejects over-allocation, under-allocation, and a second remainder", () => {
    const blank = previewPaymentSchedule(schedule([
      row({ id: ids(1), label: "Advance", amount: { type: "percent", percent: null }, due: { type: "date", date: "2026-12-01" } }),
    ]), USD, "100.00");
    expect(blank.ready).toBe(false);
    expect(blank.issues.map((issue) => issue.message).join(" ")).toContain("Advance: enter the percentage.");
    expect(blank.allocated).toBeNull();

    const zero = previewPaymentSchedule(schedule([
      row({ id: ids(1), label: "Advance", amount: { type: "fixed", amount: "0.00" }, due: { type: "date", date: "2026-12-01" } }),
    ]), USD, "100.00");
    expect(zero.issues.map((issue) => issue.message).join(" ")).toContain("Advance: the amount must be greater than zero.");

    const over = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "fixed", amount: "60.00" }, due: { type: "date", date: "2026-12-01" } }),
      row({ id: ids(2), amount: { type: "fixed", amount: "50.00" }, due: { type: "date", date: "2026-12-02" } }),
    ]), USD, "100.00");
    expect(over.ready).toBe(false);
    expect(over.overallocated).toBe("10.00");

    const under = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "percent", percent: "30" }, due: { type: "date", date: "2026-12-01" } }),
    ]), USD, "100.00");
    expect(under.unallocated).toBe("70.00");
    expect(under.customerText).toBeNull();

    const remainders = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "remainder" }, due: { type: "date", date: "2026-12-01" } }),
      row({ id: ids(2), amount: { type: "remainder" }, due: { type: "date", date: "2026-12-02" } }),
    ]), USD, "100.00");
    expect(remainders.issues.map((issue) => issue.message).join(" ")).toContain("Only one payment can be the remaining balance.");
  });

  it("puts percentage rounding on the final payment and instalment rounding on the final instalment", () => {
    const percents = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        amount: { type: "percent", percent: "50" },
        due: { type: "on_event", event: { type: "standard", code: "order_confirmation" } },
      }),
      row({
        id: ids(2),
        amount: { type: "percent", percent: "50" },
        due: { type: "on_event", event: { type: "standard", code: "delivery" } },
      }),
    ]), USD, "99.99");
    expect(percents.canonical?.rows.map((item) => item.amount)).toEqual(["50.00", "49.99"]);
    expect(percents.customerText).toBe("50% upon order confirmation, and 50% (USD 49.99) upon delivery.");
    expect(percents.canonical?.rows.reduce((sum, item) => sum + Number(item.amount), 0)).toBeCloseTo(99.99, 2);

    const parts = splitInstalments(new Decimal("100.00"), 3);
    expect(parts.map((part) => part.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
    const instalments = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        amount: { type: "fixed", amount: "100.00" },
        instalments: { count: 3, frequency: "monthly", first: { type: "date", date: "2026-12-01" } },
      }),
    ]), USD, "100.00");
    expect(instalments.canonical?.rows[0]?.instalments?.map((item) => item.amount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(instalments.customerText).toBe(
      "USD 100.00 payable in 3 monthly instalments of USD 33.33, with a final instalment of USD 33.34, the first instalment due on 1 December 2026.",
    );
    expect(instalments.customerText).not.toMatch(/equal/i);
  });

  it("does not treat a short percentage total as rounding", () => {
    const preview = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "percent", percent: "33.33" }, due: { type: "date", date: "2026-12-01" } }),
      row({ id: ids(2), amount: { type: "percent", percent: "33.33" }, due: { type: "date", date: "2026-12-02" } }),
      row({ id: ids(3), amount: { type: "percent", percent: "33.33" }, due: { type: "date", date: "2026-12-03" } }),
    ]), USD, "100.00");
    expect(preview.ready).toBe(false);
    expect(preview.unallocated).toBe("0.01");
    expect(preview.issues.map((issue) => issue.message).join(" ")).toContain("exactly 100%");
    expect(preview.customerText).toBeNull();
  });

  it("requires percentage-only schedules to total exactly 100 percent", () => {
    const over = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "percent", percent: "60" }, due: { type: "date", date: "2026-12-01" } }),
      row({ id: ids(2), amount: { type: "percent", percent: "50" }, due: { type: "date", date: "2026-12-02" } }),
    ]), USD, "0.02");
    expect(over.ready).toBe(false);
    expect(over.customerText).toBeNull();
    expect(over.issues.map((issue) => issue.message).join(" ")).toContain("exactly 100%");
    expect(over.issues.map((issue) => issue.message).join(" ")).toContain("110%");

    const rounded = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "percent", percent: "50" }, due: { type: "date", date: "2026-12-01" } }),
      row({ id: ids(2), amount: { type: "percent", percent: "50" }, due: { type: "date", date: "2026-12-02" } }),
    ]), USD, "0.03");
    expect(rounded.ready).toBe(true);
    expect(rounded.canonical?.rows.map((item) => item.amount)).toEqual(["0.02", "0.01"]);

    const mixed = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "fixed", amount: "0.01" }, due: { type: "date", date: "2026-12-01" } }),
      row({ id: ids(2), amount: { type: "percent", percent: "50" }, due: { type: "date", date: "2026-12-02" } }),
    ]), USD, "0.02");
    expect(mixed.ready).toBe(true);
    expect(mixed.canonical?.rows.map((item) => item.amount)).toEqual(["0.01", "0.01"]);

    const remainder = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "percent", percent: "60" }, due: { type: "date", date: "2026-12-01" } }),
      row({ id: ids(2), amount: { type: "remainder" }, due: { type: "date", date: "2026-12-02" } }),
    ]), USD, "0.02");
    expect(remainder.ready).toBe(true);
    expect(remainder.canonical?.rows.map((item) => item.amount)).toEqual(["0.01", "0.01"]);
  });

  it("returns validation for invalid instalment counts without throwing", () => {
    expect(splitInstalments(new Decimal("10.00"), 0)).toEqual([]);
    expect(splitInstalments(new Decimal("10.00"), 1.5)).toEqual([]);
    expect(splitInstalments(new Decimal("10.00"), -4)).toEqual([]);
    expect(splitInstalments(new Decimal("10.00"), 10_000_000)).toEqual([]);

    const cases: Array<{ count: number | null; message: string }> = [
      { count: null, message: "enter the number of instalments" },
      { count: 0, message: "whole number from 2 to 120" },
      { count: 1.5, message: "whole number from 2 to 120" },
      { count: -3, message: "whole number from 2 to 120" },
      { count: 121, message: "whole number from 2 to 120" },
      { count: 10_000_000, message: "whole number from 2 to 120" },
    ];
    for (const item of cases) {
      const preview = previewPaymentSchedule(schedule([
        row({
          id: ids(1),
          label: "Balance",
          amount: { type: "fixed", amount: "100.00" },
          due: { type: "date", date: "2026-12-01" },
          instalments: { count: item.count, frequency: "monthly", first: { type: "date", date: "2026-12-01" } },
        }),
      ]), USD, "100.00");
      expect(preview.ready).toBe(false);
      expect(preview.customerText).toBeNull();
      expect(preview.canonical).toBeNull();
      expect(preview.issues.map((issue) => issue.message).join(" ")).toContain(item.message);
    }

    const parsed = parsePaymentSchedule({
      schema_version: 1,
      no_payment_due: false,
      dates_need_review: false,
      rows: [{
        id: ids(1),
        label: "Balance",
        amount: { type: "fixed", amount: "100.00" },
        due: { type: "unset" },
        instalments: { count: "2.5", frequency: "monthly", first: { type: "date", date: "2026-12-01" } },
      }],
    });
    const fromStorage = previewPaymentSchedule(parsed, USD, "100.00");
    expect(fromStorage.ready).toBe(false);
    expect(fromStorage.issues.map((issue) => issue.message).join(" ")).toContain("whole number from 2 to 120");
  });

  it("rejects a missing or unsupported standard milestone", () => {
    const ordinary = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        label: "advance payment",
        amount: { type: "percent", percent: "100" },
        due: { type: "on_event", event: { type: "standard", code: null as never } },
      }),
    ]), USD, "100.00");
    expect(ordinary.ready).toBe(false);
    expect(ordinary.customerText).toBeNull();
    expect(ordinary.issues.map((issue) => issue.message).join(" ")).toContain("supported milestone");
    expect(ordinary.rows[0]?.contractual ?? "").not.toContain("upon .");

    const instalments = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        amount: { type: "fixed", amount: "100.00" },
        instalments: {
          count: 2,
          frequency: "monthly",
          first: {
            type: "after_event",
            event: { type: "standard", code: "inspection" as "delivery" },
            offset: 1,
            unit: "months",
          },
        },
      }),
    ]), USD, "100.00");
    expect(instalments.ready).toBe(false);
    expect(instalments.customerText).toBeNull();
    expect(instalments.issues.map((issue) => issue.message).join(" ")).toContain("supported milestone");
  });

  it("allows an explicit empty schedule only when the PI total is zero", () => {
    const marked = previewPaymentSchedule({ ...emptyPaymentSchedule(), no_payment_due: true }, USD, "0.00");
    expect(marked.ready).toBe(true);
    expect(marked.customerText).toBe("No payment due.");
    expect(marked.canonical?.rows).toEqual([]);

    const implicit = previewPaymentSchedule(emptyPaymentSchedule(), USD, "0.00");
    expect(implicit.ready).toBe(false);
    expect(implicit.customerText).toBeNull();

    const positive = previewPaymentSchedule({ ...emptyPaymentSchedule(), no_payment_due: true }, "EGP", "1.00");
    expect(positive.ready).toBe(false);
  });

  it("states an uneven remainder in currency", () => {
    const preview = previewPaymentSchedule(schedule([
      row({ id: ids(1), amount: { type: "fixed", amount: "10.00" }, due: { type: "date", date: "2026-12-01" } }),
      row({
        id: ids(2),
        amount: { type: "remainder" },
        due: { type: "on_event", event: { type: "standard", code: "delivery" } },
      }),
    ]), USD, "100.01");
    expect(preview.canonical?.rows.map((item) => item.amount)).toEqual(["10.00", "90.01"]);
    expect(preview.customerText).toBe("USD 10.00 due on 1 December 2026, and the remaining balance of USD 90.01 upon delivery.");
  });

  it("uses the same currency code and does not convert EGP, USD, or EUR", () => {
    const agreement = schedule([
      row({
        id: ids(1),
        amount: { type: "fixed", amount: "10.50" },
        due: { type: "on_event", event: { type: "standard", code: "commissioning" } },
      }),
      row({
        id: ids(2),
        amount: { type: "remainder" },
        due: { type: "date", date: "2026-12-01" },
      }),
    ]);
    expect(previewPaymentSchedule(agreement, "EGP", "25.50").customerText).toContain("EGP 10.50");
    expect(previewPaymentSchedule(agreement, "USD", "25.50").customerText).toContain("USD 10.50");
    expect(previewPaymentSchedule(agreement, "EUR", "25.50").customerText).toContain("EUR 10.50");
    expect(previewPaymentSchedule(agreement, "EUR", "25.50").canonical?.rows[1]?.amount).toBe("15.00");
  });
});

describe("payment agreement shape", () => {
  it("saves incomplete fields as incomplete and reports the row that needs correction", () => {
    const draft = schedule([
      row({
        id: ids(1),
        label: "Commissioning",
        amount: { type: "fixed", amount: null },
        due: { type: "unset" },
      }),
    ]);
    const parsed = parsePaymentSchedule(JSON.parse(JSON.stringify(draft)));
    expect(parsed.rows[0]?.amount).toEqual({ type: "fixed", amount: null });
    expect(parsed.rows[0]?.due).toEqual({ type: "unset" });
    const preview = previewPaymentSchedule(parsed, USD, "10.00");
    expect(preview.issues.map((issue) => issue.rowId)).toContain(ids(1));
    expect(preview.issues.map((issue) => issue.message).join(" ")).toContain("Commissioning: enter the amount.");
    expect(preview.issues.map((issue) => issue.message).join(" ")).toContain("Commissioning: choose when it is due.");
  });

  it("names a custom milestone in the wording and keeps its identifier out of the text", () => {
    const eventId = ids(9);
    const preview = previewPaymentSchedule(schedule([
      row({
        id: ids(1),
        amount: { type: "percent", percent: "100" },
        due: { type: "on_event", event: { type: "custom", id: eventId, label: "factory acceptance" } },
      }),
    ]), USD, "80.00");
    expect(preview.customerText).toBe("100% upon factory acceptance.");
    expect(preview.customerText).not.toContain(eventId);
    expect(preview.canonical?.rows[0]?.due).toMatchObject({ type: "on_event", event: { type: "custom", id: eventId } });
  });

  it("copies rules onto a duplicate, clears fixed dates, and issues new identifiers", () => {
    const custom = ids(7);
    const source = schedule([
      row({
        id: ids(1),
        label: "advance payment",
        amount: { type: "fixed", amount: "10.00" },
        due: { type: "date", date: "2026-12-01" },
      }),
      row({
        id: ids(2),
        amount: { type: "percent", percent: "20" },
        due: { type: "before_shipment", deadline: "2026-11-01" },
      }),
      row({
        id: ids(3),
        amount: { type: "remainder" },
        due: { type: "after_event", event: { type: "custom", id: custom, label: "factory acceptance" }, offset: 1, unit: "months" },
        instalments: {
          count: 2,
          frequency: "yearly",
          first: { type: "date", date: "2027-01-15" },
        },
      }),
    ], { dates_need_review: false });
    const copy = copyPaymentScheduleForDuplicate(source);
    expect(copy.dates_need_review).toBe(true);
    expect(copy.rows.map((item) => item.id)).not.toEqual(source.rows.map((item) => item.id));
    expect(copy.rows[0]?.due).toEqual({ type: "date", date: null });
    expect(copy.rows[1]?.due).toEqual({ type: "before_shipment", deadline: null });
    expect(copy.rows[1]?.amount).toEqual({ type: "percent", percent: "20" });
    expect(copy.rows[2]?.instalments?.count).toBe(2);
    expect(copy.rows[2]?.instalments?.frequency).toBe("yearly");
    expect(copy.rows[2]?.instalments?.first).toEqual({ type: "date", date: null });
    const copiedEvent = copy.rows[2]?.due;
    expect(copiedEvent && copiedEvent.type === "after_event" && copiedEvent.event?.type === "custom" ? copiedEvent.event.id : "").not.toBe(custom);
    expect(copiedEvent && copiedEvent.type === "after_event" && copiedEvent.event?.type === "custom" ? copiedEvent.event.label : "").toBe("factory acceptance");
    const blocked = previewPaymentSchedule(copy, USD, "100.00");
    expect(blocked.ready).toBe(false);
    expect(blocked.issues.map((issue) => issue.message).join(" ")).toContain("enter the due date");
  });

  it("uses a table when the agreement is too long for one paragraph", () => {
    const rows = Array.from({ length: 5 }, (_, index) => row({
      id: ids(index + 1),
      label: `Stage ${index + 1}`,
      amount: { type: "percent", percent: "20" },
      due: { type: "date", date: `2026-12-0${index + 1}` },
    }));
    const preview = previewPaymentSchedule(schedule(rows), USD, "100.00");
    expect(preview.ready).toBe(true);
    expect(preview.presentation).toBe("table");
    expect(preview.canonical?.rows).toHaveLength(5);
    const total = preview.canonical?.rows.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
    expect(total?.toFixed(2)).toBe("100.00");
  });
});
