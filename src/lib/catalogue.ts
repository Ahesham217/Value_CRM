import { rankProducts } from "./catalogue-rank";
import { escapeIlike, isUniqueModelConflict } from "./model-identity";
import { supabase } from "./supabase";
import type { BillingType, CurrencyCode, Product, Vendor } from "./types";

export type CatalogueProduct = {
  id: string;
  vendor_id: string;
  brand: string;
  model_code: string;
  description: string;
  unit: string;
  sell_price_egp: string | number | null;
  sell_price_usd: string | number | null;
  sell_price_eur: string | number | null;
  billing_type: BillingType;
  archived_at: string | null;
  vendor_name: string;
  vendor_archived: boolean;
};

export type NewCatalogueProduct = {
  model: string;
  vendorId: string;
  vendorName: string;
  description: string;
  unit: string;
  currency: CurrencyCode | null;
  price: string | null;
};

type VendorJoin = { company_name?: string | null; archived_at?: string | null } | null;

const PRODUCT_COLUMNS = "*, vendors(company_name, archived_at)";

function vendorJoin(vendors: Product["vendors"] | VendorJoin | VendorJoin[] | null | undefined): VendorJoin {
  if (Array.isArray(vendors)) return vendors[0] ?? null;
  return vendors ?? null;
}

export function toCatalogueProduct(row: Product): CatalogueProduct {
  const vendor = vendorJoin(row.vendors);
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    brand: row.brand,
    model_code: row.model_code,
    description: row.description,
    unit: row.unit,
    sell_price_egp: row.sell_price_egp,
    sell_price_usd: row.sell_price_usd,
    sell_price_eur: row.sell_price_eur,
    billing_type: row.billing_type ?? "one_time",
    archived_at: row.archived_at,
    vendor_name: vendor?.company_name ?? "",
    vendor_archived: Boolean(vendor?.archived_at),
  };
}

type LookupRow = {
  id: string;
  vendor_id: string;
  brand: string;
  model_code: string;
  description: string;
  unit: string;
  sell_price_egp: string | number | null;
  sell_price_usd: string | number | null;
  sell_price_eur: string | number | null;
  billing_type?: BillingType;
  archived_at: string | null;
  vendor_name: string;
  vendor_archived_at: string | null;
};

function fromLookup(row: LookupRow): CatalogueProduct {
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    brand: row.brand,
    model_code: row.model_code,
    description: row.description,
    unit: row.unit,
    sell_price_egp: row.sell_price_egp,
    sell_price_usd: row.sell_price_usd,
    sell_price_eur: row.sell_price_eur,
    billing_type: row.billing_type ?? "one_time",
    archived_at: row.archived_at,
    vendor_name: row.vendor_name,
    vendor_archived: Boolean(row.vendor_archived_at),
  };
}

export async function lookupCatalogue(model: string): Promise<CatalogueProduct | null> {
  const { data, error } = await supabase.rpc("lookup_product_by_model", { p_model: model });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as LookupRow | undefined;
  return row ? fromLookup(row) : null;
}

export async function searchCatalogue(term: string): Promise<CatalogueProduct[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const discovery = trimmed.replace(/[%_\\,()*]/g, " ").trim();
  const like = escapeIlike(discovery);
  const listPromise = like
    ? supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .or(`model_code.ilike.%${like}%,description.ilike.%${like}%`)
        .order("model_code")
        .limit(20)
    : Promise.resolve({ data: [] as Product[], error: null });
  const [listResult, exact] = await Promise.all([listPromise, lookupCatalogue(trimmed)]);
  if (listResult.error) throw listResult.error;
  const rows = ((listResult.data ?? []) as Product[]).map(toCatalogueProduct);
  if (exact && !rows.some((row) => row.id === exact.id)) rows.unshift(exact);
  return rankProducts(trimmed, rows);
}

export async function listActiveVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .is("archived_at", null)
    .order("company_name")
    .limit(500);
  if (error) throw error;
  return (data ?? []) as Vendor[];
}

const PRICE_COLUMNS = {
  EGP: "sell_price_egp",
  USD: "sell_price_usd",
  EUR: "sell_price_eur",
} as const;

export async function createCatalogueProduct(
  input: NewCatalogueProduct,
): Promise<{ outcome: "created" | "exists"; product: CatalogueProduct } | { outcome: "missing" }> {
  const payload: {
    vendor_id: string;
    model_code: string;
    description: string;
    unit: string;
    brand: string;
    sell_price_egp?: string;
    sell_price_usd?: string;
    sell_price_eur?: string;
  } = {
    vendor_id: input.vendorId,
    model_code: input.model.trim(),
    description: input.description.trim(),
    unit: input.unit.trim() || "unit",
    brand: "",
  };
  if (input.currency && input.price !== null) {
    payload[PRICE_COLUMNS[input.currency]] = input.price;
  }
  const inserted = await supabase.from("products").insert(payload).select(PRODUCT_COLUMNS).single();
  if (!inserted.error && inserted.data) {
    const product = toCatalogueProduct(inserted.data as Product);
    if (!product.vendor_name) product.vendor_name = input.vendorName;
    return { outcome: "created", product };
  }
  if (inserted.error && isUniqueModelConflict(inserted.error)) {
    const existing = await lookupCatalogue(input.model);
    if (!existing) return { outcome: "missing" };
    return { outcome: "exists", product: existing };
  }
  throw inserted.error;
}
