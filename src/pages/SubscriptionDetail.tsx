import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Banner } from "../components/ui";
import { errorText } from "../lib/errors";
import { formatDate, formatMoney, formatQuantity } from "../lib/format";
import { methodLabel, nextCommittedPaymentDate, cairoToday } from "../lib/payment-tracking";
import { supabase } from "../lib/supabase";

type Period = { year: number; starts_on: string; ends_on: string };

type SubscriptionRecord = {
  id: string;
  client_id: string | null;
  client_name: string;
  client_link_matches_snapshot: boolean;
  product_id: string | null;
  product_model: string;
  product_description: string;
  vendor_identity: string;
  quantity: string | number;
  currency: string;
  pi_id: string;
  source_version_id: string;
  source_obligation_id: string;
  payment_obligation_id: string;
  commitment_years: number;
  first_year_negotiated_unit_price: string | number;
  later_year_base_unit_price: string | number | null;
  later_year_rule: string | null;
  adjustment_compounds: boolean;
  start_date: string;
  commitment_end_date: string;
  annual_periods: Period[];
  activation_kind: string;
  no_charge_reason: string | null;
  state: string;
  agreement: { subscription?: { customer_text?: string } };
};

type ObligationBalance = {
  label: string;
  amount: string | number;
  paid_amount: string | number;
  outstanding_amount: string | number;
  collection_status: string;
};

type ReceiptLine = {
  id: string;
  received_on: string;
  amount: string | number;
  method: string;
  reference: string | null;
  allocated: string | number;
  reversed_at: string | null;
  reversal_reason: string | null;
};

function ruleText(rule: string | null, years: number): string {
  if (years <= 1 || rule == null) return "This is a one-year commitment. There is no committed later year.";
  if (rule === "fixed_annual") return "Later years use the saved base as a fixed annual price. Each year is calculated from that base, not from the previous year's price.";
  if (rule === "vendor_confirmed_base_adjustment") return "Later years use the saved base plus that year's vendor-confirmed adjustment. Adjustments do not compound.";
  return "The later-year rule was not recorded.";
}

