/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiVersion } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tables = vi.hoisted(() => ({
  selects: [] as { table: string; columns: string }[],
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from(table: string) {
      const payload = table === "payment_plans"
        ? { data: { id: "plan-1", pi_id: "pi-1", source_version_id: "version-1", currency: "USD", agreed_total: "100.00", schema_version: 1, started_at: "2026-10-01T00:00:00Z" }, error: null }
        : table === "payment_receipts"
          ? {
            data: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                amount: "25.00",
                currency: "USD",
                received_on: "2026-10-01",
                method: "bank_transfer",
                reference: "BANK-9",
                note: null,
                recorded_at: "2026-10-01T08:00:00Z",
                recorded_by: "user-1",
                reversed_at: null,
                reversed_by: null,
                reversal_reason: null,
                payment_receipt_reviews: {
                  status: "needs_clarification",
                  internal_reference: "FIN-9",
                  note: "Which account?",
                  reviewed_by: "user-2",
                  reviewed_at: "2026-10-02T08:00:00Z",
                  ever_verified: false,
                  version: 1,
                },
              },
              {
                id: "22222222-2222-4222-8222-222222222222",
                amount: "10.00",
                currency: "USD",
                received_on: "2026-10-03",
                method: "cash",
                reference: "BANK-8",
                note: null,
                recorded_at: "2026-10-03T08:00:00Z",
                recorded_by: "user-1",
                reversed_at: "2026-10-04T08:00:00Z",
                reversed_by: "user-1",
                reversal_reason: "Duplicate",
                payment_receipt_reviews: {
                  status: "verified",
                  internal_reference: "FIN-8",
                  note: null,
                  reviewed_by: "user-2",
                  reviewed_at: "2026-10-03T09:00:00Z",
                  ever_verified: true,
                  version: 1,
                },
              },
              {
                id: "33333333-3333-4333-8333-333333333333",
                amount: "5.00",
                currency: "USD",
                received_on: "2026-10-05",
                method: "cheque",
                reference: null,
                note: null,
                recorded_at: "2026-10-05T08:00:00Z",
                recorded_by: "user-1",
                reversed_at: null,
                reversed_by: null,
                reversal_reason: null,
                payment_receipt_reviews: null,
              },
            ],
            error: null,
          }
        : table === "profiles"
          ? { data: [{ id: "user-1", full_name: "Ada" }, { id: "user-2", full_name: "Finance" }], error: null }
          : { data: [], error: null };
      const chain = {
        select(columns: string) {
          tables.selects.push({ table, columns });
          return chain;
        },
        eq() { return chain; },
        order() { return chain; },
        in() { return chain; },
        maybeSingle() { return Promise.resolve(payload); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(payload).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

import { PaymentTrackingSection } from "./PaymentTrackingSection";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

const version = {
  id: "version-1",
  pi_id: "pi-1",
  revision: 1,
  pi_number: "AE26100",
  generated_by: "user-1",
  generated_at: "2026-10-01T00:00:00Z",
  snapshot: {
    display_number: "AE26100-R1",
    currency: "USD",
    adjustments: { grand_total: "100.00" },
    payment: { schema_version: 1, grand_total: "100.00" },
  },
  pdf_status: "issued",
  pdf_path: null,
  layout_version: "uae-v2",
  grand_total: "100.00",
} as PiVersion;

describe("PI receipt review labels", () => {
  afterEach(() => {
    for (const view of mounted.splice(0)) {
      act(() => view.root.unmount());
      view.container.remove();
    }
  });

  it("shows each receipt's finance review from one joined receipt query", async () => {
    tables.selects.length = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PaymentTrackingSection piId="pi-1" versions={[version]} canManage={false} canReverse={false} canWaive={false} />
        </MemoryRouter>,
      );
    });
    const receiptSelects = tables.selects.filter((item) => item.table === "payment_receipts");
    expect(receiptSelects).toHaveLength(1);
    expect(receiptSelects[0]?.columns).toContain("payment_receipt_reviews");
    expect(container.textContent).toContain("BANK-9");
    expect(container.textContent).toContain("Needs clarification");
    expect(container.textContent).toContain("Finance reference FIN-9");
    expect(container.textContent).toContain("Clarification: Which account?");
    expect(container.textContent).toContain("Reversed · previously verified");
    expect(container.textContent).toContain("Finance reference FIN-8");
    expect(container.textContent).toContain("Awaiting finance review");
    const history = container.querySelector('a[href="/payments?tab=received&rid=11111111-1111-4111-8111-111111111111"]');
    expect(history?.textContent).toBe("Review history");
    const bankLine = [...container.querySelectorAll("p")].find((node) => node.textContent?.includes("BANK-9"));
    expect(bankLine?.textContent).not.toContain("FIN-9");
  });
});
