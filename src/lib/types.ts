import { numericInputValue } from "./numeric-input";
import type { CanonicalPayment, CanonicalPaymentRow, PaymentSchedule, ResidualTarget } from "./payment-schedule";

export type PresetCode = string;
export type OfficeCode = string;
export type CurrencyCode = "EGP" | "USD" | "EUR";
export type DiscountType = "none" | "fixed" | "percent";
export type BillingType = "one_time" | "subscription";
export type LaterYearRule = "fixed_annual" | "vendor_confirmed_base_adjustment";
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
  can_manage_payments: boolean;
  can_reverse_payments: boolean;
  can_activate_zero_subscriptions: boolean;
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
  billing_type: BillingType;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  vendors?: { company_name: string; archived_at?: string | null } | null;
};

export type ProductCommitmentOption = {
  id: string;
  product_id: string;
  commitment_years: number;
  currency: CurrencyCode;
  first_year_unit_price: string | number;
  later_year_base_unit_price: string | number | null;
  later_year_rule: LaterYearRule | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductCost = {
  product_id: string;
  purchase_price: string | number | null;
  purchase_currency: CurrencyCode | null;
};

export type NumberingSequence = {
  code: string;
  prefix: string;
  created_at: string;
};

export type CompanyPreset = {
  code: PresetCode;
  display_name: string;
  office: OfficeCode;
  currency: CurrencyCode;
  layout: "egypt" | "uae";
  sequence_code: string;
  archived_at: string | null;
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
  subscription_agreement: SubscriptionAgreement | null;
};

export type StoredAllocationLine = {
  position: number;
  billing_type: BillingType;
  obligation_id: string | null;
  product_id: string | null;
  line_total: string;
  discount: string;
  discounted: string;
  shipping: string;
  installation: string;
  bank_charge: string;
  tax: string;
  allocated_total: string;
};

export type SubscriptionObligation = {
  id: string;
  product_id: string | null;
  position: number;
  amount: string;
  due_formula: string;
};

export type AllocatedCanonicalPayment = {
  schema_version: 2;
  currency: CurrencyCode;
  grand_total: string;
  subscription_total: string;
  one_time_total: string;
  customer_text: string;
  presentation: "paragraph" | "table";
  no_payment_due: boolean;
  subscription_obligations: SubscriptionObligation[];
  rows: CanonicalPaymentRow[];
  allocation: {
    residual_target: ResidualTarget | null;
    residual_applied: boolean;
    lines: StoredAllocationLine[];
  };
};

export type SubscriptionAgreement = {
  schema_version: 1;
  option_id: string;
  obligation_id: string;
  product_id: string;
  billing_type: "subscription";
  commitment_years: number;
  currency: CurrencyCode;
  current_year: 1;
  catalogue_first_year_unit_price: string;
  negotiated_first_year_unit_price: string;
  later_year_rule: LaterYearRule | null;
  later_year_base_unit_price: string | null;
  catalogue_later_year_base_unit_price: string | null;
  adjustment_compounds: false;
  payable_in_advance: true;
  customer_text: string;
};

export type ProformaInvoice = {
  id: string;
  preset_code: PresetCode | null;
  office: OfficeCode | null;
  currency: CurrencyCode | null;
  sequence_code: string | null;
  numbering_prefix: string | null;
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
  payment_schedule: PaymentSchedule | null;
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
  preset_code: PresetCode | null;
  preset_display_name: string | null;
};

export type SnapshotLine = {
  model_code: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  line_id?: string | null;
  product_id?: string | null;
  position?: number | null;
  subscription?: (SubscriptionAgreement & { payment_allocation?: StoredAllocationLine | null }) | null;
};

export type PiSnapshot = {
  layout_version: "egypt-v1" | "uae-v1" | "egypt-v2" | "uae-v2" | "egypt-v3" | "uae-v3";
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
  payment?: CanonicalPayment | AllocatedCanonicalPayment | null;
};

export type PiVersion = {
  id: string;
  pi_id: string;
  revision: number;
  pi_number: string;
  generated_by: string;
  generated_at: string;
  /** Null until this version's immutable snapshot is loaded. Downloads must not substitute current records. */
  snapshot: PiSnapshot | null;
  pdf_status: "pending" | "ready" | "issued";
  pdf_path: string | null;
  layout_version: string;
  grand_total: string;
};

export type DraftSubscriptionInput = {
  option_id: string;
  obligation_id: string | null;
  negotiated_first_year_unit_price: string | null;
  later_year_base_unit_price: string | null;
};

export type DraftLineInput = {
  product_id: string | null;
  vendor_id: string | null;
  model_code: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string | null;
  subscription?: DraftSubscriptionInput | null;
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
  payment_schedule: PaymentSchedule | null;
  delivery_terms: string;
  warranty: string;
  additional_notes: string;
  lines: DraftLineInput[];
  expected_currency?: string | null;
  expected_office?: string | null;
  expected_sequence_code?: string | null;
  expected_prefix?: string | null;
  confirm_preset_identity?: boolean;
};

export type GenerateResult = {
  id: string;
  draft_version: number;
  version_id: string;
  revision: number;
  pi_number: string;
  display_number: string;
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

export function sellingPriceForCurrency(
  product: {
    sell_price_egp: string | number | null;
    sell_price_usd: string | number | null;
    sell_price_eur: string | number | null;
  },
  currency: CurrencyCode | null,
): string | null {
  if (currency === "EGP") return product.sell_price_egp == null ? null : numericInputValue(product.sell_price_egp);
  if (currency === "USD") return product.sell_price_usd == null ? null : numericInputValue(product.sell_price_usd);
  if (currency === "EUR") return product.sell_price_eur == null ? null : numericInputValue(product.sell_price_eur);
  return null;
}
