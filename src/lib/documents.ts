import { supabase } from "./supabase";
import type { DraftPayload, GenerateResult, PiSnapshot, PiVersion, SaveDraftResult } from "./types";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function saveDraft(id: string, expectedVersion: number, payload: DraftPayload): Promise<SaveDraftResult> {
  const { data, error } = await supabase.rpc("save_pi_draft", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_payload: payload,
  });
  if (error) throw error;
  return data as SaveDraftResult;
}

export async function storeIssuedPdf(versionId: string, snapshot: PiSnapshot): Promise<void> {
  const { renderPiPdf } = await import("./pdf");
  const bytes = await renderPiPdf(snapshot);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const path = `${versionId}.pdf`;
  const reset = await supabase.rpc("prepare_pdf_retry", { p_version_id: versionId });
  if (reset.error) throw reset.error;
  await supabase.storage.from("pi-pdfs").remove([path]);
  const upload = await supabase.storage.from("pi-pdfs").upload(path, blob, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw upload.error;
  const confirm = await supabase.rpc("confirm_pi_pdf", { p_version_id: versionId });
  if (confirm.error) {
    throw new Error(`The PDF upload did not complete, so it was not marked as saved. ${confirm.error.message}`);
  }
}

export async function downloadStoredPdf(version: PiVersion): Promise<void> {
  if (version.pdf_status !== "ready" || !version.pdf_path) {
    await storeIssuedPdf(version.id, version.snapshot);
  }
  const path = version.pdf_path || `${version.id}.pdf`;
  const { data, error } = await supabase.storage.from("pi-pdfs").download(path);
  if (error || !data) {
    throw new Error(error ? error.message : "The stored PDF could not be downloaded.");
  }
  const { pdfFilename } = await import("./pdf");
  downloadBlob(data, pdfFilename(version.snapshot));
}

export async function generateAndDownload(id: string, expectedVersion: number, payload: DraftPayload): Promise<GenerateResult> {
  const { data, error } = await supabase.rpc("generate_pi", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_payload: payload,
  });
  if (error) throw error;
  const result = data as GenerateResult;
  try {
    await storeIssuedPdf(result.version_id, result.snapshot);
    const { data: file, error: downloadError } = await supabase.storage.from("pi-pdfs").download(result.pdf_path);
    if (downloadError || !file) {
      throw new Error("The PDF was saved, but the download failed. Use Download in the version history.");
    }
    const { pdfFilename } = await import("./pdf");
    downloadBlob(file, pdfFilename(result.snapshot));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "PDF storage failed.";
    throw new Error(`${result.display_number} was issued, but the PDF was not stored. Open the PI and retry. ${message}`);
  }
  return result;
}

export async function previewDraftPdf(snapshot: PiSnapshot): Promise<void> {
  const { renderPiPdf } = await import("./pdf");
  const bytes = await renderPiPdf(snapshot);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
