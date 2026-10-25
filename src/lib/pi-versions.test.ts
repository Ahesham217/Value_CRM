import { describe, expect, it, vi } from "vitest";
import type { PiSnapshot, PiVersion } from "./types";

vi.mock("./supabase", () => ({
  supabase: { from: vi.fn() },
}));
import {
  EDITOR_PRESET_COLUMNS,
  PI_VERSION_SUMMARY_COLUMNS,
  attachSnapshot,
  ensureVersionSnapshot,
  versionAgreedTotal,
  versionDisplayNumber,
} from "./pi-versions";

function version(overrides: Partial<PiVersion> = {}): PiVersion {
  return {
    id: "version-1",
    pi_id: "pi-1",
    revision: 1,
    pi_number: "EG-2026-00001",
    generated_by: "user-1",
    generated_at: "2026-10-25T00:00:00Z",
    snapshot: null,
    pdf_status: "issued",
    pdf_path: null,
    layout_version: "egypt-v2",
    grand_total: "80.00",
    ...overrides,
  };
}

function snapshot(display = "EG-2026-00001-R1"): PiSnapshot {
  return {
    layout_version: "egypt-v2",
    preset_code: "EG-EGP",
    office: "EG",
    currency: "EGP",
    pi_number: "EG-2026-00001",
    revision: 1,
    revision_label: "R1",
    display_number: display,
    pi_date: "2026-10-25",
    expiry_date: "2026-11-25",
    customer_reference: "",
    company: {
      name: "Value",
      address: "",
      phone: "",
      fax: "",
      email: "",
      website: "",
      tax_registration: "",
      logo_base64: "LOGO",
      logo_content_type: "image/png",
    },
    bank: {
      bank_name: "",
      branch: "",
      address: "",
      swift: "",
      account_name: "",
      account_number: "",
      iban: "",
      correspondent_bank: "",
      notes: "",
    },
    client: { company_name: "", country: "", tax_number: "", contact_name: "", contact_job_title: "", contact_phone: "", contact_email: "" },
    bill_to: "",
    ship_to: "",
    sales: { lead_name: "", lead_phone: "", additional: [], prepared_by: "Ada" },
    lines: [],
    adjustments: {
      discount_type: "none",
      discount_value: null,
      discount_amount: "0",
      shipping: null,
      installation: null,
      bank_charge: null,
      tax_enabled: false,
      tax_percent: null,
      tax_amount: "0",
      tax_excludes_shipping: false,
      tax_excludes_installation: false,
      tax_excludes_bank_charge: false,
      subtotal: "80.00",
      net_items: "80.00",
      taxable_base: null,
      grand_total: "80.00",
    },
    terms: { price_basis: "", payment_terms: "", delivery_terms: "", warranty: "", additional_notes: "" },
  };
}

describe("on-demand PI snapshots", () => {
  it("does not ask for snapshot or logo columns on the first read", () => {
    expect(PI_VERSION_SUMMARY_COLUMNS.split(",").map((column) => column.trim())).not.toContain("snapshot");
    expect(EDITOR_PRESET_COLUMNS.split(",").map((column) => column.trim())).not.toContain("logo_base64");
    expect(EDITOR_PRESET_COLUMNS).toContain("bank_name");
    expect(EDITOR_PRESET_COLUMNS).toContain("company_name");
  });

  it("attaches one snapshot without copying it onto another version", () => {
    const older = version({ id: "older", revision: 0, pi_number: "EG-2026-00001" });
    const latest = version({ id: "latest", revision: 1 });
    const saved = snapshot();
    const attached = attachSnapshot([older, latest], { id: "latest", snapshot: saved });
    expect(attached[0]?.snapshot).toBeNull();
    expect(attached[1]?.snapshot).toBe(saved);
    expect(versionDisplayNumber(attached[0]!)).toBe("EG-2026-00001");
    expect(versionDisplayNumber(attached[1]!)).toBe("EG-2026-00001-R1");
    expect(versionAgreedTotal(attached[0]!)).toBe("80.00");
    expect(versionAgreedTotal(attached[1]!)).toBe("80.00");
  });

  it("loads a snapshot only when the version does not already have one", async () => {
    const saved = snapshot();
    const load = vi.fn(async () => saved);
    const present = version({ snapshot: saved });
    await expect(ensureVersionSnapshot(present, load)).resolves.toBe(saved);
    expect(load).not.toHaveBeenCalled();
    const missing = version({ id: "missing", snapshot: null });
    await expect(ensureVersionSnapshot(missing, load)).resolves.toBe(saved);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("missing");
  });
});
