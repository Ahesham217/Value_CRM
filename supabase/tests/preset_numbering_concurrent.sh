#!/bin/bash
# Two sessions issue PIs on one new sequence. Run only on a disposable database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${1:-value_crm_test}"
PSQL=(sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q)
OUT=$("${PSQL[@]}" -tA -f "$ROOT/supabase/tests/preset_numbering_concurrent.sql")
IFS='|' read -r USER_ID FIRST_ID FIRST_VERSION SECOND_ID SECOND_VERSION PREFIX <<<"$OUT"
if [[ -z "$USER_ID" || -z "$FIRST_ID" || -z "$SECOND_ID" || -z "$PREFIX" || "$FIRST_ID" == "$SECOND_ID" ]]; then
  echo "Could not prepare the numbering fixture: $OUT" >&2
  exit 1
fi

"${PSQL[@]}" > /tmp/preset-number-hold.out 2>&1 <<SQL &
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.generate_pi('$FIRST_ID', $FIRST_VERSION, '{}'::jsonb);
select pg_sleep(2);
commit;
SQL
HOLD_PID=$!
sleep 0.4
set +e
"${PSQL[@]}" > /tmp/preset-number-second.out 2>&1 <<SQL
begin;
select set_config('request.jwt.claim.sub', '$USER_ID', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.generate_pi('$SECOND_ID', $SECOND_VERSION, '{}'::jsonb);
commit;
SQL
SECOND_CODE=$?
set -e
if ! wait "$HOLD_PID"; then
  echo "Holding issue failed" >&2
  cat /tmp/preset-number-hold.out >&2
  exit 1
fi
if [[ "$SECOND_CODE" -ne 0 ]]; then
  echo "Second issue failed" >&2
  cat /tmp/preset-number-second.out >&2
  exit 1
fi
COUNT=$("${PSQL[@]}" -tA -c "select count(distinct pi_number) from public.proforma_invoices where id in ('$FIRST_ID', '$SECOND_ID') and pi_number like '$PREFIX-2026-%'")
SAME=$("${PSQL[@]}" -tA -c "select count(*) from public.proforma_invoices where pi_number like '$PREFIX-2026-%'")
if [[ "$COUNT" != "2" || "$SAME" != "2" ]]; then
  echo "Expected two distinct $PREFIX numbers, found distinct=$COUNT total=$SAME" >&2
  "${PSQL[@]}" -c "select id, pi_number, serial from public.proforma_invoices where id in ('$FIRST_ID', '$SECOND_ID')" >&2
  exit 1
fi
echo "Concurrent issue allocated two distinct $PREFIX numbers."
