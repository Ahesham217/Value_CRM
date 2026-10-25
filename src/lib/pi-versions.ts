import { dedupeInflight } from "../auth/session-guard";
import { displayNumber } from "./format";
import { supabase } from "./supabase";
import type { PiSnapshot, PiVersion } from "./types";

/** Version rows for the PI screen. The snapshot column is loaded separately. */
export const PI_VERSION_SUMMARY_COLUMNS =
  "id, pi_id, revision, pi_number, generated_by, generated_at, pdf_status, pdf_path, layout_version, grand_total";

/** Editor preset fields. The logo file is loaded only when a preview needs it. */
export const EDITOR_PRESET_COLUMNS =
  "code, office, currency, layout, company_name, address, phone, fax, email, website, tax_registration, logo_content_type, bank_name, bank_branch, bank_address, bank_swift, account_name, account_number, iban, correspondent_bank, bank_notes, updated_at, display_name, sequence_code, archived_at";

const snapshotRequests = new Map<string, Promise<PiSnapshot>>();

export function emptyVersionSnapshot(row: Omit<PiVersion, "snapshot">): PiVersion {
  return { ...row, snapshot: null };
}

export function attachSnapshot(
  versions: PiVersion[],
  loaded: { id: string; snapshot: PiSnapshot } | null,
): PiVersion[] {
  if (!loaded) return versions;
  return versions.map((version) => (version.id === loaded.id ? { ...version, snapshot: loaded.snapshot } : version));
}

export function versionDisplayNumber(version: Pick<PiVersion, "pi_number" | "revision" | "snapshot">): string {
  return version.snapshot?.display_number || displayNumber(version.pi_number, version.revision);
}

export function versionCurrency(version: Pick<PiVersion, "snapshot">, fallback: string | null | undefined): string | null {
  return version.snapshot?.currency ?? fallback ?? null;
}

export function versionAgreedTotal(version: Pick<PiVersion, "snapshot" | "grand_total">): string {
  if (!version.snapshot) return String(version.grand_total ?? "");
  return version.snapshot.payment?.grand_total ?? version.snapshot.adjustments.grand_total;
}

export async function fetchPiVersionSnapshot(versionId: string): Promise<PiSnapshot> {
  return dedupeInflight(snapshotRequests, versionId, async () => {
    const { data, error } = await supabase.from("pi_versions").select("id, snapshot").eq("id", versionId).maybeSingle();
    if (error) throw error;
    const snapshot = data?.snapshot as PiSnapshot | undefined;
    if (!snapshot) throw new Error("The saved version could not be read.");
    return snapshot;
  });
}

/** Use the snapshot already on the version. Load that version's own snapshot only when it is missing. */
export async function ensureVersionSnapshot(
  version: PiVersion,
  load: (versionId: string) => Promise<PiSnapshot> = fetchPiVersionSnapshot,
): Promise<PiSnapshot> {
  if (version.snapshot) return version.snapshot;
  return load(version.id);
}
