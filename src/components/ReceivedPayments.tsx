import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { errorText, isConflict } from "../lib/errors";
import { can } from "../lib/permissions";
import { formatDate, formatMoney } from "../lib/format";
import { methodLabel } from "../lib/payment-tracking";
import {
  RECEIVED_FILTERS,
  RECEIVED_FILTER_LABELS,
  compactReviewLabel,
  defaultReceivedFilter,
  formatReviewedAt,
  latestVerification,
  parseReceivedLocation,
  readReceiptReview,
  readReceivedRegister,
  receivedRangeMessage,
  reviewEventText,
  reviewStatusLabel,
  validateReviewAction,
  verificationCount,
  withReceivedLocation,
  type ReceiptReviewDetail,
  type ReceivedLocation,
  type ReceivedRegister,
  type ReviewAction,
} from "../lib/payment-review";
import { PAGE_SIZE, sanitizeSearch } from "../lib/records";
import { paymentTrackingPath, withListChange } from "../lib/reporting";
import { supabase } from "../lib/supabase";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "../lib/useDebouncedValue";
import { Banner, Button, EmptyState, Field, LoadingNote, Pagination, SearchField, Segmented, Select, TextArea, controlClass, linkClass, segmentItemClass, tableWrapClass, tdClass, thClass, theadClass } from "./ui";

type Draft = {
  reference: string;
  note: string;
  clarify: string;
  reopen: string;
};

const emptyDraft = (): Draft => ({ reference: "", note: "", clarify: "", reopen: "" });

function draftFromDetail(detail: ReceiptReviewDetail): Draft {
  return {
    reference: detail.review.internalReference ?? "",
    note: detail.review.status === "verified" ? (detail.review.note ?? "") : "",
    clarify: detail.review.status === "needs_clarification" ? (detail.review.note ?? "") : "",
    reopen: "",
  };
}

