#!/bin/bash
# Two sessions try to consume the same USD 100 obligation. Run only on a disposable database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${1:-value_crm_test}"
PSQL=(sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q)
OUT=$("${PSQL[@]}" -tA -f "$ROOT/supabase/tests/payment_tracking_concurrent.sql")
PLAN=${OUT%%|*}
OBLIGATION=${OUT##*|}
USER_ID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"
if [[ -z "$PLAN" || -z "$OBLIGATION" || "$PLAN" == "$OBLIGATION" ]]; then
  echo "Could not prepare the concurrent fixture: $OUT" >&2
  exit 1
fi

"${PSQL[@]}" > /tmp/payment-hold.out 2>&1 <<SQL &
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select public.record_payment_receipt(
  '$PLAN',
  jsonb_build_object(
    'idempotency_key', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'amount', '60.00',
    'received_on', (private.cairo_today())::text,
    'method', 'cash',
    'allocations', jsonb_build_array(jsonb_build_object('obligation_id', '$OBLIGATION', 'amount', '60.00'))
  )
);
select pg_sleep(2);
commit;
SQL
HOLD_PID=$!
sleep 0.4
set +e
"${PSQL[@]}" -v ON_ERROR_STOP=0 > /tmp/payment-second.out 2>&1 <<SQL
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select public.record_payment_receipt(
  '$PLAN',
  jsonb_build_object(
    'idempotency_key', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'amount', '60.00',
    'received_on', (private.cairo_today())::text,
    'method', 'bank_transfer',
    'allocations', jsonb_build_array(jsonb_build_object('obligation_id', '$OBLIGATION', 'amount', '60.00'))
  )
);
commit;
SQL
SECOND_CODE=$?
set -e
if ! wait "$HOLD_PID"; then
  echo "Holding receipt failed" >&2
  cat /tmp/payment-hold.out >&2
  exit 1
fi
if ! rg -q "unpaid balance|exceeds the unpaid balance" /tmp/payment-second.out; then
  echo "Concurrent receipt was not rejected (exit $SECOND_CODE)" >&2
  echo "HOLD:" >&2
  cat /tmp/payment-hold.out >&2
  echo "SECOND:" >&2
  cat /tmp/payment-second.out >&2
  exit 1
fi
COUNT=$("${PSQL[@]}" -tA -c "select count(*) from public.payment_receipts where plan_id = '$PLAN' and reversed_at is null")
if [[ "$COUNT" != "1" ]]; then
  echo "Expected one posted receipt, found $COUNT" >&2
  exit 1
fi
echo "Concurrent receipts kept a single posted receipt."
