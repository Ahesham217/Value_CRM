import { createClient } from "@supabase/supabase-js";

export const PI_PDF_BUCKET = "pi-pdfs";
export const DELETE_CONFIRMATION = "delete-pi-pdfs";

const GENERATED_PI_PDF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

export type PiPdfObject = {
  name?: string;
  id?: string | null;
  size?: number;
  metadata?: { size?: number } | null;
};

export type PiPdfSummary = {
  bucket: string;
  count: number;
  totalBytes: number;
  unknownBytes: number;
  generated: { name: string; size: number | null }[];
  skipped: string[];
};

export type PiPdfStorage = {
  from: (bucket: string) => {
    list: (
      path: string,
      options: { limit: number; offset: number; sortBy: { column: string; order: string } },
    ) => Promise<{ data: PiPdfObject[] | null; error: { message: string } | null }>;
    remove: (names: string[]) => Promise<{ error: { message: string } | null }>;
  };
};

export function isGeneratedPiPdfName(name: unknown): name is string {
  return typeof name === "string" && GENERATED_PI_PDF.test(name);
}

function byteSize(object: PiPdfObject): number | null {
  const raw = object.metadata?.size ?? object.size;
  const size = Number(raw);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

export function summarizePiPdfObjects(objects: PiPdfObject[]): PiPdfSummary {
  const generated: PiPdfSummary["generated"] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  let unknownBytes = 0;
  for (const object of objects) {
    const name = object?.name;
    const folder = object?.id == null && object?.metadata == null && typeof name === "string" && !name.includes(".");
    if (!folder && isGeneratedPiPdfName(name)) {
      const size = byteSize(object);
      generated.push({ name, size });
      if (size == null) unknownBytes += 1;
      else totalBytes += size;
    } else if (name) {
      skipped.push(name);
    }
  }
  return {
    bucket: PI_PDF_BUCKET,
    count: generated.length,
    totalBytes,
    unknownBytes,
    generated,
    skipped,
  };
}

export function formatPiPdfReport(summary: PiPdfSummary, options?: { deleting?: boolean }): string {
  const lines = [
    `Bucket: ${summary.bucket}`,
    `Generated PI PDFs: ${summary.count}`,
    `Total size: ${summary.totalBytes} bytes`,
  ];
  if (summary.unknownBytes > 0) {
    lines.push(`Files with an unknown size: ${summary.unknownBytes}`);
  }
  lines.push(`Skipped objects: ${summary.skipped.length}`);
  if (summary.skipped.length > 0) {
    lines.push(`Skipped names: ${summary.skipped.join(", ")}`);
  }
  lines.push(options?.deleting ? "Deletion: requested" : "Deletion: not requested");
  return lines.join("\n");
}

async function listBucket(storage: PiPdfStorage): Promise<PiPdfObject[]> {
  const objects: PiPdfObject[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await storage.from(PI_PDF_BUCKET).list("", {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(error.message);
    const page = data ?? [];
    objects.push(...page);
    if (page.length < pageSize) break;
  }
  return objects;
}

async function deleteGenerated(storage: PiPdfStorage, names: string[]): Promise<string[]> {
  const removed: string[] = [];
  for (let index = 0; index < names.length; index += 100) {
    const batch = names.slice(index, index + 100);
    const { error } = await storage.from(PI_PDF_BUCKET).remove(batch);
    if (error) throw new Error(error.message);
    removed.push(...batch);
  }
  return removed;
}

export async function runPiPdfCleanup(options?: {
  env?: Record<string, string | undefined>;
  argv?: string[];
  stdout?: (line: string) => void;
  storage?: PiPdfStorage;
}): Promise<PiPdfSummary & { deleted: string[] }> {
  const env = options?.env ?? {};
  const argv = options?.argv ?? [];
  const stdout = options?.stdout ?? (() => undefined);
  const deleting = argv.includes("--delete");
  const confirmed = env.CONFIRM_PI_PDF_CLEANUP === DELETE_CONFIRMATION;
  if (deleting && !confirmed) {
    throw new Error(
      `Refusing to delete. Set CONFIRM_PI_PDF_CLEANUP=${DELETE_CONFIRMATION} as well as --delete. Nothing was deleted.`,
    );
  }
  const storage = options?.storage ?? createCleanupStorage(env);
  const summary = summarizePiPdfObjects(await listBucket(storage));
  stdout(formatPiPdfReport(summary, { deleting }));
  if (!deleting) return { ...summary, deleted: [] };
  if (summary.skipped.length > 0) {
    throw new Error("Refusing to delete because the bucket contains objects that are not generated PI PDFs. Nothing was deleted.");
  }
  const deleted = await deleteGenerated(storage, summary.generated.map((file) => file.name));
  stdout(`Deleted ${deleted.length} generated PI PDFs from ${PI_PDF_BUCKET}.`);
  return { ...summary, deleted };
}

function createCleanupStorage(env: Record<string, string | undefined>): PiPdfStorage {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The publishable key cannot list or delete private PDFs.");
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.storage as unknown as PiPdfStorage;
}
