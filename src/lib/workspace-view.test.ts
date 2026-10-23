import { describe, expect, it } from "vitest";
import {
  additionalSalesSummary,
  editorFingerprint,
  type EditorSnapshot,
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

function snapshot(overrides: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return {
    presetCode: "EG-EGP",
    piDate: "2026-10-19",
    expiryDate: "2026-11-19",
    clientId: "client-1",
    contactId: "contact-1",
    billTo: "Cairo",
    shipTo: "Cairo",
    shipSame: true,
    reference: "",
    leadId: "lead-1",
    salespersonIds: ["lead-1"],
    lines: [{ productId: "p1", model: "A100", description: "Pump", unit: "unit", quantity: "1", unitPrice: "10" }],
    discountType: "none",
    discountValue: "",
    shippingOn: false,
    shipping: "",
    installationOn: false,
    installation: "",
    bankOn: false,
    bankCharge: "",
    taxEnabled: false,
    taxPercent: "",
    taxExcludesShipping: false,
    taxExcludesInstallation: false,
    taxExcludesBank: false,
    priceBasis: "",
    paymentTerms: "Advance",
    paymentMode: "legacy",
    paymentSchedule: null,
    deliveryTerms: "4 weeks",
    warranty: "",
    notes: "",
    ...overrides,
  };
}

describe("draft change tracking", () => {
  it("matches an unchanged draft and notices a later edit", () => {
    const saved = editorFingerprint(snapshot());
    expect(editorFingerprint(snapshot({ salespersonIds: ["lead-1"] }))).toBe(saved);
    expect(editorFingerprint(snapshot({ salespersonIds: ["b", "a"] }))).toBe(
      editorFingerprint(snapshot({ salespersonIds: ["a", "b"] })),
    );
    expect(editorFingerprint(snapshot({ lines: [{ ...snapshot().lines[0]!, unitPrice: "12" }] }))).not.toBe(saved);
  });

  it("treats item order as part of the draft", () => {
    const first = snapshot({
      lines: [
        { productId: "p1", model: "A", description: "", unit: "unit", quantity: "1", unitPrice: "1" },
        { productId: "p2", model: "B", description: "", unit: "unit", quantity: "1", unitPrice: "2" },
      ],
    });
    const reversed = snapshot({
      lines: [...first.lines].reverse(),
    });
    expect(editorFingerprint(reversed)).not.toBe(editorFingerprint(first));
  });
});

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

  it("labels a preset filter with the preset name", () => {
    expect(piListFilterChips({
      office: "P-NORTH",
      officeName: "North Office — USD",
      currency: "",
      status: "",
      salespersonName: "",
      fromDate: "",
      toDate: "",
    })).toEqual([{ id: "office", label: "Office: North Office — USD" }]);
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
