import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import { renderPiPdf } from "./pdf";
import type { PiSnapshot } from "./types";

function snapshot(overrides: Partial<PiSnapshot> = {}): PiSnapshot {
  const base: PiSnapshot = {
    layout_version: "egypt-v1",
    preset_code: "EG-EGP",
    office: "EG",
    currency: "EGP",
    pi_number: "EG-2026-00001",
    revision: 0,
    revision_label: null,
    display_number: "EG-2026-00001",
    pi_date: "2026-10-18",
    expiry_date: "2026-11-18",
    customer_reference: "SO-44",
    company: {
      name: "Value Technologies for Import & Agencies S.A.E.",
      address: "72 Mosadak St, Dokki\nGiza, 12311 Egypt",
      phone: "+20 2 33380876 / 33383657 / 33383659",
      fax: "+20 2 33380873",
      email: "",
      website: "",
      tax_registration: "",
      logo_base64: null,
      logo_content_type: null,
    },
    bank: {
      bank_name: "Commercial International Bank (CIB)",
      branch: "Abbaseya",
      address: "115 Abbaseya st. Abbaseya Cairo Beside Omar Effendi",
      swift: "CIBEEGCX072",
      account_name: "Value Technologies for Import& Agencies S.A.E.",
      account_number: "100022610548",
      iban: "EG590010007200000100022610548",
      correspondent_bank: "",
      notes: "",
    },
    client: {
      company_name: "Nile Works",
      country: "Egypt",
      tax_number: "123",
      contact_name: "Mona Adel",
      contact_job_title: "Buyer",
      contact_phone: "+20 100",
      contact_email: "mona@example.com",
    },
    bill_to: "Nile Works\nDokki",
    ship_to: "Nile Works warehouse",
    sales: {
      lead_name: "Hana Saleh",
      lead_phone: "+20 111",
      additional: [{ name: "Omar Internal" }],
      prepared_by: "Karim Nabil",
    },
    lines: [
      {
        model_code: "VT-1",
        description: "Controller",
        unit: "unit",
        quantity: "2",
        unit_price: "100.00",
        line_total: "200.00",
      },
    ],
    adjustments: {
      discount_type: "none",
      discount_value: null,
      discount_amount: "0.00",
      shipping: null,
      installation: null,
      bank_charge: null,
      tax_enabled: false,
      tax_percent: null,
      tax_excludes_shipping: false,
      tax_excludes_installation: false,
      tax_excludes_bank_charge: false,
      subtotal: "200.00",
      net_items: "200.00",
      taxable_base: null,
      tax_amount: "0.00",
      grand_total: "200.00",
    },
    terms: {
      price_basis: "Site Delivery",
      payment_terms: "100% in advance",
      delivery_terms: "Available in stock",
      warranty: "12 months",
      additional_notes: "",
    },
  };
  return { ...base, ...overrides, company: { ...base.company, ...overrides.company }, bank: { ...base.bank, ...overrides.bank }, client: { ...base.client, ...overrides.client }, sales: { ...base.sales, ...overrides.sales }, adjustments: { ...base.adjustments, ...overrides.adjustments }, terms: { ...base.terms, ...overrides.terms }, lines: overrides.lines ?? base.lines };
}

async function textOf(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: bytes });
  const result = await parser.getText();
  await parser.destroy();
  return { text: result.text, pages: result.pages.length };
}

