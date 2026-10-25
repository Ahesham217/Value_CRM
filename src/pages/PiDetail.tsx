import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { PaymentTrackingSection } from "../components/PaymentTrackingSection";
import { usePageCrumbs } from "../components/page-chrome";
import { Banner, Button, Disclosure, DocumentSurface, Field, LoadingNote, Menu, Select, StatusBadge, buttonClass, formSheetClass, tableWrapClass, tdClass, thClass, theadClass } from "../components/ui";
import { downloadIssuedPdf } from "../lib/documents";
import { errorText } from "../lib/errors";
import { formatDate, formatMoney, formatQuantity, officeLabel } from "../lib/format";
import { previewPaymentSchedule, readPaymentSchedule } from "../lib/payment-schedule";
import { can } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import type { PiLine, PiListRow, PiVersion, ProformaInvoice, TrackingStatus } from "../lib/types";
import { PAYMENT_TRACKING_ANCHOR } from "../lib/reporting";
import { adjustmentRows, moneyLabel, taxExclusionNotes } from "../lib/workspace-view";

function paymentDescription(pi: ProformaInvoice, latest: PiVersion | null): string {
  if (latest?.snapshot.payment?.customer_text) return latest.snapshot.payment.customer_text;
  if (latest?.snapshot.terms?.payment_terms) return latest.snapshot.terms.payment_terms;
  if (pi.payment_schedule) {
    try {
      const schedule = readPaymentSchedule(pi.payment_schedule);
      if (!schedule) return "The saved payment schedule could not be read.";
      if (schedule.schema_version === 2) {
        return "This payment schedule keeps the subscription charge in advance and applies the other rows only to the one-time amount. Open the draft to see the allocation.";
      }
      const preview = previewPaymentSchedule(schedule, pi.currency, pi.grand_total == null ? null : String(pi.grand_total));
      if (preview.customerText) return preview.customerText;
      if (preview.issues.length > 0) return preview.issues.map((issue) => issue.message).join(" ");
    } catch (caught) {
      return caught instanceof Error ? caught.message : "The saved payment schedule could not be read.";
    }
  }
  return pi.payment_terms.trim() ? pi.payment_terms : "No payment terms yet.";
}

function downloadNoticeFrom(state: unknown): string {
  if (!state || typeof state !== "object" || !("downloadNotice" in state)) return "";
  const notice = (state as { downloadNotice?: unknown }).downloadNotice;
  return typeof notice === "string" ? notice : "";
}

