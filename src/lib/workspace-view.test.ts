import { describe, expect, it } from "vitest";
import {
  additionalSalesSummary,
  adjustmentRows,
  billingSummary,
  clientOptionalSummary,
  contactLine,
  descriptionSummary,
  moneyLabel,
  piListFilterChips,
  recordOptionalSummary,
  taxExclusionNotes,
} from "./workspace-view";

describe("everyday summaries", () => {
  it("keeps a short description and collapses a long one to one line", () => {
    expect(descriptionSummary("Pump controller")).toBe("Pump controller");
    expect(descriptionSummary("First line\nsecond line")).toBe("First line second line");
    expect(descriptionSummary("a".repeat(120), 20).endsWith("…")).toBe(true);
    expect(descriptionSummary("a".repeat(120), 20).length).toBeLessThanOrEqual(20);
  });

  it("shows a billing summary even when the address is blank", () => {
    expect(billingSummary("")).toBe("No billing address yet");
    expect(billingSummary("12 Nile St\nCairo")).toBe("12 Nile St Cairo");
  });

  it("joins the contact details that are present", () => {
    expect(contactLine({ name: "Mona Adel", job_title: "Buyer", phone: "", email: "mona@example.com" })).toBe(
      "Mona Adel · Buyer · mona@example.com",
    );
  });

  it("keeps an explicit zero and leaves a blank amount unknown", () => {
    expect(moneyLabel("0", "EGP")).toBe("EGP 0.00");
    expect(moneyLabel("", "USD")).toBe("—");
    expect(moneyLabel("not-a-number", "EUR")).toBe("not-a-number");
  });
});

describe("pi list filters", () => {
  it("shows a removable chip only for filters that are applied", () => {
    expect(piListFilterChips({
      office: "",
      currency: "",
      status: "",
      salespersonName: "",
      fromDate: "",
      toDate: "",
    })).toEqual([]);

    expect(piListFilterChips({
      office: "EG",
      currency: "EGP",
      status: "issued",
      salespersonName: "Mona Adel",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    })).toEqual([
      { id: "status", label: "Status: Issued" },
      { id: "office", label: "Office: Egypt" },
      { id: "currency", label: "Currency: EGP" },
      { id: "salesperson", label: "Salesperson: Mona Adel" },
      { id: "dates", label: "Date: 1 Jan 2026 – 31 Jan 2026" },
    ]);
  });
});

describe("optional PI values stay visible", () => {
  it("summarises a different shipping address and a customer reference", () => {
    expect(clientOptionalSummary({ shipSame: true, reference: "" })).toBeNull();
    expect(clientOptionalSummary({ shipSame: false, reference: "SO-14" })).toBe(
      "Shipping address differs from billing · Reference: SO-14",
    );
  });

  it("lists additional salespeople and omits an empty assignment", () => {
    expect(additionalSalesSummary([])).toBeNull();
    expect(additionalSalesSummary(["Nour Hassan", "Omar Fathy"])).toBe("Also assigned: Nour Hassan, Omar Fathy");
  });

  it("lists only adjustments that are turned on, including an explicit zero", () => {
    expect(adjustmentRows({
      currency: "USD",
      discountType: "none",
      discountValue: "",
      discountAmount: null,
      shippingOn: false,
      shipping: "",
      installationOn: false,
      installation: "",
      bankOn: false,
      bankCharge: "",
      taxEnabled: false,
      taxPercent: "",
      taxAmount: null,
    })).toEqual([]);

    expect(adjustmentRows({
      currency: "USD",
      discountType: "percent",
      discountValue: "10",
      discountAmount: "15.00",
      shippingOn: true,
      shipping: "0",
      installationOn: false,
      installation: "25",
      bankOn: true,
      bankCharge: "",
      taxEnabled: true,
      taxPercent: "14",
      taxAmount: "8.40",
    })).toEqual([
      { key: "discount", label: "Discount (10%)", display: "USD 15.00" },
      { key: "shipping", label: "Shipping", display: "USD 0.00" },
      { key: "bank", label: "Bank charge", display: "USD 0.00" },
      { key: "tax", label: "Tax (14%)", display: "USD 8.40" },
    ]);
  });

  it("mentions tax exclusions only when that charge and tax are both on", () => {
    expect(taxExclusionNotes({
      taxEnabled: false,
      shippingOn: true,
      installationOn: false,
      bankOn: false,
      taxExcludesShipping: true,
      taxExcludesInstallation: true,
      taxExcludesBank: true,
    })).toEqual([]);
    expect(taxExclusionNotes({
      taxEnabled: true,
      shippingOn: true,
      installationOn: true,
      bankOn: false,
      taxExcludesShipping: true,
      taxExcludesInstallation: false,
      taxExcludesBank: true,
    })).toEqual(["Shipping is excluded from tax."]);
  });

  it("summarises saved commercial terms and record details without dropping them", () => {
    expect(recordOptionalSummary([
      { label: "Price basis", value: "" },
      { label: "Warranty", value: "" },
      { label: "Notes", value: "" },
    ])).toBeNull();
    expect(recordOptionalSummary([
      { label: "Price basis", value: "Ex works" },
      { label: "Warranty", value: "12 months" },
      { label: "Notes", value: "" },
    ])).toBe("Price basis: Ex works · Warranty: 12 months");
  });
});
