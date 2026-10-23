import { useEffect, useId, useState } from "react";
import { Button, Disclosure, Field, Select, TextArea, controlClass } from "./ui";
import { errorText } from "../lib/errors";
import {
  canonicalOfficeCode,
  canonicalSequencePrefix,
  isCurrencyCode,
  layoutLabel,
  presetOptionLabel,
  presetStatusText,
  CURRENCIES,
} from "../lib/presets";
import { supabase } from "../lib/supabase";
import type { CompanyPreset, CurrencyCode, NumberingSequence } from "../lib/types";
import { recordOptionalSummary } from "../lib/workspace-view";

type Draft = {
  display_name: string;
  office: string;
  currency: "" | CurrencyCode;
  layout: "" | "egypt" | "uae";
  sequenceMode: "existing" | "new";
  sequenceCode: string;
  newPrefix: string;
  company_name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
  tax_registration: string;
  logo_base64: string | null;
  logo_content_type: string | null;
  bank_name: string;
  bank_branch: string;
  bank_address: string;
  bank_swift: string;
  account_name: string;
  account_number: string;
  iban: string;
  correspondent_bank: string;
  bank_notes: string;
  archived: boolean;
};

const emptyDraft = (): Draft => ({
  display_name: "",
  office: "",
  currency: "",
  layout: "",
  sequenceMode: "existing",
  sequenceCode: "",
  newPrefix: "",
  company_name: "",
  address: "",
  phone: "",
  fax: "",
  email: "",
  website: "",
  tax_registration: "",
  logo_base64: null,
  logo_content_type: null,
  bank_name: "",
  bank_branch: "",
  bank_address: "",
  bank_swift: "",
  account_name: "",
  account_number: "",
  iban: "",
  correspondent_bank: "",
  bank_notes: "",
  archived: false,
});

function draftFromPreset(preset: CompanyPreset): Draft {
  return {
    display_name: preset.display_name,
    office: preset.office,
    currency: preset.currency,
    layout: preset.layout,
    sequenceMode: "existing",
    sequenceCode: preset.sequence_code,
    newPrefix: "",
    company_name: preset.company_name,
    address: preset.address,
    phone: preset.phone,
    fax: preset.fax,
    email: preset.email,
    website: preset.website,
    tax_registration: preset.tax_registration,
    logo_base64: preset.logo_base64,
    logo_content_type: preset.logo_content_type,
    bank_name: preset.bank_name,
    bank_branch: preset.bank_branch,
    bank_address: preset.bank_address,
    bank_swift: preset.bank_swift,
    account_name: preset.account_name,
    account_number: preset.account_number,
    iban: preset.iban,
    correspondent_bank: preset.correspondent_bank,
    bank_notes: preset.bank_notes,
    archived: preset.archived_at != null,
  };
}

function validate(draft: Draft, sequences: NumberingSequence[], locked: boolean): string | null {
  const name = draft.display_name.trim();
  if (!name || name.length > 120) return "Enter a display name of up to 120 characters. The display name is not the preset identifier.";
  if (draft.layout !== "egypt" && draft.layout !== "uae") return "Choose the Egypt or UAE PDF layout.";
  if (locked) return null;
  if (!canonicalOfficeCode(draft.office)) {
    return "An office identifier must be 1 to 12 letters or digits, starting with a letter. It is not the display name.";
  }
  if (!isCurrencyCode(draft.currency)) return "Choose EGP, USD, or EUR. There is no currency conversion.";
  if (draft.sequenceMode === "new") {
    const prefix = canonicalSequencePrefix(draft.newPrefix);
    if (!prefix) return "A numbering prefix must be 1 to 8 letters or digits, starting with a letter, with no spaces or punctuation.";
    if (sequences.some((sequence) => sequence.prefix === prefix)) {
      return `The prefix ${prefix} is already used by another numbering sequence. Choose a different prefix so PI numbers stay unique.`;
    }
  } else if (!draft.sequenceCode) {
    return "Choose a numbering sequence, or create one with a new prefix.";
  }
  return null;
}

