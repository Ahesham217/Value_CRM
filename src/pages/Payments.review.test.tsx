/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS } from "../lib/useDebouncedValue";
import type { Profile } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECEIPT = "11111111-1111-4111-8111-111111111111";

const harness = vi.hoisted(() => ({
  profile: null as Profile | null,
  detail: null as Record<string, unknown> | null,
  reviewData: null as Record<string, unknown> | null,
  reviewError: null as { message: string } | null,
  rpc: vi.fn(),
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ profile: harness.profile }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => harness.rpc(...args),
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
  },
}));

import { PaymentsPage } from "./Payments";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    full_name: "Ada",
    phone: "",
    is_active: true,
    is_admin: false,
    is_salesperson: true,
    pi_visibility: "associated",
    can_edit_drafts: true,
    can_generate_pis: false,
    can_manage_clients: false,
    can_manage_vendors: false,
    can_manage_products: false,
    can_view_purchase_prices: false,
    can_manage_payments: false,
    can_reverse_payments: false,
    can_activate_zero_subscriptions: false,
    can_review_payments: true,
    ...overrides,
  };
}

function receiptJson(review: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    receipt: {
      id: RECEIPT,
      plan_id: "44444444-4444-4444-8444-444444444444",
      received_on: "2026-10-01",
      amount: "25.00",
      currency: "USD",
      method: "bank_transfer",
      reference: "BANK-1",
      note: "Customer note",
      recorded_by: "33333333-3333-4333-8333-333333333333",
      recorded_by_name: "Sam",
      recorded_at: "2026-10-01T08:00:00Z",
      reversed_at: null,
      reversed_by: null,
      reversed_by_name: null,
      reversal_reason: null,
      ...(extra.receipt as Record<string, unknown> | undefined),
    },
    allocations: [
      { obligation_id: "55555555-5555-4555-8555-555555555551", label: "Advance", amount: "10.00" },
      { obligation_id: "55555555-5555-4555-8555-555555555552", label: "Balance", amount: "15.00" },
    ],
    source: {
      pi_id: "22222222-2222-4222-8222-222222222222",
      pi_number: "AE26100",
      tracked_revision: 1,
      tracked_display_number: "AE26100-R1",
      source_version_id: "66666666-6666-4666-8666-666666666666",
      client_name: "Acme",
      currency: "USD",
      agreed_total: "100.00",
    },
    review,
    history: extra.history ?? [],
    can_review: extra.can_review ?? true,
    ...("already_applied" in extra ? { already_applied: extra.already_applied, action: extra.action } : {}),
  };
}

function awaitingReview() {
  return {
    status: "awaiting_review",
    display_status: "awaiting_review",
    internal_reference: null,
    note: null,
    reviewed_by: null,
    reviewed_by_name: null,
    reviewed_at: null,
    version: 0,
    ever_verified: false,
  };
}

function registerRow() {
  return {
    id: RECEIPT,
    received_on: "2026-10-01",
    client_name: "Acme",
    pi_id: "22222222-2222-4222-8222-222222222222",
    pi_number: "AE26100",
    tracked_revision: 1,
    tracked_display_number: "AE26100-R1",
    amount: "25.00",
    currency: "USD",
    method: "bank_transfer",
    reference: "BANK-1",
    internal_reference: null,
    recorded_by: "33333333-3333-4333-8333-333333333333",
    recorded_by_name: "Sam",
    review_status: "awaiting_review",
    reviewed_by: null,
    reviewed_at: null,
    version: 0,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/payments?tab=received&review=verified&rq=next")}>External search</button>
      <button type="button" onClick={() => navigate(-1)}>History back</button>
    </>
  );
}

