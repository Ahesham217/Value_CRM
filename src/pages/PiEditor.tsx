import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ClientCombobox } from "../components/ClientCombobox";
import { PaymentScheduleSection } from "../components/PaymentScheduleSection";
import { PiItemSection } from "../components/PiItemSection";
import { Banner, Button, Disclosure, Field, Select, TextArea, buttonClass, controlClass } from "../components/ui";
import { toCatalogueProduct } from "../lib/catalogue";
import { generateAndDownload, isIssuedDownloadError, previewDraftPdf, saveDraft } from "../lib/documents";
import { errorText, isConflict } from "../lib/errors";
import { formatMoney } from "../lib/format";
import { calculateDocument } from "../lib/money";
import { emptyPaymentSchedule, issueList, previewPaymentSchedule, readPaymentSchedule, type PaymentSchedule } from "../lib/payment-schedule";
import { adjustScheduleForSubscriptionSelection, applySubscriptionConversion, commitmentCustomerText, previewAllocatedPayment, subscriptionConversionPlan, type PortionLine } from "../lib/subscription";
import { numericInputValue } from "../lib/numeric-input";
import { can } from "../lib/permissions";
import { editorLineFromStored, generationBlock, isBlankPlaceholder, isResolvedLine, linesForDraft, type EditorLine } from "../lib/pi-lines";
import { layoutLabel, presetOptionLabel, subscriptionCurrencyMismatch } from "../lib/presets";
import { supabase } from "../lib/supabase";
import {
  type Client,
  type ClientContact,
  type CompanyPreset,
  type DiscountType,
  type DraftLineInput,
  type DraftPayload,
  type PiLine,
  type PiSnapshot,
  type Product,
  type ProductCommitmentOption,
  type Profile,
  type ProformaInvoice,
} from "../lib/types";
import {
  additionalSalesSummary,
  adjustmentRows,
  billingSummary,
  clientOptionalSummary,
  contactLine,
  editorFingerprint,
  moneyLabel,
  recordOptionalSummary,
  taxExclusionNotes,
  type AdjustmentKey,
} from "../lib/workspace-view";

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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<"save" | "generate" | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const acting = useRef(false);
  const captureBaseline = useRef(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [draftVersion, setDraftVersion] = useState(1);
  const [piNumber, setPiNumber] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(true);
  const [presetCode, setPresetCode] = useState("");
  const [presets, setPresets] = useState<CompanyPreset[]>([]);
  const [piDate, setPiDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientRecord, setClientRecord] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [contactId, setContactId] = useState("");
  const [billTo, setBillTo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [shipSame, setShipSame] = useState(true);
  const [reference, setReference] = useState("");
  const [editingClient, setEditingClient] = useState(false);
  const [clientDetailsOpen, setClientDetailsOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [salespeople, setSalespeople] = useState<Profile[]>([]);
  const [selectedSales, setSelectedSales] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [commitments, setCommitments] = useState<ProductCommitmentOption[]>([]);
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
  const [paymentMode, setPaymentMode] = useState<"legacy" | "structured">("structured");
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentSchedule>(emptyPaymentSchedule());
  const [loadedLegacy, setLoadedLegacy] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [warranty, setWarranty] = useState("");
  const [notes, setNotes] = useState("");

  const selectedPreset = presets.find((preset) => preset.code === presetCode) ?? null;
  const currency = selectedPreset?.currency ?? null;
  const currencyWarning = subscriptionCurrencyMismatch(lines, currency);
  const officeChoices = presets
    .filter((preset) => preset.archived_at == null || preset.code === presetCode)
    .slice()
    .sort((left, right) => left.display_name.localeCompare(right.display_name) || left.code.localeCompare(right.code));

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
    if (pi.payment_schedule == null) {
      setPaymentMode("legacy");
      setLoadedLegacy(true);
      setPaymentSchedule(emptyPaymentSchedule());
    } else {
      const schedule = readPaymentSchedule(pi.payment_schedule);
      if (!schedule) throw new Error("The saved payment schedule could not be read.");
      setPaymentMode("structured");
      setLoadedLegacy(false);
      setPaymentSchedule(schedule);
    }
    setDeliveryTerms(pi.delivery_terms);
    setWarranty(pi.warranty);
    setNotes(pi.additional_notes);
    const storedLines = (lineResult.data ?? []) as PiLine[];
    const productIds = [...new Set(storedLines.flatMap((line) => (line.product_id ? [line.product_id] : [])))];
    const linked = new Map<string, ReturnType<typeof toCatalogueProduct>>();
    if (productIds.length > 0) {
      const productResult = await supabase.from("products").select("*, vendors(company_name, archived_at)").in("id", productIds);
      if (productResult.error) throw productResult.error;
      for (const row of (productResult.data ?? []) as Product[]) {
        const product = toCatalogueProduct(row);
        linked.set(product.id, product);
      }
    }
    setLines(storedLines.map((line) => {
      const product = line.product_id ? linked.get(line.product_id) : undefined;
      return editorLineFromStored(line, product ? {
        id: product.id,
        model_code: product.model_code,
        vendor_id: product.vendor_id,
        vendor_name: product.vendor_name,
        vendor_archived: product.vendor_archived,
        billing_type: product.billing_type,
      } : null);
    }));
    setPresets((presetResult.data ?? []) as CompanyPreset[]);
    setSalespeople((peopleResult.data ?? []) as Profile[]);
    if (pi.client_id) {
      const clientResult = await supabase.from("clients").select("*").eq("id", pi.client_id).maybeSingle();
      if (clientResult.data) {
        const client = clientResult.data as Client;
        setClientRecord(client);
        setClientQuery(client.company_name);
      }
      const contactResult = await supabase.from("client_contacts").select("*").eq("client_id", pi.client_id).order("position");
      setContacts((contactResult.data ?? []) as ClientContact[]);
    } else {
      setClientRecord(null);
      setClientQuery("");
      setContacts([]);
    }
    setReady(true);
    captureBaseline.current = true;
  }

  useEffect(() => {
    if (!id) return;
    load(id).catch((caught) => setError(errorText(caught))).finally(() => setLoading(false));
  }, [id]);

  const commitmentProductIds = lines.flatMap((line) => (line.product ? [line.product.id] : [])).sort().join(",");
  useEffect(() => {
    const ids = commitmentProductIds ? commitmentProductIds.split(",") : [];
    if (ids.length === 0) {
      setCommitments([]);
      return;
    }
    let active = true;
    supabase.from("product_commitment_options").select("*").in("product_id", ids).then((result) => {
      if (!active) return;
      if (result.error) {
        setError(errorText(result.error));
        return;
      }
      setCommitments((result.data ?? []) as ProductCommitmentOption[]);
    });
    return () => {
      active = false;
    };
  }, [commitmentProductIds]);

  const totals = useMemo(() => {
    try {
      return {
        error: null as string | null,
        value: calculateDocument(
          lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice.trim() ? line.unitPrice.trim() : null })),
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

  const paymentGrandTotal = totals.value && totals.value.unpricedCount === 0 ? totals.value.grandTotal : null;
  const hasSubscription = lines.some((line) => isResolvedLine(line) && line.product?.billingType === "subscription");
  const resolvedLines = lines.filter((line) => isResolvedLine(line));
  const subscriptionOnly = resolvedLines.length > 0 && resolvedLines.every((line) => line.product?.billingType === "subscription");
  const conversion = subscriptionConversionPlan({
    mode: paymentMode,
    schedule: paymentSchedule,
    hasSubscription,
    subscriptionOnly,
  });
  const needsConversion = conversion != null;
  const conversionMessage = conversion?.message ?? null;
  const portionLines: PortionLine[] = lines.map((line, index) => ({
    position: index + 1,
    billingType: line.product?.billingType === "subscription" ? "subscription" : "one_time",
    lineTotal: totals.value?.lines[index]?.lineTotal ?? null,
    obligationId: line.subscription?.obligationId ?? null,
    productId: line.product?.id ?? null,
  }));
  const paymentPreview = useMemo(
    () => previewPaymentSchedule(paymentSchedule, currency, paymentGrandTotal),
    [currency, paymentGrandTotal, paymentSchedule],
  );
  const allocatedPreview = useMemo(() => {
    if (paymentSchedule.schema_version !== 2 || !totals.value || paymentGrandTotal == null) return null;
    return previewAllocatedPayment({
      schedule: paymentSchedule,
      currency,
      lines: portionLines,
      discountAmount: totals.value.discountAmount,
      shipping: totals.value.shipping,
      installation: totals.value.installation,
      bankCharge: totals.value.bankCharge,
      taxAmount: totals.value.taxAmount,
      taxEnabled,
      taxExcludesShipping,
      taxExcludesInstallation,
      taxExcludesBankCharge: taxExcludesBank,
      grandTotal: paymentGrandTotal,
    });
  }, [currency, paymentGrandTotal, paymentSchedule, portionLines, taxEnabled, taxExcludesBank, taxExcludesInstallation, taxExcludesShipping, totals.value]);

  function paymentIssue(): string | null {
    if (needsConversion) return conversionMessage;
    if (paymentMode === "legacy") return null;
    if (paymentSchedule.schema_version === 2) {
      if (allocatedPreview?.ready) return null;
      return issueList(allocatedPreview?.issues ?? []) || "Complete the payment allocation before continuing.";
    }
    if (paymentPreview.ready) return null;
    return issueList(paymentPreview.issues) || "Complete the payment schedule before continuing.";
  }

  const fingerprint = useMemo(() => editorFingerprint({
    presetCode,
    piDate,
    expiryDate,
    clientId,
    contactId,
    billTo,
    shipTo,
    shipSame,
    reference,
    leadId,
    salespersonIds: selectedSales,
    lines: lines.map((line) => ({
      productId: line.product?.id ?? "",
      model: line.modelInput,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      commitmentOptionId: line.subscription?.optionId ?? "",
      laterYearBase: line.subscription?.laterYearBaseUnitPrice ?? "",
    })),
    discountType,
    discountValue,
    shippingOn,
    shipping,
    installationOn,
    installation,
    bankOn,
    bankCharge,
    taxEnabled,
    taxPercent,
    taxExcludesShipping,
    taxExcludesInstallation,
    taxExcludesBank,
    priceBasis,
    paymentTerms,
    paymentMode,
    paymentSchedule,
    deliveryTerms,
    warranty,
    notes,
  }), [
    bankCharge, bankOn, billTo, clientId, contactId, deliveryTerms, discountType, discountValue, expiryDate,
    installation, installationOn, leadId, lines, notes, paymentMode, paymentSchedule, paymentTerms, piDate, presetCode, priceBasis, reference,
    selectedSales, shipSame, shipTo, shipping, shippingOn, taxEnabled, taxExcludesBank, taxExcludesInstallation,
    taxExcludesShipping, taxPercent, warranty,
  ]);

  useEffect(() => {
    if (!ready || !captureBaseline.current) return;
    captureBaseline.current = false;
    setBaseline(fingerprint);
  }, [fingerprint, ready]);

  function payload(draftLines: DraftLineInput[]): DraftPayload {
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
      payment_terms: paymentMode === "legacy" ? paymentTerms : "",
      payment_schedule: paymentMode === "legacy" ? null : paymentSchedule,
      delivery_terms: deliveryTerms,
      warranty,
      additional_notes: notes,
      lines: draftLines,
    };
  }

  function preparedPayload(): DraftPayload | null {
    const prepared = linesForDraft(lines);
    if (!prepared.ok) {
      setMessage(null);
      setError(prepared.message);
      return null;
    }
    return payload(prepared.lines);
  }

  function previewSnapshot(): PiSnapshot {
    const preset = presets.find((item) => item.code === presetCode);
    if (!preset || !currency) throw new Error("Choose an office and currency preset before previewing.");
    if (!totals.value) throw new Error(totals.error ?? "Correct the totals before previewing.");
    const lead = salespeople.find((person) => person.id === leadId);
    const contact = contacts.find((item) => item.id === contactId);
    const calculated = totals.value;
    return {
      layout_version: paymentMode !== "structured"
        ? (preset.layout === "uae" ? "uae-v1" : "egypt-v1")
        : paymentSchedule.schema_version === 2
          ? (preset.layout === "uae" ? "uae-v3" : "egypt-v3")
          : (preset.layout === "uae" ? "uae-v2" : "egypt-v2"),
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
        company_name: clientRecord?.company_name ?? "",
        country: clientRecord?.country ?? "",
        tax_number: clientRecord?.tax_number ?? "",
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
      lines: lines.flatMap((line, index) => {
        if (!isResolvedLine(line) || !line.product) return [];
        return [{
          model_code: line.product.modelCode,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: calculated.lines[index]?.lineTotal ?? "",
          subscription: line.subscription ? {
            schema_version: 1 as const,
            option_id: line.subscription.optionId,
            obligation_id: line.subscription.obligationId,
            product_id: line.product.id,
            billing_type: "subscription" as const,
            commitment_years: line.subscription.commitmentYears,
            currency: line.subscription.currency,
            current_year: 1 as const,
            catalogue_first_year_unit_price: line.subscription.catalogueFirstYearUnitPrice,
            negotiated_first_year_unit_price: line.unitPrice,
            later_year_rule: line.subscription.laterYearRule,
            later_year_base_unit_price: line.subscription.laterYearBaseUnitPrice,
            catalogue_later_year_base_unit_price: line.subscription.catalogueLaterYearBaseUnitPrice,
            adjustment_compounds: false as const,
            payable_in_advance: true as const,
            customer_text: commitmentCustomerText({
              currency: line.subscription.currency,
              commitmentYears: line.subscription.commitmentYears,
              currentYearUnitPrice: line.unitPrice || "0",
              laterYearRule: line.subscription.laterYearRule,
              laterYearBaseUnitPrice: line.subscription.laterYearBaseUnitPrice,
            }),
          } : null,
        }];
      }),
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
      terms: {
        price_basis: priceBasis,
        payment_terms: paymentMode === "structured"
          ? (paymentSchedule.schema_version === 2 ? (allocatedPreview?.customerText ?? "") : (paymentPreview.customerText ?? ""))
          : paymentTerms,
        delivery_terms: deliveryTerms,
        warranty,
        additional_notes: notes,
      },
      payment: paymentMode !== "structured"
        ? null
        : paymentSchedule.schema_version === 2
          ? (allocatedPreview?.canonical ?? null)
          : paymentPreview.canonical,
    };
  }

  async function onSave() {
    if (!id || acting.current) return;
    const body = preparedPayload();
    if (!body) return;
    acting.current = true;
    setBusy("save");
    setError(null);
    setConflict(false);
    try {
      const result = await saveDraft(id, draftVersion, body);
      setDraftVersion(result.draft_version);
      if (paymentMode === "structured") setLoadedLegacy(false);
      setBaseline(fingerprint);
      setSavedNotice(true);
      setMessage(null);
    } catch (caught) {
      setMessage(null);
      setConflict(isConflict(caught));
      setError(errorText(caught));
    } finally {
      acting.current = false;
      setBusy(null);
    }
  }

  async function onPreview() {
    if (acting.current) return;
    const blockedPayment = paymentIssue();
    if (blockedPayment) {
      setMessage(null);
      setError(blockedPayment);
      return;
    }
    const body = preparedPayload();
    if (!body) return;
    acting.current = true;
    setPreviewing(true);
    setError(null);
    try {
      await previewDraftPdf(previewSnapshot());
    } catch (caught) {
      setMessage(null);
      setError(errorText(caught));
    } finally {
      acting.current = false;
      setPreviewing(false);
    }
  }

  async function onGenerate() {
    if (!id || acting.current) return;
    acting.current = true;
    try {
      const chosen = presets.find((preset) => preset.code === presetCode) ?? null;
      if (!piNumber && chosen?.archived_at) {
        setMessage(null);
        setError("This preset is archived. Choose an active preset before issuing. A revision of an issued PI can still use it.");
        return;
      }
      const currencyWarning = subscriptionCurrencyMismatch(lines, chosen?.currency ?? null);
      if (currencyWarning) {
        setMessage(null);
        setError(currencyWarning);
        return;
      }
      const blocked = generationBlock(lines);
      if (blocked) {
        setMessage(null);
        setError(blocked);
        return;
      }
      const blockedPayment = paymentIssue();
      if (blockedPayment) {
        setMessage(null);
        setError(blockedPayment);
        return;
      }
      const body = preparedPayload();
      if (!body) return;
      if (!window.confirm(piNumber ? "Issue the next revision of this PI? The previous version stays unchanged." : "Issue this PI? It will receive a permanent number.")) return;
      setBusy("generate");
      setError(null);
      try {
        await generateAndDownload(id, draftVersion, body);
        navigate(`/pis/${id}`);
      } catch (caught) {
        setMessage(null);
        setConflict(isConflict(caught));
        if (isIssuedDownloadError(caught)) {
          navigate(`/pis/${id}`, { state: { downloadNotice: errorText(caught) } });
          return;
        }
        setError(errorText(caught));
      }
    } finally {
      acting.current = false;
      setBusy(null);
    }
  }

  async function chooseClient(client: Client) {
    const sameClient = client.id === clientId;
    setClientRecord(client);
    setClientId(client.id);
    setClientQuery(client.company_name);
    if (sameClient) return;
    setContactId("");
    setBillTo(client.billing_address);
    if (shipSame) setShipTo(client.billing_address);
    const { data } = await supabase.from("client_contacts").select("*").eq("client_id", client.id).order("position");
    const loaded = (data ?? []) as ClientContact[];
    setContacts(loaded);
    const primary = loaded.find((contact) => contact.is_primary);
    if (primary) setContactId(primary.id);
  }

  function clearClient() {
    setClientRecord(null);
    setClientId("");
    setClientQuery("");
    setContactId("");
    setContacts([]);
  }

  function chooseLead(nextId: string) {
    setLeadId(nextId);
    if (!nextId) return;
    setSelectedSales((current) => (current.includes(nextId) ? current : [...current, nextId]));
  }

  function removeAdjustment(key: AdjustmentKey) {
    if (key === "discount") setDiscountType("none");
    if (key === "shipping") setShippingOn(false);
    if (key === "installation") setInstallationOn(false);
    if (key === "bank") setBankOn(false);
    if (key === "tax") setTaxEnabled(false);
  }

  if (loading) return <p className="text-sm text-slate-600">Loading draft…</p>;
  if (!ready) return <Banner tone="error">{error || "This draft could not be loaded."}</Banner>;
  if (!draftOpen) {
    return (
      <div className="space-y-3">
        <Banner tone="info">This PI is issued. Create a revision before editing it.</Banner>
        <Link to={`/pis/${id}`} className={buttonClass("secondary")}>Open PI</Link>
      </div>
    );
  }

  const assignable = salespeople.filter((person) => person.is_active || selectedSales.includes(person.id) || person.id === leadId);
  const additionalNames = assignable
    .filter((person) => person.id !== leadId && selectedSales.includes(person.id))
    .map((person) => person.full_name);
  const salesSummary = additionalSalesSummary(additionalNames);
  const selectedContact = contacts.find((contact) => contact.id === contactId) ?? null;
  const clientSummary = clientOptionalSummary({ shipSame, reference });
  const termsSummary = recordOptionalSummary([
    { label: "Price basis", value: priceBasis },
    { label: "Warranty", value: warranty },
    { label: "Notes", value: notes },
  ]);
  const rows = adjustmentRows({
    currency,
    discountType,
    discountValue,
    discountAmount: totals.value?.discountAmount ?? null,
    shippingOn,
    shipping,
    installationOn,
    installation,
    bankOn,
    bankCharge,
    taxEnabled,
    taxPercent,
    taxAmount: totals.value?.taxAmount ?? null,
  });
  const exclusionNotes = taxExclusionNotes({
    taxEnabled,
    shippingOn,
    installationOn,
    bankOn,
    taxExcludesShipping,
    taxExcludesInstallation,
    taxExcludesBank,
  });
  const unpriced = lines.filter((line) => !isBlankPlaceholder(line) && line.unitPrice.trim() === "").length;
  const working = busy !== null || previewing;
  const dirty = baseline !== null && fingerprint !== baseline;
  const saveStatus = dirty ? "Unsaved changes" : savedNotice ? "Draft saved" : "";

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-4 mb-6 bg-canvas/95 px-4 py-3 sm:-mx-6 sm:px-6 md:top-0 lg:-mx-8 lg:px-8">
        <p className="text-[13px] text-muted">
          <Link to="/pis" className="hover:text-ink">Proforma invoices</Link>
          <span aria-hidden="true"> / </span>
          <span>{piNumber ?? "New invoice"}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-ink">{piNumber ?? "New proforma invoice"}</h1>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-line">
              {piNumber ? "Revision draft" : "Draft"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button type="button" variant={canGenerate ? "ghost" : "primary"} onClick={() => void onSave()} disabled={working}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
            <Button type="button" variant="accent" onClick={() => void onPreview()} disabled={working}>
              {previewing ? "Preparing preview…" : "Preview"}
            </Button>
            {canGenerate ? (
              <Button type="button" variant="primary" onClick={() => void onGenerate()} disabled={working || (!piNumber && Boolean(selectedPreset?.archived_at))}>
                {busy === "generate" ? "Generating…" : "Generate PI"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? (
        <Banner tone="error">
          {error}
          {conflict && id ? (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                captureBaseline.current = false;
                setBaseline(null);
                setSavedNotice(false);
                setLoading(true);
                void load(id).finally(() => setLoading(false));
              }}
            >
              Reload draft
            </button>
          ) : null}
        </Banner>
      ) : null}
      {!canEdit ? <div className="mb-4"><Banner tone="info">You can view this draft but cannot change it.</Banner></div> : null}
      {message ? <div className="mb-4"><Banner tone="info">{message}</Banner></div> : null}
      {!piNumber && selectedPreset?.archived_at ? (
        <div className="mb-4">
          <Banner tone="error">This preset is archived. The saved selection stays visible, but choose an active preset before issuing this PI.</Banner>
        </div>
      ) : null}
      {currencyWarning ? <div className="mb-4"><Banner tone="error">{currencyWarning}</Banner></div> : null}

      <div className="rounded-[10px] border border-line bg-white px-5 py-6 sm:px-7 sm:py-7 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Office"
            hint={piNumber
              ? "This number keeps its office and currency."
              : selectedPreset
                ? `${selectedPreset.currency} · ${layoutLabel(selectedPreset.layout)}`
                : "Choose a company preset. Prices are not converted between currencies."}
          >
            <Select value={presetCode} disabled={!canEdit || Boolean(piNumber)} onChange={(event) => setPresetCode(event.target.value)}>
              <option value="">Select a preset</option>
              {officeChoices.map((preset) => <option key={preset.code} value={preset.code}>{presetOptionLabel(preset)}</option>)}
            </Select>
          </Field>
          <Field label="Date">
            <input className={controlClass} type="date" disabled={!canEdit} value={piDate} onChange={(event) => setPiDate(event.target.value)} />
          </Field>
          <Field label="Valid until">
            <input className={controlClass} type="date" disabled={!canEdit} value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
          </Field>
        </div>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(16rem,1fr)]">
          <div>
            <ClientCombobox
              query={clientQuery}
              selected={clientRecord}
              disabled={!canEdit}
              onQueryChange={setClientQuery}
              onSelect={(client) => void chooseClient(client)}
              onClear={clearClient}
              onRevert={() => setClientQuery(clientRecord?.company_name ?? "")}
            />
            <div className="mt-2 px-0.5 text-[13px] leading-5 text-muted">
              {clientRecord ? (
                <p>{selectedContact ? contactLine(selectedContact) : contacts.length > 1 ? "No contact selected." : contacts[0] ? contactLine(contacts[0]) : "No contacts on this client."}</p>
              ) : (
                <p>No client selected.</p>
              )}
              <p>{billingSummary(billTo)}</p>
              {!shipSame ? <p>Shipping address differs from billing.</p> : null}
            </div>
            <button type="button" className="mt-1 text-sm font-medium text-primary" aria-expanded={editingClient} onClick={() => setEditingClient((current) => !current)}>
              {editingClient ? "Hide details" : canEdit ? "Edit details" : "View details"}
            </button>
          </div>
          <div>
            <Field label="Lead salesperson">
              <Select value={leadId} disabled={!canEdit} onChange={(event) => chooseLead(event.target.value)}>
                <option value="">Select a lead</option>
                {assignable.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}{person.is_active ? "" : " (disabled)"}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-4 text-[13px] text-muted">Prepared by</p>
            <p className="text-sm text-ink">{profile?.full_name || "Recorded when generated"}</p>
            {salesSummary ? <p className="mt-2 text-[13px] text-muted">{salesSummary}</p> : null}
          </div>
        </div>

        {editingClient ? (
          <div className="mt-4 grid max-w-3xl gap-4">
            {contacts.length > 1 ? (
              <Field label="Contact">
                <Select value={contactId} disabled={!canEdit} onChange={(event) => setContactId(event.target.value)}>
                  <option value="">No contact</option>
                  {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                </Select>
              </Field>
            ) : null}
            {contacts.length === 1 && !selectedContact ? (
              <button type="button" className="text-left text-sm font-medium text-primary" onClick={() => setContactId(contacts[0]?.id ?? "")}>
                Use {contacts[0]?.name || "this contact"}
              </button>
            ) : null}
            <Field label="Billing address">
              <TextArea
                disabled={!canEdit}
                value={billTo}
                onChange={(event) => {
                  setBillTo(event.target.value);
                  if (shipSame) setShipTo(event.target.value);
                }}
              />
            </Field>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <Disclosure
          quiet
          title="Shipping & reference"
          summary={clientSummary}
          open={clientDetailsOpen}
          onToggle={() => setClientDetailsOpen((current) => !current)}
        >
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!shipSame}
                disabled={!canEdit}
                onChange={(event) => {
                  const different = event.target.checked;
                  setShipSame(!different);
                  if (!different) setShipTo(billTo);
                }}
              />
              Shipping address is different from billing
            </label>
            {!shipSame ? (
              <Field label="Shipping address">
                <TextArea disabled={!canEdit} value={shipTo} onChange={(event) => setShipTo(event.target.value)} />
              </Field>
            ) : null}
            <Field label="Customer / SO reference">
              <input className={controlClass} disabled={!canEdit} value={reference} onChange={(event) => setReference(event.target.value)} />
            </Field>
          </div>
        </Disclosure>
        <Disclosure
          quiet
          title="Additional salespeople"
          summary={salesSummary}
          open={salesOpen}
          onToggle={() => setSalesOpen((current) => !current)}
        >
          <div className="space-y-2">
            {assignable.map((person) => {
              const isLead = person.id === leadId;
              const checked = isLead || selectedSales.includes(person.id);
              return (
                <label key={person.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!canEdit || isLead}
                    checked={checked}
                    onChange={(event) => {
                      setSelectedSales((current) => (
                        event.target.checked ? [...current, person.id] : current.filter((item) => item !== person.id)
                      ));
                    }}
                  />
                  <span>
                    {person.full_name}
                    {person.phone ? ` · ${person.phone}` : ""}
                    {isLead ? " · Lead" : ""}
                    {person.is_active ? "" : " (disabled)"}
                  </span>
                </label>
              );
            })}
          </div>
        </Disclosure>
        </div>

        <div className="mt-8 border-t border-line pt-6">
      <PiItemSection
        lines={lines}
        currency={currency}
        commitments={commitments}
        canEdit={canEdit}
        canManageProducts={can(profile, "can_manage_products")}
        totals={(totals.value?.lines ?? []).map((line) => line.lineTotal)}
        onChange={(nextLines) => {
          const hadSubscription = lines.some((line) => isResolvedLine(line) && line.product?.billingType === "subscription");
          const nextHasSubscription = nextLines.some((line) => isResolvedLine(line) && line.product?.billingType === "subscription");
          const adjusted = adjustScheduleForSubscriptionSelection({
            mode: paymentMode,
            schedule: paymentSchedule,
            hadSubscription,
            hasSubscription: nextHasSubscription,
          });
          setLines(nextLines);
          if (adjusted) setPaymentSchedule(adjusted);
        }}
        onNotice={(text) => {
          setError(null);
          setMessage(text);
        }}
      />
        </div>

        <div className="mt-8 grid items-start gap-8 border-t border-line pt-6 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <section className="order-2 lg:order-1">
          <h2 className="text-[15px] font-semibold text-ink">Commercial terms</h2>
          <div className="mt-4">
            <PaymentScheduleSection
              mode={paymentMode}
              legacyText={paymentTerms}
              schedule={paymentSchedule}
              currency={currency}
              grandTotal={paymentGrandTotal}
              percentageOf={paymentSchedule.schema_version === 2 ? "one_time" : "grand_total"}
              percentageBase={allocatedPreview?.allocation?.oneTimeTotal ?? null}
              allocationNote={needsConversion ? null : allocatedPreview?.explanation ?? null}
              customerText={paymentSchedule.schema_version === 2 ? allocatedPreview?.customerText ?? null : null}
              conversionMessage={conversionMessage}
              conversionRemoveLabels={conversion?.removeLabels ?? []}
              conversionRetainLabels={conversion?.retainLabels ?? []}
              conversionConfirmLabel={conversion?.confirmLabel}
              onConvert={() => {
                setPaymentMode("structured");
                setPaymentSchedule(applySubscriptionConversion(paymentMode === "legacy" ? null : paymentSchedule, subscriptionOnly));
              }}
              residualRequired={allocatedPreview?.allocation?.residualRequired ?? false}
              allocationIssues={paymentSchedule.schema_version === 2 ? (allocatedPreview?.issues ?? null) : null}
              canEdit={canEdit}
              showLegacyCancel={loadedLegacy}
              onLegacyText={setPaymentTerms}
              onReplaceLegacy={() => {
                setPaymentMode("structured");
                setPaymentSchedule(emptyPaymentSchedule());
              }}
              onCancelReplacement={() => {
                setPaymentMode("legacy");
                setPaymentSchedule(emptyPaymentSchedule());
              }}
              onSchedule={setPaymentSchedule}
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Delivery">
              <TextArea rows={2} disabled={!canEdit} value={deliveryTerms} onChange={(event) => setDeliveryTerms(event.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Disclosure quiet title="More commercial terms" summary={termsSummary} open={termsOpen} onToggle={() => setTermsOpen((current) => !current)}>
              <div className="grid gap-3">
                <Field label="Price basis">
                  <TextArea disabled={!canEdit} value={priceBasis} onChange={(event) => setPriceBasis(event.target.value)} />
                </Field>
                <Field label="Warranty">
                  <TextArea disabled={!canEdit} value={warranty} onChange={(event) => setWarranty(event.target.value)} />
                </Field>
                <Field label="Additional notes">
                  <TextArea disabled={!canEdit} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
              </div>
            </Disclosure>
          </div>
        </section>
        <section className="order-1 lg:order-2">
          <div className="text-sm">
            {totals.error ? <p className="mb-2 text-red-800">{totals.error}</p> : null}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted">Subtotal</span>
              <span className="tabular-nums text-ink">{moneyLabel(totals.value?.subtotal, currency)}</span>
            </div>
            {rows.map((row) => (
              <div key={row.key} className="mt-1 flex items-baseline justify-between gap-3">
                <span>{row.label}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {row.display}
                  {canEdit ? (
                    <button type="button" className="text-navy-800 underline" onClick={() => removeAdjustment(row.key)}>
                      Remove
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
            {discountType !== "none" && totals.value ? (
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span>Net items</span>
                <span className="tabular-nums">{formatMoney(totals.value.netItems, currency)}</span>
              </div>
            ) : null}
            {taxEnabled && totals.value?.taxableBase ? (
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span>Taxable base</span>
                <span className="tabular-nums">{formatMoney(totals.value.taxableBase, currency)}</span>
              </div>
            ) : null}
            {exclusionNotes.map((note) => <p key={note} className="mt-1 text-xs text-muted">{note}</p>)}
            <div className="mt-3">
            <Disclosure
              quiet
              title={rows.length > 0 ? "Edit discount or charges" : "Add discount or charges"}
              open={adjustmentsOpen}
              onToggle={() => setAdjustmentsOpen((current) => !current)}
            >
              <div className="grid gap-3">
                <Field label="Discount">
                  <Select disabled={!canEdit} value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountType)}>
                    <option value="none">None</option>
                    <option value="percent">Percentage</option>
                    <option value="fixed">Fixed amount</option>
                  </Select>
                </Field>
                {discountType !== "none" ? (
                  <Field label={discountType === "percent" ? "Discount percent" : "Discount amount"}>
                    <input className={controlClass} inputMode="decimal" disabled={!canEdit} value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} />
                  </Field>
                ) : null}
                <label className="flex items-center gap-2">
                  <input type="checkbox" disabled={!canEdit} checked={taxEnabled} onChange={(event) => setTaxEnabled(event.target.checked)} />
                  Tax
                </label>
                {taxEnabled ? (
                  <Field label="Tax percentage">
                    <input className={controlClass} inputMode="decimal" disabled={!canEdit} value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} />
                  </Field>
                ) : null}
                <Charge label="Shipping" enabled={shippingOn} amount={shipping} onEnabled={setShippingOn} onAmount={setShipping} disabled={!canEdit} />
                {taxEnabled && shippingOn ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={!canEdit} checked={taxExcludesShipping} onChange={(event) => setTaxExcludesShipping(event.target.checked)} />
                    Exclude shipping from tax
                  </label>
                ) : null}
                <Charge label="Installation" enabled={installationOn} amount={installation} onEnabled={setInstallationOn} onAmount={setInstallation} disabled={!canEdit} />
                {taxEnabled && installationOn ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={!canEdit} checked={taxExcludesInstallation} onChange={(event) => setTaxExcludesInstallation(event.target.checked)} />
                    Exclude installation from tax
                  </label>
                ) : null}
                <Charge label="Bank charge" enabled={bankOn} amount={bankCharge} onEnabled={setBankOn} onAmount={setBankCharge} disabled={!canEdit} />
                {taxEnabled && bankOn ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={!canEdit} checked={taxExcludesBank} onChange={(event) => setTaxExcludesBank(event.target.checked)} />
                    Exclude bank charge from tax
                  </label>
                ) : null}
              </div>
            </Disclosure>
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
              <span className="font-semibold text-ink">Total</span>
              <span className="text-[22px] font-semibold leading-7 tabular-nums text-ink">{moneyLabel(totals.value?.grandTotal, currency)}</span>
            </div>
            {!currency ? <p className="mt-1 text-xs text-muted">Currency not chosen.</p> : null}
            {unpriced > 0 ? (
              <p className="mt-2 text-red-800">
                {unpriced === 1 ? "1 item still needs a selling price." : `${unpriced} items still need a selling price.`}
              </p>
            ) : null}
          </div>
        </section>
      </div>
        <p className="mt-6 min-h-5 text-[13px] text-muted" role="status" aria-live="polite">{saveStatus}</p>
      </div>
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
      <label className="flex items-center gap-2">
        <input type="checkbox" disabled={disabled} checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
        {label}
      </label>
      {enabled ? (
        <input
          className={`${controlClass} mt-1`}
          inputMode="decimal"
          aria-label={`${label} amount`}
          disabled={disabled}
          value={amount}
          onChange={(event) => onAmount(event.target.value)}
        />
      ) : null}
    </div>
  );
}
