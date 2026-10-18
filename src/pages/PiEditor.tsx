import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Card, Field, Modal, PageHeader, Select, TextArea, controlClass } from "../components/ui";
import { generateAndDownload, previewDraftPdf, saveDraft } from "../lib/documents";
import { errorText, isConflict } from "../lib/errors";
import { formatMoney } from "../lib/format";
import { calculateDocument } from "../lib/money";
import { numericInputValue } from "../lib/numeric-input";
import { can } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import {
  PRESETS,
  presetByCode,
  sellingPriceForCurrency,
  type Client,
  type ClientContact,
  type CompanyPreset,
  type CurrencyCode,
  type DiscountType,
  type DraftPayload,
  type PiLine,
  type PiSnapshot,
  type PresetCode,
  type Product,
  type Profile,
  type ProformaInvoice,
} from "../lib/types";

type LineDraft = {
  key: string;
  product_id: string | null;
  vendor_id: string | null;
  vendor_name: string;
  model_code: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
};

function blankLine(): LineDraft {
  return { key: crypto.randomUUID(), product_id: null, vendor_id: null, vendor_name: "", model_code: "", description: "", unit: "unit", quantity: "1", unit_price: "" };
}

function moneyOrNull(value: string, enabled: boolean): string | null {
  if (!enabled) return null;
  return value.trim();
}

