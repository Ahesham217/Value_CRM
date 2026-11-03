#!/bin/bash
# Overlap finance verification with receipt reversal on one plan.
# Run only on a disposable database. This script commits rows. Never run it on Value CRM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${1:-value_crm_test}"
PSQL=(sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q)
USER_ID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01"
mapfile -t ROWS < <("${PSQL[@]}" -tA -f "$ROOT/supabase/tests/finance_review_concurrent.sql")
if [[ "${#ROWS[@]}" -ne 1 || -z "${ROWS[0]}" ]]; then
  echo "Expected one concurrent plan, got ${#ROWS[@]}: ${ROWS[*]:-}" >&2
  exit 1
fi
IFS='|' read -r PLAN RECEIPT_A RECEIPT_B OBLIGATION <<< "${ROWS[0]}"
if [[ -z "$PLAN" || -z "$RECEIPT_A" || -z "$RECEIPT_B" || -z "$OBLIGATION" ]]; then
  echo "Could not read the concurrent fixture: ${ROWS[0]}" >&2
  exit 1
fi

verify_sql() {
  local receipt="$1" key="$2"
  cat <<SQL
set lock_timeout = '8s';
set statement_timeout = '20s';
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select public.review_payment_receipt(
  '$receipt',
  'verify',
  0,
  jsonb_build_object('idempotency_key', '$key', 'internal_reference', 'CONC-VCH', 'note', 'Checked while reversal was waiting')
);
select pg_sleep(2);
commit;
SQL
}

reverse_sql() {
  local receipt="$1"
  cat <<SQL
set lock_timeout = '8s';
set statement_timeout = '20s';
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select public.reverse_payment_receipt('$receipt', 'Posted to the wrong PI');
select pg_sleep(2);
commit;
SQL
}

overlap() {
  local first="$1" second="$2" hold_out="$3" wait_out="$4" allow_wait_error="${5:-0}"
  "${PSQL[@]}" > "$hold_out" 2>&1 <<SQL &
$first
SQL
  local hold_pid=$!
  sleep 0.4
  set +e
  "${PSQL[@]}" > "$wait_out" 2>&1 <<SQL
$second
SQL
  local wait_code=$?
  set -e
  if [[ "$allow_wait_error" != "1" && "$wait_code" -ne 0 ]]; then
    echo "Waiting operation failed" >&2
    echo "HOLD:" >&2
    cat "$hold_out" >&2
    echo "WAIT:" >&2
    cat "$wait_out" >&2
    wait "$hold_pid" || true
    exit 1
  fi
  if ! wait "$hold_pid"; then
    echo "Holding operation failed" >&2
    cat "$hold_out" >&2
    exit 1
  fi
  if rg -q "deadlock detected" "$hold_out" "$wait_out"; then
    echo "Deadlock detected" >&2
    cat "$hold_out" "$wait_out" >&2
    exit 1
  fi
}

overlap \
  "$(verify_sql "$RECEIPT_A" "cccccccc-cccc-4ccc-8ccc-ccccccccccc1")" \
  "$(reverse_sql "$RECEIPT_A")" \
  /tmp/finance-review-a-hold.out \
  /tmp/finance-review-a-wait.out

summary=$("${PSQL[@]}" -tA -c "
  select
    (r.reversed_at is not null),
    review.status,
    review.ever_verified,
    (select count(*) from public.payment_receipt_review_events event where event.receipt_id = r.id),
    r.amount,
    r.reference,
    (select outstanding_amount from public.payment_obligation_balances where id = '$OBLIGATION')
  from public.payment_receipts r
  join public.payment_receipt_reviews review on review.receipt_id = r.id
  where r.id = '$RECEIPT_A'
")
if [[ "$summary" != "t|verified|t|1|4000.00|CONC-1|7000.00" ]]; then
  echo "Verify-then-reverse was inconsistent: $summary" >&2
  exit 1
fi

overlap \
  "$(reverse_sql "$RECEIPT_B")" \
  "$(verify_sql "$RECEIPT_B" "cccccccc-cccc-4ccc-8ccc-ccccccccccc2")" \
  /tmp/finance-review-b-hold.out \
  /tmp/finance-review-b-wait.out \
  1

if ! rg -q "reversed" /tmp/finance-review-b-wait.out; then
  echo "Verification was not rejected after reversal" >&2
  cat /tmp/finance-review-b-wait.out >&2
  exit 1
fi
second=$("${PSQL[@]}" -tA -c "
  select
    (r.reversed_at is not null),
    r.amount,
    (select count(*) from public.payment_receipt_reviews where receipt_id = r.id),
    (select count(*) from public.payment_receipt_review_events where receipt_id = r.id),
    (select outstanding_amount from public.payment_obligation_balances where id = '$OBLIGATION'),
    (select count(*) from public.subscriptions s join public.payment_plans p on p.pi_id = s.pi_id where p.id = '$PLAN')
  from public.payment_receipts r
  where r.id = '$RECEIPT_B'
")
if [[ "$second" != "t|3000.00|0|0|10000.00|0" ]]; then
  echo "Reverse-then-verify was inconsistent: $second" >&2
  exit 1
fi

echo "Finance review and reversal overlapped without a deadlock."
