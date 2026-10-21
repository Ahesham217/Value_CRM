import pdfMake from "pdfmake/build/pdfmake";
import vfs from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { formatDate, formatMoney, formatQuantity } from "./format";
import type { PiSnapshot } from "./types";

let fontsReady = false;

function ensureFonts(): void {
  if (fontsReady) return;
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFonts({
    Roboto: {
      normal: "Roboto-Regular.ttf",
      bold: "Roboto-Medium.ttf",
      italics: "Roboto-Italic.ttf",
      bolditalics: "Roboto-MediumItalic.ttf",
    },
  });
  fontsReady = true;
}

const NAVY = "#12324d";
const MUTED = "#5c6b7a";
const LINE = "#d5dde5";
const RULE = "#8aa0b5";

function paragraph(text: string | null | undefined): string {
  return (text ?? "").replace(/\r\n/g, "\n").trim();
}

function nonzero(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value.trim() === "") return false;
  return Number(value) !== 0;
}

function metaRow(label: string, value: string): Content {
  return {
    columns: [
      { text: label, width: 78, color: MUTED, fontSize: 8 },
      { text: value || "—", width: "*", fontSize: 9 },
    ],
    margin: [0, 1, 0, 1],
  };
}

function sectionTitle(text: string): Content {
  return {
    text,
    style: "section",
    margin: [0, 10, 0, 4],
  };
}

function partyBlock(title: string, lines: string[]): Content {
  const body = lines.map((line) => paragraph(line)).filter(Boolean);
  return {
    stack: [
      { text: title, color: MUTED, fontSize: 8, margin: [0, 0, 0, 2] },
      { text: body.length ? body.join("\n") : "—", fontSize: 9 },
    ],
  };
}

function identityLines(snapshot: PiSnapshot): string[] {
  const company = snapshot.company;
  return [
    company.address,
    company.phone ? `Phone: ${company.phone}` : "",
    company.fax ? `Fax: ${company.fax}` : "",
    company.email ? `Email: ${company.email}` : "",
    company.website ? company.website : "",
    company.tax_registration ? `Tax registration: ${company.tax_registration}` : "",
  ].filter((line) => paragraph(line));
}

function header(snapshot: PiSnapshot): Content {
  const logo = snapshot.company.logo_base64
    ? {
        image: `data:${snapshot.company.logo_content_type || "image/png"};base64,${snapshot.company.logo_base64}`,
        fit: [180, 42] as [number, number],
        margin: [0, 0, 0, 6] as [number, number, number, number],
      }
    : null;
  const identity: Content[] = [
    ...(logo ? [logo] : []),
    { text: snapshot.company.name || "Company name not configured", style: "company" },
    { text: identityLines(snapshot).join("\n"), fontSize: 8, color: MUTED, margin: [0, 3, 0, 0] },
  ];
  const meta: Content[] = [
    { text: "PROFORMA INVOICE", style: "title" },
    { text: snapshot.display_number, style: "number", margin: [0, 2, 0, 6] },
    metaRow("Date", formatDate(snapshot.pi_date)),
    metaRow("Expiry", formatDate(snapshot.expiry_date)),
    metaRow("Invoice no.", snapshot.display_number),
    metaRow("SO / reference", snapshot.customer_reference || "—"),
    metaRow("Currency", snapshot.currency),
  ];
  return {
    columns: [
      { stack: identity, width: "*" },
      { stack: meta, width: 220 },
    ],
    columnGap: 16,
    margin: [0, 0, 0, 8],
  };
}

function parties(snapshot: PiSnapshot, layout: IssuedLayoutVersion): Content {
  const clientLines = [
    snapshot.client.company_name,
    snapshot.client.country,
    snapshot.client.tax_number ? `Tax no. ${snapshot.client.tax_number}` : "",
    snapshot.client.contact_name
      ? [
          snapshot.client.contact_name,
          snapshot.client.contact_job_title,
          snapshot.client.contact_phone,
          snapshot.client.contact_email,
        ]
          .filter(Boolean)
          .join(" · ")
      : "",
  ].filter((line) => paragraph(line));

  return {
    columns: [
      partyBlock(layout.startsWith("uae-") ? "To" : "Client", clientLines),
      partyBlock("Bill to", [snapshot.bill_to]),
      partyBlock("Ship to", [snapshot.ship_to]),
    ],
    columnGap: 12,
    margin: [0, 4, 0, 2],
  };
}

