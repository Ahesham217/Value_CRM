import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import { previewPaymentSchedule, type PaymentRow, type PaymentSchedule } from "./payment-schedule";
import { buildPiDefinition, pdfFilename, renderPiPdf } from "./pdf";
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

function paymentRow(id: string, overrides: Partial<PaymentRow>): PaymentRow {
  return {
    id,
    label: "",
    amount: { type: "unset" },
    due: { type: "unset" },
    instalments: null,
    ...overrides,
  };
}

async function textOf(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: bytes });
  const result = await parser.getText();
  await parser.destroy();
  return { text: result.text, pages: result.pages.length };
}

describe("PI pdf", () => {
  it.each([
    ["EG-EGP", "egypt-v1", "EG", "EGP"],
    ["AE-USD", "uae-v1", "AE", "USD"],
    ["AE-EUR", "uae-v1", "AE", "EUR"],
  ] as const)("shows the company contact and keeps the preparer internal for %s", async (preset, layout, office, currency) => {
    const issued = snapshot({
      preset_code: preset, layout_version: layout, office, currency,
      revision: 1, revision_label: "R1", display_number: `${office}-2026-00001-R1`,
    });
    const original = JSON.stringify(issued);
    const definition = JSON.stringify(buildPiDefinition(issued));
    expect(definition).toContain("Contact person");
    expect(definition).toContain("Hana Saleh");
    expect(definition).toContain("+20 111");
    expect(definition).not.toContain("Lead salesperson");
    expect(definition).not.toContain("Prepared by");
    expect(definition).not.toContain("Karim Nabil");
    const { text } = await textOf(await renderPiPdf(issued));
    expect(text).toContain("Contact person");
    expect(text).toContain("Hana Saleh");
    expect(text).toContain("+20 111");
    expect(text).not.toContain("Lead salesperson");
    expect(text).not.toContain("Prepared by");
    expect(text).not.toContain("Karim Nabil");
    expect(text).not.toContain("Omar Internal");
    expect(JSON.stringify(issued)).toBe(original);
    expect(issued.sales.prepared_by).toBe("Karim Nabil");
  });

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
    expect(text).not.toContain("Karim Nabil");
    expect(text).toContain("EGP 200.00");
    expect(text).toContain("Client");
    expect(text).toContain("the information mentioned above");
    expect(text).not.toContain("the above information is true");
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
    expect(usd.text).toContain("the above information is true");
    expect(usd.text).not.toContain("the information mentioned above");
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
    expect(text.indexOf("M-1")).toBeLessThan(text.indexOf("M-2"));
    expect(text.indexOf("M-2")).toBeLessThan(text.indexOf("M-28"));
    expect(text.match(/Description/g)?.length).toBeGreaterThan(1);
    expect(text).toContain("EG590010007200000100022610548");
  });

  it("keeps saved line order, revision filename, and the saved logo", async () => {
    const pngLogo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const jpegLogo = Buffer.from(
      "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda000c03010002110311003f00f7fa28a2803f00ffd9",
      "hex",
    ).toString("base64");
    const currentLogo = "CURRENT-LOGO-NOT-IN-THE-SNAPSHOT";
    const pngDocument = JSON.stringify(buildPiDefinition(snapshot({
      company: {
        name: "Saved company",
        address: "Saved address",
        phone: "",
        fax: "",
        email: "",
        website: "",
        tax_registration: "",
        logo_base64: pngLogo,
        logo_content_type: "image/png",
      },
    })));
    expect(pngDocument).toContain(`data:image/png;base64,${pngLogo}`);
    expect(pngDocument).not.toContain(currentLogo);
    const issued = snapshot({
      display_number: "AE-2026-00008-R1",
      pi_number: "AE-2026-00008",
      revision: 1,
      revision_label: "R1",
      lines: [
        {
          model_code: "FIRST-MODEL",
          description: "Saved first line",
          unit: "unit",
          quantity: "1",
          unit_price: "10.00",
          line_total: "10.00",
        },
        {
          model_code: "SECOND-MODEL",
          description: "Saved second line",
          unit: "unit",
          quantity: "1",
          unit_price: "5.00",
          line_total: "5.00",
        },
      ],
      company: {
        name: "Saved company",
        address: "Saved address",
        phone: "",
        fax: "",
        email: "",
        website: "",
        tax_registration: "",
        logo_base64: jpegLogo,
        logo_content_type: "image/jpeg",
      },
    });
    expect(pdfFilename(issued)).toBe("AE-2026-00008-R1.pdf");
    const definition = JSON.stringify(buildPiDefinition(issued));
    expect(definition).toContain(`data:image/jpeg;base64,${jpegLogo}`);
    expect(definition).not.toContain(currentLogo);
    const bytes = await renderPiPdf(issued);
    expect(Buffer.from(bytes).includes(Buffer.from(jpegLogo, "base64"))).toBe(true);
    const { text } = await textOf(bytes);
    expect(text.indexOf("FIRST-MODEL")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("FIRST-MODEL")).toBeLessThan(text.indexOf("SECOND-MODEL"));
    expect(text).toContain("AE-2026-00008-R1");
    expect(text).toContain("Saved company");
  });

  it("renders only the saved snapshot when current records differ", async () => {
    const currentRecords = {
      company: "Current Company Ltd",
      client: "Current Client",
      bank: "Current Bank",
      salesperson: "Current Seller",
      preparer: "Current Preparer",
      model: "CURRENT-MODEL",
      description: "Current catalogue description",
    };
    const { text } = await textOf(await renderPiPdf(snapshot()));
    expect(text).toContain("Nile Works");
    expect(text).toContain("Commercial International Bank (CIB)");
    expect(text).toContain("Hana Saleh");
    expect(text).not.toContain("Karim Nabil");
    expect(text).toContain("VT-1");
    expect(text).toContain("Controller");
    for (const value of Object.values(currentRecords)) {
      expect(text).not.toContain(value);
    }
  });

  it("rejects an unsupported layout instead of using another one", async () => {
    const issued = snapshot({ layout_version: "egypt-v9" as PiSnapshot["layout_version"] });
    await expect(renderPiPdf(issued)).rejects.toThrow(/layout version "egypt-v9"/);
    await expect(renderPiPdf(issued)).rejects.toThrow(/No other layout was used/);
    await expect(renderPiPdf(issued)).rejects.toThrow(/cannot render/);
  });

  it("renders a snapshot that also stores product and line identifiers", async () => {
    const lineId = "11111111-1111-1111-1111-111111111111";
    const productId = "22222222-2222-2222-2222-222222222222";
    const issued = snapshot({
      lines: [{
        model_code: "VT-1",
        description: "Controller",
        unit: "unit",
        quantity: "2",
        unit_price: "100.00",
        line_total: "200.00",
        line_id: lineId,
        product_id: productId,
        position: 1,
      }],
    });
    const { text } = await textOf(await renderPiPdf(issued));
    expect(text).toContain("VT-1");
    expect(text).toContain("Controller");
    expect(text).toContain("100.00");
    expect(text).not.toContain(lineId);
    expect(text).not.toContain(productId);
  });

  it("prints a structured payment agreement from the snapshot", async () => {
    const agreement: PaymentSchedule = {
      schema_version: 1,
      no_payment_due: false,
      dates_need_review: false,
      rows: [
        paymentRow("00000000-0000-4000-8000-000000000001", {
          label: "advance payment",
          amount: { type: "percent", percent: "30" },
          due: { type: "on_event", event: { type: "standard", code: "order_confirmation" } },
        }),
        paymentRow("00000000-0000-4000-8000-000000000002", {
          label: "before shipment",
          amount: { type: "percent", percent: "15" },
          due: { type: "before_shipment", deadline: null },
        }),
        paymentRow("00000000-0000-4000-8000-000000000003", {
          label: "Remaining balance",
          amount: { type: "remainder" },
          instalments: {
            count: 10,
            frequency: "monthly",
            first: { type: "after_event", event: { type: "standard", code: "delivery" }, offset: 1, unit: "months" },
          },
        }),
      ],
    };
    const preview = previewPaymentSchedule(agreement, "USD", "100000.00");
    const issued = snapshot({
      layout_version: "uae-v2",
      preset_code: "AE-USD",
      office: "AE",
      currency: "USD",
      pi_number: "AE-2026-00008",
      display_number: "AE-2026-00008",
      adjustments: { ...snapshot().adjustments, grand_total: "100000.00", subtotal: "100000.00", net_items: "100000.00" },
      terms: { ...snapshot().terms, payment_terms: preview.customerText ?? "" },
      payment: preview.canonical,
    });
    const original = JSON.stringify(issued);
    const { text } = await textOf(await renderPiPdf(issued));
    const compact = text.replace(/\s+/g, " ");
    expect(compact).toContain("30% advance payment upon order confirmation");
    expect(compact).toContain("15% before shipment");
    expect(compact).toContain("10 monthly instalments");
    expect(compact).toContain("one calendar month after delivery");
    expect(text).toContain("Contact person");
    expect(text).toContain("Hana Saleh");
    expect(text).toContain("To");
    expect(text).toContain("the above information is true");
    expect(text).not.toContain("Prepared by");
    expect(text).not.toContain("Karim Nabil");
    expect(text).not.toContain("Awaiting");
    expect(text).not.toContain("Deadline to be set");
    expect(text).not.toContain("00000000-0000-4000-8000");
    expect(text).not.toContain("order_confirmation");
    expect(JSON.stringify(issued)).toBe(original);
    const currentCatalogue = "CURRENT-CATALOGUE-PRICE";
    expect(text).not.toContain(currentCatalogue);
  });

  it("keeps a long structured schedule readable across pages", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => paymentRow(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, {
      label: `Stage ${index + 1} retention holdback for commissioning`,
      amount: { type: "fixed", amount: "2500.00" },
      instalments: {
        count: 3,
        frequency: "monthly",
        first: { type: "date", date: "2026-12-01" },
      },
    }));
    const preview = previewPaymentSchedule({ schema_version: 1, no_payment_due: false, dates_need_review: false, rows }, "EGP", "20000.00");
    expect(preview.presentation).toBe("table");
    const issued = snapshot({
      layout_version: "egypt-v2",
      lines: Array.from({ length: 12 }, (_, index) => ({
        model_code: `VT-${index + 1}`,
        description: `Long catalogue description ${index + 1} that keeps the item table from collapsing the payment schedule onto the first page.`,
        unit: "unit",
        quantity: "1",
        unit_price: "10.00",
        line_total: "10.00",
      })),
      terms: { ...snapshot().terms, payment_terms: preview.customerText ?? "" },
      payment: preview.canonical,
    });
    const { text, pages } = await textOf(await renderPiPdf(issued));
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain("Payment schedule");
    expect(text).toContain("Stage 1 retention holdback");
    expect(text).toContain("Stage 8 retention holdback");
    expect(text).toContain("Commercial International Bank (CIB)");
    expect(text).toContain("Page 1 of");
    expect(text).not.toContain("00000000-0000-4000-8000");
    expect(text).not.toContain("Awaiting");
  });

  it("still renders legacy payment text on v1 and refuses a v2 snapshot without a payment agreement", async () => {
    const legacy = await textOf(await renderPiPdf(snapshot()));
    expect(legacy.text).toContain("100% in advance");
    const broken = snapshot({ layout_version: "egypt-v2" });
    await expect(renderPiPdf(broken)).rejects.toThrow(/payment schedule/);
  });

  it("prints the saved commitment and only the current-year total on layout v3", async () => {
    const obligationId = "33333333-3333-4333-8333-333333333333";
    const productId = "44444444-4444-4444-8444-444444444444";
    const issued = snapshot({
      layout_version: "uae-v3",
      currency: "USD",
      preset_code: "AE-USD",
      office: "AE",
      lines: [{
        model_code: "PLAN-1",
        description: "Support plan",
        unit: "license",
        quantity: "2",
        unit_price: "1950.00",
        line_total: "3900.00",
        product_id: productId,
        subscription: {
          schema_version: 1,
          option_id: "55555555-5555-4555-8555-555555555555",
          obligation_id: obligationId,
          product_id: productId,
          billing_type: "subscription",
          commitment_years: 3,
          currency: "USD",
          current_year: 1,
          catalogue_first_year_unit_price: "1950.00",
          negotiated_first_year_unit_price: "1950.00",
          later_year_rule: "vendor_confirmed_base_adjustment",
          later_year_base_unit_price: "1950.00",
          catalogue_later_year_base_unit_price: "1950.00",
          adjustment_compounds: false,
          payable_in_advance: true,
          customer_text: "Three-year commitment. Year 1: USD 1,950.00 per unit. Years 2 and 3: USD 1,950.00 per unit plus the applicable vendor-confirmed CPI adjustment for each year. Each annual adjustment is applied independently to the USD 1,950.00 base. Each year is payable 100% in advance. Only Year 1 is included in this PI total.",
        },
      }],
      adjustments: {
        ...snapshot().adjustments,
        subtotal: "3900.00",
        net_items: "3900.00",
        grand_total: "3900.00",
      },
      payment: {
        schema_version: 2,
        currency: "USD",
        grand_total: "3900.00",
        subscription_total: "3900.00",
        one_time_total: "0.00",
        customer_text: "Subscription charges of USD 3,900.00 are payable 100% in advance.",
        presentation: "paragraph",
        no_payment_due: false,
        subscription_obligations: [{
          id: obligationId,
          product_id: productId,
          position: 1,
          amount: "3900.00",
          due_formula: "payable 100% in advance",
        }],
        rows: [],
        allocation: { residual_target: null, residual_applied: false, lines: [] },
      },
    });
    const { text } = await textOf(await renderPiPdf(issued));
    expect(text).toContain("Three-year commitment");
    expect(text).toMatch(/Only\s+Year 1 is included in this PI total/);
    expect(text).toContain("3,900.00");
    expect(text).not.toContain("11,700");
    expect(text).not.toContain(obligationId);
    expect(text).not.toContain(productId);
    expect(text).not.toContain("purchase");
    const legacy = await textOf(await renderPiPdf(snapshot({ layout_version: "egypt-v1" })));
    expect(legacy.text).not.toContain("Three-year commitment");
    const previous = await textOf(await renderPiPdf(snapshot({ layout_version: "uae-v2", payment: {
      schema_version: 1,
      currency: "EGP",
      grand_total: "200.00",
      customer_text: "100% advance payment upon order confirmation.",
      presentation: "paragraph",
      no_payment_due: false,
      rows: [],
    } })));
    expect(previous.text).toContain("100% advance payment upon order confirmation.");
    expect(previous.text).not.toContain("Three-year commitment");
  });

  it("reports a snapshot that is missing saved rendering data", async () => {
    const issued = snapshot();
    const broken = { ...issued, company: undefined } as unknown as PiSnapshot;
    await expect(renderPiPdf(broken)).rejects.toThrow(/company details/);
    await expect(renderPiPdf(broken)).rejects.toThrow(/current catalogue or company records were not used/);
  });
});
