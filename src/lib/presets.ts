import type { CurrencyCode } from "./types";

/**
 * Keep these patterns aligned with the database checks in
 * supabase/migrations/20261023120000_administrator_company_presets.sql.
 * The database is the authority. These helpers only give the form a clear message.
 */
export const SEQUENCE_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,7}$/;
export const OFFICE_CODE_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/;
export const CURRENCIES = ["EGP", "USD", "EUR"] as const satisfies readonly CurrencyCode[];

export function canonicalSequencePrefix(value: string): string | null {
  const prefix = value.trim().toUpperCase();
  return SEQUENCE_PREFIX_PATTERN.test(prefix) ? prefix : null;
}

export function canonicalOfficeCode(value: string): string | null {
  const office = value.trim().toUpperCase();
  return OFFICE_CODE_PATTERN.test(office) ? office : null;
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value === "EGP" || value === "USD" || value === "EUR";
}

export function presetReady(preset: {
  company_name: string;
  address: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  iban: string;
  bank_swift: string;
}): boolean {
  return [
    preset.company_name,
    preset.address,
    preset.bank_name,
    preset.account_name,
    preset.account_number,
    preset.iban,
    preset.bank_swift,
  ].every((value) => value.trim());
}

export function presetStatusText(preset: {
  company_name: string;
  address: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  iban: string;
  bank_swift: string;
}, archived: boolean): string {
  const ready = presetReady(preset);
  if (archived && ready) {
    return "Archived. Existing documents stay available. A new issue needs an active preset.";
  }
  if (archived) {
    return "Archived, and it still needs configuration. A new issue needs an active preset that is ready to issue.";
  }
  if (ready) return "Ready to issue";
  return "Needs configuration before a PI can be issued";
}

export function presetOptionLabel(preset: { display_name: string; archived_at: string | null }): string {
  return preset.archived_at ? `${preset.display_name} (archived)` : preset.display_name;
}

export type PresetFilterOption = {
  code: string;
  label: string;
  archived: boolean;
};

export function presetFilterOptions(
  presets: { code: string; display_name: string; archived_at: string | null }[],
): PresetFilterOption[] {
  return [...presets]
    .sort((left, right) => left.display_name.localeCompare(right.display_name) || left.code.localeCompare(right.code))
    .map((preset) => ({
      code: preset.code,
      label: presetOptionLabel(preset),
      archived: preset.archived_at != null,
    }));
}

export function layoutLabel(layout: "egypt" | "uae"): string {
  return layout === "uae" ? "UAE layout" : "Egypt layout";
}

export const PRESET_IDENTITY_REVIEW =
  "This preset's office, currency, or numbering changed after the draft was saved. Reload the draft and review it before saving or issuing. Prices were not converted.";

export function presetIdentityChanged(input: {
  saved: { presetCode: string; office: string; currency: string; sequenceCode: string; prefix: string } | null;
  preset: { code: string; office: string; currency: string; sequenceCode: string; prefix: string } | null;
}): boolean {
  const saved = input.saved;
  const preset = input.preset;
  if (!saved || !preset || saved.presetCode !== preset.code) return false;
  return saved.currency !== preset.currency
    || saved.office !== preset.office
    || saved.sequenceCode !== preset.sequenceCode
    || (saved.prefix !== "" && saved.prefix !== preset.prefix);
}

export function subscriptionCurrencyMismatch(
  lines: { subscription: { currency: string } | null }[],
  currency: string | null,
): string | null {
  if (!currency) return null;
  const other = lines.find((line) => line.subscription && line.subscription.currency !== currency)?.subscription?.currency;
  if (!other) return null;
  return `A subscription on this draft is priced in ${other}. This PI is ${currency}. Prices are not converted. Choose a ${currency} commitment before saving. The saved terms stay until you do.`;
}
