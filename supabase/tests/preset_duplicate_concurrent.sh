#!/bin/bash
# Duplicate overlaps save and generate, in both orders, on one source PI.
# The duplicate insert pauses after the source locks are held and before its
# foreign-key checks. The other session must be blocked on a lock before the
# pause ends, which is the interleaving that deadlocks when those configuration
# locks are FOR UPDATE. Run only on a disposable database. This script commits rows.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${1:-value_crm_test}"
PSQL=(sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q)

cleanup() {
  "${PSQL[@]}" -c "drop trigger if exists pause_duplicate_pi_insert on public.proforma_invoices; drop function if exists public.pause_duplicate_pi_insert(); drop table if exists public.preset_duplicate_race;" >/dev/null
}
trap cleanup EXIT

mapfile -t LINES < <("${PSQL[@]}" -tA -f "$ROOT/supabase/tests/preset_duplicate_concurrent.sql")
if [[ "${#LINES[@]}" -ne 4 ]]; then
  echo "Could not prepare duplicate fixtures:" >&2
  printf '%s\n' "${LINES[@]}" >&2
  exit 1
fi

row_for() {
  local kind="$1"
  local line
  for line in "${LINES[@]}"; do
    if [[ "$line" == "$kind|"* ]]; then
      printf '%s' "$line"
      return
    fi
  done
  echo "Missing fixture $kind" >&2
  exit 1
}