// Customer-facing attribution is an explicit presentation/privacy rule for all
// layouts, including legacy snapshots. Internal preparer data remains untouched.
function attribution(snapshot: PiSnapshot): Content {
  return {
    stack: [
      metaRow("Contact person", [snapshot.sales.lead_name, snapshot.sales.lead_phone].filter(Boolean).join(" · ")),
    ],
    margin: [0, 6, 0, 2],
  };
}

function itemsTable(snapshot: PiSnapshot): Content {
  const currency = snapshot.currency;
  const body: Content[][] = [
    [
      { text: "Model", style: "th" },
      { text: "Description", style: "th" },
      { text: "Unit", style: "th" },
      { text: "Qty", style: "th", alignment: "right" },
      { text: `Unit price\n${currency}`, style: "th", alignment: "right" },
      { text: `Total\n${currency}`, style: "th", alignment: "right" },
    ],
  ];
  for (const line of snapshot.lines) {
    body.push([
      { text: line.model_code || "—", fontSize: 8 },
      { text: line.description || "—", fontSize: 8 },
      { text: line.unit || "—", fontSize: 8 },
      { text: formatQuantity(line.quantity), fontSize: 8, alignment: "right" },
      { text: formatMoney(line.unit_price), fontSize: 8, alignment: "right" },
      { text: formatMoney(line.line_total), fontSize: 8, alignment: "right" },
    ]);
  }
  if (snapshot.lines.length === 0) {
    body.push([
      { text: "No items", color: MUTED, alignment: "center" },
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  return {
    table: {
      headerRows: 1,
      widths: [68, "*", 42, 36, 62, 64],
      body,
      dontBreakRows: false,
    },
    layout: {
      fillColor: (rowIndex) => (rowIndex === 0 ? "#e8eef4" : null),
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      hLineWidth: () => 0.4,
      vLineWidth: () => 0.4,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 8, 0, 4],
  };
}

function totalRow(label: string, value: string, emphasis = false): Content[] {
  return [
    { text: label, alignment: "right", bold: emphasis, color: emphasis ? NAVY : MUTED, fontSize: emphasis ? 10 : 8 },
    { text: value, alignment: "right", bold: emphasis, fontSize: emphasis ? 10 : 8 },
  ];
}

function totals(snapshot: PiSnapshot): Content {
  const currency = snapshot.currency;
  const adjustments = snapshot.adjustments;
  const rows: Content[][] = [totalRow("Subtotal", formatMoney(adjustments.subtotal, currency))];
  if (nonzero(adjustments.discount_amount)) {
    const suffix =
      adjustments.discount_type === "percent" && adjustments.discount_value
        ? ` (${adjustments.discount_value}%)`
        : "";
    rows.push(totalRow(`Discount${suffix}`, formatMoney(adjustments.discount_amount, currency)));
    rows.push(totalRow("Net items", formatMoney(adjustments.net_items, currency)));
  }
  if (nonzero(adjustments.shipping)) rows.push(totalRow("Shipping", formatMoney(adjustments.shipping, currency)));
  if (nonzero(adjustments.installation)) {
    rows.push(totalRow("Installation", formatMoney(adjustments.installation, currency)));
  }
  if (nonzero(adjustments.bank_charge)) {
    rows.push(totalRow("Bank charge", formatMoney(adjustments.bank_charge, currency)));
  }
  if (adjustments.tax_enabled) {
    rows.push(totalRow("Taxable base", formatMoney(adjustments.taxable_base, currency)));
    const percent = adjustments.tax_percent ? ` (${adjustments.tax_percent}%)` : "";
    rows.push(totalRow(`Tax${percent}`, formatMoney(adjustments.tax_amount, currency)));
  }
  rows.push(totalRow("Grand total", formatMoney(adjustments.grand_total, currency), true));
  return {
    columns: [
      { text: "", width: "*" },
      {
        width: 230,
        table: { widths: ["*", "auto"], body: rows },
        layout: "noBorders",
      },
    ],
  };
}

function terms(snapshot: PiSnapshot): Content {
  const entries = [
    ["Price basis", snapshot.terms.price_basis],
    ["Payment terms", snapshot.terms.payment_terms],
    ["Delivery", snapshot.terms.delivery_terms],
    ["Warranty", snapshot.terms.warranty],
    ["Notes", snapshot.terms.additional_notes],
  ].filter(([, value]) => paragraph(value));
  if (entries.length === 0 && !paragraph(snapshot.bank.notes)) return { text: "" };
  return {
    stack: [
      sectionTitle("Commercial terms"),
      ...entries.map(([label, value]) => ({
        text: [{ text: `${label}: `, bold: true }, { text: value }],
        fontSize: 9,
        margin: [0, 0, 0, 3] as [number, number, number, number],
      })),
    ],
  };
}

function isFixedBankChargeInstruction(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "charges details:" || normalized === "charges details") return true;
  if (normalized.startsWith("our:") && normalized.includes("no extra bank fees")) return true;
  if (/sha\s*:/.test(normalized) && /72/.test(normalized)) return true;
  if (/adding\s+72\s*(usd|eur)/.test(normalized)) return true;
  if (/72\s*(usd|eur)/.test(normalized) && /bank fe/.test(normalized)) return true;
  return false;
}

export function customerBankNotes(notes: string): string {
  return paragraph(notes)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isFixedBankChargeInstruction(line))
    .join("\n");
}

function bank(snapshot: PiSnapshot): Content {
  const details = snapshot.bank;
  const lines = [
    details.bank_name ? `Bank: ${details.bank_name}` : "",
    details.branch ? `Branch: ${details.branch}` : "",
    details.address ? `Address: ${details.address}` : "",
    details.swift ? `SWIFT: ${details.swift}` : "",
    details.account_name ? `Account name: ${details.account_name}` : "",
    details.account_number ? `Account no.: ${details.account_number}` : "",
    details.iban ? `IBAN: ${details.iban}` : "",
    details.correspondent_bank || "",
    customerBankNotes(details.notes),
  ].filter((line) => paragraph(line));
  return {
    stack: [
      sectionTitle("Bank details"),
      { text: lines.join("\n"), fontSize: 9 },
    ],
    margin: [0, 4, 0, 0],
  };
}

function declaration(snapshot: PiSnapshot, layout: IssuedLayoutVersion): Content {
  const base =
    layout.startsWith("uae-")
      ? "I declare that the above information is true and correct to the best of my knowledge."
      : "I declare that the information mentioned above is true and correct to the best of my knowledge.";
  const lines = [base];
  if (!snapshot.adjustments.tax_enabled) {
    lines.push("The price does not include VAT.");
  }
  return {
    stack: [
      { text: lines.join("\n"), fontSize: 8, color: MUTED, margin: [0, 12, 0, 10] },
      {
        columns: [
          { text: "Signature: ______________________________", fontSize: 9, width: "*" },
          { text: `Date: ${formatDate(snapshot.pi_date)}`, fontSize: 9, width: 140, alignment: "right" },
        ],
      },
    ],
  };
}

export const ISSUED_LAYOUT_VERSIONS = ["egypt-v1", "uae-v1", "egypt-v2", "uae-v2"] as const;

export type IssuedLayoutVersion = (typeof ISSUED_LAYOUT_VERSIONS)[number];

function isIssuedLayoutVersion(value: string): value is IssuedLayoutVersion {
  return (ISSUED_LAYOUT_VERSIONS as readonly string[]).includes(value);
}

function missingSnapshotData(snapshot: PiSnapshot): string[] {
  const missing: string[] = [];
  if (!snapshot.display_number) missing.push("PI number");
  if (!snapshot.currency) missing.push("currency");
  if (!snapshot.pi_date) missing.push("PI date");
  if (!snapshot.company) missing.push("company details");
  if (!snapshot.bank) missing.push("bank details");
  if (!snapshot.client) missing.push("client details");
  if (!snapshot.sales) missing.push("salesperson and preparer");
  if (!Array.isArray(snapshot.lines)) missing.push("line items");
  if (!snapshot.adjustments || snapshot.adjustments.grand_total == null || snapshot.adjustments.grand_total === "") {
    missing.push("saved totals");
  }
  if (!snapshot.terms) missing.push("terms");
  if (snapshot.layout_version === "egypt-v2" || snapshot.layout_version === "uae-v2") {
    const payment = snapshot.payment;
    if (!payment || payment.schema_version !== 1 || typeof payment.customer_text !== "string" || !Array.isArray(payment.rows)) {
      missing.push("payment schedule");
    }
  }
  return missing;
}

function assertRenderableSnapshot(snapshot: PiSnapshot): IssuedLayoutVersion {
  const layout = snapshot?.layout_version ?? "";
  if (!isIssuedLayoutVersion(layout)) {
    throw new Error(
      `This document uses layout version "${layout || "missing"}", which this application cannot render. No other layout was used.`,
    );
  }
  const missing = missingSnapshotData(snapshot);
  if (missing.length > 0) {
    throw new Error(
      `This issued document is missing saved ${missing.join(", ")}. The PDF was not created, and current catalogue or company records were not used.`,
    );
  }
  return layout;
}

// egypt-v1 and uae-v1 share this builder. A future layout must add a new
// versioned function and map entry. Do not change this builder for a new design.
function buildIssuedDocumentV1(snapshot: PiSnapshot, layout: IssuedLayoutVersion): TDocumentDefinitions {
  return {
    pageSize: "A4",
    pageMargins: [32, 28, 32, 42],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#1c2833" },
    info: {
      title: `Proforma invoice ${snapshot.display_number}`,
      author: snapshot.company.name,
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: snapshot.company.name, color: MUTED, fontSize: 8, margin: [32, 8, 0, 0] },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          color: MUTED,
          fontSize: 8,
          margin: [0, 8, 32, 0],
        },
      ],
    }),
    content: [
      header(snapshot),
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 531, y2: 0, lineWidth: 1, lineColor: RULE }] },
      parties(snapshot, layout),
      attribution(snapshot),
      itemsTable(snapshot),
      totals(snapshot),
      terms(snapshot),
      bank(snapshot),
      declaration(snapshot, layout),
    ],
    styles: {
      company: { fontSize: 11, bold: true, color: NAVY },
      title: { fontSize: 14, bold: true, color: NAVY, alignment: "right" },
      number: { fontSize: 11, bold: true, alignment: "right", color: NAVY },
      section: { fontSize: 10, bold: true, color: NAVY },
      th: { bold: true, fontSize: 8, color: NAVY },
    },
  };
}

