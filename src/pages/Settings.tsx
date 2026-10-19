import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Field, PageHeader, Select, Tabs, TextArea, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { supabase } from "../lib/supabase";
import { PRESETS, type CompanyPreset, type DefaultTerms, type PiVisibility, type PresetCode } from "../lib/types";

type ManagedUser = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  is_admin: boolean;
  is_salesperson: boolean;
  pi_visibility: PiVisibility;
  can_edit_drafts: boolean;
  can_generate_pis: boolean;
  can_manage_clients: boolean;
  can_manage_vendors: boolean;
  can_manage_products: boolean;
  can_view_purchase_prices: boolean;
};

type SettingsTab = "company" | "terms" | "users";

const emptyUser = (): ManagedUser => ({
  id: "",
  email: "",
  full_name: "",
  phone: "",
  is_active: true,
  is_admin: false,
  is_salesperson: true,
  pi_visibility: "associated",
  can_edit_drafts: true,
  can_generate_pis: false,
  can_manage_clients: false,
  can_manage_vendors: false,
  can_manage_products: false,
  can_view_purchase_prices: false,
});

function presetReady(preset: CompanyPreset): boolean {
  return [preset.company_name, preset.address, preset.bank_name, preset.account_name, preset.account_number, preset.iban, preset.bank_swift].every((value) => value.trim());
}

async function callAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }
  return data as T;
}