session_settings() {
  local user_id="$1"
  cat <<SQL
set lock_timeout = '15s';
set statement_timeout = '25s';
set deadlock_timeout = '200ms';
select set_config('request.jwt.claim.sub', '$user_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
SQL
}

wait_for_activity() {
  local kind="$1" where="$2"
  local ready="" attempt
  for attempt in $(seq 1 40); do
    ready=$("${PSQL[@]}" -tA -c "select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and $where")
    if [[ "$ready" != "0" && -n "$ready" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "$kind did not reach: $where" >&2
  "${PSQL[@]}" -c "select pid, state, wait_event_type, wait_event, left(query, 120) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid();" >&2 || true
  return 1
}

run_pair() {
  local kind="$1" holder_where="$2" overlap_where="$3" holder_sql="$4" waiter_sql="$5"
  local holder_pid waiter_pid holder_code waiter_code
  "${PSQL[@]}" > "/tmp/duplicate-$kind-holder.out" 2>&1 <<SQL &
$holder_sql
SQL
  holder_pid=$!
  if ! wait_for_activity "$kind holder" "$holder_where"; then
    cat "/tmp/duplicate-$kind-holder.out" >&2
    wait "$holder_pid" || true
    exit 1
  fi
  "${PSQL[@]}" > "/tmp/duplicate-$kind-waiter.out" 2>&1 <<SQL &
$waiter_sql
SQL
  waiter_pid=$!
  if ! wait_for_activity "$kind overlap" "$overlap_where"; then
    echo "--- holder ---" >&2
    cat "/tmp/duplicate-$kind-holder.out" >&2
    echo "--- waiter ---" >&2
    cat "/tmp/duplicate-$kind-waiter.out" >&2
    wait "$holder_pid" || true
    wait "$waiter_pid" || true
    exit 1
  fi
  set +e
  wait "$holder_pid"
  holder_code=$?
  wait "$waiter_pid"
  waiter_code=$?
  set -e
  if [[ "$holder_code" -ne 0 || "$waiter_code" -ne 0 ]] || rg -q "deadlock detected" "/tmp/duplicate-$kind-holder.out" "/tmp/duplicate-$kind-waiter.out"; then
    echo "$kind deadlocked or failed (holder=$holder_code waiter=$waiter_code)" >&2
    echo "--- holder ---" >&2
    cat "/tmp/duplicate-$kind-holder.out" >&2
    echo "--- waiter ---" >&2
    cat "/tmp/duplicate-$kind-waiter.out" >&2
    exit 1
  fi
}

assert_pair() {
  local kind="$1" expect="$2"
  local row editor issuer preset pi version prefix status
  row="$(row_for "$kind")"
  IFS='|' read -r kind editor issuer preset pi version prefix <<<"$row"
  status=$("${PSQL[@]}" -tA <<SQL
with src as (
  select * from public.proforma_invoices where id = '$pi'
),
dup as (
  select * from public.proforma_invoices
  where preset_code = '$preset' and id <> '$pi'
),
src_line as (
  select * from public.pi_lines where pi_id = '$pi'
),
dup_line as (
  select lines.*
  from public.pi_lines lines
  join dup on dup.id = lines.pi_id
)
select case
  when (select count(*) from dup) <> 1 then 'duplicate count ' || (select count(*) from dup)
  when (select count(*) from src_line) <> 1 or (select count(*) from dup_line) <> 1 then 'line count'
  when (select pi_number from dup) is not null or (select serial from dup) is not null then 'duplicate took a number'
  when (select draft_open from dup) is not true then 'duplicate is not an open draft'
  when (select count(*) from public.pi_versions where pi_id = (select id from dup)) <> 0 then 'duplicate has a version'
  when (select currency from dup) <> 'USD' or (select currency from src) <> 'USD' then 'currency changed'
  when (select preset_code from dup) is distinct from (select preset_code from src) then 'preset was not copied'
  when (select office from dup) is distinct from '$prefix' or (select office from src) is distinct from '$prefix' then 'office changed'
  when (select sequence_code from dup) is distinct from '$prefix' or (select sequence_code from src) is distinct from '$prefix' then 'sequence changed'
  when (select numbering_prefix from dup) is distinct from '$prefix' or (select numbering_prefix from src) is distinct from '$prefix' then 'prefix changed'
  when (select description from dup_line) <> 'Duplicate item' or (select quantity from dup_line) <> 1 then 'line contents'
  when '$expect' = 'original' and (select unit_price from dup_line) <> 10.50 then 'duplicate price ' || (select unit_price from dup_line)
  when '$expect' = 'original' and (select additional_notes from dup) <> 'saved draft' then 'duplicate notes'
  when '$expect' = 'original' and (select unit_price from src_line) <> 12.00 then 'source price ' || (select unit_price from src_line)
  when '$expect' = 'original' and (select additional_notes from src) <> 'saved over duplicate' then 'source notes'
  when '$expect' = 'saved' and (select unit_price from dup_line) <> 12.00 then 'duplicate missed the save'
  when '$expect' = 'saved' and (select unit_price from src_line) <> 12.00 then 'source missed the save'
  when '$expect' = 'saved' and (select additional_notes from dup) <> 'saved over duplicate' then 'duplicate notes after save'
  when '$expect' in ('original', 'saved') and (select pi_number from src) is not null then 'save allocated a number'
  when '$expect' in ('original', 'saved') and coalesce((select last_value from private.pi_counters where office = '$prefix' and pi_year = 2026), 0) <> 0 then 'counter moved'
  when '$expect' in ('original', 'saved') and (select count(*) from public.pi_versions where pi_id = '$pi') <> 0 then 'save created a version'
  when '$expect' = 'issue-after-copy' and (select unit_price from dup_line) <> 10.50 then 'issued duplicate price'
  when '$expect' = 'issue-after-copy' and (select unit_price from src_line) <> 10.50 then 'issued source price'
  when '$expect' = 'issue-after-copy' and (select additional_notes from dup) <> 'saved draft' then 'issued duplicate notes'
  when '$expect' = 'copy-after-issue' and (select unit_price from dup_line) <> 10.50 then 'post-issue duplicate price'
  when '$expect' = 'copy-after-issue' and (select unit_price from src_line) <> 10.50 then 'post-issue source price'
  when '$expect' in ('issue-after-copy', 'copy-after-issue') and (select pi_number from src) is distinct from '$prefix-2026-00001' then 'source number ' || coalesce((select pi_number from src), '')
  when '$expect' in ('issue-after-copy', 'copy-after-issue') and (select serial from src) is distinct from 1 then 'source serial'
  when '$expect' in ('issue-after-copy', 'copy-after-issue') and (select pi_year from src) is distinct from 2026 then 'source year'
  when '$expect' in ('issue-after-copy', 'copy-after-issue') and (select draft_open from src) is not false then 'source stayed a draft'
  when '$expect' in ('issue-after-copy', 'copy-after-issue') and (select count(*) from public.pi_versions where pi_id = '$pi') <> 1 then 'version count'
  when '$expect' in ('issue-after-copy', 'copy-after-issue') and coalesce((select last_value from private.pi_counters where office = '$prefix' and pi_year = 2026), 0) <> 1 then 'counter ' || coalesce((select last_value from private.pi_counters where office = '$prefix' and pi_year = 2026), 0)
  when '$expect' in ('issue-after-copy', 'copy-after-issue') and (select count(*) from public.proforma_invoices where pi_number like '$prefix-2026-%') <> 1 then 'extra number'
  else 'ok'
end;
SQL
)
  if [[ "$status" != "ok" ]]; then
    echo "$kind assertion failed: $status" >&2
    "${PSQL[@]}" -c "select id, pi_number, serial, currency, office, sequence_code, numbering_prefix, additional_notes, draft_open from public.proforma_invoices where preset_code = '$preset' order by created_at;" >&2
    "${PSQL[@]}" -c "select pi_id, unit_price, quantity, description from public.pi_lines where pi_id in (select id from public.proforma_invoices where preset_code = '$preset');" >&2
    exit 1
  fi
}

dup_save_row="$(row_for dup_save)"
IFS='|' read -r _ dup_save_editor _ dup_save_preset dup_save_pi dup_save_version _ <<<"$dup_save_row"
run_pair dup_save "query like 'select public.duplicate_pi(%' and wait_event = 'PgSleep'" "query like 'select public.save_pi_draft(%' and wait_event_type = 'Lock'" "$(cat <<SQL
begin;
$(session_settings "$dup_save_editor")
select set_config('test.pause_pi_insert', 'on', true);
select public.duplicate_pi('$dup_save_pi');
commit;
SQL
)" "$(cat <<SQL
begin;
$(session_settings "$dup_save_editor")
select public.save_pi_draft(
  '$dup_save_pi',
  $dup_save_version,
  (select save_payload from public.preset_duplicate_race where kind = 'dup_save')
);
commit;
SQL
)"
assert_pair dup_save original

save_dup_row="$(row_for save_dup)"
IFS='|' read -r _ save_dup_editor _ _ save_dup_pi save_dup_version _ <<<"$save_dup_row"
run_pair save_dup "query like 'select pg_sleep(%' and wait_event = 'PgSleep'" "query like 'select public.duplicate_pi(%' and wait_event_type = 'Lock'" "$(cat <<SQL
begin;
$(session_settings "$save_dup_editor")
select public.save_pi_draft(
  '$save_dup_pi',
  $save_dup_version,
  (select save_payload from public.preset_duplicate_race where kind = 'save_dup')
);
select pg_sleep(5);
commit;
SQL
)" "$(cat <<SQL
begin;
$(session_settings "$save_dup_editor")
select public.duplicate_pi('$save_dup_pi');
commit;
SQL
)"
assert_pair save_dup saved

dup_generate_row="$(row_for dup_generate)"
IFS='|' read -r _ dup_generate_editor dup_generate_issuer _ dup_generate_pi dup_generate_version _ <<<"$dup_generate_row"
run_pair dup_generate "query like 'select public.duplicate_pi(%' and wait_event = 'PgSleep'" "query like 'select public.generate_pi(%' and wait_event_type = 'Lock'" "$(cat <<SQL
begin;
$(session_settings "$dup_generate_editor")
select set_config('test.pause_pi_insert', 'on', true);
select public.duplicate_pi('$dup_generate_pi');
commit;
SQL
)" "$(cat <<SQL
begin;
$(session_settings "$dup_generate_issuer")
select public.generate_pi('$dup_generate_pi', $dup_generate_version, '{}'::jsonb);
commit;
SQL
)"
assert_pair dup_generate issue-after-copy

generate_dup_row="$(row_for generate_dup)"
IFS='|' read -r _ generate_dup_editor generate_dup_issuer _ generate_dup_pi generate_dup_version _ <<<"$generate_dup_row"
run_pair generate_dup "query like 'select pg_sleep(%' and wait_event = 'PgSleep'" "query like 'select public.duplicate_pi(%' and wait_event_type = 'Lock'" "$(cat <<SQL
begin;
$(session_settings "$generate_dup_issuer")
select public.generate_pi('$generate_dup_pi', $generate_dup_version, '{}'::jsonb);
select pg_sleep(5);
commit;
SQL
)" "$(cat <<SQL
begin;
$(session_settings "$generate_dup_editor")
select public.duplicate_pi('$generate_dup_pi');
commit;
SQL
)"
assert_pair generate_dup copy-after-issue

echo "Duplicate overlapped save and generate without a deadlock, a copied number, or an extra serial."
