import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFParse } from "pdf-parse";

const rpc = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  supabase: {
    rpc,
    storage: {
      from: storageFrom,
    },
  },
}));

import { downloadIssuedPdf, generateAndDownload, IssuedDownloadError, previewDraftPdf } from "./documents";
import * as pdf from "./pdf";
import type { DraftPayload, GenerateResult, PiSnapshot } from "./types";

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
      name: "Saved Company",
      address: "Saved address",
      phone: "",
      fax: "",
      email: "",
      website: "",
      tax_registration: "",
      logo_base64: null,
      logo_content_type: null,
    },
    bank: {
      bank_name: "Saved Bank",
      branch: "",
      address: "",
      swift: "SAVEDSWIFT",
      account_name: "Saved Account",
      account_number: "100",
      iban: "EG590010007200000100022610548",
      correspondent_bank: "",
      notes: "",
    },
    client: {
      company_name: "Saved Client",
      country: "Egypt",
      tax_number: "",
      contact_name: "",
      contact_job_title: "",
      contact_phone: "",
      contact_email: "",
    },
    bill_to: "Saved billing address",
    ship_to: "Saved shipping address",
    sales: {
      lead_name: "Saved Seller",
      lead_phone: "",
      additional: [],
      prepared_by: "Saved Preparer",
    },
    lines: [
      {
        model_code: "SAVED-MODEL",
        description: "Saved description",
        unit: "unit",
        quantity: "1",
        unit_price: "10.00",
        line_total: "10.00",
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
      subtotal: "10.00",
      net_items: "10.00",
      taxable_base: null,
      tax_amount: "0.00",
      grand_total: "10.00",
    },
    terms: {
      price_basis: "Site Delivery",
      payment_terms: "100% in advance",
      delivery_terms: "",
      warranty: "",
      additional_notes: "",
    },
  };
  return {
    ...base,
    ...overrides,
    company: { ...base.company, ...overrides.company },
    bank: { ...base.bank, ...overrides.bank },
    client: { ...base.client, ...overrides.client },
    sales: { ...base.sales, ...overrides.sales },
    adjustments: { ...base.adjustments, ...overrides.adjustments },
    terms: { ...base.terms, ...overrides.terms },
    lines: overrides.lines ?? base.lines,
  };
}

const editorPayload = {
  customer_reference: "UNSAVED-EDITOR-REFERENCE",
  lines: [{ model_code: "UNSAVED-MODEL", description: "Unsaved editor line", unit: "unit", quantity: "9", unit_price: "1" }],
} as DraftPayload;

function issuedResult(issued: PiSnapshot): GenerateResult {
  return {
    id: "pi-1",
    draft_version: 4,
    version_id: "version-1",
    revision: issued.revision,
    pi_number: issued.pi_number,
    display_number: issued.display_number,
    snapshot: issued,
  };
}

const createdBlobs: Blob[] = [];
const downloads: { filename: string; blob: Blob }[] = [];

beforeEach(() => {
  createdBlobs.length = 0;
  downloads.length = 0;
  rpc.mockReset();
  storageFrom.mockReset();
  storageFrom.mockImplementation(() => {
    throw new Error("Storage must not be used for PI PDFs.");
  });
});

