import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Disclosure, Menu, Select, StatusBadge, buttonClass } from "../components/ui";
import { downloadIssuedPdf } from "../lib/documents";
import { errorText } from "../lib/errors";
import { formatDate, formatMoney, formatQuantity, officeLabel } from "../lib/format";
import { can } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import type { PiLine, PiListRow, PiVersion, ProformaInvoice, TrackingStatus } from "../lib/types";
import { adjustmentRows, moneyLabel, taxExclusionNotes } from "../lib/workspace-view";

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

  if (loading) return <p className="text-sm text-slate-600">Loading PI…</p>;
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/pis" className="text-sm font-medium text-navy-800 underline">Back to PIs</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-ink">{pi.pi_number ?? "Draft"}</h1>
            <StatusBadge status={listRow?.display_status ?? (versions.length ? "issued" : "draft")} />
          </div>
          <p className="mt-1 text-sm text-slate-700">{listRow?.client_name || "No client"}</p>
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
        <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-line bg-white p-6">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Change status</span>
            <Select value={status} onChange={(event) => setStatus(event.target.value as TrackingStatus)} disabled={!canEdit && !canGenerate}>
              <option value="draft">{versions.length ? "Issued / not sent" : "Draft"}</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </label>
          {canEdit || canGenerate ? <Button type="button" variant="secondary" onClick={() => void changeStatus()}>Update status</Button> : null}
        </div>
      ) : null}
      <section className="rounded-[10px] border border-line bg-white p-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-xs text-slate-500">PI date</dt><dd>{formatDate(pi.pi_date)}</dd></div>
          <div><dt className="text-xs text-slate-500">Expiry date</dt><dd>{formatDate(pi.expiry_date)}</dd></div>
          <div><dt className="text-xs text-slate-500">Office</dt><dd>{officeLabel(listRow?.office ?? pi.office)}</dd></div>
          <div><dt className="text-xs text-slate-500">Currency and total</dt><dd className="font-medium tabular-nums">{formatMoney(grandTotal, currency)}</dd></div>
          <div><dt className="text-xs text-slate-500">Lead salesperson</dt><dd>{listRow?.lead_name || latest?.snapshot.sales.lead_name || "—"}</dd></div>
          <div>
            <dt className="text-xs text-slate-500">Prepared by</dt>
            <dd>{latest?.snapshot.sales.prepared_by || listRow?.prepared_by_name || "Not recorded yet"}</dd>
          </div>
          {pi.customer_reference ? <div><dt className="text-xs text-slate-500">Customer / SO reference</dt><dd>{pi.customer_reference}</dd></div> : null}
          {!pi.ship_same_as_billing ? <div><dt className="text-xs text-slate-500">Shipping</dt><dd>Shipping address differs from billing.</dd></div> : null}
        </dl>
        <div className="mt-3 border-t border-slate-100 pt-2 text-sm">
          {latest && pi.draft_open ? <p className="mb-1 text-xs text-slate-500">Totals are from the latest issued version.</p> : null}
          <div className="flex justify-between gap-3"><span>Subtotal</span><span className="tabular-nums">{moneyLabel(subtotal, currency)}</span></div>
          {totalRows.map((row) => (
            <div key={row.key} className="mt-1 flex justify-between gap-3"><span>{row.label}</span><span className="tabular-nums">{row.display}</span></div>
          ))}
          {exclusionNotes.map((note) => <p key={note} className="mt-1 text-xs text-slate-600">{note}</p>)}
        </div>
      </section>
      <section className="rounded-[10px] border border-line bg-white">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-[15px] font-semibold text-ink">{pi.draft_open && versions.length > 0 ? "Draft items" : "Items"}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">Model</th>
                <th className="px-2 py-1.5 font-medium">Description</th>
                <th className="px-2 py-1.5 font-medium">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium">Price</th>
                <th className="px-2 py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td className="px-2 py-3 text-slate-600" colSpan={5}>No items yet.</td></tr>
              ) : lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{line.model_code || "—"}</td>
                  <td className="max-w-md px-2 py-1.5 whitespace-pre-wrap">{line.description}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatQuantity(line.quantity)} {line.unit}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(line.unit_price, currency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(line.line_total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-[10px] border border-line bg-white px-6">
        <Disclosure title="Version history" summary={historySummary} open={historyOpen} onToggle={() => setHistoryOpen((current) => !current)}>
          {versions.length === 0 ? <p className="text-sm text-slate-600">Nothing has been issued yet. Generate the draft to allocate a permanent number.</p> : (
            <ul className="divide-y divide-slate-100">
              {orderedVersions.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">
                      {version.snapshot.display_number}
                      {version.id === latest?.id ? <span className="ml-2 text-xs font-medium text-navy-800">Current</span> : null}
                    </p>
                    <p className="text-xs text-slate-600">
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
