import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { CompanyPresetSettings } from "../components/CompanyPresetSettings";
import { Banner, Button, Field, LoadingNote, PageHeader, Select, Tabs, TextArea, controlClass, formSheetClass, linkClass, tableWrapClass, tdClass, thClass, theadClass } from "../components/ui";
import { SETTINGS_ADMIN_MESSAGE, permissionFormGroups } from "../lib/user-form";
import { errorText } from "../lib/errors";
import { supabase } from "../lib/supabase";
import type { DefaultTerms, PiVisibility } from "../lib/types";

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
  can_manage_payments: boolean;
  can_reverse_payments: boolean;
  can_activate_zero_subscriptions: boolean;
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
  can_manage_payments: false,
  can_reverse_payments: false,
  can_activate_zero_subscriptions: false,
});

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
    const termsResult = await supabase.from("default_terms").select("*").eq("id", 1).single();
    if (termsResult.error) throw termsResult.error;
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
    return <Banner tone="error">{SETTINGS_ADMIN_MESSAGE}</Banner>;
  }
  if (loading) return <LoadingNote>Loading settings…</LoadingNote>;

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
    else setMessage("Default terms saved. Delivery, price basis, warranty, and notes are copied onto new drafts. The legacy payment paragraph is not.");
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
    setDraftUser((current) => (current.id === user.id ? current : {
      ...user,
      can_manage_payments: user.can_manage_payments === true,
      can_reverse_payments: user.can_reverse_payments === true,
      can_activate_zero_subscriptions: user.can_activate_zero_subscriptions === true,
    }));
    setUserView("form");
  }

  function openNewUser() {
    setDraftUser(emptyUser());
    setPassword("");
    setMode("invite");
    setUserView("form");
  }

  return (
    <div className={`${formSheetClass} space-y-3`}>
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
      {tab === "company" ? <CompanyPresetSettings onError={setError} onMessage={setMessage} /> : null}
      {tab === "terms" && terms ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <form onSubmit={saveTerms} className="grid max-w-3xl gap-4">
            <div>
              <p className="text-[13px] font-medium text-muted">Legacy payment paragraph</p>
              <p className="mt-1 text-sm text-ink">{terms.payment_terms.trim() ? terms.payment_terms : "No legacy payment paragraph is stored."}</p>
              <p className="mt-1 text-xs text-muted">This paragraph is kept for legacy compatibility. It is not copied onto new proforma invoices and it does not configure the payment schedule. New drafts use a payment schedule on the PI. Delivery, price basis, warranty, and notes are still copied onto each new draft.</p>
            </div>
            <Field label="Delivery terms"><input className={controlClass} value={terms.delivery_terms} onChange={(event) => setTerms({ ...terms, delivery_terms: event.target.value })} /></Field>
            <Field label="Price basis"><input className={controlClass} value={terms.price_basis} onChange={(event) => setTerms({ ...terms, price_basis: event.target.value })} /></Field>
            <Field label="Warranty"><input className={controlClass} value={terms.warranty} onChange={(event) => setTerms({ ...terms, warranty: event.target.value })} /></Field>
            <Field label="Additional notes"><TextArea value={terms.additional_notes} onChange={(event) => setTerms({ ...terms, additional_notes: event.target.value })} /></Field>
            <div><Button variant="primary" type="submit">Save default terms</Button></div>
          </form>
        </section>
      ) : null}
      {tab === "users" ? (
        <section className="rounded-lg border border-line bg-white p-6">
          {userView === "list" ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-secondary">Invite or create each account. There is no public registration.</p>
                <Button type="button" variant="primary" onClick={openNewUser}>Add user</Button>
              </div>
              <div className={tableWrapClass}>
                <table className="min-w-full text-left text-sm">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass} scope="col">Name</th>
                      <th className={thClass} scope="col">Email</th>
                      <th className={thClass} scope="col">Access</th>
                      <th className={thClass} scope="col">Status</th>
                      <th className={thClass} scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-t border-line">
                        <td className={tdClass}>{user.full_name}</td>
                        <td className={tdClass}>{user.email}</td>
                        <td className={tdClass}>{user.is_admin ? "Administrator" : user.pi_visibility === "all" ? "All PIs" : "Associated PIs"}</td>
                        <td className={tdClass}>{user.is_active ? "Active" : <span className="font-medium text-danger">Disabled</span>}</td>
                        <td className={tdClass}>
                          <button type="button" className={linkClass} onClick={() => openUser(user)}>Edit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] text-muted">Disabled users keep their name on issued invoices but cannot open company records.</p>
            </>
          ) : (
            <form onSubmit={submitUser} className="grid max-w-3xl gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[17px] font-semibold text-ink">{draftUser.id ? `Edit ${draftUser.full_name}` : "Add a user"}</h2>
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
              {permissionFormGroups.map((group) => (
                <fieldset key={group.heading} className="grid gap-3 rounded-lg border border-line p-4 text-sm">
                  <legend className="px-1 text-sm font-semibold text-ink">{group.heading}</legend>
                  {group.heading === "PI access" ? (
                    <Field label="PI visibility">
                      <Select value={draftUser.pi_visibility} onChange={(event) => setDraftUser({ ...draftUser, pi_visibility: event.target.value as PiVisibility })}>
                        <option value="associated">Only associated PIs</option>
                        <option value="all">All PIs</option>
                      </Select>
                    </Field>
                  ) : null}
                  {group.checks.map((check) => (
                    <Check
                      key={check.key}
                      label={check.label}
                      hint={check.hint}
                      checked={draftUser[check.key] === true}
                      onChange={(checked) => setDraftUser({ ...draftUser, [check.key]: checked })}
                    />
                  ))}
                </fieldset>
              ))}
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
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