function renderPayments(entry: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <PaymentsPage />
        <LocationProbe />
        <HistoryControls />
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

function paramsOf(container: ParentNode) {
  const href = container.querySelector("[data-testid=location]")?.textContent ?? "";
  return new URLSearchParams(href.split("?")[1] ?? "");
}

function calls(name: string) {
  return harness.rpc.mock.calls.filter((call) => call[0] === name).map((call) => call[1] as Record<string, unknown>);
}

function clickButton(container: ParentNode, label: string) {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing ${label}`);
  act(() => {
    found.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function clickLink(container: ParentNode, label: string) {
  const found = [...container.querySelectorAll("a")].find((node) => node.textContent?.trim() === label);
  if (!(found instanceof HTMLAnchorElement)) throw new Error(`Missing ${label}`);
  act(() => {
    found.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

function typeControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Value setter missing");
  act(() => {
    setter.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function labeledControl(container: ParentNode, label: string) {
  const found = [...container.querySelectorAll("label")].find((node) => node.textContent?.includes(label));
  const control = found?.querySelector("input, textarea");
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) throw new Error(`Missing ${label}`);
  return control;
}

describe("Payments finance review", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.profile = profile();
    harness.detail = receiptJson(awaitingReview());
    harness.reviewData = receiptJson({
      status: "verified",
      display_status: "verified",
      internal_reference: "VCH-9",
      note: null,
      reviewed_by: "user-1",
      reviewed_by_name: "Ada",
      reviewed_at: "2026-11-03T10:15:00Z",
      version: 1,
      ever_verified: true,
    }, { already_applied: false, action: "verify", history: [] });
    harness.reviewError = null;
    harness.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "payment_register") {
        return Promise.resolve({
          data: { today: "2026-11-03", view: args.p_view ?? "outstanding", count: 0, totals: [], rows: [], leads: [] },
          error: null,
        });
      }
      if (name === "received_payment_register") {
        return Promise.resolve({
          data: { status: args.p_status, count: 40, rows: [registerRow()] },
          error: null,
        });
      }
      if (name === "received_payment_detail") {
        return Promise.resolve({ data: harness.detail, error: null });
      }
      if (name === "review_payment_receipt") {
        return Promise.resolve({ data: harness.reviewError ? null : harness.reviewData, error: harness.reviewError });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected ${name}` } });
    });
  });

  afterEach(() => {
    for (const view of mounted.splice(0)) {
      act(() => view.root.unmount());
      view.container.remove();
    }
    vi.useRealTimers();
  });

  it("keeps due payments as the default and preserves their filters on the received tab", async () => {
    const container = renderPayments("/payments?view=overdue&currency=USD&q=acme");
    await flush();
    expect(container.querySelector("[aria-selected=true]")?.textContent).toBe("Due payments");
    expect(calls("payment_register").at(-1)).toMatchObject({ p_view: "overdue", p_currency: "USD", p_search: "acme" });
    expect(calls("received_payment_register")).toHaveLength(0);

    clickButton(container, "Received payments");
    await flush();
    expect(container.querySelector("[aria-selected=true]")?.textContent).toBe("Received payments");
    expect(paramsOf(container).get("tab")).toBe("received");
    expect(paramsOf(container).get("view")).toBe("overdue");
    expect(paramsOf(container).get("currency")).toBe("USD");
    expect(paramsOf(container).get("q")).toBe("acme");
    expect(paramsOf(container).get("review")).toBe("awaiting");
    expect(calls("received_payment_register").at(-1)).toMatchObject({ p_status: "awaiting", p_search: null });

    clickButton(container, "Due payments");
    await flush();
    expect(paramsOf(container).get("tab")).toBeNull();
    expect(paramsOf(container).get("view")).toBe("overdue");
    expect(paramsOf(container).get("currency")).toBe("USD");
    expect(calls("payment_register").at(-1)).toMatchObject({ p_view: "overdue", p_currency: "USD" });
  });

  it("opens all non-reversed receipts for someone who cannot review", async () => {
    harness.profile = profile({ can_review_payments: false });
    const container = renderPayments("/payments?tab=received");
    await flush();
    expect(paramsOf(container).get("review")).toBe("open");
    expect(calls("received_payment_register").at(-1)).toMatchObject({ p_status: "open" });
  });

  it("debounces received search, resets it, and follows history", async () => {
    const container = renderPayments("/payments?tab=received&review=awaiting&rq=old&rcurrency=USD&rpage=2");
    await flush();
    const search = labeledControl(container, "Search PI, client, or reference");
    expect(search).toBeInstanceOf(HTMLInputElement);
    expect((search as HTMLInputElement).value).toBe("old");
    expect(calls("received_payment_register").at(-1)).toMatchObject({ p_search: "old", p_currency: "USD", p_offset: 20 });

    typeControl(search, "draft");
    await flush(SEARCH_DEBOUNCE_MS - 1);
    expect(paramsOf(container).get("rq")).toBe("old");
    clickButton(container, "Reset filters");
    await flush();
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(paramsOf(container).get("rq")).toBeNull();
    expect(paramsOf(container).get("rcurrency")).toBeNull();
    expect(paramsOf(container).get("review")).toBe("awaiting");
    expect((labeledControl(container, "Search PI, client, or reference") as HTMLInputElement).value).toBe("");
    expect(calls("received_payment_register").some((args) => args.p_search === "draft" || args.p_search === "old" && args.p_currency === null)).toBe(false);

    typeControl(labeledControl(container, "Search PI, client, or reference"), "next-typed");
    await flush(100);
    clickButton(container, "External search");
    await flush();
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(paramsOf(container).get("rq")).toBe("next");
    expect(paramsOf(container).get("review")).toBe("verified");
    expect(calls("received_payment_register").some((args) => args.p_search === "next-typed")).toBe(false);
    clickButton(container, "History back");
    await flush();
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(paramsOf(container).get("review")).toBe("awaiting");
    expect((labeledControl(container, "Search PI, client, or reference") as HTMLInputElement).value).toBe("");
  });

  it("filters the queue from the address and shows one receipt with both references", async () => {
    const container = renderPayments(`/payments?tab=received&review=awaiting&rid=${RECEIPT}`);
    await flush();
    expect(container.textContent).toContain("BANK-1");
    expect(container.textContent).toContain("Advance");
    expect(container.textContent).toContain("Balance");
    clickLink(container, "Needs clarification");
    await flush();
    expect(paramsOf(container).get("review")).toBe("clarification");
    expect(paramsOf(container).get("rid")).toBe(RECEIPT);
    expect(calls("received_payment_register").at(-1)).toMatchObject({ p_status: "clarification", p_offset: 0 });
    const currency = container.querySelector("[aria-label='Receipt currency']");
    if (!(currency instanceof HTMLSelectElement)) throw new Error("Currency missing");
    typeControl(currency, "EUR");
    await flush();
    expect(paramsOf(container).get("rcurrency")).toBe("EUR");
    expect(calls("received_payment_register").at(-1)).toMatchObject({ p_currency: "EUR" });
  });

  it("verifies, asks for clarification, and reopens without sending a reviewer id", async () => {
    const container = renderPayments(`/payments?tab=received&review=awaiting&rid=${RECEIPT}`);
    await flush();
    clickButton(container, "Verify payment");
    await flush();
    expect(container.textContent).toContain("Enter the internal payment reference.");
    expect(calls("review_payment_receipt")).toHaveLength(0);

    typeControl(labeledControl(container, "Internal payment reference"), "VCH-9");
    const pending: { resolve: ((value: { data: unknown; error: { message: string } | null }) => void) | null } = { resolve: null };
    harness.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "review_payment_receipt") {
        return new Promise((resolve) => {
          pending.resolve = resolve;
        });
      }
      if (name === "received_payment_register") {
        return Promise.resolve({ data: { status: args.p_status, count: 1, rows: [registerRow()] }, error: null });
      }
      if (name === "received_payment_detail") return Promise.resolve({ data: harness.detail, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    clickButton(container, "Verify payment");
    await flush();
    expect(container.querySelector("button") && [...container.querySelectorAll("button")].find((node) => node.textContent === "Saving…")).toBeTruthy();
    expect((container.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(true);
    pending.resolve?.({ data: harness.reviewData, error: null });
    await flush();
    const payload = calls("review_payment_receipt").at(-1);
    expect(payload).toMatchObject({
      p_receipt_id: RECEIPT,
      p_action: "verify",
      p_expected_version: 0,
    });
    expect(payload?.p_payload).toMatchObject({ internal_reference: "VCH-9", note: "" });
    expect(payload?.p_payload).not.toHaveProperty("reviewed_by");
    expect(container.textContent).toContain("Payment verified");
    expect(container.textContent).toContain("Reopen review");
    expect([...container.querySelectorAll("button")].some((node) => node.textContent === "Verify payment")).toBe(false);

    harness.detail = receiptJson({
      status: "needs_clarification",
      display_status: "needs_clarification",
      internal_reference: null,
      note: "Which bank?",
      reviewed_by: "user-1",
      reviewed_by_name: "Ada",
      reviewed_at: "2026-11-03T10:00:00Z",
      version: 2,
      ever_verified: false,
    });
    const clarifyContainer = renderPayments(`/payments?tab=received&review=clarification&rid=${RECEIPT}`);
    await flush();
    typeControl(labeledControl(clarifyContainer, "Clarification reason"), "");
    clickButton(clarifyContainer, "Needs clarification");
    await flush();
    expect(clarifyContainer.textContent).toContain("Enter a reason for the clarification.");
    typeControl(labeledControl(clarifyContainer, "Clarification reason"), "Which bank?");
    harness.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "review_payment_receipt") {
        return Promise.resolve({
          data: receiptJson(harness.detail?.review as Record<string, unknown>, { already_applied: false, action: "clarify" }),
          error: null,
        });
      }
      if (name === "received_payment_register") return Promise.resolve({ data: { status: args.p_status, count: 1, rows: [registerRow()] }, error: null });
      if (name === "received_payment_detail") return Promise.resolve({ data: harness.detail, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    clickButton(clarifyContainer, "Needs clarification");
    await flush();
    expect(calls("review_payment_receipt").at(-1)).toMatchObject({ p_action: "clarify", p_expected_version: 2 });
    expect(clarifyContainer.textContent).toContain("Marked as needing clarification");

    harness.detail = receiptJson({
      status: "verified",
      display_status: "verified",
      internal_reference: "VCH-9",
      note: "Checked",
      reviewed_by: "user-1",
      reviewed_by_name: "Ada",
      reviewed_at: "2026-11-03T10:15:00Z",
      version: 3,
      ever_verified: true,
    });
    const reopenContainer = renderPayments(`/payments?tab=received&review=verified&rid=${RECEIPT}`);
    await flush();
    clickButton(reopenContainer, "Reopen review");
    await flush();
    expect(reopenContainer.textContent).toContain("Enter a reason for reopening this review.");
    typeControl(labeledControl(reopenContainer, "Reason for reopening"), "Wrong voucher");
    harness.reviewData = receiptJson({
      ...awaitingReview(),
      version: 4,
      ever_verified: true,
    }, { already_applied: false, action: "reopen" });
    harness.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "review_payment_receipt") return Promise.resolve({ data: harness.reviewData, error: null });
      if (name === "received_payment_register") return Promise.resolve({ data: { status: args.p_status, count: 1, rows: [registerRow()] }, error: null });
      if (name === "received_payment_detail") return Promise.resolve({ data: harness.detail, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    clickButton(reopenContainer, "Reopen review");
    await flush();
    expect(calls("review_payment_receipt").at(-1)).toMatchObject({
      p_action: "reopen",
      p_expected_version: 3,
      p_payload: expect.objectContaining({ note: "Wrong voucher" }),
    });
    expect(reopenContainer.textContent).toContain("Review reopened");
  });

  it("hides finance actions without permission and keeps a reversed verification historical", async () => {
    harness.detail = receiptJson(awaitingReview(), { can_review: false });
    const container = renderPayments(`/payments?tab=received&review=open&rid=${RECEIPT}`);
    await flush();
    expect([...container.querySelectorAll("button")].some((node) => node.textContent === "Verify payment")).toBe(false);
    expect(container.textContent).toContain("Review received payments permission is required");

    harness.detail = receiptJson({
      status: "verified",
      display_status: "reversed_previously_verified",
      internal_reference: "VCH-9",
      note: null,
      reviewed_by: "user-1",
      reviewed_by_name: "Ada",
      reviewed_at: "2026-11-03T10:15:00Z",
      version: 1,
      ever_verified: true,
    }, {
      can_review: true,
      receipt: { reversed_at: "2026-11-03T11:00:00Z", reversed_by: "user-3", reversed_by_name: "Rami", reversal_reason: "Duplicate" },
    });
    const reversed = renderPayments(`/payments?tab=received&review=reversed&rid=${RECEIPT}`);
    await flush();
    expect(reversed.textContent).toContain("Reversed · previously verified");
    expect(reversed.textContent).toContain("VCH-9");
    expect(reversed.textContent).toContain("BANK-1");
    expect([...reversed.querySelectorAll("button")].some((node) => node.textContent === "Verify payment" || node.textContent === "Reopen review")).toBe(false);
  });

  it("keeps typed text when the saved review changed or the server fails", async () => {
    const container = renderPayments(`/payments?tab=received&review=awaiting&rid=${RECEIPT}`);
    await flush();
    typeControl(labeledControl(container, "Internal payment reference"), "VCH-KEPT");
    harness.reviewError = { message: "This review was updated by someone else. Reload the receipt before saving again." };
    clickButton(container, "Verify payment");
    await flush();
    expect(container.textContent).toContain("updated by someone else");
    expect(container.textContent).toContain("The text you typed is still here.");
    expect((labeledControl(container, "Internal payment reference") as HTMLInputElement).value).toBe("VCH-KEPT");
    const before = calls("received_payment_detail").length;
    clickButton(container, "Reload receipt");
    await flush();
    expect(calls("received_payment_detail").length).toBe(before + 1);
    expect((labeledControl(container, "Internal payment reference") as HTMLInputElement).value).toBe("VCH-KEPT");

    harness.reviewError = { message: "The database is unavailable." };
    clickButton(container, "Verify payment");
    await flush();
    expect(container.textContent).toContain("The database is unavailable.");
    expect((labeledControl(container, "Internal payment reference") as HTMLInputElement).value).toBe("VCH-KEPT");
    const verify = [...container.querySelectorAll("button")].find((node) => node.textContent === "Verify payment");
    expect(verify).toBeInstanceOf(HTMLButtonElement);
    expect((verify as HTMLButtonElement).disabled).toBe(false);
  });
});
