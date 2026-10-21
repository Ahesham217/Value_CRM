import { describe, expect, it } from "vitest";
import { exactProduct, rankProducts } from "./catalogue-rank";
import { isUniqueModelConflict, modelKey, modelsMatch } from "./model-identity";
import {
  blankLine,
  editorLineFromStored,
  generationBlock,
  isBlankPlaceholder,
  isResolvedLine,
  linesForDraft,
  moveEditorLine,
  reorderEditorLines,
  selectProduct,
  type CatalogueChoice,
  type EditorLine,
} from "./pi-lines";
import type { PiLine } from "./types";

function choice(overrides: Partial<CatalogueChoice> = {}): CatalogueChoice {
  return {
    id: "product-1",
    model_code: "ABC-100",
    vendor_id: "vendor-1",
    vendor_name: "Acme",
    vendor_archived: false,
    description: "Controller",
    unit: "set",
    unit_price: "12.50",
    billing_type: "one_time",
    ...overrides,
  };
}

function storedLine(overrides: Partial<PiLine> = {}): PiLine {
  return {
    id: "line-1",
    pi_id: "pi-1",
    position: 1,
    product_id: null,
    vendor_id: null,
    vendor_name: "",
    model_code: "OLD-LINE",
    description: "Historic text",
    unit: "unit",
    quantity: "2",
    unit_price: "9.00",
    line_total: "18.00",
    subscription_agreement: null,
    ...overrides,
  };
}

describe("model identity", () => {
  it("treats case and surrounding spaces as the same model", () => {
    expect(modelKey(" ABC-100 ")).toBe("abc-100");
    expect(modelsMatch("ABC-100", " abc-100 ")).toBe(true);
    expect(modelsMatch("ABC-100", "ABC-1000")).toBe(false);
    expect(modelsMatch("   ", "ABC-100")).toBe(false);
  });

  it("recognises a unique-index conflict", () => {
    expect(isUniqueModelConflict({ code: "23505", message: "duplicate key" })).toBe(true);
    expect(isUniqueModelConflict({ message: 'duplicate key value violates unique constraint "products_model_key_uidx"' })).toBe(true);
    expect(isUniqueModelConflict(new Error("Vendor is required."))).toBe(false);
  });
});