function sentenceCase(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function paymentAmountLabel(row: NonNullable<PiSnapshot["payment"]>["rows"][number], currency: string): string {
  const amount = formatMoney(row.amount, currency);
  if (row.amount_basis.type === "percent" && row.amount_basis.percent) return `${amount} (${row.amount_basis.percent}%)`;
  if (row.amount_basis.type === "fixed") return amount;
  if (row.amount_basis.type === "remainder") return `${amount} remaining`;
  return amount;
}

function structuredPayment(snapshot: PiSnapshot): Content {
  const payment = snapshot.payment;
  if (!payment) return { text: "" };
  if (payment.no_payment_due || payment.presentation !== "table") {
    return {
      text: [{ text: "Payment terms: ", bold: true }, { text: payment.customer_text }],
      fontSize: 9,
      margin: [0, 0, 0, 3],
    };
  }
  const body: Content[][] = [[
    { text: "Payment", style: "th" },
    { text: "Amount", style: "th", alignment: "right" },
    { text: "Due", style: "th" },
  ]];
  for (const row of payment.rows) {
    const label = row.label || `Payment ${row.position}`;
    if (row.instalments && row.instalments.length > 0) {
      for (const instalment of row.instalments) {
        body.push([
          { text: `${label} (${instalment.sequence} of ${instalment.count})`, fontSize: 8 },
          { text: formatMoney(instalment.amount, snapshot.currency), alignment: "right", fontSize: 8 },
          { text: sentenceCase(instalment.due_formula), fontSize: 8 },
        ]);
      }
    } else {
      body.push([
        { text: label, fontSize: 8 },
        { text: paymentAmountLabel(row, snapshot.currency), alignment: "right", fontSize: 8 },
        { text: sentenceCase(row.due_formula), fontSize: 8 },
      ]);
    }
  }
  return {
    stack: [
      sectionTitle("Payment schedule"),
      {
        table: { headerRows: 1, widths: [168, 110, "*"], body, dontBreakRows: true },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? "#e8eef4" : null),
          hLineColor: () => LINE,
          vLineColor: () => LINE,
          hLineWidth: () => 0.4,
          vLineWidth: () => 0.4,
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
    ],
  };
}

function termsV2(snapshot: PiSnapshot): Content {
  const entries: Content[] = [];
  if (paragraph(snapshot.terms.price_basis)) {
    entries.push({ text: [{ text: "Price basis: ", bold: true }, { text: snapshot.terms.price_basis }], fontSize: 9, margin: [0, 0, 0, 3] });
  }
  entries.push(structuredPayment(snapshot));
  for (const [label, value] of [
    ["Delivery", snapshot.terms.delivery_terms],
    ["Warranty", snapshot.terms.warranty],
    ["Notes", snapshot.terms.additional_notes],
  ] as const) {
    if (!paragraph(value)) continue;
    entries.push({ text: [{ text: `${label}: `, bold: true }, { text: value }], fontSize: 9, margin: [0, 0, 0, 3] });
  }
  if (entries.length === 0 && !paragraph(snapshot.bank.notes)) return { text: "" };
  return { stack: [sectionTitle("Commercial terms"), ...entries] };
}

function buildIssuedDocumentV2(snapshot: PiSnapshot, layout: IssuedLayoutVersion): TDocumentDefinitions {
  return {
    pageSize: "A4",
    pageMargins: [32, 28, 32, 42],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#1c2833" },
    info: {
      title: `Proforma invoice ${snapshot.display_number}`,
      author: snapshot.company.name,
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: snapshot.company.name, color: MUTED, fontSize: 8, margin: [32, 8, 0, 0] },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          color: MUTED,
          fontSize: 8,
          margin: [0, 8, 32, 0],
        },
      ],
    }),
    content: [
      header(snapshot),
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 531, y2: 0, lineWidth: 1, lineColor: RULE }] },
      parties(snapshot, layout),
      attribution(snapshot),
      itemsTable(snapshot),
      totals(snapshot),
      termsV2(snapshot),
      bank(snapshot),
      declaration(snapshot, layout),
    ],
    styles: {
      company: { fontSize: 11, bold: true, color: NAVY },
      title: { fontSize: 14, bold: true, color: NAVY, alignment: "right" },
      number: { fontSize: 11, bold: true, alignment: "right", color: NAVY },
      section: { fontSize: 10, bold: true, color: NAVY },
      th: { bold: true, fontSize: 8, color: NAVY },
    },
  };
}

const issuedLayouts: Record<IssuedLayoutVersion, (snapshot: PiSnapshot) => TDocumentDefinitions> = {
  "egypt-v1": (snapshot) => buildIssuedDocumentV1(snapshot, "egypt-v1"),
  "uae-v1": (snapshot) => buildIssuedDocumentV1(snapshot, "uae-v1"),
  "egypt-v2": (snapshot) => buildIssuedDocumentV2(snapshot, "egypt-v2"),
  "uae-v2": (snapshot) => buildIssuedDocumentV2(snapshot, "uae-v2"),
};

export function buildPiDefinition(snapshot: PiSnapshot): TDocumentDefinitions {
  const layout = assertRenderableSnapshot(snapshot);
  return issuedLayouts[layout](snapshot);
}

export async function renderPiPdf(snapshot: PiSnapshot): Promise<Uint8Array> {
  ensureFonts();
  const document = pdfMake.createPdf(buildPiDefinition(snapshot));
  return document.getBuffer();
}

export function pdfFilename(snapshot: PiSnapshot): string {
  return `${snapshot.display_number}.pdf`;
}
