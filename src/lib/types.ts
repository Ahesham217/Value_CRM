import { numericInputValue } from "./numeric-input";

export type PresetCode = "EG-EGP" | "AE-USD" | "AE-EUR";
export type OfficeCode = "EG" | "AE";
export type CurrencyCode = "EGP" | "USD" | "EUR";
export type DiscountType = "none" | "fixed" | "percent";
export type TrackingStatus = "draft" | "sent" | "accepted" | "cancelled";
export type DisplayStatus = TrackingStatus | "issued";
export type PiVisibility = "all" | "associated";

export type Profile = {
  id: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  is_admin: boolean;
  is_salesperson: boolean;
  pi_visibility: PiVisibility;
  can_edit_drafts: boolean;
  can_generate_pis: boolean;
  can_manage_clients: boolean;
  can_manage_vendors: boolean;
  can_manage_products: boolean;
  can_view_purchase_prices: boolean;
};

export type Client = {
  id: string;
  company_name: string;
  country: string;
  billing_address: string;
  shipping_address: string | null;
  tax_number: string | null;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientContact = {
  id: string;
  client_id: string;
  name: string;
  job_title: string;
  phone: string;
  email: string;
  is_primary: boolean;
  position: number;
};

export type Vendor = {
  id: string;
  company_name: string;
  country: string;
  address: string;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorContact = {
  id: string;
  vendor_id: string;
  name: string;
  job_title: string;
  phone: string;
  email: string;
  position: number;
};

export type Product = {
  id: string;
  vendor_id: string;
  brand: string;
  model_code: string;
  description: string;
  unit: string;
  sell_price_egp: string | number | null;
  sell_price_usd: string | number | null;
  sell_price_eur: string | number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  vendors?: { company_name: string } | null;
};

export type ProductCost = {
  product_id: string;
  purchase_price: string | number | null;
  purchase_currency: CurrencyCode | null;
};

export type CompanyPreset = {
  code: PresetCode;
  office: OfficeCode;
  currency: CurrencyCode;
  layout: "egypt" | "uae";
  company_name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
  tax_registration: string;
  logo_base64: string | null;
  logo_content_type: string | null;
  bank_name: string;
  bank_branch: string;
  bank_address: string;
  bank_swift: string;
  account_name: string;
  account_number: string;
  iban: string;
  correspondent_bank: string;
  bank_notes: string;
  updated_at: string;
};

export type DefaultTerms = {
  id: number;
  price_basis: string;
  payment_terms: string;
  delivery_terms: string;
  warranty: string;
  additional_notes: string;
};

export type PiLine = {
  id: string;
  pi_id: string;
  position: number;
  product_id: string | null;
  vendor_id: string | null;
  vendor_name: string;
  model_code: string;
  description: string;
  unit: string;
  quantity: string | number;
  unit_price: string | number | null;
  line_total: string | number | null;
};

export type ProformaInvoice = {
  id: string;
  preset_code: PresetCode | null;
  office: OfficeCode | null;
  currency: CurrencyCode | null;
  pi_year: number | null;
  serial: number | null;
  pi_number: string | null;
  pi_date: string | null;
  expiry_date: string | null;
  client_id: string | null;
  client_contact_id: string | null;
  bill_to: string;
  ship_to: string;
  ship_same_as_billing: boolean;
  customer_reference: string;
  lead_salesperson_id: string | null;
  created_by: string;
  tracking_status: TrackingStatus;
  draft_open: boolean;
  draft_version: number;
  discount_type: DiscountType;
  discount_value: string | number | null;
  shipping_amount: string | number | null;
  installation_amount: string | number | null;
  bank_charge_amount: string | number | null;
  tax_enabled: boolean;
  tax_percent: string | number | null;
  tax_excludes_shipping: boolean;
  tax_excludes_installation: boolean;
  tax_excludes_bank_charge: boolean;
  price_basis: string;
  payment_terms: string;
  delivery_terms: string;
  warranty: string;
  additional_notes: string;
  subtotal: string | number;
  discount_amount: string | number;
  net_items: string | number;
  taxable_base: string | number | null;
  tax_amount: string | number;
  grand_total: string | number;
  created_at: string;
  updated_at: string;
};

export type PiListRow = {
  id: string;
  pi_number: string | null;
  office: OfficeCode | null;
  currency: CurrencyCode | null;
  pi_date: string | null;
  tracking_status: TrackingStatus;
  draft_open: boolean;
  draft_version: number;
  created_at: string;
  client_id: string | null;
  client_name: string | null;
  latest_revision: number | null;
  display_total: string | null;
  lead_salesperson_id: string | null;
  lead_name: string | null;
  prepared_by_name: string | null;
  salesperson_ids: string[] | null;
  display_status: DisplayStatus;
  has_open_revision: boolean;
};

export type SnapshotLine = {
  model_code: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
  line_total: string;
};

export type PiSnapshot = {
  layout_version: "egypt-v1" | "uae-v1";
  preset_code: PresetCode;
  office: OfficeCode;
  currency: CurrencyCode;
  pi_number: string;
  revision: number;
  revision_label: string | null;
  display_number: string;
  pi_date: string;
  expiry_date: string;
  customer_reference: string;
  company: {
    name: string;
    address: string;
    phone: string;
    fax: string;
    email: string;
    website: string;
    tax_registration: string;
    logo_base64: string | null;
    logo_content_type: string | null;
  };
  bank: {
    bank_name: string;
    branch: string;
    address: string;
    swift: string;
    account_name: string;
    account_number: string;
    iban: string;
    correspondent_bank: string;
    notes: string;
  };
  client: {
    company_name: string;
    country: string;
    tax_number: string;
    contact_name: string;
    contact_job_title: string;
    contact_phone: string;
    contact_email: string;
  };
  bill_to: string;
  ship_to: string;
  sales: {
    lead_name: string;
    lead_phone: string;
    additional: { name: string }[];
    prepared_by: string;
  };
  lines: SnapshotLine[];
  adjustments: {
    discount_type: DiscountType;
    discount_value: string | null;
    discount_amount: string;
    shipping: string | null;
    installation: string | null;
    bank_charge: string | null;
    tax_enabled: boolean;
    tax_percent: string | null;
    tax_excludes_shipping: boolean;
    tax_excludes_installation: boolean;
    tax_excludes_bank_charge: boolean;
    subtotal: string;
    net_items: string;
    taxable_base: string | null;
    tax_amount: string;
    grand_total: string;
  };
  terms: {
    price_basis: string;
    payment_terms: string;
    delivery_terms: string;
    warranty: string;
    additional_notes: string;
  };
};

export type PiVersion = {
  id: string;
  pi_id: string;
  revision: number;
  pi_number: string;
  generated_by: string;
  generated_at: string;
  snapshot: PiSnapshot;
  pdf_status: "pending" | "ready";
  pdf_path: string | null;
  layout_version: string;
  grand_total: string;
};

export type DraftLineInput = {
  product_id: string | null;
  vendor_id: string | null;
  model_code: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string | null;
};

export type DraftPayload = {
  preset_code: PresetCode | null;
  pi_date: string | null;
  expiry_date: string | null;
  client_id: string | null;
  client_contact_id: string | null;
  bill_to: string;
  ship_to: string;
  ship_same_as_billing: boolean;
  customer_reference: string;
  lead_salesperson_id: string | null;
  salesperson_ids: string[];
  discount_type: DiscountType;
  discount_value: string | null;
  shipping_amount: string | null;
  installation_amount: string | null;
  bank_charge_amount: string | null;
  tax_enabled: boolean;
  tax_percent: string | null;
  tax_excludes_shipping: boolean;
  tax_excludes_installation: boolean;
  tax_excludes_bank_charge: boolean;
  price_basis: string;
  payment_terms: string;
  delivery_terms: string;
  warranty: string;
  additional_notes: string;
  lines: DraftLineInput[];
};

export type GenerateResult = {
  id: string;
  draft_version: number;
  version_id: string;
  revision: number;
  pi_number: string;
  display_number: string;
  pdf_path: string;
  snapshot: PiSnapshot;
};

export type SaveDraftResult = {
  id: string;
  draft_version: number;
  subtotal: string;
  discount_amount: string;
  net_items: string;
  taxable_base: string | null;
  tax_amount: string;
  grand_total: string;
  line_totals: (string | null)[];
};

export const PRESETS: { code: PresetCode; label: string; office: OfficeCode; currency: CurrencyCode }[] = [
  { code: "EG-EGP", label: "Egypt — EGP", office: "EG", currency: "EGP" },
  { code: "AE-USD", label: "UAE — USD", office: "AE", currency: "USD" },
  { code: "AE-EUR", label: "UAE — EUR", office: "AE", currency: "EUR" },
];

export function presetByCode(code: string | null | undefined) {
  return PRESETS.find((preset) => preset.code === code) ?? null;
}

export function sellingPriceForCurrency(product: Product, currency: CurrencyCode | null): string | null {
  if (currency === "EGP") return product.sell_price_egp == null ? null : numericInputValue(product.sell_price_egp);
  if (currency === "USD") return product.sell_price_usd == null ? null : numericInputValue(product.sell_price_usd);
  if (currency === "EUR") return product.sell_price_eur == null ? null : numericInputValue(product.sell_price_eur);
  return null;
}
