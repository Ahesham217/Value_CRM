import { supabase } from "./supabase";
import type { DraftPayload, GenerateResult, PiSnapshot, SaveDraftResult } from "./types";

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

export class IssuedDownloadError extends Error {
  readonly displayNumber: string;

  constructor(displayNumber: string, detail: string) {
    super(
      `${displayNumber} was issued and keeps its number and version. The PDF could not be created in the browser: ${detail} Open this PI and choose Download in version history. That uses the saved version and does not issue another number or revision.`,
    );
    this.name = "IssuedDownloadError";
    this.displayNumber = displayNumber;
  }
}

export function isIssuedDownloadError(error: unknown): boolean {
  return error instanceof IssuedDownloadError;
}

async function renderIssuedPdf(snapshot: PiSnapshot): Promise<{ bytes: Uint8Array; filename: string }> {
  const { renderPiPdf, pdfFilename } = await import("./pdf");
  const bytes = await renderPiPdf(snapshot);
  return { bytes, filename: pdfFilename(snapshot) };
}

export async function downloadIssuedPdf(snapshot: PiSnapshot): Promise<void> {
  const file = await renderIssuedPdf(snapshot);
  downloadBlob(new Blob([new Uint8Array(file.bytes)], { type: "application/pdf" }), file.filename);
}

export async function generateAndDownload(id: string, expectedVersion: number, payload: DraftPayload): Promise<GenerateResult> {
  const { data, error } = await supabase.rpc("generate_pi", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_payload: payload,
  });
  if (error) throw error;
  const result = data as GenerateResult | null;
  if (!result?.display_number || !result.snapshot) {
    throw new IssuedDownloadError(result?.display_number || "The PI", "The saved snapshot was not returned.");
  }
  try {
    await downloadIssuedPdf(result.snapshot);
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "The PDF could not be created.";
    throw new IssuedDownloadError(result.display_number, detail);
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
