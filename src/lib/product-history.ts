import { displayStatusLabel, formatMoney, formatQuantity } from "./format";
import type { FilterChip } from "./workspace-view";

export const PI_HISTORY_TITLE = "PI history";
export const PI_HISTORY_SUBTITLE = "Where this product has been quoted";
export const PI_HISTORY_PRICE_NOTE =
  "Quoted unit prices are before invoice-wide discounts, tax and charges.";
export const PI_HISTORY_STATUS_NOTE =
  "PI status is the invoice's current status. Draft rows show saved draft values.";
export const LEGACY_MODEL_MATCH =
  "Matched on the saved model only, ignoring capitalisation and surrounding spaces. This issued record does not store a product id. Renaming the catalogue model later can stop this line from matching.";

export type ProductHistorySource = "latest_issued" | "older_revision" | "initial_draft" | "revision_draft";
export type ProductHistoryMatch = "product_id" | "legacy_model";

export type ProductHistoryRow = {
  row_id: string;
  pi_id: string;
  source: ProductHistorySource;
  pi_number: string | null;
  revision: number | null;
  revision_label: string | null;
  display_number: string | null;
  client_name: string | null;
  pi_date: string | null;
  quantity: string;
  unit: string;
  unit_price: string | null;
  currency: string | null;
  pi_status: string;
  model_code: string;
  description: string;
  position: number;
  match_kind: ProductHistoryMatch;
  discount_on_pi: boolean;
  discount_type: string;
  discount_value: string | null;
  discount_amount: string | null;
};

export type ProductHistoryPage = {
  total: number;
  rows: ProductHistoryRow[];
  clients: string[];
  currencies: string[];
  statuses: string[];
};

const SOURCES: readonly ProductHistorySource[] = [
  "latest_issued",
  "older_revision",
  "initial_draft",
  "revision_draft",
];

const MATCHES: readonly ProductHistoryMatch[] = ["product_id", "legacy_model"];

export function persistentProductId(id: string | undefined): string | null {
  if (!id || id === "new") return null;
  return id;
}

export function quotedUnitPriceLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return "Not priced";
  try {
    return formatMoney(value);
  } catch {
    return value.trim();
  }
}

export function quotedQuantityLabel(quantity: string | null | undefined, unit: string | null | undefined): string {
  const amount = quantity === null || quantity === undefined || quantity.trim() === ""
    ? "—"
    : formatQuantity(quantity);
  const unitText = (unit ?? "").trim();
  return unitText && amount !== "—" ? `${amount} ${unitText}` : amount;
}

export function historySourceText(row: Pick<ProductHistoryRow, "source" | "display_number" | "pi_number">): {
  title: string;
  detail: string;
} {
  if (row.source === "latest_issued") {
    return { title: row.display_number || row.pi_number || "Issued PI", detail: "Latest issued" };
  }
  if (row.source === "older_revision") {
    return { title: row.display_number || row.pi_number || "Issued PI", detail: "Older revision" };
  }
  if (row.source === "revision_draft") {
    return {
      title: "Draft",
      detail: row.pi_number ? `Revision draft · ${row.pi_number}` : "Revision draft",
    };
  }
  return { title: "Draft", detail: "New draft" };
}

export function historyRowHref(source: ProductHistorySource, piId: string, canEditDrafts: boolean): string {
  if (source === "initial_draft" || source === "revision_draft") {
    return canEditDrafts ? `/pis/${piId}/edit` : `/pis/${piId}`;
  }
  return `/pis/${piId}`;
}

export function historyDiscountDetail(
  row: Pick<ProductHistoryRow, "discount_on_pi" | "discount_type" | "discount_value" | "discount_amount" | "currency">,
): string | null {
  if (!row.discount_on_pi) return null;
  const currency = row.currency?.trim() || null;
  if (row.discount_type === "percent") {
    const percent = row.discount_value?.trim() || "0";
    const saved = row.discount_amount?.trim()
      ? ` Saved invoice discount ${formatMoney(row.discount_amount, currency)}.`
      : "";
    return `Invoice-wide discount: ${percent}%.${saved} The quoted unit price is before this discount.`;
  }
  if (row.discount_type === "fixed") {
    const amount = row.discount_value?.trim() ? formatMoney(row.discount_value, currency) : "a fixed amount";
    return `Invoice-wide fixed discount: ${amount}. The quoted unit price is before this discount.`;
  }
  return null;
}

