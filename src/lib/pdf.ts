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

function parties(snapshot: PiSnapshot): Content {
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
      partyBlock(snapshot.layout_version === "uae-v1" ? "To" : "Client", clientLines),
      partyBlock("Bill to", [snapshot.bill_to]),
      partyBlock("Ship to", [snapshot.ship_to]),
    ],
    columnGap: 12,
    margin: [0, 4, 0, 2],
  };
}

function attribution(snapshot: PiSnapshot): Content {
  return {
    columns: [
      metaRow("Lead salesperson", [snapshot.sales.lead_name, snapshot.sales.lead_phone].filter(Boolean).join(" · ")),
      metaRow("Prepared by", snapshot.sales.prepared_by),
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

function declaration(snapshot: PiSnapshot): Content {
  const base =
    snapshot.layout_version === "uae-v1"
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

export function buildPiDefinition(snapshot: PiSnapshot): TDocumentDefinitions {
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
      parties(snapshot),
      attribution(snapshot),
      itemsTable(snapshot),
      totals(snapshot),
      terms(snapshot),
      bank(snapshot),
      declaration(snapshot),
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

export async function renderPiPdf(snapshot: PiSnapshot): Promise<Uint8Array> {
  ensureFonts();
  const document = pdfMake.createPdf(buildPiDefinition(snapshot));
  return document.getBuffer();
}

export function pdfFilename(snapshot: PiSnapshot): string {
  return `${snapshot.display_number}.pdf`;
}