async function withBrowserDownload<T>(action: () => Promise<T>): Promise<T> {
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = ((blob: Blob) => {
    createdBlobs.push(blob);
    return "blob:pi";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  vi.stubGlobal("document", {
    createElement: () => {
      const anchor = {
        href: "",
        download: "",
        click() {
          const blob = createdBlobs.at(-1);
          if (!blob) throw new Error("Download started without a PDF.");
          downloads.push({ filename: anchor.download, blob });
        },
      };
      return anchor;
    },
  });
  vi.stubGlobal("window", { open: vi.fn() });
  try {
    return await action();
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.unstubAllGlobals();
  }
}

async function fileText(file: { blob: Blob }): Promise<string> {
  return textOf(new Uint8Array(await file.blob.arrayBuffer()));
}

async function textOf(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

describe("on-demand PI PDFs", () => {
  it("issues one snapshot and downloads that PDF without storage", async () => {
    const issued = snapshot();
    rpc.mockResolvedValueOnce({ data: issuedResult(issued), error: null });

    const result = await withBrowserDownload(() => generateAndDownload("pi-1", 3, editorPayload));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("generate_pi", {
      p_id: "pi-1",
      p_expected_version: 3,
      p_payload: editorPayload,
    });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(result.version_id).toBe("version-1");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.filename).toBe("EG-2026-00001.pdf");
    const text = await fileText(downloads[0]!);
    expect(text).toContain("Saved Client");
    expect(text).toContain("SAVED-MODEL");
    expect(text).toContain("Saved description");
    expect(text).not.toContain("UNSAVED-EDITOR-REFERENCE");
    expect(text).not.toContain("UNSAVED-MODEL");
    expect(text).not.toContain("Unsaved editor line");
  });

  it("downloads an existing snapshot again without issuing another version", async () => {
    const issued = snapshot({ display_number: "AE-2026-00008-R2", pi_number: "AE-2026-00008", revision: 2, revision_label: "R2" });
    await withBrowserDownload(async () => {
      await downloadIssuedPdf(issued);
      await downloadIssuedPdf(issued);
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    expect(downloads.map((file) => file.filename)).toEqual(["AE-2026-00008-R2.pdf", "AE-2026-00008-R2.pdf"]);
    const text = await fileText(downloads[1]!);
    expect(text).toContain("AE-2026-00008-R2");
    expect(text).toContain("Saved Client");
  });

  it("renders pending, ready, and issued versions from their own snapshots", async () => {
    const versions = (["pending", "ready", "issued"] as const).map((status, index) => ({
      pdf_status: status,
      pdf_path: status === "ready" ? "stored.pdf" : null,
      snapshot: snapshot({
        display_number: `EG-2026-0002${index}`,
        pi_number: `EG-2026-0002${index}`,
        client: {
          company_name: `Client for ${status}`,
          country: "Egypt",
          tax_number: "",
          contact_name: "",
          contact_job_title: "",
          contact_phone: "",
          contact_email: "",
        },
      }),
    }));

    await withBrowserDownload(async () => {
      for (const version of versions) {
        await downloadIssuedPdf(version.snapshot);
      }
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(3);
    const texts = await Promise.all(downloads.map((file) => fileText(file)));
    expect(texts[0]).toContain("Client for pending");
    expect(texts[1]).toContain("Client for ready");
    expect(texts[2]).toContain("Client for issued");
    expect(texts[0]).not.toContain("Client for ready");
    expect(texts[1]).not.toContain("Client for pending");
  });

  it("keeps the issued number when browser rendering fails and does not call storage", async () => {
    const issued = snapshot({ display_number: "EG-2026-00042" });
    rpc.mockResolvedValueOnce({ data: issuedResult(issued), error: null });
    const render = vi.spyOn(pdf, "renderPiPdf").mockRejectedValueOnce(new Error("The font file could not be read."));

    let caught: unknown;
    try {
      await generateAndDownload("pi-1", 3, editorPayload);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IssuedDownloadError);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toMatch(/EG-2026-00042 was issued and keeps its number and version/);
    expect(message).toMatch(/Download in version history/);
    expect(message).toMatch(/does not issue another number or revision/);
    expect(message).toMatch(/font file could not be read/);
    expect(message).not.toMatch(/upload|not stored/i);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(storageFrom).not.toHaveBeenCalled();
    render.mockRestore();
  });

  it("previews a draft through the versioned renderer without storage", async () => {
    const opened: unknown[][] = [];
    await withBrowserDownload(async () => {
      vi.useFakeTimers();
      try {
        await previewDraftPdf(snapshot({ display_number: "DRAFT" }));
        await vi.runAllTimersAsync();
        opened.push(...(window.open as ReturnType<typeof vi.fn>).mock.calls);
      } finally {
        vi.useRealTimers();
      }
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(0);
    expect(opened).toEqual([["blob:pi", "_blank", "noopener"]]);
    const text = await textOf(new Uint8Array(await createdBlobs[0]!.arrayBuffer()));
    expect(text).toContain("Saved Client");
    expect(text).toContain("DRAFT");
  });
});