export function historyLegacyDetail(matchKind: ProductHistoryMatch): string | null {
  return matchKind === "legacy_model" ? LEGACY_MODEL_MATCH : null;
}

export function productHistoryFilterChips(input: {
  client: string;
  currency: string;
  status: string;
}): FilterChip[] {
  const chips: FilterChip[] = [];
  if (input.client) chips.push({ id: "client", label: `Client: ${input.client}` });
  if (input.currency) chips.push({ id: "currency", label: `Currency: ${input.currency}` });
  if (input.status) chips.push({ id: "status", label: `PI status: ${displayStatusLabel(input.status)}` });
  return chips;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`PI history is missing ${label}.`);
  return value;
}

function parseRow(value: unknown): ProductHistoryRow {
  if (!value || typeof value !== "object") throw new Error("PI history returned an unreadable row.");
  const row = value as Record<string, unknown>;
  const source = row.source;
  const match = row.match_kind;
  if (typeof source !== "string" || !SOURCES.includes(source as ProductHistorySource)) {
    throw new Error("PI history returned an unknown row type.");
  }
  if (typeof match !== "string" || !MATCHES.includes(match as ProductHistoryMatch)) {
    throw new Error("PI history returned an unknown product match.");
  }
  if (typeof row.pi_id !== "string" || typeof row.row_id !== "string") {
    throw new Error("PI history returned a row without a document.");
  }
  if (typeof row.position !== "number" || !Number.isInteger(row.position)) {
    throw new Error("PI history returned a row without a line position.");
  }
  if (typeof row.discount_on_pi !== "boolean") {
    throw new Error("PI history returned a row without discount information.");
  }
  const revision = row.revision;
  if (!(revision === null || (typeof revision === "number" && Number.isInteger(revision)))) {
    throw new Error("PI history returned an unreadable revision.");
  }
  return {
    row_id: row.row_id,
    pi_id: row.pi_id,
    source: source as ProductHistorySource,
    pi_number: textOrNull(row.pi_number),
    revision,
    revision_label: textOrNull(row.revision_label),
    display_number: textOrNull(row.display_number),
    client_name: textOrNull(row.client_name),
    pi_date: textOrNull(row.pi_date),
    quantity: requiredText(row.quantity ?? "", "quantity"),
    unit: typeof row.unit === "string" ? row.unit : "",
    unit_price: textOrNull(row.unit_price),
    currency: textOrNull(row.currency),
    pi_status: requiredText(row.pi_status, "PI status"),
    model_code: typeof row.model_code === "string" ? row.model_code : "",
    description: typeof row.description === "string" ? row.description : "",
    position: row.position,
    match_kind: match as ProductHistoryMatch,
    discount_on_pi: row.discount_on_pi,
    discount_type: typeof row.discount_type === "string" ? row.discount_type : "none",
    discount_value: textOrNull(row.discount_value),
    discount_amount: textOrNull(row.discount_amount),
  };
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`PI history returned unreadable ${label}.`);
  }
  return value;
}

export function parseProductHistory(value: unknown): ProductHistoryPage {
  if (!value || typeof value !== "object") throw new Error("PI history could not be read.");
  const page = value as Record<string, unknown>;
  if (typeof page.total !== "number" || !Number.isInteger(page.total) || page.total < 0) {
    throw new Error("PI history returned an unreadable result count.");
  }
  if (!Array.isArray(page.rows)) throw new Error("PI history returned no rows.");
  return {
    total: page.total,
    rows: page.rows.map(parseRow),
    clients: stringList(page.clients, "clients"),
    currencies: stringList(page.currencies, "currencies"),
    statuses: stringList(page.statuses, "statuses"),
  };
}
