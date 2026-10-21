import { describe, expect, it } from "vitest";
import {
  LEGACY_MODEL_MATCH,
  PI_HISTORY_PRICE_NOTE,
  PI_HISTORY_STATUS_NOTE,
  PI_HISTORY_SUBTITLE,
  PI_HISTORY_TITLE,
  historyDiscountDetail,
  historyLegacyDetail,
  historySubscriptionDetail,
  historyRowHref,
  historySourceText,
  parseProductHistory,
  persistentProductId,
  productHistoryFilterChips,
  quotedQuantityLabel,
  quotedUnitPriceLabel,
  type ProductHistoryRow,
} from "./product-history";

function row(overrides: Partial<ProductHistoryRow> = {}): ProductHistoryRow {
  return {
    row_id: "latest_issued:version:line",
    pi_id: "pi-1",
    source: "latest_issued",
    pi_number: "EG-2026-00018",
    revision: 1,
    revision_label: "R1",
    display_number: "EG-2026-00018-R1",
    client_name: "Atlas Example",
    pi_date: "2026-10-19",
    quantity: "2",
    unit: "licenses",
    unit_price: "1850.00",
    currency: "USD",
    pi_status: "sent",
    model_code: "VT-100",
    description: "Saved line description",
    position: 1,
    match_kind: "product_id",
    discount_on_pi: false,
    discount_type: "none",
    discount_value: null,
    discount_amount: null,
    current_subscription_year: null,
    commitment_years: null,
    ...overrides,
  };
}

describe("product PI history presentation", () => {
  it("uses the history headings and keeps quoted prices distinct from invoice discounts", () => {
    expect(PI_HISTORY_TITLE).toBe("PI history");
    expect(PI_HISTORY_SUBTITLE).toBe("Where this product has been quoted");
    expect(PI_HISTORY_PRICE_NOTE).toContain("before invoice-wide discounts, tax and charges");
    expect(PI_HISTORY_PRICE_NOTE).toContain("saved price of the year included");
    expect(PI_HISTORY_STATUS_NOTE).toContain("invoice's current status");
    expect(PI_HISTORY_PRICE_NOTE.toLowerCase()).not.toContain("illustrative");
  });

  it("shows an explicit zero and a missing price differently, without converting currency", () => {
    expect(quotedUnitPriceLabel("0")).toBe("0.00");
    expect(quotedUnitPriceLabel("0.00")).toBe("0.00");
    expect(quotedUnitPriceLabel(null)).toBe("Not priced");
    expect(quotedUnitPriceLabel("")).toBe("Not priced");
    expect(quotedUnitPriceLabel("1850")).toBe("1,850.00");
    expect(quotedUnitPriceLabel("10.50")).toBe("10.50");
    expect(quotedQuantityLabel("2", "licenses")).toBe("2 licenses");
    expect(quotedQuantityLabel("1.5000", "set")).toBe("1.5 set");
    expect(historySubscriptionDetail(row({ current_subscription_year: "1", commitment_years: "3" }))).toContain("Year 1 of a 3-year commitment");
    expect(historySubscriptionDetail(row())).toBeNull();
  });

  it("distinguishes latest issued, older revisions, new drafts, and revision drafts", () => {
    expect(historySourceText(row())).toEqual({ title: "EG-2026-00018-R1", detail: "Latest issued" });
    expect(historySourceText(row({ source: "older_revision", display_number: "EG-2026-00018" }))).toEqual({
      title: "EG-2026-00018",
      detail: "Older revision",
    });
    expect(historySourceText(row({ source: "initial_draft", display_number: null, pi_number: null }))).toEqual({
      title: "Draft",
      detail: "New draft",
    });
    expect(historySourceText(row({ source: "revision_draft", display_number: null }))).toEqual({
      title: "Draft",
      detail: "Revision draft · EG-2026-00018",
    });
  });

  it("links drafts to the draft route and issued rows to the PI", () => {
    expect(historyRowHref("latest_issued", "pi-1", true)).toBe("/pis/pi-1");
    expect(historyRowHref("older_revision", "pi-1", true)).toBe("/pis/pi-1");
    expect(historyRowHref("initial_draft", "pi-1", true)).toBe("/pis/pi-1/edit");
    expect(historyRowHref("revision_draft", "pi-1", true)).toBe("/pis/pi-1/edit");
    expect(historyRowHref("revision_draft", "pi-1", false)).toBe("/pis/pi-1");
  });

  it("describes an invoice-wide discount without changing the quoted unit price", () => {
    const priced = row({ unit_price: "100.00", discount_on_pi: true, discount_type: "percent", discount_value: "10", discount_amount: "30.00" });
    expect(quotedUnitPriceLabel(priced.unit_price)).toBe("100.00");
    const detail = historyDiscountDetail(priced);
    expect(detail).toContain("Invoice-wide discount: 10%");
    expect(detail).toContain("USD 30.00");
    expect(detail).toContain("before this discount");
    expect(detail).not.toContain("90");
    expect(historyDiscountDetail(row({ discount_on_pi: true, discount_type: "fixed", discount_value: "5", currency: "EGP" }))).toBe(
      "Invoice-wide fixed discount: EGP 5.00. The quoted unit price is before this discount.",
    );
    expect(historyDiscountDetail(row())).toBeNull();
  });

  it("explains legacy model matches and stays quiet for stored product ids", () => {
    expect(historyLegacyDetail("legacy_model")).toBe(LEGACY_MODEL_MATCH);
    expect(historyLegacyDetail("product_id")).toBeNull();
    expect(LEGACY_MODEL_MATCH).toContain("does not store a product id");
    expect(LEGACY_MODEL_MATCH).toContain("Renaming the catalogue model");
  });

  it("builds removable filter chips and ignores an unsaved product", () => {
    expect(productHistoryFilterChips({ client: "Nile", currency: "EUR", status: "accepted" })).toEqual([
      { id: "client", label: "Client: Nile" },
      { id: "currency", label: "Currency: EUR" },
      { id: "status", label: "PI status: Accepted" },
    ]);
    expect(productHistoryFilterChips({ client: "", currency: "", status: "" })).toEqual([]);
    expect(persistentProductId(undefined)).toBeNull();
    expect(persistentProductId("new")).toBeNull();
    expect(persistentProductId("product-1")).toBe("product-1");
  });

  it("parses separate rows, counts, and options without requiring purchase prices", () => {
    const page = parseProductHistory({
      total: 2,
      rows: [
        row({ unit_price: "0", currency: "EGP" }),
        row({
          row_id: "initial_draft:draft:line-2",
          source: "initial_draft",
          unit_price: null,
          currency: "EUR",
          pi_status: "draft",
          revision: null,
          display_number: null,
          match_kind: "legacy_model",
        }),
      ],
      clients: ["Atlas Example"],
      currencies: ["EGP", "EUR"],
      statuses: ["draft", "sent"],
    });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]?.unit_price).toBe("0");
    expect(page.rows[1]?.unit_price).toBeNull();
    expect(page.rows[1]?.match_kind).toBe("legacy_model");
    expect(page.clients).toEqual(["Atlas Example"]);
    expect(JSON.stringify(page)).not.toContain("purchase");
  });
});
