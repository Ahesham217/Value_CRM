import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Disclosure, Field, Menu, PageHeader, TextArea, buttonClass, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { can } from "../lib/permissions";
import { archiveRow } from "../lib/records";
import { supabase } from "../lib/supabase";
import type { Product, Vendor, VendorContact } from "../lib/types";
import { recordOptionalSummary } from "../lib/workspace-view";

type ContactDraft = { key: string; id?: string; name: string; job_title: string; phone: string; email: string };

function emptyContact(): ContactDraft {
  return { key: crypto.randomUUID(), name: "", job_title: "", phone: "", email: "" };
}

export function VendorDetailPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { profile } = useAuth();
  const manage = can(profile, "can_manage_vendors");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactDraft[]>([emptyContact()]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([
      supabase.from("vendors").select("*").eq("id", id).maybeSingle(),
      supabase.from("vendor_contacts").select("*").eq("vendor_id", id).order("position"),
      supabase.from("products").select("*").eq("vendor_id", id).order("model_code").limit(50),
    ]).then(([vendorResult, contactResult, productResult]) => {
      if (!active) return;
      if (vendorResult.error || !vendorResult.data) {
        setError(vendorResult.error ? errorText(vendorResult.error) : "Vendor not found.");
        setLoading(false);
        return;
      }
      const vendor = vendorResult.data as Vendor;
      setCompanyName(vendor.company_name);
      setCountry(vendor.country);
      setAddress(vendor.address);
      setNotes(vendor.notes);
      setArchivedAt(vendor.archived_at);
      const loaded = ((contactResult.data ?? []) as VendorContact[]).map((contact) => ({
        key: contact.id,
        id: contact.id,
        name: contact.name,
        job_title: contact.job_title,
        phone: contact.phone,
        email: contact.email,
      }));
      setContacts(loaded.length ? loaded : [emptyContact()]);
      setProducts((productResult.data ?? []) as Product[]);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  function updateContact(key: string, patch: Partial<ContactDraft>) {
    setContacts((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!manage) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { company_name: companyName.trim(), country: country.trim(), address: address.trim(), notes: notes.trim() };
      if (!payload.company_name) throw new Error("Company name is required.");
      let vendorId = id;
      if (!vendorId) {
        const { data, error: insertError } = await supabase.from("vendors").insert(payload).select("id").single();
        if (insertError) throw insertError;
        vendorId = data.id as string;
      } else {
        const { error: updateError } = await supabase.from("vendors").update(payload).eq("id", vendorId);
        if (updateError) throw updateError;
      }
      const kept = contacts.filter((contact) => contact.name.trim());
      const { data: existing, error: existingError } = await supabase.from("vendor_contacts").select("id").eq("vendor_id", vendorId);
      if (existingError) throw existingError;
      const keepIds = new Set(kept.map((contact) => contact.id).filter(Boolean));
      const removeIds = (existing ?? []).map((row) => row.id as string).filter((contactId) => !keepIds.has(contactId));
      if (removeIds.length) {
        const { error: deleteError } = await supabase.from("vendor_contacts").delete().in("id", removeIds);
        if (deleteError) throw deleteError;
      }
      for (const [index, contact] of kept.entries()) {
        const row = { vendor_id: vendorId, name: contact.name.trim(), job_title: contact.job_title.trim(), phone: contact.phone.trim(), email: contact.email.trim(), position: index };
        const result = contact.id
          ? await supabase.from("vendor_contacts").update(row).eq("id", contact.id)
          : await supabase.from("vendor_contacts").insert(row);
        if (result.error) throw result.error;
      }
      setMessage("Vendor saved.");
      if (!id) navigate(`/vendors/${vendorId}`, { replace: true });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Loading vendor…</p>;

  const featured = contacts[0] ?? emptyContact();
  const additional = contacts.slice(1);
  const additionalSummary = additional.map((contact) => contact.name.trim()).filter(Boolean).join(", ") || null;
  const detailSummary = recordOptionalSummary([
    { label: "Address", value: address },
    { label: "Notes", value: notes },
  ]);

  function contactFields(contact: ContactDraft) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name"><input className={controlClass} disabled={!manage} value={contact.name} onChange={(event) => updateContact(contact.key, { name: event.target.value })} /></Field>
        <Field label="Job title"><input className={controlClass} disabled={!manage} value={contact.job_title} onChange={(event) => updateContact(contact.key, { job_title: event.target.value })} /></Field>
        <Field label="Phone"><input className={controlClass} disabled={!manage} value={contact.phone} onChange={(event) => updateContact(contact.key, { phone: event.target.value })} /></Field>
        <Field label="Email"><input className={controlClass} type="email" disabled={!manage} value={contact.email} onChange={(event) => updateContact(contact.key, { email: event.target.value })} /></Field>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <PageHeader
        title={isNew ? "New vendor" : companyName || "Vendor"}
        subtitle={archivedAt ? "Archived. Products and invoice history stay linked." : undefined}
        actions={
          <>
            <Link to="/vendors" className={buttonClass("secondary")}>Back</Link>
            {id && manage ? (
              <Menu
                label="More"
                items={[{
                  label: archivedAt ? "Restore" : "Archive",
                  tone: "danger",
                  onSelect: () => {
                    if (!window.confirm(archivedAt ? "Restore this vendor?" : "Archive this vendor? Products and invoice history stay linked.")) return;
                    void archiveRow("vendors", id, !archivedAt).then(() => {
                      setArchivedAt(archivedAt ? null : new Date().toISOString());
                      setMessage(archivedAt ? "Vendor restored." : "Vendor archived.");
                    }).catch((caught) => setError(errorText(caught)));
                  },
                }]}
              />
            ) : null}
            {manage ? <Button variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button> : null}
          </>
        }
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      {!manage ? <Banner tone="info">You can view this vendor. An administrator has not given you permission to change vendors.</Banner> : null}
      <section className="rounded-[10px] border border-line bg-white p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name"><input className={controlClass} required disabled={!manage} value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></Field>
          <Field label="Country"><input className={controlClass} disabled={!manage} value={country} onChange={(event) => setCountry(event.target.value)} /></Field>
        </div>
        <div className="mt-3">
          <h2 className="mb-2 text-sm font-semibold text-navy-950">Primary contact</h2>
          {contactFields(featured)}
          {manage ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" onClick={() => { setContactsOpen(true); setContacts((current) => [...current, emptyContact()]); }}>Add contact</Button>
              {contacts.length > 1 ? (
                <Button type="button" variant="ghost" onClick={() => setContacts((current) => current.length > 1 ? current.slice(1) : [emptyContact()])}>Remove contact</Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <Disclosure title="More vendor details" summary={detailSummary} open={detailsOpen} onToggle={() => setDetailsOpen((current) => !current)}>
          <div className="grid gap-3">
            <Field label="Address"><TextArea disabled={!manage} value={address} onChange={(event) => setAddress(event.target.value)} /></Field>
            <Field label="Notes"><TextArea disabled={!manage} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          </div>
        </Disclosure>
        <Disclosure title="Additional contacts" summary={additionalSummary} open={contactsOpen} onToggle={() => setContactsOpen((current) => !current)}>
          {additional.length === 0 ? <p className="text-sm text-slate-600">No additional contacts.</p> : (
            <div className="space-y-3">
              {additional.map((contact) => (
                <div key={contact.key} className="rounded-lg border border-line p-3">
                  {contactFields(contact)}
                  {manage ? <Button className="mt-2" type="button" variant="ghost" onClick={() => setContacts((current) => current.filter((item) => item.key !== contact.key))}>Remove</Button> : null}
                </div>
              ))}
            </div>
          )}
        </Disclosure>
      </section>
      {id ? (
        <section className="rounded-[10px] border border-line bg-white px-6">
          <Disclosure
            title="Related products"
            summary={products.length === 0 ? "None yet" : `${products.length} product${products.length === 1 ? "" : "s"}`}
            open={productsOpen}
            onToggle={() => setProductsOpen((current) => !current)}
          >
            {products.length === 0 ? <p className="text-sm text-slate-600">No products for this vendor yet.</p> : (
              <ul className="space-y-1 text-sm">
                {products.map((product) => (
                  <li key={product.id}><Link className="text-navy-800 underline" to={`/products/${product.id}`}>{product.model_code}</Link></li>
                ))}
              </ul>
            )}
          </Disclosure>
        </section>
      ) : null}
    </form>
  );
}
