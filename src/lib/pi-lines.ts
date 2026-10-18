import { modelsMatch } from "./model-identity";
import { numericInputValue } from "./numeric-input";
import type { CurrencyCode, DraftLineInput, PiLine } from "./types";
import { sellingPriceForCurrency } from "./types";

export type SelectedProduct = {
  id: string;
  modelCode: string;
  vendorId: string;
  vendorName: string;
  vendorArchived: boolean;
};

export type EditorLine = {
  key: string;
  product: SelectedProduct | null;
  modelInput: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  /** A stored draft line that is not tied to a matching catalogue product. */
  legacyUnresolved: boolean;
};

export type CatalogueChoice = {
  id: string;
  model_code: string;
  vendor_id: string;
  vendor_name: string;
  vendor_archived: boolean;
  description: string;
  unit: string;
  /** Null when this currency has no default. "0" is an explicit zero. */
  unit_price: string | null;
};

export type StoredProductLink = {
  id: string;
  model_code: string;
  vendor_id: string;
  vendor_name: string;
  vendor_archived: boolean;
};

export function blankLine(key: string = crypto.randomUUID()): EditorLine {
  return {
    key,
    product: null,
    modelInput: "",
    description: "",
    unit: "unit",
    quantity: "1",
    unitPrice: "",
    legacyUnresolved: false,
  };
}

export function isBlankPlaceholder(line: EditorLine): boolean {
  if (line.product || line.legacyUnresolved) return false;
  const unit = line.unit.trim();
  const quantity = line.quantity.trim();
  return (
    line.modelInput.trim() === "" &&
    line.description.trim() === "" &&
    line.unitPrice.trim() === "" &&
    (unit === "" || unit === "unit") &&
    (quantity === "" || quantity === "1")
  );
}

export function isResolvedLine(line: EditorLine): boolean {
  return Boolean(
    line.product &&
      line.product.vendorId &&
      modelsMatch(line.modelInput, line.product.modelCode),
  );
}

export function selectProduct(line: EditorLine, choice: CatalogueChoice): EditorLine {
  return {
    ...line,
    product: {
      id: choice.id,
      modelCode: choice.model_code,
      vendorId: choice.vendor_id,
      vendorName: choice.vendor_name,
      vendorArchived: choice.vendor_archived,
    },
    modelInput: choice.model_code,
    description: choice.description,
    unit: choice.unit.trim() || "unit",
    unitPrice: choice.unit_price ?? "",
    legacyUnresolved: false,
  };
}

export function revertModelInput(line: EditorLine): EditorLine {
  if (!line.product) return line;
  return { ...line, modelInput: line.product.modelCode };
}

export function editorLineFromStored(line: PiLine, product: StoredProductLink | null): EditorLine {
  const shared = {
    key: line.id,
    description: line.description,
    unit: line.unit,
    quantity: numericInputValue(line.quantity),
    unitPrice: numericInputValue(line.unit_price),
  };
  const linked =
    product !== null &&
    line.product_id === product.id &&
    line.vendor_id === product.vendor_id &&
    modelsMatch(line.model_code, product.model_code);
  if (!linked || !product) {
    return {
      ...shared,
      product: null,
      modelInput: line.model_code,
      legacyUnresolved: true,
    };
  }
  return {
    ...shared,
    product: {
      id: product.id,
      modelCode: product.model_code,
      vendorId: product.vendor_id,
      vendorName: product.vendor_name,
      vendorArchived: product.vendor_archived,
    },
    modelInput: product.model_code,
    legacyUnresolved: false,
  };
}

export function moveEditorLine(lines: EditorLine[], index: number, direction: -1 | 1): EditorLine[] {
  const target = index + direction;
  if (target < 0 || target >= lines.length) return lines;
  const next = lines.slice();
  const [item] = next.splice(index, 1);
  if (!item) return lines;
  next.splice(target, 0, item);
  return next;
}

