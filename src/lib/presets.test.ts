import { describe, expect, it } from "vitest";
import {
  canonicalOfficeCode,
  canonicalSequencePrefix,
  presetFilterOptions,
  presetReady,
  presetStatusText,
  subscriptionCurrencyMismatch,
} from "./presets";

describe("preset identifiers", () => {
  it("accepts a canonical prefix and office code", () => {
    expect(canonicalSequencePrefix(" qa ")).toBe("QA");
    expect(canonicalSequencePrefix("EG")).toBe("EG");
    expect(canonicalOfficeCode("ae")).toBe("AE");
  });

  it("rejects prefixes that could not stay inside one numbering format", () => {
    expect(canonicalSequencePrefix("")).toBeNull();
    expect(canonicalSequencePrefix("A-E")).toBeNull();
    expect(canonicalSequencePrefix("1QA")).toBeNull();
    expect(canonicalSequencePrefix("TOOLONGPFX")).toBeNull();
    expect(canonicalOfficeCode("New Office")).toBeNull();
  });
});

describe("preset readiness", () => {
  const ready = {
    company_name: "North Office LLC",
    address: "Doha",
    bank_name: "Qatar National Bank",
    account_name: "North Office LLC",
    account_number: "000123",
    iban: "QA00NORTH000123",
    bank_swift: "QNBAQAQA",
  };

  it("keeps the existing issue fields and preserves a text account number", () => {
    expect(presetReady(ready)).toBe(true);
    expect(presetReady({ ...ready, account_number: "  " })).toBe(false);
    expect(presetStatusText(ready, false)).toBe("Ready to issue");
    expect(presetStatusText({ ...ready, iban: "" }, false)).toBe("Needs configuration before a PI can be issued");
    expect(presetStatusText(ready, true)).toMatch(/Archived/);
  });
});

describe("preset filters", () => {
  it("includes a newly added preset and keeps an archived preset visible", () => {
    expect(presetFilterOptions([
      { code: "AE-USD", display_name: "UAE — USD", archived_at: null },
      { code: "P-NORTH", display_name: "North Office — USD", archived_at: null },
      { code: "EG-EGP", display_name: "Egypt — EGP", archived_at: "2026-10-23T00:00:00Z" },
    ])).toEqual([
      { code: "EG-EGP", label: "Egypt — EGP (archived)", archived: true },
      { code: "P-NORTH", label: "North Office — USD", archived: false },
      { code: "AE-USD", label: "UAE — USD", archived: false },
    ]);
  });
});

describe("preset currency changes", () => {
  it("reports a subscription priced in another currency and leaves one-time lines alone", () => {
    expect(subscriptionCurrencyMismatch([{ subscription: null }], "USD")).toBeNull();
    expect(subscriptionCurrencyMismatch([{ subscription: { currency: "USD" } }], "USD")).toBeNull();
    expect(subscriptionCurrencyMismatch([{ subscription: { currency: "USD" } }], "EGP")).toMatch(/priced in USD/);
    expect(subscriptionCurrencyMismatch([{ subscription: { currency: "USD" } }], "EGP")).toMatch(/not converted/);
  });
});