export function ReceivedPayments() {
  const { profile } = useAuth();
  const canReview = can(profile, "can_review_payments");
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const location = parseReceivedLocation(params, canReview);
  const [searchText, setSearchText] = useState(location.search);
  const debouncedSearch = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  const searchTyped = useRef(false);
  const publishedSearch = useRef<string | null>(null);
  const [register, setRegister] = useState<ReceivedRegister | null>(null);
  const [detail, setDetail] = useState<ReceiptReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listToken, setListToken] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const draftReceipt = useRef("");
  const submission = useRef<{
    key: string;
    receiptId: string;
    action: ReviewAction;
    reference: string;
    note: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const receiptRef = useRef(location.receiptId);
  const detailTicket = useRef(0);
  receiptRef.current = location.receiptId;
  const rangeMessage = receivedRangeMessage(location.receivedFrom, location.receivedTo);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function stillCurrent(receiptId: string, ticket: number) {
    return mountedRef.current && receiptRef.current === receiptId && detailTicket.current === ticket;
  }

  function submissionKeyFor(receiptId: string, action: ReviewAction, reference: string, note: string) {
    const normalizedReference = reference.trim();
    const normalizedNote = note.trim();
    const current = submission.current;
    if (
      current
      && current.receiptId === receiptId
      && current.action === action
      && current.reference === normalizedReference
      && current.note === normalizedNote
    ) {
      return current.key;
    }
    const key = crypto.randomUUID();
    submission.current = { key, receiptId, action, reference: normalizedReference, note: normalizedNote };
    return key;
  }

  useEffect(() => {
    const requested = params.get("review");
    if (requested && (RECEIVED_FILTERS as readonly string[]).includes(requested)) return;
    const current = parseReceivedLocation(params, canReview);
    setParams(withReceivedLocation(params, { ...current, status: defaultReceivedFilter(canReview) }), { replace: true });
  }, [canReview, params, setParams]);

  useEffect(() => {
    if (publishedSearch.current !== null && publishedSearch.current === location.search) {
      publishedSearch.current = null;
      return;
    }
    publishedSearch.current = null;
    searchTyped.current = false;
    setSearchText(location.search);
  }, [location.search]);

  useEffect(() => {
    if (!searchTyped.current) return;
    if (debouncedSearch !== searchText) return;
    if (debouncedSearch === location.search) return;
    publishedSearch.current = debouncedSearch;
    searchTyped.current = false;
    update({ search: debouncedSearch });
    // Only a search typed by the person is published. Reset and history cancel it first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, location.search, searchText]);

  function update(patch: Partial<ReceivedLocation>) {
    const keys = Object.keys(patch) as (keyof ReceivedLocation)[];
    const keepsPage = keys.every((key) => key === "receiptId" || key === "page");
    const next = keepsPage ? { ...location, ...patch } : withListChange(location, patch);
    setParams(withReceivedLocation(params, next));
  }

  useEffect(() => {
    if (rangeMessage) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    supabase.rpc("received_payment_register", {
      p_status: location.status,
      p_search: sanitizeSearch(location.search) || null,
      p_currency: location.currency || null,
      p_received_from: location.receivedFrom || null,
      p_received_to: location.receivedTo || null,
      p_limit: PAGE_SIZE,
      p_offset: (location.page - 1) * PAGE_SIZE,
    }).then(({ data, error: queryError }) => {
      if (!active) return;
      if (queryError) {
        setError(errorText(queryError));
        setLoading(false);
        return;
      }
      try {
        const next = readReceivedRegister(data);
        setRegister(next);
        setError(null);
        const pageCount = Math.max(1, Math.ceil(next.count / PAGE_SIZE));
        if (location.page > pageCount) {
          setParams(withReceivedLocation(params, { ...location, page: pageCount }), { replace: true });
        }
      } catch (caught) {
        setError(errorText(caught));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [listToken, location.currency, location.page, location.receivedFrom, location.receivedTo, location.search, location.status, params, query, rangeMessage, setParams]);

  useEffect(() => {
    const receiptId = location.receiptId;
    const ticket = ++detailTicket.current;
    if (!receiptId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setSaving(false);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setSaving(false);
    supabase.rpc("received_payment_detail", { p_receipt_id: receiptId }).then(({ data, error: queryError }) => {
      if (!active || !stillCurrent(receiptId, ticket)) return;
      if (queryError) {
        setDetailError(errorText(queryError));
        setDetailLoading(false);
        return;
      }
      try {
        const next = readReceiptReview(data);
        setDetail(next);
        setDetailError(null);
        if (draftReceipt.current !== next.receipt.id) {
          draftReceipt.current = next.receipt.id;
          setDraft(draftFromDetail(next));
          setFormError(null);
          setConflict(false);
          setMessage(null);
        }
      } catch (caught) {
        setDetailError(errorText(caught));
      }
      setDetailLoading(false);
    });
    return () => {
      active = false;
    };
  }, [location.receiptId]);

  async function reloadDetail() {
    const receiptId = receiptRef.current;
    if (!receiptId) return;
    const ticket = ++detailTicket.current;
    setDetailLoading(true);
    const { data, error: queryError } = await supabase.rpc("received_payment_detail", { p_receipt_id: receiptId });
    if (!stillCurrent(receiptId, ticket)) return;
    setDetailLoading(false);
    if (queryError) {
      setDetailError(errorText(queryError));
      return;
    }
    try {
      const next = readReceiptReview(data);
      setDetail(next);
      setDetailError(null);
      setConflict(false);
      setMessage("The receipt was reloaded. The saved review is shown below.");
    } catch (caught) {
      setDetailError(errorText(caught));
    }
  }

  async function submit(action: ReviewAction) {
    if (!detail || saving) return;
    const receiptId = detail.receipt.id;
    const ticket = detailTicket.current;
    const note = action === "verify" ? draft.note : action === "clarify" ? draft.clarify : draft.reopen;
    const reference = action === "verify" ? draft.reference : (detail.review.internalReference ?? "");
    const problem = validateReviewAction(action, { internalReference: reference, note });
    if (problem) {
      setFormError(problem);
      setMessage(null);
      return;
    }
    const idempotencyKey = submissionKeyFor(receiptId, action, reference, note);
    setSaving(true);
    setFormError(null);
    setMessage(null);
    let data: unknown;
    let saveError: { message?: string } | null = null;
    try {
      const result = await supabase.rpc("review_payment_receipt", {
        p_receipt_id: receiptId,
        p_action: action,
        p_expected_version: detail.review.version,
        p_payload: {
          internal_reference: reference.trim(),
          note: note.trim(),
          idempotency_key: idempotencyKey,
        },
      });
      data = result.data;
      saveError = result.error;
    } catch (caught) {
      saveError = { message: errorText(caught) };
    }
    if (!mountedRef.current) return;
    if (!stillCurrent(receiptId, ticket)) {
      if (!saveError) setListToken((value) => value + 1);
      return;
    }
    setSaving(false);
    if (saveError) {
      setFormError(errorText(saveError));
      setConflict(isConflict(saveError));
      return;
    }
    try {
      const next = readReceiptReview(data);
      setDetail(next);
      setConflict(false);
      setDraft(draftFromDetail(next));
      draftReceipt.current = next.receipt.id;
      setMessage(successMessage(action));
      setListToken((value) => value + 1);
    } catch (caught) {
      setFormError(errorText(caught));
    }
  }

  const pageCount = Math.max(1, Math.ceil((register?.count ?? 0) / PAGE_SIZE));
  const filtersChanged = location.status !== defaultReceivedFilter(canReview)
    || location.search !== ""
    || location.currency !== ""
    || location.receivedFrom !== ""
    || location.receivedTo !== "";

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-secondary">
        Each row is one receipt already recorded on a PI. Finance review checks that receipt and stores an internal reference. It does not record the money again and does not change the outstanding balance.
      </p>
      <div className="mb-4 overflow-x-auto">
        <Segmented label="Review status">
          {RECEIVED_FILTERS.map((status) => {
            const href = `/payments?${withReceivedLocation(params, withListChange(location, { status })).toString()}`;
            const selected = location.status === status;
            return (
              <Link key={status} className={segmentItemClass(selected)} to={href} aria-current={selected ? "page" : undefined}>
                {RECEIVED_FILTER_LABELS[status]}
              </Link>
            );
          })}
        </Segmented>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SearchField
          label="Search PI, client, or reference"
          placeholder="PI, client, bank reference, or finance reference"
          value={searchText}
          onChange={(event) => {
            searchTyped.current = true;
            setSearchText(event.target.value);
          }}
        />
        <label className="w-40 shrink-0">
          <span className="sr-only">Receipt currency</span>
          <Select aria-label="Receipt currency" value={location.currency} onChange={(event) => update({ currency: event.target.value as ReceivedLocation["currency"] })}>
            <option value="">All currencies</option>
            <option>EGP</option>
            <option>USD</option>
            <option>EUR</option>
          </Select>
        </label>
        <Field label="Received from">
          <input className={controlClass} type="date" value={location.receivedFrom} onChange={(event) => update({ receivedFrom: event.target.value })} />
        </Field>
        <Field label="Received to">
          <input className={controlClass} type="date" value={location.receivedTo} onChange={(event) => update({ receivedTo: event.target.value })} />
        </Field>
      </div>
      {rangeMessage ? <p className="mb-3 text-sm text-danger" role="alert">{rangeMessage}</p> : null}
      {filtersChanged ? (
        <div className="mb-3">
          <button
            type="button"
            className="text-sm font-medium text-primary hover:text-primary-hover"
            onClick={() => {
              searchTyped.current = false;
              publishedSearch.current = null;
              update({
                status: defaultReceivedFilter(canReview),
                search: "",
                currency: "",
                receivedFrom: "",
                receivedTo: "",
                page: 1,
              });
            }}
          >
            Reset filters
          </button>
        </div>
      ) : null}
      {error ? <p className="mb-3 text-sm text-danger" role="alert">{register ? `The receipt list could not be refreshed. ${error}` : error}</p> : null}
      {loading ? <LoadingNote>Loading received payments…</LoadingNote> : null}
      {register ? (
        <p className="mb-2 text-sm text-secondary">{register.count} matching {register.count === 1 ? "receipt" : "receipts"}</p>
      ) : null}
      {!loading && register && register.rows.length === 0 ? (
        <EmptyState title="No matching receipts" body="Try another review status, date, or search. An issued offer without a recorded receipt is not listed here." />
      ) : null}
      {register && register.rows.length > 0 ? (
        <div className={tableWrapClass}>
          <table className="min-w-full text-left text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={thClass} scope="col">Received</th>
                <th className={thClass} scope="col">Client</th>
                <th className={thClass} scope="col">PI</th>
                <th className={thClass} scope="col">Amount</th>
                <th className={thClass} scope="col">Method</th>
                <th className={thClass} scope="col">Bank reference</th>
                <th className={thClass} scope="col">Finance reference</th>
                <th className={thClass} scope="col">Recorded by</th>
                <th className={thClass} scope="col">Review</th>
              </tr>
            </thead>
            <tbody>
              {register.rows.map((row) => {
                const selected = row.id === location.receiptId;
                return (
                  <tr key={row.id} className={selected ? "border-t border-line bg-selected" : "border-t border-line"}>
                    <td className={tdClass}>{formatDate(row.receivedOn)}</td>
                    <td className={tdClass}>
                      <button type="button" className={`${linkClass} text-left`} aria-pressed={selected} onClick={() => update({ receiptId: row.id })}>
                        {row.clientName || "Client"}
                      </button>
                    </td>
                    <td className={tdClass}>{row.trackedDisplayNumber}</td>
                    <td className={`${tdClass} tabular-nums`}>{formatMoney(row.amount, row.currency)}</td>
                    <td className={tdClass}>{methodLabel(row.method)}</td>
                    <td className={tdClass}>{row.reference || "—"}</td>
                    <td className={tdClass}>{row.internalReference || "—"}</td>
                    <td className={tdClass}>{row.recordedByName}</td>
                    <td className={tdClass}>{reviewStatusLabel(row.reviewStatus)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {register ? <Pagination page={location.page} pageCount={pageCount} total={register.count} onPage={(page) => update({ page })} /> : null}
      {location.receiptId ? (
        <section className="mt-4 rounded-lg border border-line bg-white p-4" aria-label="Receipt detail">
          {detailLoading ? <LoadingNote>Loading receipt…</LoadingNote> : null}
          {detailError ? <p className="text-sm text-danger" role="alert">{detailError}</p> : null}
          {detail && detail.receipt.id === location.receiptId ? (
            <ReceiptDetail
              detail={detail}
              draft={draft}
              saving={saving}
              message={message}
              formError={formError}
              conflict={conflict}
              onDraft={setDraft}
              onSubmit={(action) => void submit(action)}
              onReload={() => void reloadDetail()}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function successMessage(action: ReviewAction): string {
  if (action === "verify") return "Payment verified. The receipt and its balance are unchanged.";
  if (action === "clarify") return "Marked as needing clarification. The receipt and its balance are unchanged.";
  return "Review reopened. The earlier verification stays in the history.";
}

function ReceiptDetail({
  detail,
  draft,
  saving,
  message,
  formError,
  conflict,
  onDraft,
  onSubmit,
  onReload,
}: {
  detail: ReceiptReviewDetail;
  draft: Draft;
  saving: boolean;
  message: string | null;
  formError: string | null;
  conflict: boolean;
  onDraft: (draft: Draft) => void;
  onSubmit: (action: ReviewAction) => void;
  onReload: () => void;
}) {
  const reversed = detail.review.displayStatus === "reversed" || detail.review.displayStatus === "reversed_previously_verified";
  const verified = detail.review.displayStatus === "verified";
  const actions = detail.canReview && !reversed;
  const historicalVerification = latestVerification(detail.history);
  const historicalCount = verificationCount(detail.history);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{detail.source.clientName || "Receipt"} · {detail.source.trackedDisplayNumber}</h2>
        <Link className={linkClass} to={paymentTrackingPath(detail.source.piId)}>Open PI payment tracking</Link>
      </div>
      {message ? <Banner tone="success">{message}</Banner> : null}
      {formError ? <p className="text-sm text-danger" role="alert">{formError}</p> : null}
      {conflict ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-secondary">The saved review changed. Reload the receipt before submitting again. The text you typed is still here.</p>
          <Button type="button" variant="secondary" onClick={onReload}>Reload receipt</Button>
        </div>
      ) : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Received</dt><dd>{formatDate(detail.receipt.receivedOn)} · {formatMoney(detail.receipt.amount, detail.receipt.currency)} · {methodLabel(detail.receipt.method)}</dd></div>
        <div><dt className="text-muted">Bank or customer reference</dt><dd>{detail.receipt.reference || "—"}</dd></div>
        <div><dt className="text-muted">Recorded by</dt><dd>{detail.receipt.recordedByName}</dd></div>
        <div><dt className="text-muted">Finance review</dt><dd>{compactReviewLabel(detail.review.displayStatus)}</dd></div>
        <div><dt className="text-muted">Finance internal reference</dt><dd>{detail.review.internalReference || "—"}</dd></div>
        <div>
          <dt className="text-muted">Reviewed by</dt>
          <dd>
            {reversed && historicalVerification
              ? `${historicalVerification.actorName} · ${formatReviewedAt(historicalVerification.actedAt)}`
              : detail.review.displayStatus === "verified" && detail.review.reviewedByName
                ? `${detail.review.reviewedByName} · ${formatReviewedAt(detail.review.reviewedAt)}`
                : "—"}
          </dd>
        </div>
      </dl>
      {detail.receipt.note ? <p className="text-sm text-secondary">Receipt note: {detail.receipt.note}</p> : null}
      {detail.review.displayStatus === "needs_clarification" && detail.review.note ? (
        <p className="text-sm text-ink">Clarification: {detail.review.note}</p>
      ) : null}
      {detail.review.status === "verified" && detail.review.note && !reversed ? (
        <p className="text-sm text-secondary">Finance note: {detail.review.note}</p>
      ) : null}
      {reversed && historicalVerification ? (
        <p className="text-sm text-ink">
          {historicalCount > 1
            ? `Reversed · latest verification by ${historicalVerification.actorName} on ${formatReviewedAt(historicalVerification.actedAt)}.`
            : `Reversed · previously verified by ${historicalVerification.actorName} on ${formatReviewedAt(historicalVerification.actedAt)}.`}
          {historicalVerification.internalReference ? ` Internal reference ${historicalVerification.internalReference}.` : ""}
        </p>
      ) : null}
      {detail.receipt.reversedAt ? (
        <p className="text-sm text-muted">Reversed {formatReviewedAt(detail.receipt.reversedAt)}{detail.receipt.reversedByName ? ` by ${detail.receipt.reversedByName}` : ""}. {detail.receipt.reversalReason}</p>
      ) : null}
      <div>
        <h3 className="text-sm font-medium text-ink">Allocations</h3>
        {detail.allocations.length === 0 ? <p className="mt-1 text-sm text-muted">No allocations are stored on this receipt.</p> : (
          <ul className="mt-1 text-sm text-secondary">
            {detail.allocations.map((allocation) => (
              <li key={allocation.obligationId}>{allocation.label} · {formatMoney(allocation.amount, detail.receipt.currency)}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-sm text-secondary">Agreed issued version {detail.source.trackedDisplayNumber}. Total {formatMoney(detail.source.agreedTotal, detail.source.currency)}.</p>
      <div>
        <h3 className="text-sm font-medium text-ink">Review history</h3>
        {detail.history.length === 0 ? <p className="mt-1 text-sm text-muted">No finance review has been saved yet.</p> : (
          <ul className="mt-1 space-y-1 text-sm text-secondary">
            {detail.history.map((event) => <li key={event.id}>{reviewEventText(event)}</li>)}
          </ul>
        )}
      </div>
      {actions && !verified ? (
        <div className="grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); onSubmit("verify"); }}>
            <Field label="Internal payment reference" hint="Required to verify. Up to 80 characters. The same reference can be used on more than one receipt.">
              <input className={controlClass} value={draft.reference} maxLength={80} onChange={(event) => onDraft({ ...draft, reference: event.target.value })} />
            </Field>
            <Field label="Finance note" hint="Optional. Up to 400 characters.">
              <TextArea rows={2} value={draft.note} maxLength={400} onChange={(event) => onDraft({ ...draft, note: event.target.value })} />
            </Field>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Verify payment"}</Button>
          </form>
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); onSubmit("clarify"); }}>
            <Field label="Clarification reason" hint="Required. The receipt stays recorded.">
              <TextArea rows={3} value={draft.clarify} maxLength={400} onChange={(event) => onDraft({ ...draft, clarify: event.target.value })} />
            </Field>
            <Button type="submit" variant="secondary" disabled={saving}>{saving ? "Saving…" : "Needs clarification"}</Button>
          </form>
        </div>
      ) : null}
      {actions && verified ? (
        <form className="grid max-w-xl gap-3 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); onSubmit("reopen"); }}>
          <Field label="Reason for reopening" hint="Required. The current verification stays in the history.">
            <TextArea rows={3} value={draft.reopen} maxLength={400} onChange={(event) => onDraft({ ...draft, reopen: event.target.value })} />
          </Field>
          <Button type="submit" variant="secondary" disabled={saving}>{saving ? "Saving…" : "Reopen review"}</Button>
        </form>
      ) : null}
      {!detail.canReview && !reversed ? <p className="text-sm text-muted">You can read this review. Review received payments permission is required to verify, clarify, or reopen it.</p> : null}
    </div>
  );
}
