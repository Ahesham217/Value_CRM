import { supabase } from "./supabase";

export const PAGE_SIZE = 20;

export function sanitizeSearch(value: string): string {
  return value.replace(/[%_,()*]/g, " ").trim();
}

export async function archiveRow(table: "clients" | "vendors" | "products", id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}
