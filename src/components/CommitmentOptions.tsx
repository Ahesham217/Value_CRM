import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button, Field, Select, controlClass } from "./ui";
import { errorText } from "../lib/errors";
import { numericInputValue } from "../lib/numeric-input";
import { commitmentHeading } from "../lib/subscription";
import { supabase } from "../lib/supabase";
import type { CurrencyCode, LaterYearRule, ProductCommitmentOption } from "../lib/types";

const RULES: { value: LaterYearRule; label: string }[] = [
  { value: "fixed_annual", label: "Fixed annual price" },
  { value: "vendor_confirmed_base_adjustment", label: "Vendor-confirmed adjustment to the saved base" },
];

export function CommitmentOptions({ productId, canManage }: { productId: string; canManage: boolean }) {
  const [options, setOptions] = useState<ProductCommitmentOption[]>([]);
  const [years, setYears] = useState("1");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [firstYear, setFirstYear] = useState("");
  const [laterBase, setLaterBase] = useState("");
  const [rule, setRule] = useState<LaterYearRule>("vendor_confirmed_base_adjustment");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const duration = Number(years);
  const multiYear = Number.isInteger(duration) && duration > 1;

  async function load() {
    const result = await supabase
      .from("product_commitment_options")
      .select("*")
      .eq("product_id", productId)
      .order("commitment_years");
    if (result.error) throw result.error;
    setOptions((result.data ?? []) as ProductCommitmentOption[]);
  }

  useEffect(() => {
    load().catch((caught) => setError(errorText(caught)));
  }, [productId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (!Number.isInteger(duration) || duration < 1 || duration > 30) {
        throw new Error("Commitment duration must be a whole number of years from 1 to 30.");
      }
      if (!firstYear.trim()) throw new Error("Enter the first-year unit price.");
      const payload = {
        product_id: productId,
        commitment_years: duration,
        currency,
        first_year_unit_price: firstYear.trim(),
        later_year_base_unit_price: multiYear ? laterBase.trim() : null,
        later_year_rule: multiYear ? rule : null,
      };
      if (multiYear && !laterBase.trim()) throw new Error("Enter the later-year base unit price.");
      const { error: insertError } = await supabase.from("product_commitment_options").insert(payload);
      if (insertError) {
        if (insertError.code === "23505") {
          throw new Error(`An active ${currency} commitment for ${duration} ${duration === 1 ? "year" : "years"} already exists. Archive it before adding another.`);
        }
        throw insertError;
      }
      setFirstYear("");
      setLaterBase("");
      setMessage("Commitment saved. It does not change prices already saved on a PI.");
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  async function archive(option: ProductCommitmentOption) {
    setError(null);
    const { error: updateError } = await supabase
      .from("product_commitment_options")
      .update({ archived_at: option.archived_at ? null : new Date().toISOString() })
      .eq("id", option.id);
    if (updateError) {
      setError(errorText(updateError));
      return;
    }
    await load().catch((caught) => setError(errorText(caught)));
  }

  return (
    <section className="rounded-[10px] border border-line bg-white p-6">
      <h2 className="text-[15px] font-semibold text-ink">Subscription commitments</h2>
      <p className="mt-1 text-sm text-slate-600">
        Each active option is one duration and one currency. A PI uses the first-year price for its current total. Later years stay as a commitment and are not converted from another currency. Archive an option instead of deleting it when a draft still uses it.
      </p>
      {error ? <div className="mt-3"><Banner tone="error">{error}</Banner></div> : null}
      {message ? <div className="mt-3"><Banner tone="success">{message}</Banner></div> : null}
      <ul className="mt-4 space-y-2">
        {options.length === 0 ? <li className="text-sm text-slate-600">No commitment options yet.</li> : null}
        {options.map((option) => (
          <li key={option.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
            <span>
              {commitmentHeading(option.commitment_years)} · {option.currency} {numericInputValue(option.first_year_unit_price)} in year 1
              {option.commitment_years > 1 ? ` · later base ${numericInputValue(option.later_year_base_unit_price)}` : ""}
              {option.later_year_rule === "vendor_confirmed_base_adjustment" ? " · vendor-confirmed adjustment, not compounded" : ""}
              {option.later_year_rule === "fixed_annual" ? " · fixed annual price" : ""}
              {option.archived_at ? " · archived" : ""}
            </span>
            {canManage ? (
              <Button type="button" variant="secondary" onClick={() => void archive(option)}>
                {option.archived_at ? "Restore" : "Archive"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Commitment years">
            <input className={controlClass} inputMode="numeric" value={years} onChange={(event) => setYears(event.target.value)} />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
          </Field>
          <Field label="First-year unit price">
            <input className={controlClass} inputMode="decimal" value={firstYear} onChange={(event) => setFirstYear(event.target.value)} />
          </Field>
          {multiYear ? (
            <>
              <Field label="Later-year base unit price">
                <input className={controlClass} inputMode="decimal" value={laterBase} onChange={(event) => setLaterBase(event.target.value)} />
              </Field>
              <Field label="Later-year rule">
                <Select value={rule} onChange={(event) => setRule(event.target.value as LaterYearRule)}>
                  {RULES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </Select>
              </Field>
            </>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={saving}>{saving ? "Saving…" : "Add commitment"}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
