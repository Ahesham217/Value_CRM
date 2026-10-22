import { describe, expect, it } from "vitest";
import {
  anniversaryDate,
  allocationSum,
  commitmentPeriods,
  completionReceivedOn,
  nextCommittedPaymentDate,
  pendingActivationDate,
  suggestAllocation,
  validateAllocation,
  dueScheduleLabel,
} from "./payment-tracking";

describe("subscription anniversaries", () => {
  it("anchors one-year and three-year boundaries to the original start", () => {
    expect(anniversaryDate("2026-11-15", 1)).toBe("2027-11-15");
    expect(anniversaryDate("2026-11-15", 3)).toBe("2029-11-15");
    expect(commitmentPeriods("2026-11-15", 3)).toEqual([
      { year: 1, startsOn: "2026-11-15", endsOn: "2027-11-15" },
      { year: 2, startsOn: "2027-11-15", endsOn: "2028-11-15" },
      { year: 3, startsOn: "2028-11-15", endsOn: "2029-11-15" },
    ]);
    expect(nextCommittedPaymentDate("2026-11-15", 1, "2026-11-15")).toBeNull();
    expect(nextCommittedPaymentDate("2026-11-15", 3, "2026-11-15")).toBe("2027-11-15");
    expect(nextCommittedPaymentDate("2026-11-15", 3, "2028-11-16")).toBeNull();
  });

  it("clamps a leap-day anniversary without drifting off the original day", () => {
    expect(anniversaryDate("2024-02-29", 1)).toBe("2025-02-28");
    expect(anniversaryDate("2024-02-29", 2)).toBe("2026-02-28");
    expect(anniversaryDate("2024-02-29", 4)).toBe("2028-02-29");
  });
});

describe("receipt allocation", () => {
  const obligations = [
    { id: "sub", outstanding: "1950.00", position: 1 },
    { id: "advance", outstanding: "3000.00", position: 2 },
    { id: "balance", outstanding: "7000.00", position: 3 },
  ];

  it("suggests a visible split in document order and does not hide it", () => {
    expect(suggestAllocation(obligations, "5000")).toEqual([
      { obligationId: "sub", amount: "1950.00" },
      { obligationId: "advance", amount: "3000.00" },
      { obligationId: "balance", amount: "50.00" },
    ]);
    expect(allocationSum(suggestAllocation(obligations, "5000"))).toBe("5000.00");
  });

  it("rejects a sum that is not the amount received and an allocation above the balance", () => {
    expect(validateAllocation({
      amount: "5000",
      receivedOn: "2026-10-15",
      today: "2026-10-21",
      method: "bank_transfer",
      obligations,
      allocations: [
        { obligationId: "sub", amount: "1950" },
        { obligationId: "advance", amount: "3000" },
      ],
    })).toMatch(/must be equal/);
    expect(validateAllocation({
      amount: "3001",
      receivedOn: "2026-10-15",
      today: "2026-10-21",
      method: "cash",
      obligations,
      allocations: [{ obligationId: "advance", amount: "3001" }],
    })).toMatch(/unpaid balance/);
    expect(validateAllocation({
      amount: "0",
      receivedOn: "2026-10-15",
      today: "2026-10-21",
      method: "cash",
      obligations,
      allocations: [],
    })).toMatch(/greater than zero/);
    expect(validateAllocation({
      amount: "10",
      receivedOn: "2026-02-31",
      today: "2026-10-21",
      method: "cash",
      obligations,
      allocations: [{ obligationId: "balance", amount: "10" }],
    })).toMatch(/valid date/);
  });
});

describe("subscription completion date", () => {
  it("uses received dates, including a backdated receipt, and does not use the entry time", () => {
    expect(completionReceivedOn([
      { id: "later-entry", receivedOn: "2026-10-01", recordedAt: "2026-10-21T09:00:00Z", amount: "1000.00" },
      { id: "backdated", receivedOn: "2026-09-15", recordedAt: "2026-10-21T10:00:00Z", amount: "950.00" },
    ], "1950.00")).toBe("2026-10-01");
    expect(completionReceivedOn([
      { id: "full", receivedOn: "2026-09-15", recordedAt: "2026-10-21T12:00:00Z", amount: "1950.00" },
    ], "1950.00")).toBe("2026-09-15");
    expect(completionReceivedOn([
      { id: "partial", receivedOn: "2026-10-01", recordedAt: "2026-10-01T09:00:00Z", amount: "1000.00" },
    ], "1950.00")).toBeNull();
  });
});

describe("activation preview before a receipt is posted", () => {
  const partial = [{ id: "first", receivedOn: "2026-11-01", recordedAt: "2026-11-02T00:00:00Z", amount: "1000.00" }];
  const rejected = [".", "", "   ", "1.", "abc", "-5", "1.001", "0", "0.00"];

  it.each(rejected)("does not throw or preview an activation for %j", (pendingAmount) => {
    expect(pendingActivationDate({
      existing: partial,
      pendingAmount,
      required: "1950.00",
      receivedOn: "2026-11-15",
    })).toBeNull();
  });

  it("keeps a valid partial payment from activating", () => {
    expect(pendingActivationDate({
      existing: [],
      pendingAmount: "1000.00",
      required: "1950.00",
      receivedOn: "2026-11-01",
    })).toBeNull();
  });

  it("uses the received date that completes a valid payment", () => {
    expect(pendingActivationDate({
      existing: partial,
      pendingAmount: "950",
      required: "1950.00",
      receivedOn: "2026-11-15",
    })).toBe("2026-11-15");
    expect(pendingActivationDate({
      existing: [],
      pendingAmount: "1950.00",
      required: "1950.00",
      receivedOn: "2026-11-15",
    })).toBe("2026-11-15");
    expect(pendingActivationDate({
      existing: [{ id: "later", receivedOn: "2026-11-15", recordedAt: "2026-11-20T00:00:00Z", amount: "1000.00" }],
      pendingAmount: "950.00",
      required: "1950.00",
      receivedOn: "2026-11-01",
    })).toBe("2026-11-15");
  });
});

describe("due timing", () => {
  it("does not call an unresolved date overdue", () => {
    expect(dueScheduleLabel({
      dueTiming: "awaiting_event",
      dueDate: null,
      awaitingLabel: "Awaiting delivery date",
      dueFormula: "one calendar month after delivery",
      dueState: "unscheduled",
    })).toEqual({ schedule: "Awaiting delivery date", timing: null });
    expect(dueScheduleLabel({
      dueTiming: "deadline_unset",
      dueDate: null,
      awaitingLabel: "",
      dueFormula: "before shipment",
      dueState: "unscheduled",
    })).toEqual({ schedule: "Deadline to be set", timing: null });
    expect(dueScheduleLabel({
      dueTiming: "fixed",
      dueDate: "2026-03-01",
      awaitingLabel: "",
      dueFormula: "1 March 2026",
      dueState: "overdue",
    }).timing).toBe("Overdue");
  });
});