export function PiDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const downloadNotice = downloadNoticeFrom(location.state);
  const { profile } = useAuth();
  const [pi, setPi] = useState<ProformaInvoice | null>(null);
  const [listRow, setListRow] = useState<PiListRow | null>(null);
  const [lines, setLines] = useState<PiLine[]>([]);
  const [versions, setVersions] = useState<PiVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TrackingStatus>("draft");
  const [statusOpen, setStatusOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadingRef = useRef<string | null>(null);

  async function load(piId: string) {
    const [piResult, listResult, lineResult, versionResult] = await Promise.all([
      supabase.from("proforma_invoices").select("*").eq("id", piId).maybeSingle(),
      supabase.from("pi_list").select("*").eq("id", piId).maybeSingle(),
      supabase.from("pi_lines").select("*").eq("pi_id", piId).order("position"),
      supabase.from("pi_versions").select("*").eq("pi_id", piId).order("revision"),
    ]);
    if (piResult.error) throw piResult.error;
    if (!piResult.data) throw new Error("This PI was not found, or you do not have access to it.");
    setPi(piResult.data as ProformaInvoice);
    setStatus((piResult.data as ProformaInvoice).tracking_status);
    setListRow((listResult.data ?? null) as PiListRow | null);
    setLines((lineResult.data ?? []) as PiLine[]);
    setVersions((versionResult.data ?? []) as PiVersion[]);
  }

  useEffect(() => {
    if (!id) return;
    load(id).catch((caught) => setError(errorText(caught))).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (loading || location.hash !== `#${PAYMENT_TRACKING_ANCHOR}`) return;
    document.getElementById(PAYMENT_TRACKING_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [loading, location.hash]);

  async function changeStatus() {
    if (!id) return;
    const { error: statusError } = await supabase.rpc("set_pi_tracking_status", { p_id: id, p_status: status });
    if (statusError) setError(errorText(statusError));
    else {
      setMessage("Status updated.");
      await load(id);
    }
  }

  async function duplicate() {
    if (!id) return;
    const { data, error: duplicateError } = await supabase.rpc("duplicate_pi", { p_id: id });
    if (duplicateError) setError(errorText(duplicateError));
    else navigate(`/pis/${data as string}/edit`);
  }

  async function revise() {
    if (!id) return;
    const { error: revisionError } = await supabase.rpc("create_pi_revision", { p_id: id });
    if (revisionError) setError(errorText(revisionError));
    else navigate(`/pis/${id}/edit`);
  }

  async function downloadVersion(version: PiVersion) {
    if (downloadingRef.current) return;
    downloadingRef.current = version.id;
    setDownloadingId(version.id);
    setError(null);
    try {
      await downloadIssuedPdf(version.snapshot);
    } catch (caught) {
      const number = version.snapshot?.display_number || version.pi_number;
      setError(`The PDF for ${number} could not be created. ${errorText(caught)} Choose Download to try again. This does not change the issued version.`);
    } finally {
      downloadingRef.current = null;
      setDownloadingId(null);
    }
  }

  async function removeDraft() {
    if (!id || !window.confirm("Delete this unissued draft?")) return;
    const { error: deleteError } = await supabase.rpc("delete_unissued_pi", { p_id: id });
    if (deleteError) setError(errorText(deleteError));
    else navigate("/pis");
  }

  usePageCrumbs([
    { label: "Proforma invoices", to: "/pis" },
    { label: pi?.pi_number ?? "Draft" },
  ]);

  if (loading) return <LoadingNote>Loading PI…</LoadingNote>;
  if (!pi) return <Banner tone="error">{error || "PI not found."}</Banner>;

  const canEdit = can(profile, "can_edit_drafts");
  const canGenerate = can(profile, "can_generate_pis");
  const latest = versions.at(-1) ?? null;
  const orderedVersions = [...versions].reverse();
  const currency = latest?.snapshot.currency ?? pi.currency;
  const issuedAdjustments = latest?.snapshot.adjustments;
  const totalRows = issuedAdjustments
    ? adjustmentRows({
        currency,
        discountType: issuedAdjustments.discount_type,
        discountValue: issuedAdjustments.discount_value ?? "",
        discountAmount: issuedAdjustments.discount_amount,
        shippingOn: issuedAdjustments.shipping !== null,
        shipping: issuedAdjustments.shipping ?? "",
        installationOn: issuedAdjustments.installation !== null,
        installation: issuedAdjustments.installation ?? "",
        bankOn: issuedAdjustments.bank_charge !== null,
        bankCharge: issuedAdjustments.bank_charge ?? "",
        taxEnabled: issuedAdjustments.tax_enabled,
        taxPercent: issuedAdjustments.tax_percent ?? "",
        taxAmount: issuedAdjustments.tax_amount,
      })
    : adjustmentRows({
        currency,
        discountType: pi.discount_type,
        discountValue: pi.discount_value == null ? "" : String(pi.discount_value),
        discountAmount: String(pi.discount_amount),
        shippingOn: pi.shipping_amount !== null,
        shipping: pi.shipping_amount == null ? "" : String(pi.shipping_amount),
        installationOn: pi.installation_amount !== null,
        installation: pi.installation_amount == null ? "" : String(pi.installation_amount),
        bankOn: pi.bank_charge_amount !== null,
        bankCharge: pi.bank_charge_amount == null ? "" : String(pi.bank_charge_amount),
        taxEnabled: pi.tax_enabled,
        taxPercent: pi.tax_percent == null ? "" : String(pi.tax_percent),
        taxAmount: String(pi.tax_amount),
      });
  const exclusionNotes = issuedAdjustments
    ? taxExclusionNotes({
        taxEnabled: issuedAdjustments.tax_enabled,
        shippingOn: issuedAdjustments.shipping !== null,
        installationOn: issuedAdjustments.installation !== null,
        bankOn: issuedAdjustments.bank_charge !== null,
        taxExcludesShipping: issuedAdjustments.tax_excludes_shipping,
        taxExcludesInstallation: issuedAdjustments.tax_excludes_installation,
        taxExcludesBank: issuedAdjustments.tax_excludes_bank_charge,
      })
    : taxExclusionNotes({
        taxEnabled: pi.tax_enabled,
        shippingOn: pi.shipping_amount !== null,
        installationOn: pi.installation_amount !== null,
        bankOn: pi.bank_charge_amount !== null,
        taxExcludesShipping: pi.tax_excludes_shipping,
        taxExcludesInstallation: pi.tax_excludes_installation,
        taxExcludesBank: pi.tax_excludes_bank_charge,
      });
  const grandTotal = latest?.grand_total ?? pi.grand_total;
  const subtotal = issuedAdjustments?.subtotal ?? pi.subtotal;
  const actions = [
    ...(canEdit ? [{ label: "Duplicate", onSelect: () => void duplicate() }] : []),
    ...(!pi.draft_open && versions.length > 0 && canEdit && pi.tracking_status !== "cancelled"
      ? [{ label: "Create revision", onSelect: () => void revise() }]
      : []),
    ...(canEdit || canGenerate ? [{ label: "Change status", onSelect: () => setStatusOpen(true) }] : []),
    ...(versions.length === 0 && canEdit ? [{ label: "Delete draft", onSelect: () => void removeDraft(), tone: "danger" as const }] : []),
  ];
  const historySummary = versions.length === 0
    ? "Nothing issued yet"
    : `${versions.length === 1 ? "1 version" : `${versions.length} versions`} · current ${latest?.snapshot.display_number ?? ""}`;

  return (
    <div className={`${formSheetClass} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[26px] leading-[34px] font-semibold text-ink">{pi.pi_number ?? "Draft"}</h1>
            <StatusBadge status={listRow?.display_status ?? (versions.length ? "issued" : "draft")} />
          </div>
          <p className="mt-1 text-sm text-secondary">
            {listRow?.client_name || "No client"}
            <span className="mx-2 text-muted" aria-hidden="true">·</span>
            <span className="font-semibold text-ink tabular-nums">{formatMoney(grandTotal, currency)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {latest ? (
            <Button type="button" variant="primary" onClick={() => void downloadVersion(latest)} disabled={downloadingId !== null}>
              {downloadingId === latest.id ? "Downloading…" : "Download"}
            </Button>
          ) : null}
          {pi.draft_open && canEdit ? (
            <Link to={`/pis/${pi.id}/edit`} className={buttonClass(latest ? "secondary" : "primary")}>Edit draft</Link>
          ) : null}
          <Menu label="More actions" items={actions} />
        </div>
      </div>
      {downloadNotice ? <Banner tone="error">{downloadNotice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      {pi.draft_open && versions.length > 0 ? <Banner tone="info">A revision draft is open. Download uses the latest issued version.</Banner> : null}
      {statusOpen ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4">
          <Field label="Change status" className="w-56">
            <Select value={status} onChange={(event) => setStatus(event.target.value as TrackingStatus)} disabled={!canEdit && !canGenerate}>
              <option value="draft">{versions.length ? "Issued / not sent" : "Draft"}</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          {canEdit || canGenerate ? <Button type="button" variant="secondary" onClick={() => void changeStatus()}>Update status</Button> : null}
        </div>
      ) : null}
      <DocumentSurface>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-[13px] text-muted">PI date</dt><dd className="mt-0.5">{formatDate(pi.pi_date)}</dd></div>
          <div><dt className="text-[13px] text-muted">Valid until</dt><dd className="mt-0.5">{formatDate(pi.expiry_date)}</dd></div>
          <div><dt className="text-[13px] text-muted">Office</dt><dd className="mt-0.5">{listRow?.preset_display_name || officeLabel(listRow?.office ?? pi.office)}</dd></div>
          <div><dt className="text-[13px] text-muted">Amount</dt><dd className="mt-0.5 font-medium tabular-nums">{formatMoney(grandTotal, currency)}</dd></div>
          <div><dt className="text-[13px] text-muted">Lead salesperson</dt><dd className="mt-0.5">{listRow?.lead_name || latest?.snapshot.sales.lead_name || "—"}</dd></div>
          <div>
            <dt className="text-[13px] text-muted">Prepared by</dt>
            <dd className="mt-0.5">{latest?.snapshot.sales.prepared_by || listRow?.prepared_by_name || "Not recorded yet"}</dd>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-[13px] text-muted">{latest?.snapshot.payment ? "Payment schedule" : pi.payment_schedule ? "Payment schedule" : "Legacy payment terms"}</dt>
            <dd className="mt-1 whitespace-pre-wrap">{paymentDescription(pi, latest)}</dd>
            {pi.draft_open && versions.length > 0 ? <p className="mt-1 text-[13px] text-muted">The open revision is edited separately. This is the latest issued agreement.</p> : null}
          </div>
          {pi.customer_reference ? <div><dt className="text-[13px] text-muted">Customer / SO reference</dt><dd className="mt-0.5">{pi.customer_reference}</dd></div> : null}
          {!pi.ship_same_as_billing ? <div><dt className="text-[13px] text-muted">Shipping</dt><dd className="mt-0.5">Shipping address differs from billing.</dd></div> : null}
        </dl>
        <div className="mt-4 border-t border-line pt-3 text-sm">
          {latest && pi.draft_open ? <p className="mb-1 text-[13px] text-muted">Totals are from the latest issued version.</p> : null}
          <div className="flex justify-between gap-3"><span>Subtotal</span><span className="tabular-nums">{moneyLabel(subtotal, currency)}</span></div>
          {totalRows.map((row) => (
            <div key={row.key} className="mt-1 flex justify-between gap-3"><span>{row.label}</span><span className="tabular-nums">{row.display}</span></div>
          ))}
          {exclusionNotes.map((note) => <p key={note} className="mt-1 text-[13px] text-muted">{note}</p>)}
        </div>
        <div className="mt-6 border-t border-line pt-4">
          <h2 className="text-[17px] font-semibold text-ink">{pi.draft_open && versions.length > 0 ? "Draft items" : "Items"}</h2>
          <div className={`${tableWrapClass} mt-3`}>
            <table className="min-w-full text-left text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass} scope="col">Model</th>
                  <th className={thClass} scope="col">Description</th>
                  <th className={thClass} scope="col">Qty</th>
                  <th className={`${thClass} text-right`} scope="col">Price</th>
                  <th className={`${thClass} text-right`} scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td className={`${tdClass} text-muted`} colSpan={5}>No items yet.</td></tr>
                ) : lines.map((line) => (
                  <tr key={line.id} className="border-t border-line">
                    <td className={`${tdClass} font-medium`}>{line.model_code || "—"}</td>
                    <td className={`${tdClass} max-w-md whitespace-pre-wrap`}>
                      {line.description}
                      {line.subscription_agreement?.customer_text ? (
                        <span className="mt-1 block text-[13px] text-muted">{line.subscription_agreement.customer_text}</span>
                      ) : null}
                      {line.subscription_agreement && line.unit_price != null && line.subscription_agreement.catalogue_first_year_unit_price !== String(line.subscription_agreement.negotiated_first_year_unit_price) ? (
                        <span className="mt-1 block text-[13px] text-muted">Negotiated Year 1 price. Catalogue Year 1 price {line.subscription_agreement.catalogue_first_year_unit_price}.</span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatQuantity(line.quantity)} {line.unit}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(line.unit_price, currency)}</td>
                    <td className={`${tdClass} text-right font-medium tabular-nums`}>{formatMoney(line.line_total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DocumentSurface>
      <PaymentTrackingSection
        piId={pi.id}
        versions={versions}
        canManage={can(profile, "can_manage_payments")}
        canReverse={can(profile, "can_reverse_payments")}
        canWaive={can(profile, "can_activate_zero_subscriptions")}
      />
      <section className="rounded-lg border border-line bg-white px-6">
        <Disclosure title="Version history" summary={historySummary} open={historyOpen} onToggle={() => setHistoryOpen((current) => !current)}>
          {versions.length === 0 ? <p className="text-sm text-muted">Nothing has been issued yet. Generate the draft to allocate a permanent number.</p> : (
            <ul className="divide-y divide-line">
              {orderedVersions.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium text-ink">
                      {version.snapshot.display_number}
                      {version.id === latest?.id ? <span className="ml-2 text-xs font-medium text-navy-800">Current</span> : null}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDate(version.generated_at)} · {version.snapshot.sales?.prepared_by || "—"} · {formatMoney(version.grand_total, version.snapshot.currency)}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={() => void downloadVersion(version)} disabled={downloadingId !== null}>
                    {downloadingId === version.id ? "Downloading…" : "Download"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </section>
    </div>
  );
}
