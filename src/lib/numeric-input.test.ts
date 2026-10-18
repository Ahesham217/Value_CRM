import { describe, expect, it } from "vitest";
import { numericInputValue } from "./numeric-input";
import { sellingPriceForCurrency, type Product } from "./types";
import { calculateDocument, type AdjustmentInput } from "./money";

const adjustments: AdjustmentInput = {
  discountType: "none", discountValue: null, shipping: null, installation: null,
  bankCharge: null, taxEnabled: false, taxPercent: null,
  taxExcludesShipping: false, taxExcludesInstallation: false, taxExcludesBankCharge: false,
};

describe("database numeric inputs", () => {
  it("preserves zero, missing values and decimal string precision", () => {
    expect(numericInputValue(0).trim()).toBe("0");
    expect(numericInputValue(null)).toBe("");
    expect(numericInputValue(undefined)).toBe("");
    expect(numericInputValue("")).toBe("");
    expect(numericInputValue("123456789012345.1234")).toBe("123456789012345.1234");
  });

  it.each(["EGP", "USD", "EUR"] as const)("calculates with a numeric catalogue price in %s", (currency) => {
    const product = { sell_price_egp: 15.5, sell_price_usd: 15.5, sell_price_eur: 15.5 } as Product;
    const price = sellingPriceForCurrency(product, currency);
    expect(price?.trim()).toBe("15.5");
    const totals = calculateDocument([{ quantity: "2", unitPrice: price }], adjustments);
    expect(totals.grandTotal).toBe("31.00");
  });

  it("distinguishes a free catalogue product from an unknown price", () => {
    const product = { sell_price_egp: 0, sell_price_usd: null, sell_price_eur: "0.00" } as Product;
    expect(sellingPriceForCurrency(product, "EGP")).toBe("0");
    expect(sellingPriceForCurrency(product, "USD")).toBeNull();
    expect(sellingPriceForCurrency(product, "EUR")).toBe("0.00");
  });

  it("calculates reopened numeric lines, discounts, charges and tax", () => {
    const totals = calculateDocument(
      [{ quantity: numericInputValue(2), unitPrice: numericInputValue(100) }],
      { ...adjustments, discountType: "percent", discountValue: numericInputValue(10),
        shipping: numericInputValue(5), installation: numericInputValue(10),
        bankCharge: numericInputValue(15.5), taxEnabled: true, taxPercent: numericInputValue(14) },
    );
    expect(totals.taxableBase).toBe("210.50");
    expect(totals.grandTotal).toBe("239.97");
  });
});
