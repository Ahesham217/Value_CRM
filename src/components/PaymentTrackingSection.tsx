import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { errorText } from "../lib/errors";
import { formatDate, formatMoney } from "../lib/format";
import {
  allocationSum,
  cairoToday,
  collectionLabel,
  pendingActivationDate,
  dueScheduleLabel,
  methodLabel,
  suggestAllocation,
  validateAllocation,
  type DatedAmount,
} from "../lib/payment-tracking";
import { supabase } from "../lib/supabase";
import type { PiVersion } from "../lib/types";
import { Banner, Button, Field, Select, TextArea } from "./ui";

type PlanRow = {
  id: string;
  pi_id: string;
  source_version_id: string;
  currency: string;
  agreed_total: string | number;
  schema_version: number;
  started_at: string;
};

type ObligationRow = {
  id: string;
  kind: string;
  label: string;
  amount: string | number;
  paid_amount: string | number;
  outstanding_amount: string | number;
  collection_status: string;
  due_date: string | null;
  due_formula: string;
  due_timing: string;
  awaiting_label: string;
  due_state: string;
  position: number;
  subscription_obligation_id: string | null;
};

type ReceiptRow = {
  id: string;
  amount: string | number;
  currency: string;
  received_on: string;
  method: string;
  reference: string | null;
  note: string | null;
  recorded_at: string;
  recorded_by: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
};

type AllocationRow = {
  receipt_id: string;
  obligation_id: string;
  amount: string | number;
};

type SubscriptionRow = {
  id: string;
  source_obligation_id: string;
  state: string;
  start_date: string;
  product_model: string;
  commitment_years: number;
};

function versionAmount(version: PiVersion): string {
  return version.snapshot.payment?.grand_total ?? version.snapshot.adjustments.grand_total;
}

function versionIsStructured(version: PiVersion): boolean {
  const schema = version.snapshot.payment?.schema_version;
  return schema === 1 || schema === 2;
}

