import Decimal from "decimal.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthName = MONTHS[month - 1];
  if (!monthName) return value;
  return `${day} ${monthName} ${year}`;
}

export function formatMoney(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const decimal = new Decimal(amount);
  const [whole, fraction] = decimal.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = `${grouped}.${fraction}`;
  return currency ? `${currency} ${text}` : text;
}

export function formatQuantity(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const decimal = new Decimal(amount);
  return decimal.toFixed(4).replace(/\.?0+$/, "");
}

export function officeLabel(office: string | null | undefined): string {
  if (office === "EG") return "Egypt";
  if (office === "AE") return "UAE";
  return office || "—";
}

export function displayStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "issued":
      return "Issued";
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function revisionLabel(revision: number | null | undefined): string | null {
  if (revision === null || revision === undefined || revision <= 0) return null;
  return `R${revision}`;
}

export function displayNumber(piNumber: string | null, revision: number | null): string {
  if (!piNumber) return "Draft";
  const label = revisionLabel(revision);
  return label ? `${piNumber}-${label}` : piNumber;
}
