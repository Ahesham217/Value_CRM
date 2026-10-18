import { describe, expect, it } from "vitest";
import { calculateDocument, type AdjustmentInput, type LineInput } from "./money";

const baseAdjustments = (overrides: Partial<AdjustmentInput> = {}): AdjustmentInput => ({
  discountType: "none",
  discountValue: null,
  shipping: null,
  installation: null,
  bankCharge: null,
  taxEnabled: false,
  taxPercent: null,
  taxExcludesShipping: false,
  taxExcludesInstallation: false,
  taxExcludesBankCharge: false,
  ...overrides,
});

describe("calculateDocument", () => {
  it("rounds each line before summing and applies percent discount, charges, and tax", () => {
    const lines: LineInput[] = [
      { quantity: "2", unitPrice: "10.005" },
      { quantity: "1", unitPrice: "10.004" },
    ];
    const result = calculateDocument(
      lines,
      baseAdjustments({
        discountType: "percent",
        discountValue: "10",
        shipping: "5",
        bankCharge: "1",
        taxEnabled: true,
        taxPercent: "14",
      }),
    );
    expect(result.lines.map((line) => line.lineTotal)).toEqual(["20.01", "10.00"]);
    expect(result.subtotal).toBe("30.01");
    expect(result.discountAmount).toBe("3.00");
    expect(result.netItems).toBe("27.01");
    expect(result.taxableBase).toBe("33.01");
    expect(result.taxAmount).toBe("4.62");
    expect(result.grandTotal).toBe("37.63");
  });

  it("excludes selected charges from the taxable base", () => {
    const result = calculateDocument(
      [{ quantity: "2", unitPrice: "10.005" }, { quantity: "1", unitPrice: "10.004" }],
      baseAdjustments({
        discountType: "percent",
        discountValue: "10",
        shipping: "5",
        bankCharge: "1",
        taxEnabled: true,
        taxPercent: "14",
        taxExcludesShipping: true,
      }),
    );
    expect(result.taxableBase).toBe("28.01");
    expect(result.taxAmount).toBe("3.92");
    expect(result.grandTotal).toBe("36.93");
  });

  it("uses half-up rounding for line totals", () => {
    const result = calculateDocument(
      [
        { quantity: "1", unitPrice: "1.005" },
        { quantity: "1", unitPrice: "1.004" },
        { quantity: "3", unitPrice: "10.333" },
        { quantity: "1", unitPrice: "2.675" },
      ],
      baseAdjustments(),
    );
    expect(result.lines.map((line) => line.lineTotal)).toEqual(["1.01", "1.00", "31.00", "2.68"]);
  });

  it("does not treat a missing price as zero", () => {
    const result = calculateDocument(
      [
        { quantity: "2", unitPrice: "10" },
        { quantity: "1", unitPrice: null },
      ],
      baseAdjustments(),
    );
    expect(result.lines[1]?.lineTotal).toBeNull();
    expect(result.unpricedCount).toBe(1);
    expect(result.subtotal).toBe("20.00");
    expect(result.grandTotal).toBe("20.00");
  });

  it("rejects a fixed discount above the subtotal and invalid percentages", () => {
    expect(() =>
      calculateDocument([{ quantity: "1", unitPrice: "10" }], baseAdjustments({ discountType: "fixed", discountValue: "10.01" })),
    ).toThrow(/subtotal/);
    expect(() =>
      calculateDocument([{ quantity: "1", unitPrice: "10" }], baseAdjustments({ discountType: "percent", discountValue: "100.01" })),
    ).toThrow(/100/);
    expect(() =>
      calculateDocument([{ quantity: "1", unitPrice: "10" }], baseAdjustments({ taxEnabled: true, taxPercent: "101" })),
    ).toThrow(/Tax/);
    expect(() => calculateDocument([{ quantity: "0", unitPrice: "10" }], baseAdjustments())).toThrow(/Quantity/);
    expect(() => calculateDocument([{ quantity: "1", unitPrice: "-1" }], baseAdjustments())).toThrow(/negative/);
  });

  it("allows a 100 percent discount and ignores unused charges", () => {
    const result = calculateDocument(
      [{ quantity: "4", unitPrice: "2.50" }],
      baseAdjustments({ discountType: "percent", discountValue: "100" }),
    );
    expect(result.discountAmount).toBe("10.00");
    expect(result.netItems).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
    expect(result.taxableBase).toBeNull();
  });
});