describe("PI pdf", () => {
  it("renders the Egypt preset with selectable bank details and no internal fields", async () => {
    const bytes = await renderPiPdf(snapshot());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const { text, pages } = await textOf(bytes);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(text).toContain("PROFORMA INVOICE");
    expect(text).toContain("Value Technologies for Import & Agencies S.A.E.");
    expect(text).toContain("EG-2026-00001");
    expect(text).toContain("Commercial International Bank (CIB)");
    expect(text).toContain("EG590010007200000100022610548");
    expect(text).toContain("CIBEEGCX072");
    expect(text).toContain("100022610548");
    expect(text).toContain("Hana Saleh");
    expect(text).toContain("Karim Nabil");
    expect(text).toContain("The price does not include VAT.");
    expect(text).not.toContain("Omar Internal");
    expect(text).not.toContain("purchase");
    expect(text).not.toContain("supplier");
  });

  it("uses the USD and EUR bank details and omits the VAT exclusion when tax is included", async () => {
    const usd = await textOf(
      await renderPiPdf(
        snapshot({
          layout_version: "uae-v1",
          preset_code: "AE-USD",
          office: "AE",
          currency: "USD",
          pi_number: "AE-2026-00007",
          display_number: "AE-2026-00007",
          company: {
            name: "Value Technologies EMEA FZ-LLC",
            address: "SFFO0491\nCompass Building,\nAl Shohada Road,\nAL Hamra Industrial Zone-FZ,\nRas Al Khaimah, United Arab Emirates",
            phone: "",
            fax: "",
            email: "",
            website: "",
            tax_registration: "",
            logo_base64: null,
            logo_content_type: null,
          },
          bank: {
            bank_name: "Arab African International Bank",
            branch: "Dubai",
            address: "NATIONAL INSURANCE AND REINSURANCE, SHEIKH ZAYED ROAD, AL WASL AREA, DUBAI, UAE",
            swift: "ARAIAEADXXX",
            account_name: "Value Technologies EMEA FZ-LLC",
            account_number: "1000081724",
            iban: "AE690070100001000081724",
            correspondent_bank: "Correspondent Bank is Citibank, its Swift Code is: CITIUS33XXX",
            notes:
              "Charges Details:\nOUR: No extra bank fees required\nSHA : Adding 72 USD to the total value of the PI as bank fess is must",
          },
          adjustments: {
            discount_type: "fixed",
            discount_value: "10.00",
            discount_amount: "10.00",
            shipping: "5.00",
            installation: null,
            bank_charge: "72.00",
            tax_enabled: true,
            tax_percent: "5",
            tax_excludes_shipping: false,
            tax_excludes_installation: false,
            tax_excludes_bank_charge: true,
            subtotal: "200.00",
            net_items: "190.00",
            taxable_base: "195.00",
            tax_amount: "9.75",
            grand_total: "276.75",
          },
        }),
      ),
    );
    expect(usd.text).toContain("Ras Al Khaimah");
    expect(usd.text).toContain("AE690070100001000081724");
    expect(usd.text).toContain("ARAIAEADXXX");
    expect(usd.text).toContain("CITIUS33XXX");
    expect(usd.text).toContain("Taxable base");
    expect(usd.text).toContain("USD 276.75");
    expect(usd.text).toContain("Bank charge");
    expect(usd.text).toContain("USD 72.00");
    expect(usd.text).not.toContain("Adding 72");
    expect(usd.text).not.toContain("bank fess");
    expect(usd.text).not.toContain("No extra bank fees");
    expect(usd.text).not.toContain("does not include VAT");
    expect(usd.text).not.toContain("issued from our supplier");

    const eur = await textOf(
      await renderPiPdf(
        snapshot({
          layout_version: "uae-v1",
          preset_code: "AE-EUR",
          office: "AE",
          currency: "EUR",
          pi_number: "AE-2026-00008",
          display_number: "AE-2026-00008-R1",
          revision: 1,
          revision_label: "R1",
          company: {
            name: "Value Technologies EMEA FZ-LLC",
            address: "SFFO0491\nCompass Building,\nAl Shohada Road,\nAL Hamra Industrial Zone-FZ,\nRas Al Khaimah, United Arab Emirates",
            phone: "",
            fax: "",
            email: "",
            website: "",
            tax_registration: "",
            logo_base64: null,
            logo_content_type: null,
          },
          bank: {
            bank_name: "Arab African International Bank",
            branch: "Dubai",
            address: "",
            swift: "ARAIAEAD",
            account_name: "Value Technologies EMEA FZ-LLC",
            account_number: "1000080086",
            iban: "AE630070100001000080086",
            correspondent_bank: "",
            notes: "",
          },
        }),
      ),
    );
    expect(eur.text).toContain("AE-2026-00008-R1");
    expect(eur.text).toContain("AE630070100001000080086");
    expect(eur.text).toContain("ARAIAEAD");
    expect(eur.text).not.toContain("ARAIAEADXXX");
    expect(eur.text).not.toContain("CITIUS33XXX");
    expect(eur.text).not.toContain("issued from our supplier");
    expect(eur.text).not.toContain("Bank charge");
    expect(eur.text).not.toContain("72 EUR");
    expect(eur.text).not.toContain("Adding 72");
  });

  it("prints only a bank charge that is included in the total", async () => {
    const omitted = await textOf(
      await renderPiPdf(
        snapshot({
          layout_version: "uae-v1",
          preset_code: "AE-USD",
          office: "AE",
          currency: "USD",
          display_number: "AE-2026-00011",
          pi_number: "AE-2026-00011",
          bank: {
            bank_name: "Arab African International Bank",
            branch: "Dubai",
            address: "",
            swift: "ARAIAEADXXX",
            account_name: "Value Technologies EMEA FZ-LLC",
            account_number: "1000081724",
            iban: "AE690070100001000081724",
            correspondent_bank: "",
            notes: "Charges Details:\nOUR: No extra bank fees required\nSHA : Adding 72 USD to the total value of the PI as bank fess is must",
          },
          adjustments: {
            discount_type: "none",
            discount_value: null,
            discount_amount: "0.00",
            shipping: null,
            installation: null,
            bank_charge: null,
            tax_enabled: false,
            tax_percent: null,
            tax_excludes_shipping: false,
            tax_excludes_installation: false,
            tax_excludes_bank_charge: false,
            subtotal: "200.00",
            net_items: "200.00",
            taxable_base: null,
            tax_amount: "0.00",
            grand_total: "200.00",
          },
        }),
      ),
    );
    expect(omitted.text).toContain("USD 200.00");
    expect(omitted.text).not.toContain("Bank charge");
    expect(omitted.text).not.toContain("Adding 72");
    expect(omitted.text).not.toContain("72 USD");
    expect(omitted.text).not.toContain("bank fess");

    const entered = await textOf(
      await renderPiPdf(
        snapshot({
          layout_version: "uae-v1",
          preset_code: "AE-EUR",
          office: "AE",
          currency: "EUR",
          display_number: "AE-2026-00012",
          pi_number: "AE-2026-00012",
          bank: {
            bank_name: "Arab African International Bank",
            branch: "Dubai",
            address: "",
            swift: "ARAIAEAD",
            account_name: "Value Technologies EMEA FZ-LLC",
            account_number: "1000080086",
            iban: "AE630070100001000080086",
            correspondent_bank: "",
            notes: "SHA : Adding 72 EUR to the total value of the PI as bank fess is must\nQuote the PI number on the transfer.",
          },
          adjustments: {
            discount_type: "none",
            discount_value: null,
            discount_amount: "0.00",
            shipping: null,
            installation: null,
            bank_charge: "15.50",
            tax_enabled: false,
            tax_percent: null,
            tax_excludes_shipping: false,
            tax_excludes_installation: false,
            tax_excludes_bank_charge: false,
            subtotal: "200.00",
            net_items: "200.00",
            taxable_base: null,
            tax_amount: "0.00",
            grand_total: "215.50",
          },
        }),
      ),
    );
    expect(entered.text).toContain("Bank charge");
    expect(entered.text).toContain("EUR 15.50");
    expect(entered.text).toContain("EUR 215.50");
    expect(entered.text).toContain("Quote the PI number on the transfer.");
    expect(entered.text).not.toContain("Adding 72");
    expect(entered.text).not.toContain("72 EUR");
    expect(entered.text).not.toContain("bank fess");
  });

  it("wraps a long description across multiple pages and repeats the item heading", async () => {
    const description = "Industrial specification ".repeat(40).trim();
    const lines = Array.from({ length: 28 }, (_, index) => ({
      model_code: `M-${index + 1}`,
      description: index === 3 ? description : `Line item ${index + 1} with a moderately long commercial description for wrapping.`,
      unit: "set",
      quantity: "1",
      unit_price: "15.50",
      line_total: "15.50",
    }));
    const { text, pages } = await textOf(
      await renderPiPdf(
        snapshot({
          lines,
          adjustments: {
            discount_type: "none",
            discount_value: null,
            discount_amount: "0.00",
            shipping: null,
            installation: null,
            bank_charge: null,
            tax_enabled: false,
            tax_percent: null,
            tax_excludes_shipping: false,
            tax_excludes_installation: false,
            tax_excludes_bank_charge: false,
            subtotal: "434.00",
            net_items: "434.00",
            taxable_base: null,
            tax_amount: "0.00",
            grand_total: "434.00",
          },
        }),
      ),
    );
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain("Industrial specification");
    expect(text).toContain("M-28");
    expect(text).toContain("Page 1 of");
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(text.match(/Description/g)?.length).toBeGreaterThan(1);
    expect(text).toContain("EG590010007200000100022610548");
  });
});
