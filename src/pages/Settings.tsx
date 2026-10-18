import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Card, Field, PageHeader, Select, TextArea, controlClass } from "../components/ui";
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
  const [presets, setPresets] = useState<CompanyPreset[]>([]);
  const [terms, setTerms] = useState<DefaultTerms | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [draftUser, setDraftUser] = useState<ManagedUser>(emptyUser());
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"invite" | "create">("invite");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [presetResult, termsResult] = await Promise.all([
      supabase.from("company_presets").select("*").order("code"),
      supabase.from("default_terms").select("*").eq("id", 1).single(),
    ]);
    if (presetResult.error) throw presetResult.error;
    if (termsResult.error) throw termsResult.error;
    setPresets(presetResult.data as CompanyPreset[]);
    setTerms(termsResult.data as DefaultTerms);
    const listed = await callAdmin<{ users: ManagedUser[] }>({ action: "list" });
    setUsers(listed.users);
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
    else setMessage(`${preset.code} saved. Issued invoices keep the details they were generated with.`);
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
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Company identity, the three bank presets, default terms, and users." />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      {presets.map((preset) => {
        const label = PRESETS.find((item) => item.code === preset.code)?.label ?? preset.code;
        return (
          <Card key={preset.code}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-navy-950">{label}</h2>
              <span className={`text-xs font-medium ${presetReady(preset) ? "text-emerald-800" : "text-red-800"}`}>
                {presetReady(preset) ? "Ready to issue" : "Needs configuration before a PI can be issued"}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Legal company name"><input className={controlClass} value={preset.company_name} onChange={(event) => updatePreset(preset.code, { company_name: event.target.value })} /></Field>
              <Field label="Tax registration"><input className={controlClass} value={preset.tax_registration} onChange={(event) => updatePreset(preset.code, { tax_registration: event.target.value })} /></Field>
              <Field label="Address"><TextArea value={preset.address} onChange={(event) => updatePreset(preset.code, { address: event.target.value })} /></Field>
              <div className="space-y-3">
                <Field label="Phone"><input className={controlClass} value={preset.phone} onChange={(event) => updatePreset(preset.code, { phone: event.target.value })} /></Field>
                <Field label="Fax"><input className={controlClass} value={preset.fax} onChange={(event) => updatePreset(preset.code, { fax: event.target.value })} /></Field>
                <Field label="Email"><input className={controlClass} value={preset.email} onChange={(event) => updatePreset(preset.code, { email: event.target.value })} /></Field>
                <Field label="Website"><input className={controlClass} value={preset.website} onChange={(event) => updatePreset(preset.code, { website: event.target.value })} /></Field>
              </div>
              <Field label="Bank name"><input className={controlClass} value={preset.bank_name} onChange={(event) => updatePreset(preset.code, { bank_name: event.target.value })} /></Field>
              <Field label="Branch"><input className={controlClass} value={preset.bank_branch} onChange={(event) => updatePreset(preset.code, { bank_branch: event.target.value })} /></Field>
              <Field label="Bank address"><TextArea value={preset.bank_address} onChange={(event) => updatePreset(preset.code, { bank_address: event.target.value })} /></Field>
              <Field label="SWIFT"><input className={controlClass} value={preset.bank_swift} onChange={(event) => updatePreset(preset.code, { bank_swift: event.target.value })} /></Field>
              <Field label="Account name"><input className={controlClass} value={preset.account_name} onChange={(event) => updatePreset(preset.code, { account_name: event.target.value })} /></Field>
              <Field label="Account number"><input className={controlClass} value={preset.account_number} onChange={(event) => updatePreset(preset.code, { account_number: event.target.value })} /></Field>
              <Field label="IBAN"><input className={controlClass} value={preset.iban} onChange={(event) => updatePreset(preset.code, { iban: event.target.value })} /></Field>
              <Field label="Correspondent bank"><TextArea value={preset.correspondent_bank} onChange={(event) => updatePreset(preset.code, { correspondent_bank: event.target.value })} /></Field>
              <Field label="Bank notes"><TextArea value={preset.bank_notes} onChange={(event) => updatePreset(preset.code, { bank_notes: event.target.value })} /></Field>
              <Field label="Logo" hint="PNG, JPEG, or WebP under 400 KB. A new upload does not change issued PDFs.">
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void onLogo(preset.code, event.target.files?.[0])} />
                {preset.logo_base64 ? <img alt="" className="mt-2 h-10" src={`data:${preset.logo_content_type || "image/png"};base64,${preset.logo_base64}`} /> : <p className="mt-2 text-xs text-slate-500">No logo uploaded.</p>}
              </Field>
            </div>
            <Button className="mt-3" variant="primary" type="button" onClick={() => void savePreset(preset)}>Save {label}</Button>
          </Card>
        );
      })}
      {terms ? (
        <Card>
          <h2 className="mb-3 font-semibold">Default commercial terms</h2>
          <form onSubmit={saveTerms} className="grid gap-3">
            <Field label="Price basis / delivery basis"><input className={controlClass} value={terms.price_basis} onChange={(event) => setTerms({ ...terms, price_basis: event.target.value })} /></Field>
            <Field label="Payment terms"><input className={controlClass} value={terms.payment_terms} onChange={(event) => setTerms({ ...terms, payment_terms: event.target.value })} /></Field>
            <Field label="Delivery terms or lead time"><input className={controlClass} value={terms.delivery_terms} onChange={(event) => setTerms({ ...terms, delivery_terms: event.target.value })} /></Field>
            <Field label="Warranty"><input className={controlClass} value={terms.warranty} onChange={(event) => setTerms({ ...terms, warranty: event.target.value })} /></Field>
            <Field label="Additional notes"><TextArea value={terms.additional_notes} onChange={(event) => setTerms({ ...terms, additional_notes: event.target.value })} /></Field>
            <Button variant="primary" type="submit">Save default terms</Button>
          </form>
        </Card>
      ) : null}
      <Card>
        <h2 className="mb-1 font-semibold">Users and permissions</h2>
        <p className="mb-3 text-sm text-slate-600">There is no public registration. Administrators invite or create every account. Disabled users keep their name on old invoices but cannot open company records.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-600"><tr><th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Access</th><th className="py-2">Status</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3">{user.full_name}</td>
                  <td className="py-2 pr-3">{user.email}</td>
                  <td className="py-2 pr-3">{user.is_admin ? "Admin" : user.pi_visibility === "all" ? "All PIs" : "Associated PIs"}</td>
                  <td className="py-2">
                    <button type="button" className="text-navy-800 underline" onClick={() => setDraftUser(user)}>{user.is_active ? "Active" : "Disabled"} — edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={submitUser} className="mt-4 grid gap-3 md:grid-cols-2">
          <h3 className="md:col-span-2 font-medium">{draftUser.id ? `Edit ${draftUser.full_name}` : "Add a user"}</h3>
          {!draftUser.id ? (
            <Field label="Method">
              <Select value={mode} onChange={(event) => setMode(event.target.value as "invite" | "create")}>
                <option value="invite">Invite by email</option>
                <option value="create">Create with a temporary password</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Email"><input className={controlClass} type="email" required disabled={Boolean(draftUser.id)} value={draftUser.email} onChange={(event) => setDraftUser({ ...draftUser, email: event.target.value })} /></Field>
          <Field label="Name"><input className={controlClass} required value={draftUser.full_name} onChange={(event) => setDraftUser({ ...draftUser, full_name: event.target.value })} /></Field>
          <Field label="Phone"><input className={controlClass} value={draftUser.phone} onChange={(event) => setDraftUser({ ...draftUser, phone: event.target.value })} /></Field>
          {mode === "create" && !draftUser.id ? (
            <Field label="Temporary password" hint="At least 8 characters. It is not stored in this app.">
              <input className={controlClass} type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
          ) : null}
          <Field label="PI visibility">
            <Select value={draftUser.pi_visibility} onChange={(event) => setDraftUser({ ...draftUser, pi_visibility: event.target.value as PiVisibility })}>
              <option value="associated">Only associated PIs</option>
              <option value="all">All PIs</option>
            </Select>
          </Field>
          <div className="md:col-span-2 grid gap-2 text-sm sm:grid-cols-2">
            {([
              ["is_admin", "Administrator"],
              ["is_salesperson", "Can be assigned as a salesperson"],
              ["is_active", "Active"],
              ["can_edit_drafts", "Create and edit drafts, revisions, and duplicates"],
              ["can_generate_pis", "Generate PIs"],
              ["can_manage_clients", "Manage clients"],
              ["can_manage_vendors", "Manage vendors"],
              ["can_manage_products", "Manage products"],
              ["can_view_purchase_prices", "View purchase prices"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={draftUser[key]} onChange={(event) => setDraftUser({ ...draftUser, [key]: event.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" type="submit">{draftUser.id ? "Save user" : mode === "invite" ? "Send invitation" : "Create user"}</Button>
            {draftUser.id ? <Button type="button" onClick={() => setDraftUser(emptyUser())}>Cancel edit</Button> : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