export function PaymentTrackingSection({
  piId,
  versions,
  canManage,
  canReverse,
  canWaive,
}: {
  piId: string;
  versions: PiVersion[];
  canManage: boolean;
  canReverse: boolean;
  canWaive: boolean;
}) {
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [obligations, setObligations] = useState<ObligationRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [versionId, setVersionId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [acceptActivation, setAcceptActivation] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [waiveId, setWaiveId] = useState<string | null>(null);
  const [waiveDate, setWaiveDate] = useState("");
  const [waiveReason, setWaiveReason] = useState("");

  const latest = [...versions].sort((left, right) => right.revision - left.revision)[0] ?? null;
  const selected = versions.find((version) => version.id === versionId) ?? null;
  const tracked = versions.find((version) => version.id === plan?.source_version_id) ?? null;

  async function load() {
    const planResult = await supabase.from("payment_plans").select("*").eq("pi_id", piId).maybeSingle();
    if (planResult.error) throw planResult.error;
    const nextPlan = (planResult.data ?? null) as PlanRow | null;
    setPlan(nextPlan);
    if (!nextPlan) {
      setObligations([]);
      setReceipts([]);
      setAllocations([]);
      setSubscriptions([]);
      return;
    }
    const [obligationResult, receiptResult, subscriptionResult] = await Promise.all([
      supabase.from("payment_obligation_balances").select("*").eq("plan_id", nextPlan.id).order("position"),
      supabase.from("payment_receipts").select("*").eq("plan_id", nextPlan.id).order("received_on").order("recorded_at"),
      supabase.from("subscriptions").select("id, source_obligation_id, state, start_date, product_model, commitment_years").eq("pi_id", piId),
    ]);
    if (obligationResult.error) throw obligationResult.error;
    if (receiptResult.error) throw receiptResult.error;
    if (subscriptionResult.error) throw subscriptionResult.error;
    const nextReceipts = (receiptResult.data ?? []) as ReceiptRow[];
    const receiptIds = nextReceipts.map((receipt) => receipt.id);
    const allocationResult = receiptIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("payment_allocations").select("receipt_id, obligation_id, amount").in("receipt_id", receiptIds);
    if (allocationResult.error) throw allocationResult.error;
    const userIds = [...new Set(nextReceipts.flatMap((receipt) => [receipt.recorded_by, receipt.reversed_by].filter((id): id is string => Boolean(id))))];
    const nameResult = userIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("profiles").select("id, full_name").in("id", userIds);
    if (nameResult.error) throw nameResult.error;
    setObligations((obligationResult.data ?? []) as ObligationRow[]);
    setReceipts(nextReceipts);
    setAllocations((allocationResult.data ?? []) as AllocationRow[]);
    setSubscriptions((subscriptionResult.data ?? []) as SubscriptionRow[]);
    setNames(Object.fromEntries(((nameResult.data ?? []) as { id: string; full_name: string }[]).map((person) => [person.id, person.full_name])));
  }

  useEffect(() => {
    let active = true;
    load().catch((caught) => {
      if (active) setError(errorText(caught));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [piId]);

  useEffect(() => {
    if (!versionId && latest) setVersionId(latest.id);
  }, [latest, versionId]);

  const openObligations = obligations.filter((item) => Number(item.outstanding_amount) > 0);
  const suggestion = useMemo(
    () => suggestAllocation(openObligations.map((item) => ({
      id: item.id,
      outstanding: String(item.outstanding_amount),
      position: item.position,
    })), amount),
    [amount, openObligations],
  );

  useEffect(() => {
    setAllocationAmounts(Object.fromEntries(suggestion.map((item) => [item.obligationId, item.amount])));
    setAcceptActivation(false);
  }, [amount, plan?.id, suggestion.map((item) => `${item.obligationId}:${item.amount}`).join("|")]);

  const currency = plan?.currency ?? selected?.snapshot.currency ?? null;
  const received = receipts.filter((receipt) => !receipt.reversed_at).reduce((sum, receipt) => sum + Number(receipt.amount), 0);
  const agreed = plan ? Number(plan.agreed_total) : 0;
  const outstanding = Math.round((agreed - received) * 100) / 100;

  const activationPreview = useMemo(() => {
    const today = cairoToday();
    return openObligations.flatMap((obligation) => {
      if (obligation.kind !== "subscription_advance" || Number(obligation.amount) <= 0) return [];
      const existing: DatedAmount[] = allocations
        .filter((item) => item.obligation_id === obligation.id)
        .flatMap((item) => {
          const receipt = receipts.find((candidate) => candidate.id === item.receipt_id && !candidate.reversed_at);
          if (!receipt) return [];
          return [{
            id: receipt.id,
            receivedOn: receipt.received_on,
            recordedAt: receipt.recorded_at,
            amount: String(item.amount),
          }];
        });
      const added = allocationAmounts[obligation.id] ?? "";
      const start = pendingActivationDate({
        existing,
        pendingAmount: added,
        required: String(obligation.amount),
        receivedOn,
      });
      if (!start) return [];
      const subscription = subscriptions.find((item) => item.source_obligation_id === obligation.subscription_obligation_id);
      if (subscription) return [];
      return [{ label: obligation.label, start, today }];
    });
  }, [allocationAmounts, allocations, openObligations, receipts, receivedOn, subscriptions]);

  async function startTracking() {
    if (!selected) return;
    setStarting(true);
    setError(null);
    setMessage(null);
    const { error: startError } = await supabase.rpc("start_payment_tracking", {
      p_pi_id: piId,
      p_version_id: selected.id,
      p_confirmed: true,
    });
    setStarting(false);
    if (startError) {
      setError(errorText(startError));
      return;
    }
    setConfirmed(false);
    setMessage("Payment tracking is active for the agreed version.");
    await load().catch((caught) => setError(errorText(caught)));
  }

  async function recordPayment() {
    if (!plan || !currency) return;
    const allocationsToSave = openObligations
      .map((item) => ({ obligationId: item.id, amount: allocationAmounts[item.id] ?? "" }))
      .filter((item) => item.amount.trim() !== "");
    const problem = validateAllocation({
      amount,
      receivedOn,
      today: cairoToday(),
      method,
      obligations: openObligations.map((item) => ({
        id: item.id,
        outstanding: String(item.outstanding_amount),
        position: item.position,
      })),
      allocations: allocationsToSave,
    });
    if (problem) {
      setError(problem);
      return;
    }
    if (activationPreview.length > 0 && !acceptActivation) {
      setError("Confirm the subscription start date before recording this payment.");
      return;
    }
    setRecording(true);
    setError(null);
    const { error: saveError } = await supabase.rpc("record_payment_receipt", {
      p_plan_id: plan.id,
      p_payload: {
        idempotency_key: idempotencyKey,
        amount: amount.trim(),
        received_on: receivedOn,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
        currency,
        allocations: allocationsToSave.map((item) => ({ obligation_id: item.obligationId, amount: item.amount.trim() })),
      },
    });
    setRecording(false);
    if (saveError) {
      setError(errorText(saveError));
      return;
    }
    setRecordOpen(false);
    setAmount("");
    setReference("");
    setNote("");
    setAcceptActivation(false);
    setIdempotencyKey(crypto.randomUUID());
    setMessage("Payment recorded.");
    await load().catch((caught) => setError(errorText(caught)));
  }

  async function reversePayment() {
    if (!reverseId) return;
    setError(null);
    const { error: reverseError } = await supabase.rpc("reverse_payment_receipt", {
      p_receipt_id: reverseId,
      p_reason: reverseReason.trim(),
    });
    if (reverseError) {
      setError(errorText(reverseError));
      return;
    }
    setReverseId(null);
    setReverseReason("");
    setMessage("Payment reversed. The original receipt stays in the history.");
    await load().catch((caught) => setError(errorText(caught)));
  }

  async function waive() {
    if (!waiveId) return;
    setError(null);
    const { error: waiveError } = await supabase.rpc("activate_subscription_at_no_charge", {
      p_obligation_id: waiveId,
      p_start_date: waiveDate,
      p_reason: waiveReason.trim(),
    });
    if (waiveError) {
      setError(errorText(waiveError));
      return;
    }
    setWaiveId(null);
    setWaiveReason("");
    setMessage("Subscription activated at no charge.");
    await load().catch((caught) => setError(errorText(caught)));
  }

  if (loading) return <section className="rounded-[10px] border border-line bg-white p-6 text-sm text-slate-600">Loading payment tracking…</section>;
  if (versions.length === 0) {
    return (
      <section className="rounded-[10px] border border-line bg-white p-6">
        <h2 className="text-[15px] font-semibold text-ink">Payment tracking</h2>
        <p className="mt-2 text-sm text-slate-600">Generate a PI before starting payment tracking. A draft is not a collection plan, and downloading a PI does not start one.</p>
      </section>
    );
  }

  return (
    <section className="rounded-[10px] border border-line bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Payment tracking</h2>
        {plan ? <p className="text-sm text-slate-600">Collection status is separate from the PI status.</p> : null}
      </div>
      {error ? <div className="mt-3"><Banner tone="error">{error}</Banner></div> : null}
      {message ? <div className="mt-3"><Banner tone="success">{message}</Banner></div> : null}

      {!plan ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-700">Choose the issued version the customer agreed. Starting tracking does not mark the PI accepted, and a later revision will not move this plan.</p>
          <Field label="Issued version">
            <Select value={versionId} onChange={(event) => { setVersionId(event.target.value); setConfirmed(false); }}>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.snapshot.display_number} · {formatMoney(versionAmount(version), version.snapshot.currency)}
                </option>
              ))}
            </Select>
          </Field>
          {selected && !versionIsStructured(selected) ? (
            <Banner tone="info">This version uses a payment paragraph. Automatic payment allocation is not available, and the paragraph is not parsed. Download still uses the saved document.</Banner>
          ) : selected ? (
            <p className="text-sm text-ink">
              {selected.snapshot.display_number} · {formatMoney(versionAmount(selected), selected.snapshot.currency)}
              {selected.snapshot.payment?.schema_version === 2 ? " · Subscription charges are separate from one-time payments." : " · This schedule applies to the whole PI."}
            </p>
          ) : null}
          {canManage && selected && versionIsStructured(selected) ? (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input className="mt-0.5" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>This is the version agreed with the customer.</span>
              </label>
              <Button type="button" variant="primary" disabled={!confirmed || starting} onClick={() => void startTracking()}>
                {starting ? "Starting…" : "Start payment tracking"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-600">You can view this PI. Recording payments needs permission to manage payment tracking.</p>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {tracked && latest && tracked.id !== latest.id ? (
            <Banner tone="info">
              Payment tracking follows {tracked.snapshot.display_number} ({formatMoney(plan.agreed_total, currency)}). The latest issued version is {latest.snapshot.display_number}. Tracking stays on the agreed version, and receipts are not moved.
            </Banner>
          ) : null}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">Agreed total</dt><dd className="tabular-nums">{formatMoney(plan.agreed_total, currency)}</dd></div>
            <div><dt className="text-xs text-slate-500">Received</dt><dd className="tabular-nums">{formatMoney(received, currency)}</dd></div>
            <div><dt className="text-xs text-slate-500">Outstanding</dt><dd className="tabular-nums">{formatMoney(outstanding, currency)}</dd></div>
          </dl>
          <p className="text-xs text-slate-500">
            {plan.schema_version === 2
              ? "Schema version 2. Subscription advances are separate from one-time payments. A percentage on a one-time row is not a percentage of the whole PI."
              : "Schema version 1. These obligations are the whole PI. They are not split into a subscription advance."}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Obligation</th>
                  <th className="py-1 pr-3 text-right font-medium">Agreed</th>
                  <th className="py-1 pr-3 text-right font-medium">Outstanding</th>
                  <th className="py-1 pr-3 font-medium">Payment</th>
                  <th className="py-1 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((obligation) => {
                  const due = dueScheduleLabel({
                    dueTiming: obligation.due_timing,
                    dueDate: obligation.due_date,
                    awaitingLabel: obligation.awaiting_label,
                    dueFormula: obligation.due_formula,
                    dueState: obligation.due_state,
                  });
                  const linked = subscriptions.find((item) => item.source_obligation_id === obligation.subscription_obligation_id);
                  return (
                    <tr key={obligation.id} className="border-t border-slate-100">
                      <td className="py-2 pr-3">
                        {obligation.label}
                        {linked ? <Link className="mt-1 block text-xs text-primary underline" to={`/subscriptions/${linked.id}`}>{linked.state === "payment_review_required" ? "Payment review required" : "Subscription"}</Link> : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(obligation.amount, currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(obligation.outstanding_amount, currency)}</td>
                      <td className="py-2 pr-3">{collectionLabel(obligation.collection_status)}</td>
                      <td className="py-2">
                        {obligation.due_date ? formatDate(obligation.due_date) : due.schedule}
                        {due.timing ? <span className="ml-2 text-xs text-slate-500">{due.timing}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canWaive ? obligations.filter((item) => item.kind === "subscription_advance" && Number(item.amount) === 0 && !subscriptions.some((subscription) => subscription.source_obligation_id === item.subscription_obligation_id)).map((item) => (
            <div key={item.id} className="rounded-md border border-line p-3 text-sm">
              <p>{item.label} has no amount due. It is not activated automatically.</p>
              {waiveId === item.id ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Start date">
                    <input className="h-10 w-full rounded-md border border-line px-3 text-sm" type="date" value={waiveDate} onChange={(event) => setWaiveDate(event.target.value)} />
                  </Field>
                  <Field label="Reason">
                    <TextArea rows={2} value={waiveReason} onChange={(event) => setWaiveReason(event.target.value)} />
                  </Field>
                  <Button type="button" variant="primary" onClick={() => void waive()}>Activate at no charge</Button>
                </div>
              ) : (
                <Button className="mt-3" type="button" variant="secondary" onClick={() => { setWaiveId(item.id); setWaiveDate(cairoToday()); }}>Activate at no charge</Button>
              )}
            </div>
          )) : null}

          {canManage && outstanding > 0 ? (
            <div>
              {recordOpen ? (
                <div className="rounded-md border border-line p-3">
                  <h3 className="text-sm font-medium text-ink">Record payment</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Amount received" hint={currency ? `Recorded in ${currency}. There is no currency conversion.` : undefined}>
                      <input className="h-10 w-full rounded-md border border-line px-3 text-sm tabular-nums" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
                    </Field>
                    <Field label="Date received">
                      <input className="h-10 w-full rounded-md border border-line px-3 text-sm" type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
                    </Field>
                    <Field label="Method">
                      <Select value={method} onChange={(event) => setMethod(event.target.value)}>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    <Field label="Reference" hint="Optional. The same reference can be used more than once.">
                      <input className="h-10 w-full rounded-md border border-line px-3 text-sm" value={reference} onChange={(event) => setReference(event.target.value)} />
                    </Field>
                    <Field className="sm:col-span-2" label="Internal note" hint="Optional.">
                      <TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
                    </Field>
                  </div>
                  <p className="mt-3 text-sm text-slate-700">Suggested allocation, in document order. Change any amount before recording. Nothing is allocated until you record the payment.</p>
                  <div className="mt-2 space-y-2">
                    {openObligations.map((obligation) => (
                      <label key={obligation.id} className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center">
                        <span>{obligation.label} · unpaid {formatMoney(obligation.outstanding_amount, currency)}</span>
                        <input
                          className="h-10 rounded-md border border-line px-3 text-sm tabular-nums"
                          inputMode="decimal"
                          aria-label={`Allocation to ${obligation.label}`}
                          value={allocationAmounts[obligation.id] ?? ""}
                          onChange={(event) => setAllocationAmounts((current) => ({ ...current, [obligation.id]: event.target.value }))}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Allocated {currency ? formatMoney(allocationSum(Object.values(allocationAmounts).filter(Boolean).map((value) => ({ amount: value }))), currency) : allocationSum(Object.values(allocationAmounts).filter(Boolean).map((value) => ({ amount: value })))}.</p>
                  {activationPreview.map((item) => (
                    <p key={item.label} className="mt-2 text-sm text-ink">Recording this payment activates {item.label} on {formatDate(item.start)}. That date is the received date on which the Year 1 obligation is fully paid.</p>
                  ))}
                  {activationPreview.length > 0 ? (
                    <label className="mt-2 flex items-start gap-2 text-sm">
                      <input className="mt-0.5" type="checkbox" checked={acceptActivation} onChange={(event) => setAcceptActivation(event.target.checked)} />
                      <span>Activate on {activationPreview.map((item) => formatDate(item.start)).join(", ")}.</span>
                    </label>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="primary" disabled={recording} onClick={() => void recordPayment()}>{recording ? "Recording…" : "Record payment"}</Button>
                    <Button type="button" variant="secondary" onClick={() => setRecordOpen(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="primary" onClick={() => { setRecordOpen(true); setReceivedOn(cairoToday()); setIdempotencyKey(crypto.randomUUID()); }}>Record payment</Button>
              )}
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-medium text-ink">Payment history</h3>
            {receipts.length === 0 ? <p className="mt-1 text-sm text-slate-600">No payments recorded.</p> : (
              <ul className="mt-2 divide-y divide-slate-100">
                {receipts.map((receipt) => {
                  const receiptAllocations = allocations.filter((item) => item.receipt_id === receipt.id);
                  return (
                    <li key={receipt.id} className="py-2 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className={receipt.reversed_at ? "text-slate-500 line-through" : "text-ink"}>
                          {formatDate(receipt.received_on)} · {formatMoney(receipt.amount, receipt.currency)} · {methodLabel(receipt.method)}
                          {receipt.reference ? ` · ${receipt.reference}` : ""}
                        </p>
                        <p className="text-xs text-slate-500">Recorded by {names[receipt.recorded_by] || "staff"}</p>
                      </div>
                      <p className="text-xs text-slate-600">
                        {receiptAllocations.map((item) => {
                          const obligation = obligations.find((candidate) => candidate.id === item.obligation_id);
                          return `${obligation?.label ?? "Obligation"} ${formatMoney(item.amount, receipt.currency)}`;
                        }).join(" · ")}
                      </p>
                      {receipt.note ? <p className="text-xs text-slate-600">{receipt.note}</p> : null}
                      {receipt.reversed_at ? (
                        <p className="text-xs text-slate-600">Reversed {formatDate(receipt.reversed_at)} by {names[receipt.reversed_by ?? ""] || "staff"}. {receipt.reversal_reason}</p>
                      ) : canReverse ? (
                        reverseId === receipt.id ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <TextArea rows={2} value={reverseReason} placeholder="Reason for reversing this payment" onChange={(event) => setReverseReason(event.target.value)} />
                            <Button type="button" variant="danger" onClick={() => void reversePayment()}>Reverse payment</Button>
                          </div>
                        ) : (
                          <button type="button" className="mt-1 text-xs text-red-800 underline" onClick={() => { setReverseId(receipt.id); setReverseReason(""); }}>Reverse payment</button>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
