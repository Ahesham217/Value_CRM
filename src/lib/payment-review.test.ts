import { describe, expect, it } from "vitest";
import { parsePaymentLocation } from "./reporting";
import {
  compactReviewLabel,
  defaultReceivedFilter,
  parseReceivedLocation,
  readReceiptReview,
  readReceivedRegister,
  receiptReviewDisplay,
  reviewStatusLabel,
  validateReviewAction,
  withReceivedLocation,
} from "./payment-review";

describe("received payment location", () => {
  it("keeps due-payment parameters separate from the receipt register", () => {
    const params = new URLSearchParams("view=overdue&q=acme&currency=USD&due_from=2026-10-01&tab=received&review=verified&rq=bank&rcurrency=EUR&rfrom=2026-10-02&rto=2026-10-09&rpage=3&rid=11111111-1111-4111-8111-111111111111");
    const due = parsePaymentLocation(params);
    const received = parseReceivedLocation(params, false);
    expect(due).toMatchObject({ view: "overdue", search: "acme", currency: "USD", dueFrom: "2026-10-01", page: 1 });
    expect(received).toMatchObject({
      status: "verified",
      search: "bank",
      currency: "EUR",
      receivedFrom: "2026-10-02",
      receivedTo: "2026-10-09",
      page: 3,
      receiptId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("defaults finance reviewers to awaiting review and other readers to all non-reversed receipts", () => {
    expect(defaultReceivedFilter(true)).toBe("awaiting");
    expect(defaultReceivedFilter(false)).toBe("open");
    expect(parseReceivedLocation(new URLSearchParams("tab=received"), true).status).toBe("awaiting");
    expect(parseReceivedLocation(new URLSearchParams("tab=received"), false).status).toBe("open");
    expect(parseReceivedLocation(new URLSearchParams("tab=received&review=nope"), true).status).toBe("awaiting");
  });

  it("writes receipt filters without dropping the due register", () => {
    const current = new URLSearchParams("view=outstanding&currency=USD&q=old");
    const next = withReceivedLocation(current, {
      status: "clarification",
      search: "PI-9",
      currency: "EGP",
      receivedFrom: "2026-10-01",
      receivedTo: "",
      page: 2,
      receiptId: "22222222-2222-4222-8222-222222222222",
    });
    expect(next.get("view")).toBe("outstanding");
    expect(next.get("currency")).toBe("USD");
    expect(next.get("q")).toBe("old");
    expect(next.get("tab")).toBe("received");
    expect(next.get("review")).toBe("clarification");
    expect(next.get("rq")).toBe("PI-9");
    expect(next.get("rcurrency")).toBe("EGP");
    expect(next.get("rfrom")).toBe("2026-10-01");
    expect(next.get("rto")).toBeNull();
    expect(next.get("rpage")).toBe("2");
    expect(next.get("rid")).toBe("22222222-2222-4222-8222-222222222222");
  });
});

describe("review labels and validation", () => {
  it("labels a missing review as awaiting and a reversed verification as historical", () => {
    expect(receiptReviewDisplay({ reversed: false, status: null, everVerified: false })).toBe("awaiting_review");
    expect(compactReviewLabel("awaiting_review")).toBe("Awaiting finance review");
    expect(reviewStatusLabel("needs_clarification")).toBe("Needs clarification");
    expect(compactReviewLabel("verified")).toBe("Finance verified");
    expect(receiptReviewDisplay({ reversed: true, status: "verified", everVerified: true })).toBe("reversed_previously_verified");
    expect(reviewStatusLabel("reversed_previously_verified")).toBe("Reversed · previously verified");
    expect(receiptReviewDisplay({ reversed: true, status: "awaiting_review", everVerified: false })).toBe("reversed");
    expect(receiptReviewDisplay({ reversed: false, status: "awaiting_review", everVerified: true })).toBe("awaiting_review");
  });

  it("requires a reference to verify and a reason to clarify or reopen", () => {
    expect(validateReviewAction("verify", { internalReference: "  ", note: "" })).toBe("Enter the internal payment reference.");
    expect(validateReviewAction("verify", { internalReference: "VCH-1", note: "" })).toBeNull();
    expect(validateReviewAction("verify", { internalReference: "x".repeat(81), note: "" })).toMatch(/80 characters/);
    expect(validateReviewAction("verify", { internalReference: "VCH-1", note: "n".repeat(401) })).toMatch(/400 characters/);
    expect(validateReviewAction("clarify", { internalReference: "", note: "  " })).toBe("Enter a reason for the clarification.");
    expect(validateReviewAction("reopen", { internalReference: "", note: "" })).toBe("Enter a reason for reopening this review.");
    expect(validateReviewAction("clarify", { internalReference: "", note: "Which bank?" })).toBeNull();
  });
});

describe("receipt review readers", () => {
  it("reads one register row and a receipt that has not been reviewed", () => {
    const register = readReceivedRegister({
      status: "awaiting",
      count: 1,
      rows: [{
        id: "11111111-1111-4111-8111-111111111111",
        received_on: "2026-10-01",
        client_name: "Acme",
        pi_id: "22222222-2222-4222-8222-222222222222",
        pi_number: "AE26100",
        tracked_revision: 0,
        tracked_display_number: "AE26100",
        amount: "25.00",
        currency: "USD",
        method: "bank_transfer",
        reference: "BANK-1",
        internal_reference: null,
        recorded_by: "33333333-3333-4333-8333-333333333333",
        recorded_by_name: "Ada",
        review_status: "awaiting_review",
        reviewed_by: null,
        reviewed_at: null,
        version: 0,
      }],
    });
    expect(register.count).toBe(1);
    expect(register.rows[0]).toMatchObject({ reference: "BANK-1", internalReference: null, reviewStatus: "awaiting_review", version: 0 });

    const detail = readReceiptReview({
      receipt: {
        id: "11111111-1111-4111-8111-111111111111",
        plan_id: "44444444-4444-4444-8444-444444444444",
        received_on: "2026-10-01",
        amount: "25.00",
        currency: "USD",
        method: "bank_transfer",
        reference: "BANK-1",
        note: null,
        recorded_by: "33333333-3333-4333-8333-333333333333",
        recorded_by_name: "Ada",
        recorded_at: "2026-10-01T10:00:00Z",
        reversed_at: null,
        reversed_by: null,
        reversed_by_name: null,
        reversal_reason: null,
      },
      allocations: [{ obligation_id: "55555555-5555-4555-8555-555555555555", label: "Advance", amount: "25.00" }],
      source: {
        pi_id: "22222222-2222-4222-8222-222222222222",
        pi_number: "AE26100",
        tracked_revision: 0,
        tracked_display_number: "AE26100",
        source_version_id: "66666666-6666-4666-8666-666666666666",
        client_name: "Acme",
        currency: "USD",
        agreed_total: "100.00",
      },
      review: {
        status: "awaiting_review",
        display_status: "awaiting_review",
        internal_reference: null,
        note: null,
        reviewed_by: null,
        reviewed_by_name: null,
        reviewed_at: null,
        version: 0,
        ever_verified: false,
      },
      history: [],
      can_review: true,
    });
    expect(detail.review.version).toBe(0);
    expect(detail.allocations).toHaveLength(1);
    expect(detail.canReview).toBe(true);
  });
});
