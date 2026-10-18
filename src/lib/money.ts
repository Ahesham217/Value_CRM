import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DiscountType = "none" | "fixed" | "percent";

export type LineInput = {
  quantity: string;
  unitPrice: string | null;
};

export type AdjustmentInput = {
  discountType: DiscountType;
  discountValue: string | null;
  shipping: string | null;
  installation: string | null;
  bankCharge: string | null;
  taxEnabled: boolean;
  taxPercent: string | null;
  taxExcludesShipping: boolean;
  taxExcludesInstallation: boolean;
  taxExcludesBankCharge: boolean;
};

export type CalculatedLine = {
  lineTotal: string | null;
};

export type CalculatedTotals = {
  lines: CalculatedLine[];
  subtotal: string;
  discountAmount: string;
  netItems: string;
  shipping: string;
  installation: string;
  bankCharge: string;
  taxableBase: string | null;
  taxAmount: string;
  grandTotal: string;
  unpricedCount: number;
};

const MONEY = /^\d+(\.\d+)?$/;

function parseAmount(value: string | null, label: string): Decimal | null {
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (!MONEY.test(trimmed)) {
    throw new Error(`${label} must be a nonnegative number.`);
  }
  const amount = new Decimal(trimmed);
  if (amount.isNegative()) {
    throw new Error(`${label} cannot be negative.`);
  }
  return amount;
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function calculateDocument(
  lines: LineInput[],
  adjustments: AdjustmentInput,
): CalculatedTotals {
  if (lines.length > 200) {
    throw new Error("A PI can contain at most 200 lines.");
  }

  const calculated: CalculatedLine[] = [];
  let subtotal = new Decimal(0);
  let unpricedCount = 0;

  for (const line of lines) {
    const quantity = parseAmount(line.quantity, "Quantity");
    if (quantity === null || quantity.lte(0)) {
      throw new Error("Quantity must be greater than zero.");
    }
    const unitPrice = parseAmount(line.unitPrice, "Unit price");
    if (unitPrice === null) {
      unpricedCount += 1;
      calculated.push({ lineTotal: null });
      continue;
    }
    const lineTotal = roundMoney(quantity.mul(unitPrice));
    subtotal = subtotal.plus(lineTotal);
    calculated.push({ lineTotal: money(lineTotal) });
  }

  const discountValue = parseAmount(adjustments.discountValue, "Discount");
  let discountAmount = new Decimal(0);
  if (adjustments.discountType === "percent") {
    const percent = discountValue ?? new Decimal(0);
    if (percent.gt(100)) {
      throw new Error("Percentage discount must be between 0 and 100.");
    }
    discountAmount = roundMoney(subtotal.mul(percent).div(100));
  } else if (adjustments.discountType === "fixed") {
    discountAmount = discountValue ?? new Decimal(0);
    if (discountAmount.gt(subtotal)) {
      throw new Error("Fixed discount cannot be greater than the item subtotal.");
    }
  } else if (adjustments.discountType !== "none") {
    throw new Error("Invalid discount type.");
  }

  const netItems = subtotal.minus(discountAmount);
  const shipping = parseAmount(adjustments.shipping, "Shipping") ?? new Decimal(0);
  const installation = parseAmount(adjustments.installation, "Installation") ?? new Decimal(0);
  const bankCharge = parseAmount(adjustments.bankCharge, "Bank charge") ?? new Decimal(0);

  let taxableBase = netItems;
  if (!adjustments.taxExcludesShipping) taxableBase = taxableBase.plus(shipping);
  if (!adjustments.taxExcludesInstallation) taxableBase = taxableBase.plus(installation);
  if (!adjustments.taxExcludesBankCharge) taxableBase = taxableBase.plus(bankCharge);

  let taxAmount = new Decimal(0);
  if (adjustments.taxEnabled) {
    const percent = parseAmount(adjustments.taxPercent, "Tax percentage") ?? new Decimal(0);
    if (percent.gt(100)) {
      throw new Error("Tax percentage must be between 0 and 100.");
    }
    taxAmount = roundMoney(taxableBase.mul(percent).div(100));
  }

  const grandTotal = netItems.plus(shipping).plus(installation).plus(bankCharge).plus(taxAmount);

  return {
    lines: calculated,
    subtotal: money(subtotal),
    discountAmount: money(discountAmount),
    netItems: money(netItems),
    shipping: money(shipping),
    installation: money(installation),
    bankCharge: money(bankCharge),
    taxableBase: adjustments.taxEnabled ? money(taxableBase) : null,
    taxAmount: money(taxAmount),
    grandTotal: money(grandTotal),
    unpricedCount,
  };
}