export function PiEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = can(profile, "can_edit_drafts");
  const canGenerate = can(profile, "can_generate_pis");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftVersion, setDraftVersion] = useState(1);
  const [piNumber, setPiNumber] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(true);
  const [presetCode, setPresetCode] = useState<PresetCode | "">("");
  const [presets, setPresets] = useState<CompanyPreset[]>([]);
  const [piDate, setPiDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [contactId, setContactId] = useState("");
  const [billTo, setBillTo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [shipSame, setShipSame] = useState(true);
  const [reference, setReference] = useState("");
  const [salespeople, setSalespeople] = useState<Profile[]>([]);
  const [selectedSales, setSelectedSales] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [discountType, setDiscountType] = useState<DiscountType>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [shippingOn, setShippingOn] = useState(false);
  const [shipping, setShipping] = useState("");
  const [installationOn, setInstallationOn] = useState(false);
  const [installation, setInstallation] = useState("");
  const [bankOn, setBankOn] = useState(false);
  const [bankCharge, setBankCharge] = useState("");
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxPercent, setTaxPercent] = useState("");
  const [taxExcludesShipping, setTaxExcludesShipping] = useState(false);
  const [taxExcludesInstallation, setTaxExcludesInstallation] = useState(false);
  const [taxExcludesBank, setTaxExcludesBank] = useState(false);
  const [priceBasis, setPriceBasis] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [warranty, setWarranty] = useState("");
  const [notes, setNotes] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);

  const currency = presetByCode(presetCode)?.currency ?? null;

  async function load(piId: string) {
    const [piResult, lineResult, salesResult, presetResult, peopleResult] = await Promise.all([
      supabase.from("proforma_invoices").select("*").eq("id", piId).maybeSingle(),
      supabase.from("pi_lines").select("*").eq("pi_id", piId).order("position"),
      supabase.from("pi_salespeople").select("user_id").eq("pi_id", piId),
      supabase.from("company_presets").select("*"),
      supabase.from("profiles").select("*").eq("is_salesperson", true).order("full_name"),
    ]);
    if (piResult.error) throw piResult.error;
    if (!piResult.data) throw new Error("This draft was not found, or you do not have access to it.");
    const pi = piResult.data as ProformaInvoice;
    setDraftVersion(pi.draft_version);
    setPiNumber(pi.pi_number);
    setDraftOpen(pi.draft_open);
    setPresetCode(pi.preset_code ?? "");
    setPiDate(pi.pi_date ?? "");
    setExpiryDate(pi.expiry_date ?? "");
    setClientId(pi.client_id ?? "");
    setContactId(pi.client_contact_id ?? "");
    setBillTo(pi.bill_to);
    setShipTo(pi.ship_to);
    setShipSame(pi.ship_same_as_billing);
    setReference(pi.customer_reference);
    setLeadId(pi.lead_salesperson_id ?? "");
    setSelectedSales((salesResult.data ?? []).map((row) => row.user_id as string));
    setDiscountType(pi.discount_type);
    setDiscountValue(numericInputValue(pi.discount_value));
    setShippingOn(pi.shipping_amount !== null);
    setShipping(numericInputValue(pi.shipping_amount));
    setInstallationOn(pi.installation_amount !== null);
    setInstallation(numericInputValue(pi.installation_amount));
    setBankOn(pi.bank_charge_amount !== null);
    setBankCharge(numericInputValue(pi.bank_charge_amount));
    setTaxEnabled(pi.tax_enabled);
    setTaxPercent(numericInputValue(pi.tax_percent));
    setTaxExcludesShipping(pi.tax_excludes_shipping);
    setTaxExcludesInstallation(pi.tax_excludes_installation);
    setTaxExcludesBank(pi.tax_excludes_bank_charge);
    setPriceBasis(pi.price_basis);
    setPaymentTerms(pi.payment_terms);
    setDeliveryTerms(pi.delivery_terms);
    setWarranty(pi.warranty);
    setNotes(pi.additional_notes);
    const loadedLines = ((lineResult.data ?? []) as PiLine[]).map((line) => ({
      key: line.id,
      product_id: line.product_id,
      vendor_id: line.vendor_id,
      vendor_name: line.vendor_name,
      model_code: line.model_code,
      description: line.description,
      unit: line.unit,
      quantity: numericInputValue(line.quantity),
      unit_price: numericInputValue(line.unit_price),
    }));
    setLines(loadedLines.length ? loadedLines : [blankLine()]);
    setPresets((presetResult.data ?? []) as CompanyPreset[]);
    setSalespeople((peopleResult.data ?? []) as Profile[]);
    if (pi.client_id) {
      const clientResult = await supabase.from("clients").select("*").eq("id", pi.client_id).maybeSingle();
      if (clientResult.data) setClients([clientResult.data as Client]);
      const contactResult = await supabase.from("client_contacts").select("*").eq("client_id", pi.client_id).order("position");
      setContacts((contactResult.data ?? []) as ClientContact[]);
    }
  }

  useEffect(() => {
    if (!id) return;
    load(id).catch((caught) => setError(errorText(caught))).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const term = clientQuery.trim();
    if (term.length < 2) return;
    const handle = setTimeout(() => {
      void supabase.from("clients").select("*").is("archived_at", null).ilike("company_name", `%${term.replace(/[%_]/g, "")}%`).limit(20).then(({ data }) => {
        setClients((data ?? []) as Client[]);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [clientQuery]);

  useEffect(() => {
    if (!pickerOpen) return;
    const term = productQuery.trim().replace(/[%_]/g, "");
    let request = supabase.from("products").select("*, vendors(company_name)").is("archived_at", null).order("model_code").limit(20);
    if (term) request = request.or(`model_code.ilike.%${term}%,brand.ilike.%${term}%,description.ilike.%${term}%`);
    void request.then(({ data }) => setProducts((data ?? []) as Product[]));
  }, [pickerOpen, productQuery]);

  const totals = useMemo(() => {
    try {
      return {
        error: null as string | null,
        value: calculateDocument(
          lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unit_price.trim() ? line.unit_price.trim() : null })),
          {
            discountType,
            discountValue: discountType === "none" ? null : discountValue.trim() || "0",
            shipping: shippingOn ? shipping.trim() || "0" : null,
            installation: installationOn ? installation.trim() || "0" : null,
            bankCharge: bankOn ? bankCharge.trim() || "0" : null,
            taxEnabled,
            taxPercent: taxEnabled ? taxPercent.trim() || "0" : null,
            taxExcludesShipping,
            taxExcludesInstallation,
            taxExcludesBankCharge: taxExcludesBank,
          },
        ),
      };
    } catch (caught) {
      return { error: errorText(caught), value: null };
    }
  }, [bankCharge, bankOn, discountType, discountValue, installation, installationOn, lines, shipping, shippingOn, taxEnabled, taxExcludesBank, taxExcludesInstallation, taxExcludesShipping, taxPercent]);

  function payload(): DraftPayload {
    return {
      preset_code: presetCode || null,
      pi_date: piDate || null,
      expiry_date: expiryDate || null,
      client_id: clientId || null,
      client_contact_id: contactId || null,
      bill_to: billTo,
      ship_to: shipSame ? billTo : shipTo,
      ship_same_as_billing: shipSame,
      customer_reference: reference,
      lead_salesperson_id: leadId || null,
      salesperson_ids: Array.from(new Set(leadId ? [...selectedSales, leadId] : selectedSales)),
      discount_type: discountType,
      discount_value: discountType === "none" ? null : discountValue.trim() || null,
      shipping_amount: moneyOrNull(shipping, shippingOn),
      installation_amount: moneyOrNull(installation, installationOn),
      bank_charge_amount: moneyOrNull(bankCharge, bankOn),
      tax_enabled: taxEnabled,
      tax_percent: taxEnabled ? taxPercent.trim() || null : null,
      tax_excludes_shipping: taxExcludesShipping,
      tax_excludes_installation: taxExcludesInstallation,
      tax_excludes_bank_charge: taxExcludesBank,
      price_basis: priceBasis,
      payment_terms: paymentTerms,
      delivery_terms: deliveryTerms,
      warranty,
      additional_notes: notes,
      lines: lines.map((line) => ({
        product_id: line.product_id,
        vendor_id: line.vendor_id,
        model_code: line.model_code,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unit_price: line.unit_price.trim() ? line.unit_price.trim() : null,
      })),
    };
  }

  function previewSnapshot(): PiSnapshot {
    const preset = presets.find((item) => item.code === presetCode);
    if (!preset || !currency) throw new Error("Choose an office and currency preset before previewing.");
    if (!totals.value) throw new Error(totals.error ?? "Correct the totals before previewing.");
    const lead = salespeople.find((person) => person.id === leadId);
    const client = clients.find((item) => item.id === clientId);
    const contact = contacts.find((item) => item.id === contactId);
    const calculated = totals.value;
    return {
      layout_version: preset.layout === "uae" ? "uae-v1" : "egypt-v1",
      preset_code: preset.code,
      office: preset.office,
      currency: preset.currency,
      pi_number: piNumber ?? "DRAFT",
      revision: 0,
      revision_label: null,
      display_number: piNumber ?? "DRAFT",
      pi_date: piDate,
      expiry_date: expiryDate,
      customer_reference: reference,
      company: {
        name: preset.company_name,
        address: preset.address,
        phone: preset.phone,
        fax: preset.fax,
        email: preset.email,
        website: preset.website,
        tax_registration: preset.tax_registration,
        logo_base64: preset.logo_base64,
        logo_content_type: preset.logo_content_type,
      },
      bank: {
        bank_name: preset.bank_name,
        branch: preset.bank_branch,
        address: preset.bank_address,
        swift: preset.bank_swift,
        account_name: preset.account_name,
        account_number: preset.account_number,
        iban: preset.iban,
        correspondent_bank: preset.correspondent_bank,
        notes: preset.bank_notes,
      },
      client: {
        company_name: client?.company_name ?? "",
        country: client?.country ?? "",
        tax_number: client?.tax_number ?? "",
        contact_name: contact?.name ?? "",
        contact_job_title: contact?.job_title ?? "",
        contact_phone: contact?.phone ?? "",
        contact_email: contact?.email ?? "",
      },
      bill_to: billTo,
      ship_to: shipSame ? billTo : shipTo,
      sales: {
        lead_name: lead?.full_name ?? "",
        lead_phone: lead?.phone ?? "",
        additional: [],
        prepared_by: profile?.full_name ?? "",
      },
      lines: lines.map((line, index) => ({
        model_code: line.model_code,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_total: calculated.lines[index]?.lineTotal ?? "",
      })),
      adjustments: {
        discount_type: discountType,
        discount_value: discountValue || null,
        discount_amount: calculated.discountAmount,
        shipping: shippingOn ? shipping : null,
        installation: installationOn ? installation : null,
        bank_charge: bankOn ? bankCharge : null,
        tax_enabled: taxEnabled,
        tax_percent: taxPercent || null,
        tax_excludes_shipping: taxExcludesShipping,
        tax_excludes_installation: taxExcludesInstallation,
        tax_excludes_bank_charge: taxExcludesBank,
        subtotal: calculated.subtotal,
        net_items: calculated.netItems,
        taxable_base: calculated.taxableBase,
        tax_amount: calculated.taxAmount,
        grand_total: calculated.grandTotal,
      },
      terms: { price_basis: priceBasis, payment_terms: paymentTerms, delivery_terms: deliveryTerms, warranty, additional_notes: notes },
    };
  }

  async function onSave() {
    if (!id) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const result = await saveDraft(id, draftVersion, payload());
      setDraftVersion(result.draft_version);
      setMessage("Draft saved.");
    } catch (caught) {
      setConflict(isConflict(caught));
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    if (!id) return;
    if (!window.confirm(piNumber ? "Issue the next revision of this PI? The previous version stays unchanged." : "Issue this PI? It will receive a permanent number.")) return;
    setBusy(true);
    setError(null);
    try {
      await generateAndDownload(id, draftVersion, payload());
      navigate(`/pis/${id}`);
    } catch (caught) {
      setConflict(isConflict(caught));
      setError(errorText(caught));
      if (!isConflict(caught) && errorText(caught).includes("was issued")) navigate(`/pis/${id}`);
    } finally {
      setBusy(false);
    }
  }

  function addProduct(product: Product) {
    const price = currency ? sellingPriceForCurrency(product, currency) : null;
    setLines((current) => [
      ...current.filter((line) => line.model_code || line.description || line.unit_price),
      {
        key: crypto.randomUUID(),
        product_id: product.id,
        vendor_id: product.vendor_id,
        vendor_name: product.vendors?.company_name ?? "",
        model_code: product.model_code,
        description: [product.brand, product.description].filter(Boolean).join("\n"),
        unit: product.unit,
        quantity: "1",
        unit_price: numericInputValue(price),
      },
    ]);
    setPickerOpen(false);
    if (price === null) setMessage(`No default ${currency ?? ""} selling price for ${product.model_code}. Enter the price for this PI.`);
  }

  function moveLine(index: number, direction: -1 | 1) {
    setLines((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      if (!item) return current;
      next.splice(target, 0, item);
      return next;
    });
  }

  async function chooseClient(nextId: string) {
    setClientId(nextId);
    setContactId("");
    const client = clients.find((item) => item.id === nextId);
    if (client) {
      setBillTo(client.billing_address);
      if (shipSame) setShipTo(client.billing_address);
    }
    const { data } = await supabase.from("client_contacts").select("*").eq("client_id", nextId).order("position");
    const loaded = (data ?? []) as ClientContact[];
    setContacts(loaded);
    const primary = loaded.find((contact) => contact.is_primary);
    if (primary) setContactId(primary.id);
  }

  if (loading) return <p className="text-sm text-slate-600">Loading draft…</p>;
  if (!draftOpen) {
    return (
      <div className="space-y-3">
        <Banner tone="info">This PI is issued. Create a revision before editing it.</Banner>
        <Link to={`/pis/${id}`}><Button>Open PI</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={piNumber ? `Edit ${piNumber}` : "New proforma invoice"}
        subtitle="Prepared by is recorded automatically when you generate. Totals below are confirmed by the database when you save."
        actions={
          <>
            <Link to={`/pis/${id}`}><Button type="button" variant="secondary">View</Button></Link>
            {canEdit ? <Button type="button" onClick={() => void onSave()} disabled={busy}>Save draft</Button> : null}
            <Button type="button" onClick={() => { try { void previewDraftPdf(previewSnapshot()); } catch (caught) { setError(errorText(caught)); } }} disabled={busy}>Preview</Button>
            {canGenerate ? <Button type="button" variant="primary" onClick={() => void onGenerate()} disabled={busy}>{busy ? "Working…" : "Generate & Download"}</Button> : null}
          </>
        }
      />
      {error ? <Banner tone="error">{error} {conflict && id ? <button type="button" className="ml-2 underline" onClick={() => { setLoading(true); void load(id).finally(() => setLoading(false)); }}>Reload draft</button> : null}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      {!canEdit ? <Banner tone="info">You can view this draft but cannot change it.</Banner> : null}
      <Card>
        <h2 className="mb-3 font-semibold">Header</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Office / currency">
            <Select value={presetCode} disabled={!canEdit || Boolean(piNumber)} onChange={(event) => setPresetCode(event.target.value as PresetCode | "")}>
              <option value="">Select a preset</option>
              {PRESETS.map((preset) => <option key={preset.code} value={preset.code}>{preset.label}</option>)}
            </Select>
          </Field>
          <Field label="PI date"><input className={controlClass} type="date" disabled={!canEdit} value={piDate} onChange={(event) => setPiDate(event.target.value)} /></Field>
          <Field label="Expiry date"><input className={controlClass} type="date" disabled={!canEdit} value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></Field>
          <Field label="Find client">
            <input className={controlClass} disabled={!canEdit} value={clientQuery} placeholder="Type at least 2 letters" onChange={(event) => setClientQuery(event.target.value)} />
          </Field>
          <Field label="Client">
            <Select value={clientId} disabled={!canEdit} onChange={(event) => void chooseClient(event.target.value)}>
              <option value="">Select</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
            </Select>
          </Field>
          <Field label="Client contact">
            <Select value={contactId} disabled={!canEdit} onChange={(event) => setContactId(event.target.value)}>
              <option value="">None</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
            </Select>
          </Field>
          <Field label="Customer reference / SO"><input className={controlClass} disabled={!canEdit} value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Bill to"><TextArea disabled={!canEdit} value={billTo} onChange={(event) => { setBillTo(event.target.value); if (shipSame) setShipTo(event.target.value); }} /></Field>
          <Field label="Ship to">
            <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={shipSame} disabled={!canEdit} onChange={(event) => { setShipSame(event.target.checked); if (event.target.checked) setShipTo(billTo); }} /> Same as billing</label>
            <TextArea disabled={!canEdit || shipSame} value={shipSame ? billTo : shipTo} onChange={(event) => setShipTo(event.target.value)} />
          </Field>
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Sales attribution</h2>
        <div className="space-y-2">
          {salespeople.filter((person) => person.is_active || selectedSales.includes(person.id) || person.id === leadId).map((person) => {
            const checked = selectedSales.includes(person.id) || person.id === leadId;
            return (
              <label key={person.id} className="flex flex-wrap items-center gap-3 text-sm">
                <input type="checkbox" disabled={!canEdit} checked={checked} onChange={(event) => {
                  setSelectedSales((current) => event.target.checked ? [...current, person.id] : current.filter((item) => item !== person.id));
                  if (!event.target.checked && leadId === person.id) setLeadId("");
                  if (event.target.checked && !leadId) setLeadId(person.id);
                }} />
                <input type="radio" name="lead" disabled={!canEdit || !checked} checked={leadId === person.id} onChange={() => setLeadId(person.id)} />
                <span>{person.full_name}{person.phone ? ` · ${person.phone}` : ""}{person.is_active ? "" : " (disabled)"}</span>
                {leadId === person.id ? <span className="text-xs text-navy-800">Lead</span> : null}
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-slate-600">Prepared by: {profile?.full_name}. This is recorded when the version is generated and cannot be edited.</p>
      </Card>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Items</h2>
          {canEdit ? (
            <div className="flex gap-2">
              <Button type="button" onClick={() => setPickerOpen(true)}>Add from catalogue</Button>
              <Button type="button" onClick={() => setLines((current) => [...current, blankLine()])}>Add custom item</Button>
            </div>
          ) : null}
        </div>
        <p className="mb-3 text-sm text-slate-600">One PI can include products from several vendors. Vendor is internal and is omitted from the PDF. Editing a line does not change the catalogue.</p>
        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={line.key} className="rounded-md border border-slate-200 p-3">
              <div className="grid gap-2 md:grid-cols-6">
                <Field label="Model"><input className={controlClass} disabled={!canEdit} value={line.model_code} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, model_code: event.target.value } : item))} /></Field>
                <Field label="Unit"><input className={controlClass} disabled={!canEdit} value={line.unit} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, unit: event.target.value } : item))} /></Field>
                <Field label="Quantity"><input className={controlClass} inputMode="decimal" disabled={!canEdit} value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></Field>
                <Field label={`Unit price${currency ? ` (${currency})` : ""}`}><input className={controlClass} inputMode="decimal" disabled={!canEdit} value={line.unit_price} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, unit_price: event.target.value } : item))} /></Field>
                <Field label="Line total"><input className={controlClass} readOnly value={formatMoney(totals.value?.lines[index]?.lineTotal, currency)} /></Field>
                <Field label="Vendor (internal)"><input className={controlClass} readOnly value={line.vendor_name} /></Field>
              </div>
              <div className="mt-2">
                <Field label="Description"><TextArea disabled={!canEdit} value={line.description} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, description: event.target.value } : item))} /></Field>
              </div>
              {canEdit ? (
                <div className="mt-2 flex gap-2">
                  <Button type="button" onClick={() => moveLine(index, -1)}>Move up</Button>
                  <Button type="button" onClick={() => moveLine(index, 1)}>Move down</Button>
                  <Button type="button" variant="ghost" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>Remove</Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Adjustments</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Discount">
            <Select disabled={!canEdit} value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountType)}>
              <option value="none">None</option>
              <option value="percent">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          {discountType !== "none" ? <Field label={discountType === "percent" ? "Discount percent" : "Discount amount"}><input className={controlClass} inputMode="decimal" disabled={!canEdit} value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} /></Field> : null}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Charge label="Shipping" enabled={shippingOn} amount={shipping} onEnabled={setShippingOn} onAmount={setShipping} disabled={!canEdit} />
          <Charge label="Installation" enabled={installationOn} amount={installation} onEnabled={setInstallationOn} onAmount={setInstallation} disabled={!canEdit} />
          <Charge label="Bank charge" enabled={bankOn} amount={bankCharge} onEnabled={setBankOn} onAmount={setBankCharge} disabled={!canEdit} />
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={taxEnabled} onChange={(event) => setTaxEnabled(event.target.checked)} /> Apply tax</label>
          {taxEnabled ? (
            <>
              <Field label="Tax percentage"><input className={controlClass} inputMode="decimal" disabled={!canEdit} value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} /></Field>
              {shippingOn ? <label className="flex items-center gap-2"><input type="checkbox" checked={taxExcludesShipping} onChange={(event) => setTaxExcludesShipping(event.target.checked)} /> Exclude shipping from tax</label> : null}
              {installationOn ? <label className="flex items-center gap-2"><input type="checkbox" checked={taxExcludesInstallation} onChange={(event) => setTaxExcludesInstallation(event.target.checked)} /> Exclude installation from tax</label> : null}
              {bankOn ? <label className="flex items-center gap-2"><input type="checkbox" checked={taxExcludesBank} onChange={(event) => setTaxExcludesBank(event.target.checked)} /> Exclude bank charge from tax</label> : null}
            </>
          ) : null}
        </div>
        <dl className="mt-4 grid gap-1 text-sm md:grid-cols-2">
          {totals.error ? <p className="text-red-800">{totals.error}</p> : (
            <>
              <div>Subtotal: {formatMoney(totals.value?.subtotal, currency)}</div>
              <div>Discount: {formatMoney(totals.value?.discountAmount, currency)}</div>
              <div>Net items: {formatMoney(totals.value?.netItems, currency)}</div>
              {taxEnabled ? <div>Taxable base: {formatMoney(totals.value?.taxableBase, currency)}</div> : null}
              {taxEnabled ? <div>Tax: {formatMoney(totals.value?.taxAmount, currency)}</div> : null}
              <div className="font-semibold">Grand total: {formatMoney(totals.value?.grandTotal, currency)}</div>
              {totals.value && totals.value.unpricedCount > 0 ? <div className="text-red-800">{totals.value.unpricedCount} line(s) still need a selling price.</div> : null}
            </>
          )}
        </dl>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Commercial terms</h2>
        <div className="grid gap-3">
          <Field label="Price basis / delivery basis"><TextArea disabled={!canEdit} value={priceBasis} onChange={(event) => setPriceBasis(event.target.value)} /></Field>
          <Field label="Payment terms"><TextArea disabled={!canEdit} value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} /></Field>
          <Field label="Delivery terms or lead time"><TextArea disabled={!canEdit} value={deliveryTerms} onChange={(event) => setDeliveryTerms(event.target.value)} /></Field>
          <Field label="Warranty"><TextArea disabled={!canEdit} value={warranty} onChange={(event) => setWarranty(event.target.value)} /></Field>
          <Field label="Additional notes"><TextArea disabled={!canEdit} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        </div>
      </Card>
      {pickerOpen ? (
        <Modal title="Add a catalogue product" onClose={() => setPickerOpen(false)}>
          <Field label="Search"><input className={controlClass} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} /></Field>
          <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
            {products.map((product) => (
              <li key={product.id}>
                <button type="button" className="w-full rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50" onClick={() => addProduct(product)}>
                  <span className="font-medium">{product.model_code}</span> · {product.brand} · {product.vendors?.company_name}
                  <span className="block text-slate-500">{currency ? formatMoney(sellingPriceForCurrency(product, currency as CurrencyCode), currency) : "Choose a currency first"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}

function Charge({
  label,
  enabled,
  amount,
  onEnabled,
  onAmount,
  disabled,
}: {
  label: string;
  enabled: boolean;
  amount: string;
  onEnabled: (value: boolean) => void;
  onAmount: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-2 text-sm font-medium"><input type="checkbox" disabled={disabled} checked={enabled} onChange={(event) => onEnabled(event.target.checked)} /> {label}</label>
      <input className={controlClass} inputMode="decimal" disabled={disabled || !enabled} value={amount} onChange={(event) => onAmount(event.target.value)} />
    </div>
  );
}
