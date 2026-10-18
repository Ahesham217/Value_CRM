import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Card, Field, PageHeader, TextArea, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { displayNumber, formatDate, formatMoney } from "../lib/format";
import { can } from "../lib/permissions";
import { archiveRow } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { Client, ClientContact, PiListRow } from "../lib/types";

type ContactDraft = {
  key: string;
  id?: string;
  name: string;
  job_title: string;
  phone: string;
  email: string;
  is_primary: boolean;
};

function emptyContact(): ContactDraft {
  return { key: crypto.randomUUID(), name: "", job_title: "", phone: "", email: "", is_primary: false };
}

export function ClientDetailPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { profile } = useAuth();
  const manage = can(profile, "can_manage_clients");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [billing, setBilling] = useState("");
  const [shipping, setShipping] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactDraft[]>([emptyContact()]);
  const [related, setRelated] = useState<PiListRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !id) return;
    let active = true;
    Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase.from("client_contacts").select("*").eq("client_id", id).order("position"),
      supabase.from("pi_list").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(20),
    ]).then(([clientResult, contactResult, piResult]) => {
      if (!active) return;
      if (clientResult.error || !clientResult.data) {
        setError(clientResult.error ? errorText(clientResult.error) : "Client not found.");
        setLoading(false);
        return;
      }
      const client = clientResult.data as Client;
      setCompanyName(client.company_name);
      setCountry(client.country);
      setBilling(client.billing_address);
      setShipping(client.shipping_address ?? "");
      setTaxNumber(client.tax_number ?? "");
      setNotes(client.notes);
      setArchivedAt(client.archived_at);
      const loaded = ((contactResult.data ?? []) as ClientContact[]).map((contact) => ({
        key: contact.id,
        id: contact.id,
        name: contact.name,
        job_title: contact.job_title,
        phone: contact.phone,
        email: contact.email,
        is_primary: contact.is_primary,
      }));
      setContacts(loaded.length ? loaded : [emptyContact()]);
      setRelated((piResult.data ?? []) as PiListRow[]);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id, isNew]);

  function updateContact(key: string, patch: Partial<ContactDraft>) {
    setContacts((current) =>
      current.map((contact) => {
        if (patch.is_primary) return { ...contact, is_primary: contact.key === key };
        if (contact.key !== key) return contact;
        return { ...contact, ...patch };
      }),
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!manage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        company_name: companyName.trim(),
        country: country.trim(),
        billing_address: billing.trim(),
        shipping_address: shipping.trim() || null,
        tax_number: taxNumber.trim() || null,
        notes: notes.trim(),
      };
      if (!payload.company_name) throw new Error("Company name is required.");
      let clientId = id;
      if (isNew) {
        const { data, error: insertError } = await supabase.from("clients").insert(payload).select("id").single();
        if (insertError) throw insertError;
        clientId = data.id as string;
      } else {
        const { error: updateError } = await supabase.from("clients").update(payload).eq("id", id);
        if (updateError) throw updateError;
      }
      if (!clientId) throw new Error("Client was not saved.");
      const kept = contacts.filter((contact) => contact.name.trim());
      if (kept.filter((contact) => contact.is_primary).length > 1) {
        throw new Error("Choose only one primary contact.");
      }
      const { data: existing, error: existingError } = await supabase.from("client_contacts").select("id").eq("client_id", clientId);
      if (existingError) throw existingError;
      const keepIds = new Set(kept.map((contact) => contact.id).filter(Boolean));
      const removeIds = (existing ?? []).map((row) => row.id as string).filter((contactId) => !keepIds.has(contactId));
      if (removeIds.length) {
        const { error: deleteError } = await supabase.from("client_contacts").delete().in("id", removeIds);
        if (deleteError) throw deleteError;
      }
      for (const [index, contact] of kept.entries()) {
        const row = {
          client_id: clientId,
          name: contact.name.trim(),
          job_title: contact.job_title.trim(),
          phone: contact.phone.trim(),
          email: contact.email.trim(),
          is_primary: contact.is_primary,
          position: index,
        };
        if (contact.id) {
          const { error: contactError } = await supabase.from("client_contacts").update(row).eq("id", contact.id);
          if (contactError) throw contactError;
        } else {
          const { error: contactError } = await supabase.from("client_contacts").insert(row);
          if (contactError) throw contactError;
        }
      }
      setMessage("Client saved.");
      if (isNew) navigate(`/clients/${clientId}`, { replace: true });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    if (!id || isNew) return;
    if (!window.confirm(archivedAt ? "Restore this client?" : "Archive this client? Historical invoices stay linked.")) return;
    try {
      await archiveRow("clients", id, !archivedAt);
      setArchivedAt(archivedAt ? null : new Date().toISOString());
      setMessage(archivedAt ? "Client restored." : "Client archived.");
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Loading client…</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PageHeader
        title={isNew ? "New client" : companyName || "Client"}
        subtitle={archivedAt ? "Archived clients stay on historical invoices." : "Company details and contacts."}
        actions={
          <>
            <Link to="/clients"><Button type="button" variant="secondary">Back</Button></Link>
            {!isNew && manage ? <Button type="button" variant="danger" onClick={() => void toggleArchive()}>{archivedAt ? "Restore" : "Archive"}</Button> : null}
            {manage ? <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</Button> : null}
          </>
        }
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      {!manage ? <Banner tone="info">You can view this client. An administrator has not given you permission to change clients.</Banner> : null}
      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Company name">
            <input className={controlClass} required value={companyName} disabled={!manage} onChange={(event) => setCompanyName(event.target.value)} />
          </Field>
          <Field label="Country">
            <input className={controlClass} value={country} disabled={!manage} onChange={(event) => setCountry(event.target.value)} />
          </Field>
          <Field label="Tax number">
            <input className={controlClass} value={taxNumber} disabled={!manage} onChange={(event) => setTaxNumber(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Billing address">
            <TextArea value={billing} disabled={!manage} onChange={(event) => setBilling(event.target.value)} />
          </Field>
          <Field label="Shipping address" hint="Optional. A PI can still copy billing at the time it is prepared.">
            <TextArea value={shipping} disabled={!manage} onChange={(event) => setShipping(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes">
            <TextArea value={notes} disabled={!manage} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-navy-950">Contacts</h2>
          {manage ? <Button type="button" onClick={() => setContacts((current) => [...current, emptyContact()])}>Add contact</Button> : null}
        </div>
        <div className="space-y-3">
          {contacts.map((contact) => (
            <div key={contact.key} className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-4">
              <Field label="Name"><input className={controlClass} value={contact.name} disabled={!manage} onChange={(event) => updateContact(contact.key, { name: event.target.value })} /></Field>
              <Field label="Job title"><input className={controlClass} value={contact.job_title} disabled={!manage} onChange={(event) => updateContact(contact.key, { job_title: event.target.value })} /></Field>
              <Field label="Phone"><input className={controlClass} value={contact.phone} disabled={!manage} onChange={(event) => updateContact(contact.key, { phone: event.target.value })} /></Field>
              <Field label="Email"><input className={controlClass} type="email" value={contact.email} disabled={!manage} onChange={(event) => updateContact(contact.key, { email: event.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm md:col-span-3">
                <input type="radio" name="primary-contact" checked={contact.is_primary} disabled={!manage} onChange={() => updateContact(contact.key, { is_primary: true })} />
                Primary contact
              </label>
              {manage ? <Button type="button" variant="ghost" onClick={() => setContacts((current) => current.filter((item) => item.key !== contact.key))}>Remove</Button> : null}
            </div>
          ))}
        </div>
      </Card>
      {!isNew ? (
        <Card>
          <h2 className="mb-3 font-semibold text-navy-950">Related PIs</h2>
          {related.length === 0 ? <p className="text-sm text-slate-600">No proforma invoices for this client are visible to you.</p> : (
            <ul className="space-y-2 text-sm">
              {related.map((pi) => (
                <li key={pi.id}>
                  <Link className="font-medium text-navy-800 underline" to={`/pis/${pi.id}`}>{displayNumber(pi.pi_number, pi.latest_revision)}</Link>
                  <span className="text-slate-600"> · {formatDate(pi.pi_date)} · {formatMoney(pi.display_total, pi.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </form>
  );
}
