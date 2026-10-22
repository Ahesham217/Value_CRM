#!/bin/bash
# Overlap a machine receipt with no-charge activation on one mixed PI.
# Run only on a disposable database. Both orders must finish without a deadlock.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${1:-value_crm_test}"
PSQL=(sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q)
USER_ID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"
mapfile -t ROWS < <("${PSQL[@]}" -tA -f "$ROOT/supabase/tests/payment_tracking_lock_order.sql")
if [[ "${#ROWS[@]}" -ne 2 ]]; then
  echo "Expected two mixed plans, got ${#ROWS[@]}: ${ROWS[*]}" >&2
  exit 1
fi

read_row() {
  local row="$1"
  LABEL="${row%%|*}"
  local rest="${row#*|}"
  PLAN="${rest%%|*}"
  rest="${rest#*|}"
  MACHINE="${rest%%|*}"
  ZERO="${rest##*|}"
}

record_sql() {
  local plan="$1" machine="$2" key="$3"
  cat <<SQL
set lock_timeout = '8s';
set statement_timeout = '20s';
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select public.record_payment_receipt(
  '$plan',
  jsonb_build_object(
    'idempotency_key', '$key',
    'amount', '10000.00',
    'received_on', (private.cairo_today())::text,
    'method', 'bank_transfer',
    'allocations', jsonb_build_array(jsonb_build_object('obligation_id', '$machine', 'amount', '10000.00'))
  )
);
select pg_sleep(2);
commit;
SQL
}

waive_sql() {
  local zero="$1"
  cat <<SQL
set lock_timeout = '8s';
set statement_timeout = '20s';
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select public.activate_subscription_at_no_charge('$zero', date '2026-10-01', 'Included with the machine');
select pg_sleep(2);
commit;
SQL
}

overlap() {
  local first="$1" second="$2" hold_out="$3" wait_out="$4"
  "${PSQL[@]}" > "$hold_out" 2>&1 <<SQL &
$first
SQL
  local hold_pid=$!
  sleep 0.4
  if ! "${PSQL[@]}" > "$wait_out" 2>&1 <<SQL
$second
SQL
  then
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

check_plan() {
  local plan="$1"
  local summary
  summary=$("${PSQL[@]}" -tA -c "
    select
      (select count(*) from public.payment_receipts where plan_id = '$plan' and reversed_at is null and amount = 10000),
      (select outstanding_amount from public.payment_obligation_balances where plan_id = '$plan' and kind = 'payment_row'),
      (select outstanding_amount from public.payment_obligation_balances where plan_id = '$plan' and kind = 'subscription_advance'),
      (select count(*) from public.subscriptions s join public.payment_plans p on p.pi_id = s.pi_id where p.id = '$plan'),
      (select s.activation_kind || '|' || s.start_date::text from public.subscriptions s join public.payment_plans p on p.pi_id = s.pi_id where p.id = '$plan')
  ")
  if [[ "$summary" != "1|0.00|0.00|1|no_charge|2026-10-01" ]]; then
    echo "Unexpected balances for $plan: $summary" >&2
    exit 1
  fi
}

read_row "${ROWS[0]}"
if [[ "$LABEL" != "A" ]]; then
  echo "First plan was $LABEL, expected A" >&2
  exit 1
fi
PLAN_A="$PLAN"
MACHINE_A="$MACHINE"
ZERO_A="$ZERO"
read_row "${ROWS[1]}"
if [[ "$LABEL" != "B" ]]; then
  echo "Second plan was $LABEL, expected B" >&2
  exit 1
fi

overlap \
  "$(record_sql "$PLAN_A" "$MACHINE_A" "dddddddd-dddd-4ddd-8ddd-ddddddddddd1")" \
  "$(waive_sql "$ZERO_A")" \
  /tmp/lock-a-hold.out \
  /tmp/lock-a-wait.out
check_plan "$PLAN_A"

overlap \
  "$(waive_sql "$ZERO")" \
  "$(record_sql "$PLAN" "$MACHINE" "dddddddd-dddd-4ddd-8ddd-ddddddddddd2")" \
  /tmp/lock-b-hold.out \
  /tmp/lock-b-wait.out
check_plan "$PLAN"

echo "Payment recording and no-charge activation overlapped without a deadlock."
