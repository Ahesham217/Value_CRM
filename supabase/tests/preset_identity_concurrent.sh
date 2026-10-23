#!/bin/bash
# Identity and prefix edits overlap first issue, in both orders. Disposable database only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${1:-value_crm_test}"
PSQL=(sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q)
mapfile -t LINES < <("${PSQL[@]}" -tA -f "$ROOT/supabase/tests/preset_identity_concurrent.sql")
if [[ "${#LINES[@]}" -ne 4 ]]; then
  echo "Could not prepare identity fixtures:" >&2
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

issue_then_edit() {
  local kind="$1" sql_edit="$2" edit_match="$3"
  local row user preset pi version prefix
  row="$(row_for "$kind")"
  IFS='|' read -r kind user preset pi version prefix <<<"$row"
  "${PSQL[@]}" > "/tmp/identity-$kind-issue.out" 2>&1 <<SQL &
begin;
select set_config('request.jwt.claim.sub', '$user', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.generate_pi('$pi', $version, '{}'::jsonb);
select pg_sleep(2);
commit;
SQL
  local issue_pid=$!
  sleep 0.4
  set +e
  "${PSQL[@]}" > "/tmp/identity-$kind-edit.out" 2>&1 <<SQL
begin;
$sql_edit
commit;
SQL
  local edit_code=$?
  set -e
  if ! wait "$issue_pid"; then
    echo "$kind issue failed" >&2
    cat "/tmp/identity-$kind-issue.out" >&2
    exit 1
  fi
  if [[ "$edit_code" -eq 0 ]] || ! rg -q "$edit_match" "/tmp/identity-$kind-edit.out"; then
    echo "$kind edit was not rejected" >&2
    cat "/tmp/identity-$kind-edit.out" >&2
    exit 1
  fi
  if rg -q "deadlock detected" "/tmp/identity-$kind-issue.out" "/tmp/identity-$kind-edit.out"; then
    echo "$kind deadlocked" >&2
    exit 1
  fi
  local number currency price versions
  number=$("${PSQL[@]}" -tA -c "select pi_number from public.proforma_invoices where id = '$pi'")
  currency=$("${PSQL[@]}" -tA -c "select currency from public.proforma_invoices where id = '$pi'")
  price=$("${PSQL[@]}" -tA -c "select (unit_price = 10.50)::text from public.pi_lines where pi_id = '$pi'")
  versions=$("${PSQL[@]}" -tA -c "select count(*) from public.pi_versions where pi_id = '$pi'")
  if [[ "$number" != "$prefix-2026-00001" || "$currency" != "USD" || "$price" != "true" || "$versions" != "1" ]]; then
    echo "$kind issued an inconsistent document: $number $currency $price versions=$versions" >&2
    exit 1
  fi
}

edit_then_issue() {
  local kind="$1" sql_edit="$2"
  local row user preset pi version prefix
  row="$(row_for "$kind")"
  IFS='|' read -r kind user preset pi version prefix <<<"$row"
  "${PSQL[@]}" > "/tmp/identity-$kind-edit.out" 2>&1 <<SQL &
begin;
$sql_edit
select pg_sleep(2);
commit;
SQL
  local edit_pid=$!
  sleep 0.4
  set +e
  "${PSQL[@]}" > "/tmp/identity-$kind-issue.out" 2>&1 <<SQL
begin;
select set_config('request.jwt.claim.sub', '$user', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.generate_pi('$pi', $version, '{}'::jsonb);
commit;
SQL
  local issue_code=$?
  set -e
  if ! wait "$edit_pid"; then
    echo "$kind edit failed" >&2
    cat "/tmp/identity-$kind-edit.out" >&2
    exit 1
  fi
  if [[ "$issue_code" -eq 0 ]] || ! rg -q "Prices were not converted" "/tmp/identity-$kind-issue.out"; then
    echo "$kind issue was not rejected" >&2
    cat "/tmp/identity-$kind-issue.out" >&2
    exit 1
  fi
  if rg -q "deadlock detected" "/tmp/identity-$kind-issue.out" "/tmp/identity-$kind-edit.out"; then
    echo "$kind deadlocked" >&2
    exit 1
  fi
  local number currency price versions counter
  number=$("${PSQL[@]}" -tA -c "select coalesce(pi_number, '') from public.proforma_invoices where id = '$pi'")
  currency=$("${PSQL[@]}" -tA -c "select currency from public.proforma_invoices where id = '$pi'")
  price=$("${PSQL[@]}" -tA -c "select (unit_price = 10.50)::text from public.pi_lines where pi_id = '$pi'")
  versions=$("${PSQL[@]}" -tA -c "select count(*) from public.pi_versions where pi_id = '$pi'")
  counter=$("${PSQL[@]}" -tA -c "select coalesce((select last_value from private.pi_counters where office = '$prefix' and pi_year = 2026), 0)")
  if [[ -n "$number" || "$currency" != "USD" || "$price" != "true" || "$versions" != "0" || "$counter" != "0" ]]; then
    echo "$kind rejected issue changed the draft: number='$number' $currency $price versions=$versions counter=$counter" >&2
    exit 1
  fi
}

currency_row="$(row_for currency_issue)"
IFS='|' read -r _ _ currency_preset _ _ _ <<<"$currency_row"
issue_then_edit currency_issue "update public.company_presets set currency = 'EUR' where code = '$currency_preset';" "Create a new preset"

prefix_row="$(row_for prefix_issue)"
IFS='|' read -r _ _ _ _ _ prefix_code <<<"$prefix_row"
issue_then_edit prefix_issue "update public.numbering_sequences set prefix = 'X' || substr('$prefix_code', 2) where code = '$prefix_code';" "prefix cannot be changed"

currency_edit_row="$(row_for currency_edit)"
IFS='|' read -r _ _ currency_edit_preset _ _ _ <<<"$currency_edit_row"
edit_then_issue currency_edit "update public.company_presets set currency = 'EUR' where code = '$currency_edit_preset';"

prefix_edit_row="$(row_for prefix_edit)"
IFS='|' read -r _ _ _ _ _ prefix_edit_code <<<"$prefix_edit_row"
edit_then_issue prefix_edit "update public.numbering_sequences set prefix = 'Y' || substr('$prefix_edit_code', 2) where code = '$prefix_edit_code';"

echo "Identity and prefix edits overlapped first issue without a deadlock or a consumed number."