describe("PI item lines", () => {
  it("ignores a blank placeholder and keeps an edited description on the same product", () => {
    const selected = selectProduct(blankLine("row"), choice());
    const edited: EditorLine = { ...selected, description: "PI wording", quantity: "4", unitPrice: "0" };
    const prepared = linesForDraft([blankLine("empty"), edited]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.lines).toEqual([
      {
        product_id: "product-1",
        vendor_id: "vendor-1",
        model_code: "ABC-100",
        description: "PI wording",
        unit: "set",
        quantity: "4",
        unit_price: "0",
        subscription: null,
      },
    ]);
  });

  it("keeps an explicit zero and leaves a missing price empty", () => {
    const zero = selectProduct(blankLine("zero"), choice({ unit_price: "0" }));
    const missing = selectProduct(blankLine("missing"), choice({ unit_price: null }));
    expect(zero.unitPrice).toBe("0");
    expect(missing.unitPrice).toBe("");
    expect(zero.description).toBe("Controller");
    const prepared = linesForDraft([zero, missing]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.lines[0]?.unit_price).toBe("0");
    expect(prepared.lines[1]?.unit_price).toBeNull();
  });

  it("does not keep the previous product when the typed model is different", () => {
    const selected = selectProduct(blankLine("row"), choice());
    const typed = { ...selected, modelInput: "NEW-200" };
    expect(isResolvedLine(typed)).toBe(false);
    const prepared = linesForDraft([typed]);
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.message).toContain("NEW-200");
  });

  it("accepts the same model with different case and saves the catalogue spelling", () => {
    const selected = selectProduct(blankLine("row"), choice());
    const typed = { ...selected, modelInput: " abc-100 " };
    const prepared = linesForDraft([typed]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.lines[0]?.model_code).toBe("ABC-100");
    expect(prepared.lines[0]?.product_id).toBe("product-1");
  });

  it("switches to another product instead of renaming the original", () => {
    const original = choice();
    const selected = selectProduct(blankLine("row"), original);
    const customised = { ...selected, description: "Keep until switch" };
    const replacement = choice({
      id: "product-2",
      model_code: "ZX-9",
      vendor_id: "vendor-2",
      vendor_name: "Other",
      description: "Replacement",
      unit_price: null,
    });
    const switched = selectProduct(customised, replacement);
    expect(original.model_code).toBe("ABC-100");
    expect(switched.product?.id).toBe("product-2");
    expect(switched.modelInput).toBe("ZX-9");
    expect(switched.description).toBe("Replacement");
    expect(switched.unitPrice).toBe("");
    expect(switched.quantity).toBe("1");
    const prepared = linesForDraft([switched]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.lines[0]?.product_id).toBe("product-2");
    expect(prepared.lines[0]?.vendor_id).toBe("vendor-2");
    expect(prepared.lines[0]?.model_code).toBe("ZX-9");
  });

  it("marks a legacy custom line and blocks save without creating a product", () => {
    const legacy = editorLineFromStored(storedLine(), null);
    expect(legacy.legacyUnresolved).toBe(true);
    expect(legacy.product).toBeNull();
    expect(legacy.description).toBe("Historic text");
    expect(isBlankPlaceholder(legacy)).toBe(false);
    const prepared = linesForDraft([legacy]);
    expect(prepared.ok).toBe(false);
  });

  it("keeps a stored line whose model matches ignoring case", () => {
    const line = editorLineFromStored(
      storedLine({ product_id: "product-1", vendor_id: "vendor-1", model_code: " abc-100 ", vendor_name: "Old name" }),
      { id: "product-1", model_code: "ABC-100", vendor_id: "vendor-1", vendor_name: "Acme", vendor_archived: false },
    );
    expect(line.product?.modelCode).toBe("ABC-100");
    expect(line.modelInput).toBe("ABC-100");
    expect(line.description).toBe("Historic text");
    expect(linesForDraft([line]).ok).toBe(true);
  });

  it("does not attach a product when the stored vendor does not match", () => {
    const line = editorLineFromStored(
      storedLine({ product_id: "product-1", vendor_id: "other", model_code: "ABC-100" }),
      { id: "product-1", model_code: "ABC-100", vendor_id: "vendor-1", vendor_name: "Acme", vendor_archived: false },
    );
    expect(line.product).toBeNull();
    expect(linesForDraft([line]).ok).toBe(false);
  });

  it("blocks generation when the product vendor is archived", () => {
    const line = selectProduct(blankLine("row"), choice({ vendor_archived: true, unit_price: "1" }));
    expect(linesForDraft([line]).ok).toBe(true);
    expect(generationBlock([line])).toContain("no active vendor");
    expect(generationBlock([])).toBe("Add at least one item before generating.");
  });

  it("reorders by stable identity and keeps unsaved edits", () => {
    const first = { ...selectProduct(blankLine("a"), choice()), description: "First edit" };
    const second = selectProduct(blankLine("b"), choice({ id: "product-2", model_code: "ZX-9", description: "Second" }));
    const dragged = reorderEditorLines([first, second], "b", "a");
    expect(dragged.map((line) => line.key)).toEqual(["b", "a"]);
    expect(dragged[1]?.description).toBe("First edit");
    const moved = moveEditorLine(dragged, 0, 1);
    expect(moved.map((line) => line.key)).toEqual(["a", "b"]);
    expect(moveEditorLine(moved, 0, -1)).toBe(moved);
  });
});

describe("catalogue search ranking", () => {
  const products = [
    { id: "1", model_code: "ABC-100", archived_at: null },
    { id: "2", model_code: "abc-100-extra", archived_at: null },
    { id: "3", model_code: " ABC-100 ", archived_at: "2026-01-01" },
  ];

  it("prefers the exact active model and still finds the archived identity", () => {
    const ranked = rankProducts(" abc-100 ", products);
    expect(ranked.map((product) => product.id)).toEqual(["1", "2", "3"]);
    expect(exactProduct("ABC-100", products)?.id).toBe("1");
    expect(exactProduct("  abc-100 ", [products[2]!])?.id).toBe("3");
  });
});
