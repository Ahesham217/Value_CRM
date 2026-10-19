export function modelKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function modelsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const key = modelKey(left);
  return key.length > 0 && key === modelKey(right);
}

export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function isUniqueModelConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return message.includes("products_model_key_uidx");
}

export const NONNEGATIVE_DECIMAL = /^[0-9]+(\.[0-9]+)?$/;