export function SubscriptionDetailPage() {
  const { id } = useParams();
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [obligation, setObligation] = useState<ObligationBalance | null>(null);
  const [receipts, setReceipts] = useState<ReceiptLine[]>([]);
  const [versionLabel, setVersionLabel] = useState("");
  const [currentVendor, setCurrentVendor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    supabase.from("subscriptions").select("*").eq("id", id).maybeSingle().then(async ({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) {
        setError(errorText(loadError));
        setLoading(false);
        return;
      }
      if (!data) {
        setSubscription(null);
        setLoading(false);
        return;
      }
      const row = data as SubscriptionRecord;
      const [balanceResult, versionResult, vendorResult] = await Promise.all([
        supabase.from("payment_obligation_balances").select("label, amount, paid_amount, outstanding_amount, collection_status").eq("id", row.payment_obligation_id).maybeSingle(),
        supabase.from("pi_versions").select("pi_number, revision").eq("id", row.source_version_id).maybeSingle(),
        row.product_id
          ? supabase.from("products").select("vendors(company_name)").eq("id", row.product_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (!active) return;
      if (balanceResult.error) setError(errorText(balanceResult.error));
      const version = versionResult.data as { pi_number: string; revision: number } | null;
      setVersionLabel(version ? (version.revision > 0 ? `${version.pi_number}-R${version.revision}` : version.pi_number) : "Issued version");
      const vendorJoin = vendorResult.data as { vendors?: { company_name?: string } | { company_name?: string }[] | null } | null;
      const vendorRecord = Array.isArray(vendorJoin?.vendors) ? vendorJoin?.vendors[0] : vendorJoin?.vendors;
      setCurrentVendor(vendorRecord?.company_name ?? null);
      setObligation((balanceResult.data ?? null) as ObligationBalance | null);
      const allocationResult = await supabase.from("payment_allocations").select("amount, payment_receipts(id, received_on, amount, method, reference, reversed_at, reversal_reason)").eq("obligation_id", row.payment_obligation_id);
      if (!active) return;
      if (allocationResult.error) setError(errorText(allocationResult.error));
      const lines: ReceiptLine[] = ((allocationResult.data ?? []) as {
        amount: string | number;
        payment_receipts: {
          id: string;
          received_on: string;
          amount: string | number;
          method: string;
          reference: string | null;
          reversed_at: string | null;
          reversal_reason: string | null;
        } | {
          id: string;
          received_on: string;
          amount: string | number;
          method: string;
          reference: string | null;
          reversed_at: string | null;
          reversal_reason: string | null;
        }[] | null;
      }[]).flatMap((item) => {
        const receipt = Array.isArray(item.payment_receipts) ? item.payment_receipts[0] : item.payment_receipts;
        if (!receipt) return [];
        return [{
          id: receipt.id,
          received_on: receipt.received_on,
          amount: receipt.amount,
          method: receipt.method,
          reference: receipt.reference,
          allocated: item.amount,
          reversed_at: receipt.reversed_at,
          reversal_reason: receipt.reversal_reason,
        }];
      });
      lines.sort((left, right) => left.received_on.localeCompare(right.received_on) || left.id.localeCompare(right.id));
      setReceipts(lines);
      setSubscription(row);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <p className="text-sm text-slate-600">Loading subscription…</p>;
  if (!subscription) return <p className="text-sm text-slate-700">This subscription was not found, or you do not have access to it.</p>;

  const nextPayment = nextCommittedPaymentDate(subscription.start_date, subscription.commitment_years, cairoToday());
  const periods = Array.isArray(subscription.annual_periods) ? subscription.annual_periods : [];
  const customerText = subscription.agreement?.subscription?.customer_text;

  return (
    <div className="space-y-3">
      <div>
        <Link to="/subscriptions" className="text-sm font-medium text-navy-800 underline">Back to subscriptions</Link>
        <h1 className="mt-1 text-[26px] font-semibold leading-8 tracking-tight text-ink">{subscription.product_model}</h1>
        <p className="mt-1 text-sm text-slate-700">{subscription.client_name}</p>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {subscription.state === "payment_review_required" ? (
        <Banner tone="info">
          Payment review required. The first-year obligation is no longer fully paid
          {obligation ? ` (${formatMoney(obligation.outstanding_amount, subscription.currency)} outstanding)` : ""}.
          The subscription and its start date have not been removed.
        </Banner>
      ) : null}
      <section className="rounded-[10px] border border-line bg-white p-6">
        <h2 className="text-[15px] font-semibold text-ink">Saved agreement</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-xs text-slate-500">Client</dt><dd>{subscription.client_link_matches_snapshot && subscription.client_id ? <Link className="underline" to={`/clients/${subscription.client_id}`}>{subscription.client_name}</Link> : subscription.client_name}</dd></div>
          <div><dt className="text-xs text-slate-500">Product</dt><dd>{subscription.product_model}</dd></div>
          <div><dt className="text-xs text-slate-500">Description</dt><dd>{subscription.product_description || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Quantity</dt><dd>{formatQuantity(subscription.quantity)}</dd></div>
          <div><dt className="text-xs text-slate-500">Commitment</dt><dd>{subscription.commitment_years === 1 ? "1 year" : `${subscription.commitment_years} years`}</dd></div>
          <div><dt className="text-xs text-slate-500">Year 1 unit price</dt><dd className="tabular-nums">{formatMoney(subscription.first_year_negotiated_unit_price, subscription.currency)}</dd></div>
          <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-slate-500">Source PI</dt><dd><Link className="underline" to={`/pis/${subscription.pi_id}`}>{versionLabel}</Link></dd></div>
        </dl>
        {customerText ? <p className="mt-3 text-sm text-slate-700">{customerText}</p> : null}
        <p className="mt-3 text-sm text-slate-700">{ruleText(subscription.later_year_rule, subscription.commitment_years)}</p>
        {subscription.adjustment_compounds ? null : <p className="mt-1 text-xs text-slate-500">Later-year adjustments do not compound.</p>}
        <p className="mt-3 text-sm text-slate-700">
          {subscription.vendor_identity === "unavailable"
            ? "The issued agreement did not record a vendor, so no historical vendor is shown."
            : "Vendor saved on the issued agreement."}
        </p>
        {currentVendor ? <p className="mt-1 text-xs text-slate-500">Current catalogue vendor: {currentVendor}. This is the vendor on the product record today, not a vendor saved from the issued PI.</p> : null}
        {subscription.activation_kind === "no_charge" ? <p className="mt-3 text-sm text-slate-700">Activated at no charge. {subscription.no_charge_reason}</p> : null}
      </section>
      <section className="rounded-[10px] border border-line bg-white p-6">
        <h2 className="text-[15px] font-semibold text-ink">First-year payment</h2>
        {obligation ? (
          <p className="mt-2 text-sm text-slate-700">
            {obligation.label}: agreed {formatMoney(obligation.amount, subscription.currency)}, received {formatMoney(obligation.paid_amount, subscription.currency)}, outstanding {formatMoney(obligation.outstanding_amount, subscription.currency)}.
          </p>
        ) : <p className="mt-2 text-sm text-slate-600">The payment obligation is not available.</p>}
        {receipts.length === 0 ? <p className="mt-2 text-sm text-slate-600">No receipts are allocated to this obligation.</p> : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="py-2">
                <span className={receipt.reversed_at ? "text-slate-500 line-through" : ""}>
                  {formatDate(receipt.received_on)} · allocated {formatMoney(receipt.allocated, subscription.currency)} of {formatMoney(receipt.amount, subscription.currency)} · {methodLabel(receipt.method)}
                  {receipt.reference ? ` · ${receipt.reference}` : ""}
                </span>
                {receipt.reversed_at ? <span className="mt-1 block text-xs text-slate-600">Reversed. {receipt.reversal_reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-[10px] border border-line bg-white p-6">
        <h2 className="text-[15px] font-semibold text-ink">Annual timeline</h2>
        <p className="mt-2 text-sm text-slate-700">
          Started {formatDate(subscription.start_date)}. The commitment ends {formatDate(subscription.commitment_end_date)}, which is not itself a payment date.
          {nextPayment ? ` Next committed annual payment: ${formatDate(nextPayment)}.` : " There is no further committed annual payment."}
        </p>
        <p className="mt-1 text-xs text-slate-500">A late receipt does not move these dates. Passing a date does not mark a later year paid.</p>
        <ul className="mt-3 space-y-2 text-sm">
          {periods.map((period) => (
            <li key={period.year} className="rounded-md border border-line px-3 py-2">
              <p className="font-medium text-ink">Year {period.year} · {formatDate(period.starts_on)} to {formatDate(period.ends_on)}</p>
              <p className="mt-1 text-slate-700">
                {period.year === 1
                  ? "Included in the source PI. The payment obligation above is the amount for this year."
                  : subscription.later_year_rule === "fixed_annual"
                    ? `Agreed later-year price ${formatMoney(subscription.later_year_base_unit_price, subscription.currency)} per unit. Not an amount due until a renewal PI exists.`
                    : "Price pending vendor confirmation. Not an amount due. The saved base is not a confirmed charge."}
              </p>
              {period.year > 1 && subscription.later_year_rule === "vendor_confirmed_base_adjustment" ? (
                <p className="mt-1 text-xs text-slate-500">Saved base {formatMoney(subscription.later_year_base_unit_price, subscription.currency)} per unit, before the vendor confirms the adjustment. This base is not the amount due.</p>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-700">
          Renewal invoicing and reminders are not implemented yet. A later phase is planned to remind staff one calendar month before the next committed year, confirm the vendor price, and issue a renewal PI for that year only. None of that happens automatically now.
        </p>
      </section>
    </div>
  );
}