export function reorderEditorLines(lines: EditorLine[], activeKey: string, overKey: string): EditorLine[] {
  const from = lines.findIndex((line) => line.key === activeKey);
  const to = lines.findIndex((line) => line.key === overKey);
  if (from < 0 || to < 0 || from === to) return lines;
  const next = lines.slice();
  const [item] = next.splice(from, 1);
  if (!item) return lines;
  next.splice(to, 0, item);
  return next;
}

export function linesForDraft(lines: EditorLine[]): { ok: true; lines: DraftLineInput[] } | { ok: false; message: string } {
  const kept = lines.filter((line) => !isBlankPlaceholder(line));
  const unresolved = kept.filter((line) => !isResolvedLine(line));
  if (unresolved.length > 0) {
    const names = unresolved.map((line) => line.modelInput.trim() || "a line with no model").join(", ");
    return {
      ok: false,
      message: `Select or create a catalogue product for every item before saving. Unresolved: ${names}. A typed model is not saved until you select or create it.`,
    };
  }
  return {
    ok: true,
    lines: kept.map((line) => ({
      product_id: line.product!.id,
      vendor_id: line.product!.vendorId,
      model_code: line.product!.modelCode,
      description: line.description,
      unit: line.unit.trim() || "unit",
      quantity: line.quantity,
      unit_price: line.unitPrice.trim() ? line.unitPrice.trim() : null,
    })),
  };
}

export function generationBlock(lines: EditorLine[]): string | null {
  const prepared = linesForDraft(lines);
  if (!prepared.ok) {
    return prepared.message.replace("before saving", "before generating");
  }
  if (prepared.lines.length === 0) return "Add at least one item before generating.";
  const blocked = lines.filter(
    (line) => isResolvedLine(line) && (line.product?.vendorArchived || !line.product?.vendorName.trim()),
  );
  if (blocked.length === 0) return null;
  const models = blocked.map((line) => line.product?.modelCode ?? "A product").join(", ");
  return `${models} ${blocked.length === 1 ? "has" : "have"} no active vendor, so this PI cannot be generated. Assign an active vendor on the product, or ask a colleague who manages products. Issued versions are not changed.`;
}

export function lineWarning(line: EditorLine, canManageProducts: boolean): string | null {
  if (isBlankPlaceholder(line)) return null;
  if (!isResolvedLine(line)) {
    if (line.legacyUnresolved) {
      return "This saved line has no matching catalogue product. Choose or create a model before saving or generating. Already issued versions are not changed.";
    }
    if (line.product && !modelsMatch(line.modelInput, line.product.modelCode)) {
      const typed = line.modelInput.trim() || "This model";
      return `${typed} is not selected yet. Choose a product, create the model, or press Escape to keep ${line.product.modelCode}.`;
    }
    return "Select a saved product before this row can be saved.";
  }
  if (line.product?.vendorArchived || !line.product?.vendorName.trim()) {
    const model = line.product?.modelCode ?? "This product";
    return canManageProducts
      ? `${model} has no active vendor, so this PI cannot be generated until you assign one on the product.`
      : `${model} has no active vendor. Ask a colleague who manages products to assign one before this PI can be generated.`;
  }
  return null;
}

export function selectionNotice(
  modelCode: string,
  currency: CurrencyCode | null,
  unitPrice: string | null,
): string | null {
  if (!currency) {
    return `Selected ${modelCode}. Choose an office and currency to load a default selling price.`;
  }
  if (unitPrice === null) {
    return `No default ${currency} selling price for ${modelCode}. Enter the price for this PI.`;
  }
  return null;
}

export function choiceUnitPrice(
  prices: {
    sell_price_egp: string | number | null;
    sell_price_usd: string | number | null;
    sell_price_eur: string | number | null;
  },
  currency: CurrencyCode | null,
): string | null {
  return sellingPriceForCurrency(prices, currency);
}