export function CompanyPresetSettings({
  onError,
  onMessage,
}: {
  onError: (message: string | null) => void;
  onMessage: (message: string | null) => void;
}) {
  const officeListId = useId();
  const [presets, setPresets] = useState<CompanyPreset[]>([]);
  const [sequences, setSequences] = useState<NumberingSequence[]>([]);
  const [usedPresets, setUsedPresets] = useState<Set<string>>(new Set());
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load(preferCode?: string) {
    const [presetResult, sequenceResult, usedResult] = await Promise.all([
      supabase.from("company_presets").select("*").order("display_name"),
      supabase.from("numbering_sequences").select("code, prefix, created_at").order("prefix"),
      supabase.from("preset_issue_keys").select("preset_code, sequence_code"),
    ]);
    if (presetResult.error) throw presetResult.error;
    if (sequenceResult.error) throw sequenceResult.error;
    if (usedResult.error) throw usedResult.error;
    const nextPresets = presetResult.data as CompanyPreset[];
    setPresets(nextPresets);
    setSequences(sequenceResult.data as NumberingSequence[]);
    setUsedPresets(new Set((usedResult.data ?? []).map((row) => String(row.preset_code))));
    const code = preferCode ?? selectedCode;
    if (code && nextPresets.some((preset) => preset.code === code)) setSelectedCode(code);
    else if (!creating) setSelectedCode(nextPresets[0]?.code ?? null);
  }

  useEffect(() => {
    load().then(() => setLoading(false)).catch((caught) => {
      onError(errorText(caught));
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-sm text-slate-600">Loading company presets…</p>;

  const selected = presets.find((preset) => preset.code === selectedCode) ?? null;
  const draft = creating ? newDraft : selected ? (edits[selected.code] ?? draftFromPreset(selected)) : null;
  const locked = Boolean(selected && usedPresets.has(selected.code) && !creating);
  const offices = [...new Set(presets.map((preset) => preset.office))].sort();

  function update(patch: Partial<Draft>) {
    if (creating) {
      setNewDraft((current) => ({ ...current, ...patch }));
      return;
    }
    if (!selected) return;
    setEdits((current) => ({
      ...current,
      [selected.code]: { ...(current[selected.code] ?? draftFromPreset(selected)), ...patch },
    }));
  }

  function choosePreset(code: string) {
    setCreating(false);
    setSelectedCode(code);
    setCompanyOpen(false);
    setBankOpen(false);
  }

  function startNew() {
    setCreating(true);
    setNewDraft(emptyDraft());
    setCompanyOpen(false);
    setBankOpen(false);
    onError(null);
    onMessage(null);
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 400_000) {
      onError("Logo must be smaller than 400 KB.");
      return;
    }
    const dataUrl = await file.arrayBuffer().then((buffer) => {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    update({ logo_base64: dataUrl, logo_content_type: file.type || "image/png" });
  }

  async function save() {
    if (!draft) return;
    const problem = validate(draft, sequences, locked);
    if (problem) {
      onMessage(null);
      onError(problem);
      return;
    }
    setSaving(true);
    onError(null);
    try {
      if (creating) {
        const { data, error } = await supabase.rpc("create_company_preset", {
          p_preset: {
            display_name: draft.display_name.trim(),
            office: canonicalOfficeCode(draft.office),
            currency: draft.currency,
            layout: draft.layout,
            sequence_code: draft.sequenceMode === "existing" ? draft.sequenceCode : null,
            new_prefix: draft.sequenceMode === "new" ? canonicalSequencePrefix(draft.newPrefix) : null,
            company_name: draft.company_name,
            address: draft.address,
            phone: draft.phone,
            fax: draft.fax,
            email: draft.email,
            website: draft.website,
            tax_registration: draft.tax_registration,
            logo_base64: draft.logo_base64,
            logo_content_type: draft.logo_content_type,
            bank_name: draft.bank_name,
            bank_branch: draft.bank_branch,
            bank_address: draft.bank_address,
            bank_swift: draft.bank_swift,
            account_name: draft.account_name,
            account_number: draft.account_number,
            iban: draft.iban,
            correspondent_bank: draft.correspondent_bank,
            bank_notes: draft.bank_notes,
            archived: draft.archived,
          },
        });
        if (error) throw error;
        const created = data as CompanyPreset;
        setCreating(false);
        setSelectedCode(created.code);
        await load(created.code);
        onMessage(`${created.display_name} added. Issued invoices keep the details they were generated with.`);
        return;
      }
      if (!selected) return;
      let sequenceCode = draft.sequenceCode;
      let createdSequence = false;
      if (!locked && draft.sequenceMode === "new") {
        const prefix = canonicalSequencePrefix(draft.newPrefix);
        const inserted = await supabase.from("numbering_sequences").insert({ prefix }).select("code").single();
        if (inserted.error) throw inserted.error;
        sequenceCode = inserted.data.code;
        createdSequence = true;
      }
      const patch: Record<string, unknown> = {
        display_name: draft.display_name.trim(),
        layout: draft.layout,
        company_name: draft.company_name,
        address: draft.address,
        phone: draft.phone,
        fax: draft.fax,
        email: draft.email,
        website: draft.website,
        tax_registration: draft.tax_registration,
        logo_base64: draft.logo_base64,
        logo_content_type: draft.logo_content_type,
        bank_name: draft.bank_name,
        bank_branch: draft.bank_branch,
        bank_address: draft.bank_address,
        bank_swift: draft.bank_swift,
        account_name: draft.account_name,
        account_number: draft.account_number,
        iban: draft.iban,
        correspondent_bank: draft.correspondent_bank,
        bank_notes: draft.bank_notes,
        archived_at: draft.archived ? (selected.archived_at ?? new Date().toISOString()) : null,
      };
      if (!locked) {
        patch.office = canonicalOfficeCode(draft.office);
        patch.currency = draft.currency;
        patch.sequence_code = sequenceCode;
      }
      const { error } = await supabase.from("company_presets").update(patch).eq("code", selected.code);
      if (error) {
        if (createdSequence) {
          throw new Error(`${errorText(error)} The new numbering sequence was created and can be selected.`);
        }
        throw error;
      }
      setEdits((current) => {
        const next = { ...current };
        delete next[selected.code];
        return next;
      });
      await load(selected.code);
      onMessage(`${draft.display_name.trim()} saved. Issued invoices keep the details they were generated with.`);
    } catch (caught) {
      onError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  if (!draft) return <p className="text-sm text-slate-600">No company presets are available.</p>;

  const prefix = locked
    ? sequences.find((sequence) => sequence.code === selected?.sequence_code)?.prefix ?? selected?.sequence_code ?? ""
    : draft.sequenceMode === "new"
      ? canonicalSequencePrefix(draft.newPrefix)
      : sequences.find((sequence) => sequence.code === draft.sequenceCode)?.prefix ?? null;
  const sequenceUsers = presets
    .filter((preset) => preset.code !== selected?.code && preset.sequence_code === selected?.sequence_code)
    .map((preset) => preset.display_name);
  const status = presetStatusText(draft, draft.archived);
  const companySummary = recordOptionalSummary([
    { label: "Fax", value: draft.fax },
    { label: "Website", value: draft.website },
    { label: "Tax registration", value: draft.tax_registration },
    { label: "Logo", value: draft.logo_base64 ? "Uploaded" : "" },
  ]);
  const bankSummary = recordOptionalSummary([
    { label: "Branch", value: draft.bank_branch },
    { label: "Bank address", value: draft.bank_address },
    { label: "Correspondent", value: draft.correspondent_bank },
    { label: "Notes", value: draft.bank_notes },
  ]);

  return (
    <section className="rounded-[10px] border border-line bg-white p-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Company presets">
        {presets.map((preset) => {
          const active = !creating && preset.code === selected?.code;
          return (
            <button
              key={preset.code}
              type="button"
              role="tab"
              aria-selected={active}
              className={`h-9 rounded-md px-3 text-sm ${active ? "bg-navy-900 font-semibold text-white" : "border border-slate-300 bg-white text-slate-800"}`}
              onClick={() => choosePreset(preset.code)}
            >
              {presetOptionLabel(preset)}
            </button>
          );
        })}
        <Button type="button" variant={creating ? "primary" : "secondary"} onClick={startNew}>Add preset</Button>
      </div>
      <dl className="mt-3 grid gap-2 border-b border-slate-200 pb-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Preset</dt>
          <dd className="font-medium">{draft.display_name.trim() || "New preset"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Currency</dt>
          <dd className="font-medium">{draft.currency || "Not chosen"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Legal entity</dt>
          <dd className="font-medium">{draft.company_name.trim() || "Not set"}</dd>
        </div>
      </dl>
      {selected && !creating ? <p className="mt-2 text-xs text-slate-500">Identifier {selected.code}. This does not change, and it is not the display name.</p> : null}
      <p className={`mt-2 text-sm ${status === "Ready to issue" ? "text-emerald-800" : "text-red-800"}`}>{status}</p>
      {locked ? (
        <p className="mt-2 text-sm text-slate-700">
          This preset has already been used to issue a PI. Its office, currency, and numbering sequence stay as they were. Create a new preset to change them. Company, bank, logo, layout, and the display name can still be updated. Issued documents keep the details they were generated with.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Display name" hint="Shown in Settings and the PI office list. For example, New Office — USD.">
          <input className={controlClass} value={draft.display_name} onChange={(event) => update({ display_name: event.target.value })} />
        </Field>
        <Field label="Status" hint="Archive a preset after it has been used. Archived presets stay on existing PIs and cannot be chosen for a new issue.">
          <Select value={draft.archived ? "archived" : "active"} onChange={(event) => update({ archived: event.target.value === "archived" })}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Select>
        </Field>
        <Field label="Office identifier" hint="A stable code such as EG, AE, or QA. Presets that share it are the same office. It is not the display name.">
          <input
            className={controlClass}
            list={officeListId}
            value={draft.office}
            disabled={locked}
            onChange={(event) => update({ office: event.target.value.toUpperCase() })}
          />
          <datalist id={officeListId}>
            {offices.map((office) => <option key={office} value={office} />)}
          </datalist>
        </Field>
        <Field label="Currency">
          <Select value={draft.currency} disabled={locked} onChange={(event) => update({ currency: event.target.value as Draft["currency"] })}>
            <option value="">Select a currency</option>
            {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </Select>
        </Field>
        <Field label="PDF layout" hint="Future drafts use this layout family. An issued PDF keeps the layout stored on its snapshot, and prints this preset's own company and bank details.">
          <Select value={draft.layout} onChange={(event) => update({ layout: event.target.value as Draft["layout"] })}>
            <option value="">Select a layout</option>
            <option value="egypt">Egypt layout</option>
            <option value="uae">UAE layout</option>
          </Select>
        </Field>
        <Field label="Numbering" hint={prefix ? `Numbers look like ${prefix}-2026-00001. The year comes from the PI date and the sequence resets each year.` : "Use an existing sequence, or create a new prefix."}>
          {locked ? (
            <p className="text-sm text-ink">Prefix {prefix}{sequenceUsers.length > 0 ? ` · shared with ${sequenceUsers.join(", ")}` : ""}</p>
          ) : (
            <div className="space-y-2">
              <Select value={draft.sequenceMode} onChange={(event) => update({ sequenceMode: event.target.value as Draft["sequenceMode"] })}>
                <option value="existing">Use an existing numbering sequence</option>
                <option value="new">Create a new sequence with a new prefix</option>
              </Select>
              {draft.sequenceMode === "existing" ? (
                <Select value={draft.sequenceCode} onChange={(event) => update({ sequenceCode: event.target.value })}>
                  <option value="">Select a sequence</option>
                  {sequences.map((sequence) => {
                    const names = presets.filter((preset) => preset.sequence_code === sequence.code).map((preset) => preset.display_name);
                    return <option key={sequence.code} value={sequence.code}>{sequence.prefix}{names.length > 0 ? ` — ${names.join(", ")}` : ""}</option>;
                  })}
                </Select>
              ) : (
                <input
                  className={controlClass}
                  value={draft.newPrefix}
                  placeholder="QA"
                  onChange={(event) => update({ newPrefix: event.target.value.toUpperCase() })}
                />
              )}
            </div>
          )}
        </Field>
      </div>
      <h2 className="mb-2 mt-4 text-sm font-semibold text-navy-950">Company</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legal company name"><input className={controlClass} value={draft.company_name} onChange={(event) => update({ company_name: event.target.value })} /></Field>
        <Field label="Address"><TextArea value={draft.address} onChange={(event) => update({ address: event.target.value })} /></Field>
        <Field label="Phone"><input className={controlClass} value={draft.phone} onChange={(event) => update({ phone: event.target.value })} /></Field>
        <Field label="Email"><input className={controlClass} value={draft.email} onChange={(event) => update({ email: event.target.value })} /></Field>
      </div>
      <div className="mt-3">
        <Disclosure title="More company details" summary={companySummary} open={companyOpen} onToggle={() => setCompanyOpen((current) => !current)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fax"><input className={controlClass} value={draft.fax} onChange={(event) => update({ fax: event.target.value })} /></Field>
            <Field label="Website"><input className={controlClass} value={draft.website} onChange={(event) => update({ website: event.target.value })} /></Field>
            <Field label="Tax registration"><input className={controlClass} value={draft.tax_registration} onChange={(event) => update({ tax_registration: event.target.value })} /></Field>
            <Field label="Logo" hint="PNG, JPEG, or WebP under 400 KB. A new upload does not change issued PDFs.">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void onLogo(event.target.files?.[0])} />
              {draft.logo_base64 ? <img alt="" className="mt-2 h-10" src={`data:${draft.logo_content_type || "image/png"};base64,${draft.logo_base64}`} /> : <p className="mt-2 text-xs text-slate-500">No logo uploaded.</p>}
            </Field>
          </div>
        </Disclosure>
      </div>
      <h2 className="mb-1 mt-4 text-sm font-semibold text-navy-950">Bank account{draft.display_name.trim() ? ` for ${draft.display_name.trim()}` : ""}</h2>
      <p className="mb-2 text-xs text-slate-500">These account details belong only to this preset. Account number, IBAN, and SWIFT are stored as text, including leading zeroes.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bank name"><input className={controlClass} value={draft.bank_name} onChange={(event) => update({ bank_name: event.target.value })} /></Field>
        <Field label="Account name"><input className={controlClass} value={draft.account_name} onChange={(event) => update({ account_name: event.target.value })} /></Field>
        <Field label="Account number"><input className={controlClass} inputMode="text" autoComplete="off" value={draft.account_number} onChange={(event) => update({ account_number: event.target.value })} /></Field>
        <Field label="IBAN"><input className={controlClass} inputMode="text" autoComplete="off" value={draft.iban} onChange={(event) => update({ iban: event.target.value })} /></Field>
        <Field label="SWIFT"><input className={controlClass} inputMode="text" autoComplete="off" value={draft.bank_swift} onChange={(event) => update({ bank_swift: event.target.value })} /></Field>
      </div>
      <div className="mt-3">
        <Disclosure title="More bank details" summary={bankSummary} open={bankOpen} onToggle={() => setBankOpen((current) => !current)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Branch"><input className={controlClass} value={draft.bank_branch} onChange={(event) => update({ bank_branch: event.target.value })} /></Field>
            <Field label="Bank address"><TextArea value={draft.bank_address} onChange={(event) => update({ bank_address: event.target.value })} /></Field>
            <Field label="Correspondent bank"><TextArea value={draft.correspondent_bank} onChange={(event) => update({ correspondent_bank: event.target.value })} /></Field>
            <Field label="Bank notes" hint="Printed with the bank details. A bank charge is entered on each PI and is not taken from this note.">
              <TextArea value={draft.bank_notes} onChange={(event) => update({ bank_notes: event.target.value })} />
            </Field>
          </div>
        </Disclosure>
      </div>
      <Button className="mt-4" variant="primary" type="button" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : creating ? "Add preset" : `Save ${draft.display_name.trim() || "preset"}`}
      </Button>
      {draft.layout ? <p className="mt-2 text-xs text-slate-500">{layoutLabel(draft.layout)} prints the company and bank details saved on the preset.</p> : null}
    </section>
  );
}
