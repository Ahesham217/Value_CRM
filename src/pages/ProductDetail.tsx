import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { CommitmentOptions } from "../components/CommitmentOptions";
import { ProductPiHistory } from "../components/ProductPiHistory";
import { Banner, Button, Disclosure, Field, Menu, PageHeader, Select, TextArea, buttonClass, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { isUniqueModelConflict } from "../lib/model-identity";
import { can } from "../lib/permissions";
import { numericInputValue } from "../lib/numeric-input";
import { archiveRow } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { BillingType, CurrencyCode, Product, ProductCost, Vendor } from "../lib/types";
import { recordOptionalSummary } from "../lib/workspace-view";

function optionalPrice(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function ProductDetailPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { profile } = useAuth();
  const manage = can(profile, "can_manage_products");
  const seeCost = can(profile, "can_view_purchase_prices");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [brand, setBrand] = useState("");
  const [brandOpen, setBrandOpen] = useState(false);
  const [modelCode, setModelCode] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("unit");
  const [egp, setEgp] = useState("");
  const [usd, setUsd] = useState("");
  const [eur, setEur] = useState("");
  const [billingType, setBillingType] = useState<BillingType>("one_time");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseCurrency, setPurchaseCurrency] = useState<CurrencyCode | "">("");
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [found, setFound] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from("vendors").select("*").is("archived_at", null).order("company_name").limit(500).then(async ({ data, error: vendorError }) => {
      if (!active) return;
      if (vendorError) {
        setError(errorText(vendorError));
        setLoading(false);
        return;
      }
      setVendors((data ?? []) as Vendor[]);
      if (!id) {
        setLoading(false);
        return;
      }
      const productResult = await supabase.from("products").select("*").eq("id", id).maybeSingle();
      if (!active) return;
      if (productResult.error || !productResult.data) {
        setError(productResult.error ? errorText(productResult.error) : "Product not found.");
        setLoading(false);
        return;
      }
      const product = productResult.data as Product;
      setVendorId(product.vendor_id);
      setBrand(product.brand);
      setModelCode(product.model_code);
      setDescription(product.description);
      setUnit(product.unit);
      setEgp(numericInputValue(product.sell_price_egp));
      setUsd(numericInputValue(product.sell_price_usd));
      setEur(numericInputValue(product.sell_price_eur));
      setBillingType(product.billing_type ?? "one_time");
      setArchivedAt(product.archived_at);
      setFound(true);
      if (seeCost) {
        const costResult = await supabase.from("product_costs").select("*").eq("product_id", id).maybeSingle();
        if (costResult.data) {
          const cost = costResult.data as ProductCost;
          setPurchasePrice(numericInputValue(cost.purchase_price));
          setPurchaseCurrency(cost.purchase_currency ?? "");
        }
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id, seeCost]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!manage) return;
    setSaving(true);
    setError(null);
    try {
      if (!vendorId) throw new Error("Choose a vendor.");
      if (!modelCode.trim()) throw new Error("Model is required.");
      const payload = {
        vendor_id: vendorId,
        brand: brand.trim(),
        model_code: modelCode.trim(),
        description: description.trim(),
        unit: unit.trim() || "unit",
        sell_price_egp: optionalPrice(egp),
        sell_price_usd: optionalPrice(usd),
        sell_price_eur: optionalPrice(eur),
        billing_type: billingType,
      };
      let productId = id;
      if (!productId) {
        const { data, error: insertError } = await supabase.from("products").insert(payload).select("id").single();
        if (insertError) throw insertError;
        productId = data.id as string;
      } else {
        const { error: updateError } = await supabase.from("products").update(payload).eq("id", productId);
        if (updateError) throw updateError;
      }
      if (seeCost && manage) {
        const price = optionalPrice(purchasePrice);
        if (!price) {
          await supabase.from("product_costs").delete().eq("product_id", productId);
        } else {
          if (!purchaseCurrency) throw new Error("Choose a currency for the purchase price.");
          const { error: costError } = await supabase.from("product_costs").upsert({
            product_id: productId,
            purchase_price: price,
            purchase_currency: purchaseCurrency,
          });
          if (costError) throw costError;
        }
      }
      setMessage("Product saved. Existing invoice lines are unchanged.");
      setHistoryRefresh((current) => current + 1);
      if (!id) navigate(`/products/${productId}`, { replace: true });
    } catch (caught) {
      setError(isUniqueModelConflict(caught)
        ? `A product with model “${modelCode.trim()}” already exists. Matching ignores capitalisation and surrounding spaces, including archived products.`
        : errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Loading product…</p>;

  const extraSummary = recordOptionalSummary([
    { label: "Brand", value: brand },
    ...(seeCost && purchasePrice ? [{ label: "Purchase price", value: `${purchasePrice} ${purchaseCurrency}`.trim() }] : []),
  ]);

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="space-y-3">
        <PageHeader
          title={isNew ? "New product" : modelCode || "Product"}
          subtitle={archivedAt ? "Archived. Invoice lines that already use it stay unchanged." : "A blank selling price is unknown, not zero."}
          actions={
            <>
              <Link to="/products" className={buttonClass("secondary")}>Back</Link>
              {id && manage ? (
                <Menu
                  label="More"
                  items={[{
                    label: archivedAt ? "Restore" : "Archive",
                    tone: "danger",
                    onSelect: () => {
                      if (!window.confirm(archivedAt ? "Restore this product?" : "Archive this product?")) return;
                      void archiveRow("products", id, !archivedAt)
                        .then(() => setArchivedAt(archivedAt ? null : new Date().toISOString()))
                        .catch((caught) => setError(errorText(caught)));
                    },
                  }]}
                />
              ) : null}
              {manage ? <Button variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button> : null}
            </>
          }
        />
        {error ? <Banner tone="error">{error}</Banner> : null}
        {message ? <Banner tone="success">{message}</Banner> : null}
        {!manage ? <Banner tone="info">You can view this product. An administrator has not given you permission to change products.</Banner> : null}
        <section className="rounded-[10px] border border-line bg-white p-6">
          <h2 className="text-[15px] font-semibold text-ink">Product details</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label="Model" hint="Unique across the catalogue. Capitalisation and surrounding spaces do not make a different model.">
              <input className={controlClass} required disabled={!manage} value={modelCode} onChange={(event) => setModelCode(event.target.value)} />
            </Field>
            <Field label="Vendor">
              <Select required disabled={!manage} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
                <option value="">Select a vendor</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.company_name}</option>)}
              </Select>
            </Field>
            <Field label="Billing" hint="Existing products stay one-time until this is changed. Subscription prices are the commitment options below, not a conversion of these selling prices.">
              <Select disabled={!manage} value={billingType} onChange={(event) => setBillingType(event.target.value as BillingType)}>
                <option value="one_time">One-time</option>
                <option value="subscription">Subscription</option>
              </Select>
            </Field>
            <Field label="Unit" hint="For example unit, set, license, or service.">
              <input className={controlClass} list="units" disabled={!manage} value={unit} onChange={(event) => setUnit(event.target.value)} />
              <datalist id="units"><option value="unit" /><option value="set" /><option value="license" /><option value="service" /></datalist>
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Description"><TextArea disabled={!manage} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-[13px] font-medium text-muted">Selling prices</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <PriceInput code="EGP" value={egp} disabled={!manage} onChange={setEgp} />
              <PriceInput code="USD" value={usd} disabled={!manage} onChange={setUsd} />
              <PriceInput code="EUR" value={eur} disabled={!manage} onChange={setEur} />
            </div>
            <p className="mt-1 text-xs text-slate-500">A blank price is unknown, not zero. Prices are not converted between currencies.</p>
          </div>
          <div className="mt-4">
            <Disclosure title="Additional product details" summary={extraSummary} open={brandOpen} onToggle={() => setBrandOpen((current) => !current)} quiet>
              <Field label="Brand">
                <input className={controlClass} disabled={!manage} value={brand} onChange={(event) => setBrand(event.target.value)} />
              </Field>
              {seeCost ? (
                <div className="mt-3">
                  <h3 className="text-sm font-semibold text-ink">Purchase price</h3>
                  <p className="mt-1 text-xs text-slate-500">Only people with purchase-price permission can see this. It never appears on a customer PDF or in PI history.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Purchase price"><input className={controlClass} inputMode="decimal" disabled={!manage} value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></Field>
                    <Field label="Currency">
                      <Select disabled={!manage} value={purchaseCurrency} onChange={(event) => setPurchaseCurrency(event.target.value as CurrencyCode | "")}>
                        <option value="">Not set</option>
                        <option value="EGP">EGP</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              ) : null}
            </Disclosure>
          </div>
        </section>
      </form>
      {id && found && billingType === "subscription" ? <CommitmentOptions productId={id} canManage={manage} /> : null}
      {id && found ? <ProductPiHistory key={id} productId={id} refreshKey={historyRefresh} /> : null}
    </div>
  );
}

function PriceInput({
  code,
  value,
  disabled,
  onChange,
}: {
  code: CurrencyCode;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0">
      <span className="inline-flex h-10 shrink-0 items-center rounded-l-md border border-r-0 border-line bg-canvas px-2.5 text-sm text-muted">{code}</span>
      <input
        className="h-10 min-w-0 flex-1 rounded-r-md border border-line bg-white px-3 text-sm text-ink tabular-nums disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted"
        inputMode="decimal"
        aria-label={`Selling price ${code}`}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
