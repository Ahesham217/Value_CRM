import { displayStatusLabel, formatDate, formatMoney, officeLabel } from "./format";
import type { DiscountType } from "./types";

export type FilterChip = {
  id: string;
  label: string;
};

export type AdjustmentKey = "discount" | "shipping" | "installation" | "bank" | "tax";

export type AdjustmentRow = {
  key: AdjustmentKey;
  label: string;
  display: string;
};

export function oneLine(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function descriptionSummary(value: string, max = 96): string {
  return oneLine(value, max);
}

export function billingSummary(value: string): string {
  const text = oneLine(value, 140);
  return text || "No billing address yet";
}

export function contactLine(contact: { name: string; job_title?: string; phone?: string; email?: string }): string {
  return [contact.name, contact.job_title, contact.phone, contact.email]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" · ");
}

export function moneyLabel(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined) return "—";
  const trimmed = String(amount).trim();
  if (!trimmed) return "—";
  try {
    return formatMoney(trimmed, currency);
  } catch {
    return trimmed;
  }
}

export function piListFilterChips(input: {
  office: string;
  currency: string;
  status: string;
  salespersonName: string;
  fromDate: string;
  toDate: string;
}): FilterChip[] {
  const chips: FilterChip[] = [];
  if (input.status) chips.push({ id: "status", label: `Status: ${displayStatusLabel(input.status)}` });
  if (input.office) chips.push({ id: "office", label: `Office: ${officeLabel(input.office)}` });
  if (input.currency) chips.push({ id: "currency", label: `Currency: ${input.currency}` });
  if (input.salespersonName) chips.push({ id: "salesperson", label: `Salesperson: ${input.salespersonName}` });
  if (input.fromDate || input.toDate) {
    const from = input.fromDate ? formatDate(input.fromDate) : "Any start";
    const to = input.toDate ? formatDate(input.toDate) : "Any end";
    chips.push({ id: "dates", label: `Date: ${from} – ${to}` });
  }
  return chips;
}

export function additionalSalesSummary(names: string[]): string | null {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return `Also assigned: ${clean.join(", ")}`;
}

export function clientOptionalSummary(input: { shipSame: boolean; reference: string }): string | null {
  const parts: string[] = [];
  if (!input.shipSame) parts.push("Shipping address differs from billing");
  const reference = input.reference.trim();
  if (reference) parts.push(`Reference: ${oneLine(reference, 60)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function recordOptionalSummary(parts: { label: string; value: string }[]): string | null {
  const bits = parts
    .map((part) => {
      const value = oneLine(part.value, 48);
      return value ? `${part.label}: ${value}` : "";
    })
    .filter(Boolean);
  if (bits.length === 0) return null;
  return oneLine(bits.join(" · "), 160);
}

export function adjustmentRows(input: {
  currency: string | null;
  discountType: DiscountType;
  discountValue: string;
  discountAmount: string | null;
  shippingOn: boolean;
  shipping: string;
  installationOn: boolean;
  installation: string;
  bankOn: boolean;
  bankCharge: string;
  taxEnabled: boolean;
  taxPercent: string;
  taxAmount: string | null;
}): AdjustmentRow[] {
  const rows: AdjustmentRow[] = [];
  if (input.discountType === "percent" || input.discountType === "fixed") {
    const calculated = input.discountAmount;
    const fallback = input.discountType === "fixed" ? input.discountValue.trim() || "0" : null;
    rows.push({
      key: "discount",
      label: input.discountType === "percent" ? `Discount (${input.discountValue.trim() || "0"}%)` : "Discount",
      display: moneyLabel(calculated ?? fallback, input.currency),
    });
  }
  if (input.shippingOn) {
    rows.push({ key: "shipping", label: "Shipping", display: moneyLabel(input.shipping.trim() || "0", input.currency) });
  }
  if (input.installationOn) {
    rows.push({
      key: "installation",
      label: "Installation",
      display: moneyLabel(input.installation.trim() || "0", input.currency),
    });
  }
  if (input.bankOn) {
    rows.push({
      key: "bank",
      label: "Bank charge",
      display: moneyLabel(input.bankCharge.trim() || "0", input.currency),
    });
  }
  if (input.taxEnabled) {
    rows.push({
      key: "tax",
      label: `Tax (${input.taxPercent.trim() || "0"}%)`,
      display: input.taxAmount === null ? "—" : moneyLabel(input.taxAmount, input.currency),
    });
  }
  return rows;
}

export function taxExclusionNotes(input: {
  taxEnabled: boolean;
  shippingOn: boolean;
  installationOn: boolean;
  bankOn: boolean;
  taxExcludesShipping: boolean;
  taxExcludesInstallation: boolean;
  taxExcludesBank: boolean;
}): string[] {
  if (!input.taxEnabled) return [];
  const notes: string[] = [];
  if (input.shippingOn && input.taxExcludesShipping) notes.push("Shipping is excluded from tax.");
  if (input.installationOn && input.taxExcludesInstallation) notes.push("Installation is excluded from tax.");
  if (input.bankOn && input.taxExcludesBank) notes.push("Bank charge is excluded from tax.");
  return notes;
}