export function SettingsPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<SettingsTab>("company");
  const [presetCode, setPresetCode] = useState<PresetCode>("EG-EGP");
  const [presets, setPresets] = useState<CompanyPreset[]>([]);
  const [terms, setTerms] = useState<DefaultTerms | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [draftUser, setDraftUser] = useState<ManagedUser>(emptyUser());
  const [userView, setUserView] = useState<"list" | "form">("list");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"invite" | "create">("invite");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadUsers() {
    const listed = await callAdmin<{ users: ManagedUser[] }>({ action: "list" });
    setUsers(listed.users);
  }

  async function load() {
    const [presetResult, termsResult] = await Promise.all([
      supabase.from("company_presets").select("*").order("code"),
      supabase.from("default_terms").select("*").eq("id", 1).single(),
    ]);
    if (presetResult.error) throw presetResult.error;
    if (termsResult.error) throw termsResult.error;
    setPresets(presetResult.data as CompanyPreset[]);
    setTerms(termsResult.data as DefaultTerms);
    await loadUsers();
  }

  useEffect(() => {
    if (!profile?.is_admin) return;
    load().then(() => setLoading(false)).catch((caught) => {
      setError(errorText(caught));
      setLoading(false);
    });
  }, [profile?.is_admin]);

  if (!profile?.is_admin) {
    return <Banner tone="error">Only administrators can open Settings.</Banner>;
  }
  if (loading) return <p className="text-sm text-slate-600">Loading settings…</p>;

  function updatePreset(code: PresetCode, patch: Partial<CompanyPreset>) {
    setPresets((current) => current.map((preset) => (preset.code === code ? { ...preset, ...patch } : preset)));
  }

  async function savePreset(preset: CompanyPreset) {
    setError(null);
    const { error: updateError } = await supabase.from("company_presets").update({
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
    }).eq("code", preset.code);
    if (updateError) setError(errorText(updateError));
    else setMessage(`${presetLabel(preset.code)} saved. Issued invoices keep the details they were generated with.`);
  }

  async function onLogo(code: PresetCode, file: File | undefined) {
    if (!file) return;
    if (file.size > 400_000) {
      setError("Logo must be smaller than 400 KB.");
      return;
    }
    const dataUrl = await file.arrayBuffer().then((buffer) => {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    updatePreset(code, { logo_base64: dataUrl, logo_content_type: file.type || "image/png" });
  }

  async function saveTerms(event: FormEvent) {
    event.preventDefault();
    if (!terms) return;
    const { error: updateError } = await supabase.from("default_terms").update({
      price_basis: terms.price_basis,
      payment_terms: terms.payment_terms,
      delivery_terms: terms.delivery_terms,
      warranty: terms.warranty,
      additional_notes: terms.additional_notes,
    }).eq("id", 1);
    if (updateError) setError(errorText(updateError));
    else setMessage("Default terms saved. They are copied onto new drafts and remain editable on each PI.");
  }

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (draftUser.id) {
        await callAdmin({ action: "update", user: draftUser });
        setMessage("User updated.");
      } else if (mode === "invite") {
        await callAdmin({ action: "invite", user: draftUser, redirect_to: `${window.location.origin}/reset-password` });
        setMessage("Invitation sent. The person sets a password from the email link.");
      } else {
        await callAdmin({ action: "create", user: draftUser, password });
        setMessage("User created. Share the temporary password through a secure channel.");
        setPassword("");
      }
      setDraftUser(emptyUser());
      setUserView("list");
      await loadUsers();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  function openUser(user: ManagedUser) {
    setDraftUser((current) => (current.id === user.id ? current : user));
    setUserView("form");
  }

  function openNewUser() {
    setDraftUser(emptyUser());
    setPassword("");
    setMode("invite");
    setUserView("form");
  }

  const selected = presets.find((preset) => preset.code === presetCode) ?? presets[0];
  const selectedLabel = selected ? presetLabel(selected.code) : "";

  return (
    <div className="space-y-3">
      <PageHeader title="Settings" />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      <Tabs
        label="Settings"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "company", label: "Company and bank" },
          { id: "terms", label: "Default terms" },
          { id: "users", label: "Users and permissions" },
        ]}
      />
      {tab === "company" && selected ? (
        <section className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Company presets">
            {PRESETS.map((preset) => {
              const active = preset.code === selected.code;
              return (
                <button
                  key={preset.code}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`h-9 rounded-md px-3 text-sm ${active ? "bg-navy-900 font-semibold text-white" : "border border-slate-300 bg-white text-slate-800"}`}
                  onClick={() => setPresetCode(preset.code)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <dl className="mt-3 grid gap-2 border-b border-slate-200 pb-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Preset</dt>
              <dd className="font-medium">{selectedLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Currency</dt>
              <dd className="font-medium">{selected.currency}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Legal entity</dt>
              <dd className="font-medium">{selected.company_name || "Not set"}</dd>
            </div>
          </dl>
          <p className={`mt-2 text-sm ${presetReady(selected) ? "text-emerald-800" : "text-red-800"}`}>
            {presetReady(selected) ? "Ready to issue" : "Needs configuration before a PI can be issued"}
          </p>
          <h2 className="mb-2 mt-4 text-sm font-semibold text-navy-950">Company</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Legal company name"><input className={controlClass} value={selected.company_name} onChange={(event) => updatePreset(selected.code, { company_name: event.target.value })} /></Field>
            <Field label="Tax registration"><input className={controlClass} value={selected.tax_registration} onChange={(event) => updatePreset(selected.code, { tax_registration: event.target.value })} /></Field>
            <Field label="Address"><TextArea value={selected.address} onChange={(event) => updatePreset(selected.code, { address: event.target.value })} /></Field>
            <div className="space-y-3">
              <Field label="Phone"><input className={controlClass} value={selected.phone} onChange={(event) => updatePreset(selected.code, { phone: event.target.value })} /></Field>
              <Field label="Fax"><input className={controlClass} value={selected.fax} onChange={(event) => updatePreset(selected.code, { fax: event.target.value })} /></Field>
              <Field label="Email"><input className={controlClass} value={selected.email} onChange={(event) => updatePreset(selected.code, { email: event.target.value })} /></Field>
              <Field label="Website"><input className={controlClass} value={selected.website} onChange={(event) => updatePreset(selected.code, { website: event.target.value })} /></Field>
            </div>
          </div>
          <h2 className="mb-1 mt-4 text-sm font-semibold text-navy-950">Bank account for {selectedLabel}</h2>
          <p className="mb-2 text-xs text-slate-500">These account details belong only to this preset.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank name"><input className={controlClass} value={selected.bank_name} onChange={(event) => updatePreset(selected.code, { bank_name: event.target.value })} /></Field>
            <Field label="Branch"><input className={controlClass} value={selected.bank_branch} onChange={(event) => updatePreset(selected.code, { bank_branch: event.target.value })} /></Field>
            <Field label="Bank address"><TextArea value={selected.bank_address} onChange={(event) => updatePreset(selected.code, { bank_address: event.target.value })} /></Field>
            <Field label="SWIFT"><input className={controlClass} value={selected.bank_swift} onChange={(event) => updatePreset(selected.code, { bank_swift: event.target.value })} /></Field>
            <Field label="Account name"><input className={controlClass} value={selected.account_name} onChange={(event) => updatePreset(selected.code, { account_name: event.target.value })} /></Field>
            <Field label="Account number"><input className={controlClass} value={selected.account_number} onChange={(event) => updatePreset(selected.code, { account_number: event.target.value })} /></Field>
            <Field label="IBAN"><input className={controlClass} value={selected.iban} onChange={(event) => updatePreset(selected.code, { iban: event.target.value })} /></Field>
            <Field label="Correspondent bank"><TextArea value={selected.correspondent_bank} onChange={(event) => updatePreset(selected.code, { correspondent_bank: event.target.value })} /></Field>
            <Field label="Bank notes" hint="Printed with the bank details. A bank charge is entered on each PI and is not taken from this note.">
              <TextArea value={selected.bank_notes} onChange={(event) => updatePreset(selected.code, { bank_notes: event.target.value })} />
            </Field>
            <Field label="Logo" hint="PNG, JPEG, or WebP under 400 KB. A new upload does not change issued PDFs.">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void onLogo(selected.code, event.target.files?.[0])} />
              {selected.logo_base64 ? <img alt="" className="mt-2 h-10" src={`data:${selected.logo_content_type || "image/png"};base64,${selected.logo_base64}`} /> : <p className="mt-2 text-xs text-slate-500">No logo uploaded.</p>}
            </Field>
          </div>
          <Button className="mt-3" variant="primary" type="button" onClick={() => void savePreset(selected)}>Save {selectedLabel}</Button>
        </section>
      ) : null}
      {tab === "terms" && terms ? (
        <section className="rounded-md border border-slate-200 bg-white p-3">
          <form onSubmit={saveTerms} className="grid gap-3">
            <Field label="Payment terms"><input className={controlClass} value={terms.payment_terms} onChange={(event) => setTerms({ ...terms, payment_terms: event.target.value })} /></Field>
            <Field label="Delivery terms"><input className={controlClass} value={terms.delivery_terms} onChange={(event) => setTerms({ ...terms, delivery_terms: event.target.value })} /></Field>
            <Field label="Price basis"><input className={controlClass} value={terms.price_basis} onChange={(event) => setTerms({ ...terms, price_basis: event.target.value })} /></Field>
            <Field label="Warranty"><input className={controlClass} value={terms.warranty} onChange={(event) => setTerms({ ...terms, warranty: event.target.value })} /></Field>
            <Field label="Additional notes"><TextArea value={terms.additional_notes} onChange={(event) => setTerms({ ...terms, additional_notes: event.target.value })} /></Field>
            <div><Button variant="primary" type="submit">Save default terms</Button></div>
          </form>
        </section>
      ) : null}
      {tab === "users" ? (
        <section className="rounded-md border border-slate-200 bg-white p-3">
          {userView === "list" ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">Invite or create each account. There is no public registration.</p>
                <Button type="button" variant="primary" onClick={openNewUser}>Add user</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Name</th>
                      <th className="py-1.5 pr-3 font-medium">Email</th>
                      <th className="py-1.5 pr-3 font-medium">Access</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3">{user.full_name}</td>
                        <td className="py-1.5 pr-3">{user.email}</td>
                        <td className="py-1.5 pr-3">{user.is_admin ? "Administrator" : user.pi_visibility === "all" ? "All PIs" : "Associated PIs"}</td>
                        <td className="py-1.5 pr-3">{user.is_active ? "Active" : "Disabled"}</td>
                        <td className="py-1.5">
                          <button type="button" className="text-navy-800 underline" onClick={() => openUser(user)}>Edit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500">Disabled users keep their name on issued invoices but cannot open company records.</p>
            </>
          ) : (
            <form onSubmit={submitUser} className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-navy-950">{draftUser.id ? `Edit ${draftUser.full_name}` : "Add a user"}</h2>
                <Button type="button" variant="secondary" onClick={() => setUserView("list")}>Back to users</Button>
              </div>
              {!draftUser.id ? (
                <Field label="Method">
                  <Select value={mode} onChange={(event) => setMode(event.target.value as "invite" | "create")}>
                    <option value="invite">Invite by email</option>
                    <option value="create">Create with a temporary password</option>
                  </Select>
                </Field>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email"><input className={controlClass} type="email" required disabled={Boolean(draftUser.id)} value={draftUser.email} onChange={(event) => setDraftUser({ ...draftUser, email: event.target.value })} /></Field>
                <Field label="Name"><input className={controlClass} required value={draftUser.full_name} onChange={(event) => setDraftUser({ ...draftUser, full_name: event.target.value })} /></Field>
                <Field label="Phone"><input className={controlClass} value={draftUser.phone} onChange={(event) => setDraftUser({ ...draftUser, phone: event.target.value })} /></Field>
                {mode === "create" && !draftUser.id ? (
                  <Field label="Temporary password" hint="At least 8 characters. It is not stored in this app.">
                    <input className={controlClass} type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
                  </Field>
                ) : null}
              </div>
              <fieldset className="grid gap-2 rounded-md border border-slate-200 p-3 text-sm">
                <legend className="px-1 font-medium text-slate-800">Account</legend>
                <Check label="Active" checked={draftUser.is_active} onChange={(checked) => setDraftUser({ ...draftUser, is_active: checked })} />
                <Check label="Administrator" hint="An administrator can do every action." checked={draftUser.is_admin} onChange={(checked) => setDraftUser({ ...draftUser, is_admin: checked })} />
                <Check label="Can be assigned as a salesperson" checked={draftUser.is_salesperson} onChange={(checked) => setDraftUser({ ...draftUser, is_salesperson: checked })} />
              </fieldset>
              <fieldset className="grid gap-2 rounded-md border border-slate-200 p-3 text-sm">
                <legend className="px-1 font-medium text-slate-800">PI access</legend>
                <Field label="PI visibility">
                  <Select value={draftUser.pi_visibility} onChange={(event) => setDraftUser({ ...draftUser, pi_visibility: event.target.value as PiVisibility })}>
                    <option value="associated">Only associated PIs</option>
                    <option value="all">All PIs</option>
                  </Select>
                </Field>
                <Check label="Create and edit drafts, revisions, and duplicates" checked={draftUser.can_edit_drafts} onChange={(checked) => setDraftUser({ ...draftUser, can_edit_drafts: checked })} />
                <Check label="Generate PIs" checked={draftUser.can_generate_pis} onChange={(checked) => setDraftUser({ ...draftUser, can_generate_pis: checked })} />
              </fieldset>
              <fieldset className="grid gap-2 rounded-md border border-slate-200 p-3 text-sm">
                <legend className="px-1 font-medium text-slate-800">Records</legend>
                <Check label="Manage clients" checked={draftUser.can_manage_clients} onChange={(checked) => setDraftUser({ ...draftUser, can_manage_clients: checked })} />
                <Check label="Manage vendors" checked={draftUser.can_manage_vendors} onChange={(checked) => setDraftUser({ ...draftUser, can_manage_vendors: checked })} />
                <Check label="Manage products" checked={draftUser.can_manage_products} onChange={(checked) => setDraftUser({ ...draftUser, can_manage_products: checked })} />
                <Check label="View purchase prices" checked={draftUser.can_view_purchase_prices} onChange={(checked) => setDraftUser({ ...draftUser, can_view_purchase_prices: checked })} />
              </fieldset>
              <div>
                <Button variant="primary" type="submit">{draftUser.id ? "Save user" : mode === "invite" ? "Send invitation" : "Create user"}</Button>
              </div>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}

function presetLabel(code: PresetCode): string {
  return PRESETS.find((item) => item.code === code)?.label ?? code;
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input className="mt-0.5" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}
