import { useEffect, useRef, useState, type FormEvent } from "react";
import { createCatalogueProduct, listActiveVendors, lookupCatalogue, type CatalogueProduct } from "../lib/catalogue";
import { errorText } from "../lib/errors";
import { NONNEGATIVE_DECIMAL } from "../lib/model-identity";
import { archiveRow } from "../lib/records";
import type { CurrencyCode, Vendor } from "../lib/types";
import { Button, Field, Modal, TextArea, controlClass } from "./ui";

export function CreateCatalogueProduct({
  initialModel,
  currency,
  onCancel,
  onSelected,
}: {
  initialModel: string;
  currency: CurrencyCode | null;
  onCancel: () => void;
  onSelected: (product: CatalogueProduct, notice: string) => void;
}) {
  const lock = useRef(false);
  const [model, setModel] = useState(initialModel);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("unit");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState<CatalogueProduct | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(true);

  function refreshVendors() {
    setLoadingVendors(true);
    listActiveVendors()
      .then((rows) => {
        setVendors(rows);
        setError(null);
      })
      .catch((caught) => setError(errorText(caught)))
      .finally(() => setLoadingVendors(false));
  }

  useEffect(() => {
    refreshVendors();
  }, []);

  const selectedVendor = vendors.find((vendor) => vendor.id === vendorId) ?? null;
  const filteredVendors = vendors.filter((vendor) => vendor.company_name.toLowerCase().includes(vendorQuery.trim().toLowerCase())).slice(0, 20);

  async function selectExisting(product: CatalogueProduct, notice: string) {
    onSelected(product, notice);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const modelName = model.trim();
    if (!modelName) {
      setError("Model is required.");
      return;
    }
    if (!vendorId || !selectedVendor) {
      setError("Choose a vendor.");
      return;
    }
    if (!unit.trim()) {
      setError("Unit is required.");
      return;
    }
    const trimmedPrice = price.trim();
    if (trimmedPrice && !NONNEGATIVE_DECIMAL.test(trimmedPrice)) {
      setError("Default selling price must be a nonnegative number, or left blank.");
      return;
    }
    if (trimmedPrice && !currency) {
      setError("Choose an office and currency on the PI before saving a default price.");
      return;
    }
    lock.current = true;
    setSaving(true);
    setError(null);
    setArchived(null);
    try {
      const result = await createCatalogueProduct({
        model: modelName,
        vendorId,
        vendorName: selectedVendor.company_name,
        description,
        unit,
        currency,
        price: trimmedPrice ? trimmedPrice : null,
      });
      if (result.outcome === "missing") {
        setError("That model already exists, but it could not be loaded. Search for it on the line.");
        lock.current = false;
        return;
      }
      if (result.outcome === "exists") {
        if (result.product.archived_at) {
          setArchived(result.product);
          setError(`Model ‘${result.product.model_code}’ is archived. Restore it to use the existing product. Its catalogue details were not changed.`);
          lock.current = false;
          return;
        }
        await selectExisting(
          result.product,
          `Model ‘${result.product.model_code}’ already exists. The existing product was selected and its catalogue details were not changed.`,
        );
        return;
      }
      await selectExisting(result.product, `Product ‘${result.product.model_code}’ was added to the catalogue and selected.`);
    } catch (caught) {
      setError(errorText(caught));
      lock.current = false;
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    if (!archived || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await archiveRow("products", archived.id, false);
      const fresh = await lookupCatalogue(archived.model_code);
      const product = fresh ?? { ...archived, archived_at: null };
      await selectExisting(
        product,
        `Restored ‘${product.model_code}’ and selected it. Catalogue details were not changed.`,
      );
    } catch (caught) {
      setError(errorText(caught));
      lock.current = false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New catalogue product" onClose={onCancel}>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p> : null}
        <Field label="Model">
          <input className={controlClass} required value={model} onChange={(event) => setModel(event.target.value)} autoFocus />
        </Field>
        <div className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Vendor</span>
          <input
            className={controlClass}
            value={vendorQuery}
            placeholder={selectedVendor ? selectedVendor.company_name : "Search active vendors"}
            onChange={(event) => setVendorQuery(event.target.value)}
            aria-label="Search vendors"
          />
          <div className="mt-2 max-h-36 overflow-auto rounded-md border border-slate-200">
            {loadingVendors ? <p className="px-3 py-2 text-slate-500">Loading vendors…</p> : null}
            {!loadingVendors && filteredVendors.length === 0 ? <p className="px-3 py-2 text-slate-500">No active vendors match.</p> : null}
            {filteredVendors.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                className={`block w-full px-3 py-2 text-left ${vendor.id === vendorId ? "bg-navy-100 font-medium" : "hover:bg-slate-50"}`}
                onClick={() => {
                  setVendorId(vendor.id);
                  setVendorQuery("");
                }}
              >
                {vendor.company_name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-slate-600">
            {selectedVendor ? `Selected vendor: ${selectedVendor.company_name}. ` : "A vendor is required. "}
            <a className="text-navy-800 underline" href="/vendors/new" target="_blank" rel="noreferrer">Add a vendor</a>
            {" · "}
            <button type="button" className="text-navy-800 underline" onClick={refreshVendors}>Refresh list</button>
          </p>
        </div>
        <Field label="Description">
          <TextArea value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Unit">
          <input className={controlClass} required list="pi-new-product-units" value={unit} onChange={(event) => setUnit(event.target.value)} />
          <datalist id="pi-new-product-units">
            <option value="unit" />
            <option value="set" />
            <option value="license" />
            <option value="service" />
          </datalist>
        </Field>
        <Field
          label={currency ? `Default selling price (${currency})` : "Default selling price"}
          hint={currency ? "Optional. Applies only to this currency. Blank means unknown, and zero stays zero." : "Choose an office and currency on the PI to store a default price."}
        >
          <input className={controlClass} inputMode="decimal" disabled={!currency} value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {archived ? (
            <Button type="button" variant="primary" disabled={saving} onClick={() => void restore()}>
              {saving ? "Working…" : "Restore product"}
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Create product"}
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
