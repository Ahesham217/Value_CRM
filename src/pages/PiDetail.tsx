import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Card, PageHeader, Select, StatusBadge } from "../components/ui";
import { downloadStoredPdf } from "../lib/documents";
import { errorText } from "../lib/errors";
import { formatDate, formatMoney, formatQuantity, officeLabel } from "../lib/format";
import { can } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import type { PiLine, PiListRow, PiVersion, ProformaInvoice, TrackingStatus } from "../lib/types";

export function PiDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [pi, setPi] = useState<ProformaInvoice | null>(null);
  const [listRow, setListRow] = useState<PiListRow | null>(null);
  const [lines, setLines] = useState<PiLine[]>([]);
  const [versions, setVersions] = useState<PiVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TrackingStatus>("draft");

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

  return (
    <div className="space-y-4">
      <PageHeader
        title={pi.pi_number ?? "Draft PI"}
        subtitle={listRow ? `${officeLabel(listRow.office)} · ${listRow.currency || "Currency not chosen"} · ${listRow.client_name || "No client"}` : undefined}
        actions={
          <>
            <Link to="/pis"><Button type="button" variant="secondary">All PIs</Button></Link>
            {pi.draft_open && canEdit ? <Link to={`/pis/${pi.id}/edit`}><Button variant="primary">Edit draft</Button></Link> : null}
            {!pi.draft_open && versions.length > 0 && canEdit && pi.tracking_status !== "cancelled" ? <Button type="button" onClick={() => void revise()}>Create revision</Button> : null}
            {canEdit ? <Button type="button" onClick={() => void duplicate()}>Duplicate</Button> : null}
            {versions.length === 0 && canEdit ? <Button type="button" variant="danger" onClick={() => void removeDraft()}>Delete draft</Button> : null}
          </>
        }
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={listRow?.display_status ?? (versions.length ? "issued" : "draft")} />
          {pi.draft_open && versions.length > 0 ? <span className="text-sm text-slate-600">An revision draft is open.</span> : null}
          <label className="text-sm">
            Tracking status
            <Select className="ml-2" value={status} onChange={(event) => setStatus(event.target.value as TrackingStatus)} disabled={!canEdit && !canGenerate}>
              <option value="draft">{versions.length ? "Issued / not sent" : "Draft"}</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </label>
          {canEdit || canGenerate ? <Button type="button" onClick={() => void changeStatus()}>Update status</Button> : null}
        </div>
        <dl className="mt-4 grid gap-2 text-sm md:grid-cols-3">
          <div><dt className="text-slate-500">Date</dt><dd>{formatDate(pi.pi_date)}</dd></div>
          <div><dt className="text-slate-500">Expiry</dt><dd>{formatDate(pi.expiry_date)}</dd></div>
          <div><dt className="text-slate-500">Reference</dt><dd>{pi.customer_reference || "—"}</dd></div>
          <div><dt className="text-slate-500">Lead</dt><dd>{listRow?.lead_name || "—"}</dd></div>
          <div><dt className="text-slate-500">Prepared by</dt><dd>{latest ? latest.snapshot.sales.prepared_by : listRow?.prepared_by_name || "—"}</dd></div>
          <div><dt className="text-slate-500">Total</dt><dd>{formatMoney(latest?.grand_total ?? pi.grand_total, pi.currency)}</dd></div>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Current lines</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-600"><tr><th className="py-1 pr-3">Model</th><th className="py-1 pr-3">Description</th><th className="py-1 pr-3">Qty</th><th className="py-1 pr-3">Price</th><th className="py-1">Total</th></tr></thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{line.model_code || "—"}</td>
                  <td className="max-w-md py-1 pr-3 whitespace-pre-wrap">{line.description}</td>
                  <td className="py-1 pr-3">{formatQuantity(line.quantity)} {line.unit}</td>
                  <td className="py-1 pr-3">{formatMoney(line.unit_price, pi.currency)}</td>
                  <td className="py-1">{formatMoney(line.line_total, pi.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Version history</h2>
        {versions.length === 0 ? <p className="text-sm text-slate-600">Nothing has been issued yet. Generate the draft to allocate a permanent number.</p> : (
          <ul className="space-y-2 text-sm">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-2">
                <span>
                  {version.snapshot.display_number} · {formatDate(version.generated_at)} · {version.snapshot.sales.prepared_by} · {formatMoney(version.grand_total, version.snapshot.currency)}
                  {version.pdf_status === "pending" ? " · PDF not stored" : ""}
                </span>
                <Button type="button" onClick={() => void downloadStoredPdf(version).catch((caught) => setError(errorText(caught)))}>
                  {version.pdf_status === "ready" ? "Download" : "Retry PDF"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
