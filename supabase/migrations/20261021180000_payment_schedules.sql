-- Structured payment schedules for proforma invoices.
-- A null payment_schedule keeps the legacy payment_terms paragraph.
-- Existing pi_versions rows are not rewritten.
-- New drafts get an empty structured schedule, so apply this migration
-- together with the frontend that edits that schedule. Applying it while
-- the previous frontend is still issuing PIs would make new drafts unissuable
-- from that frontend.

alter table public.proforma_invoices
  add column if not exists payment_schedule jsonb;

alter table public.proforma_invoices
  drop constraint if exists proforma_invoices_payment_schedule_object;

alter table public.proforma_invoices
  add constraint proforma_invoices_payment_schedule_object
  check (payment_schedule is null or jsonb_typeof(payment_schedule) = 'object');

comment on column public.proforma_invoices.payment_schedule is
  'Structured payment agreement, schema version 1. Null means the PI still uses the legacy payment_terms paragraph. Existing rows are left null and are not rewritten.';

create or replace function private.add_calendar_months(p_date date, p_months integer)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select (p_date + make_interval(months => p_months))::date;
$$;

create or replace function private.payment_note(p_errors text, p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message is null or btrim(p_message) = '' then coalesce(p_errors, '')
    when p_errors is null or btrim(p_errors) = '' then p_message
    else p_errors || ' ' || p_message
  end;
$$;

create or replace function private.payment_plain_amount(p_amount numeric)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select (abs(round(p_amount, 2) * 100)::bigint / 100)::text
    || '.'
    || lpad((abs(round(p_amount, 2) * 100)::bigint % 100)::text, 2, '0');
$$;

create or replace function private.payment_group_digits(p_digits text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result text := '';
  v_index integer;
  v_length integer := length(p_digits);
begin
  for v_index in 1..v_length loop
    v_result := v_result || substr(p_digits, v_index, 1);
    if (v_length - v_index) > 0 and (v_length - v_index) % 3 = 0 then
      v_result := v_result || ',';
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function private.payment_grouped_amount(p_amount numeric)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case when p_amount < 0 then '-' else '' end
    || private.payment_group_digits((abs(round(p_amount, 2) * 100)::bigint / 100)::text)
    || '.'
    || lpad((abs(round(p_amount, 2) * 100)::bigint % 100)::text, 2, '0');
$$;

create or replace function private.payment_money(p_currency text, p_amount numeric)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select p_currency || ' ' || private.payment_grouped_amount(p_amount);
$$;

create or replace function private.payment_percent_text(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(p_value);
begin
  if v_text like '%.%' then
    v_text := regexp_replace(v_text, '0+$', '');
    v_text := regexp_replace(v_text, '\.$', '');
  end if;
  return v_text;
end;
$$;

create or replace function private.payment_percent_from_numeric(p_value numeric)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_cents integer := round(p_value * 100)::integer;
  v_whole integer := v_cents / 100;
  v_fraction integer := abs(v_cents % 100);
begin
  if v_fraction = 0 then
    return v_whole::text;
  elsif v_fraction % 10 = 0 then
    return v_whole::text || '.' || (v_fraction / 10)::text;
  end if;
  return v_whole::text || '.' || lpad(v_fraction::text, 2, '0');
end;
$$;

create or replace function private.payment_long_date(p_date date)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select extract(day from p_date)::integer::text
    || ' '
    || (array['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])[extract(month from p_date)::integer]
    || ' '
    || extract(year from p_date)::integer::text;
$$;

create or replace function private.payment_small_number(p_value integer)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case p_value
    when 0 then 'zero'
    when 1 then 'one'
    when 2 then 'two'
    when 3 then 'three'
    when 4 then 'four'
    when 5 then 'five'
    when 6 then 'six'
    when 7 then 'seven'
    when 8 then 'eight'
    when 9 then 'nine'
    when 10 then 'ten'
    else p_value::text
  end;
$$;

create or replace function private.payment_event_name(p_event jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event is null or jsonb_typeof(p_event) = 'null' then ''
    when p_event ->> 'type' = 'custom' then btrim(coalesce(p_event ->> 'label', ''))
    when p_event ->> 'code' = 'order_confirmation' then 'order confirmation'
    when p_event ->> 'code' = 'shipment' then 'shipment'
    when p_event ->> 'code' = 'delivery' then 'delivery'
    when p_event ->> 'code' = 'commissioning' then 'commissioning'
    else ''
  end;
$$;

create or replace function private.payment_offset_phrase(p_offset integer, p_unit text, p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_offset = 0 then 'on ' || p_event
    when p_unit = 'months' and p_offset = 1 then 'one calendar month after ' || p_event
    when p_unit = 'months' then private.payment_small_number(p_offset) || ' calendar months after ' || p_event
    when p_offset = 1 then 'one day after ' || p_event
    else private.payment_small_number(p_offset) || ' days after ' || p_event
  end;
$$;

create or replace function private.payment_join_clauses(p_clauses text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text;
  v_index integer;
  v_count integer := coalesce(cardinality(p_clauses), 0);
begin
  if v_count = 0 then
    return 'No payment due.';
  elsif v_count = 1 then
    v_body := p_clauses[1];
  else
    v_body := p_clauses[1];
    for v_index in 2..v_count - 1 loop
      v_body := v_body || ', ' || p_clauses[v_index];
    end loop;
    v_body := v_body || ', and ' || p_clauses[v_count];
  end if;
  if v_body ~ '^[a-z]' then
    v_body := upper(substr(v_body, 1, 1)) || substr(v_body, 2);
  end if;
  if right(v_body, 1) <> '.' then
    v_body := v_body || '.';
  end if;
  return v_body;
end;
$$;

create or replace function private.payment_remap_event(p_event jsonb, p_map jsonb)
returns table(event jsonb, map jsonb)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_old text;
  v_new text;
  v_map jsonb := p_map;
begin
  if p_event is null or jsonb_typeof(p_event) = 'null' or p_event ->> 'type' is distinct from 'custom' then
    event := p_event;
    map := p_map;
    return next;
    return;
  end if;
  v_old := p_event ->> 'id';
  v_new := p_map ->> v_old;
  if v_new is null then
    v_new := extensions.gen_random_uuid()::text;
    v_map := coalesce(p_map, '{}'::jsonb) || jsonb_build_object(v_old, v_new);
  end if;
  event := jsonb_set(p_event, '{id}', to_jsonb(v_new));
  map := v_map;
  return next;
end;
$$;
create or replace function private.payment_clean_decimal(
  p_text text,
  p_label text,
  p_scale integer,
  p_maximum numeric
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_text, ''));
  v_value numeric;
begin
  if v_text = '' then
    return null;
  end if;
  if v_text !~ '^[0-9]+(\.[0-9]*)?$' then
    raise exception '% must be a nonnegative number.', p_label;
  end if;
  if right(v_text, 1) = '.' then
    v_text := left(v_text, length(v_text) - 1);
  end if;
  v_value := v_text::numeric;
  if scale(v_value) > p_scale then
    if p_scale = 2 then
      raise exception '% can have at most two decimal places.', p_label;
    end if;
    raise exception '% can have at most four decimal places.', p_label;
  end if;
  if p_maximum is not null and v_value > p_maximum then
    raise exception '% cannot be more than 100.', p_label;
  end if;
  return v_text;
end;
$$;

create or replace function private.payment_clean_whole(p_value jsonb, p_label text, p_minimum integer, p_maximum integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_value integer;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') = '' then
    return null;
  end if;
  if jsonb_typeof(p_value) not in ('number', 'string') then
    raise exception '% must be a whole number.', p_label;
  end if;
  v_text := btrim(p_value #>> '{}');
  if v_text !~ '^[0-9]+$' then
    raise exception '% must be a whole number.', p_label;
  end if;
  v_value := v_text::integer;
  if v_value < p_minimum or v_value > p_maximum then
    raise exception '% is outside the allowed range.', p_label;
  end if;
  return v_value;
end;
$$;

create or replace function private.sanitize_payment_event(p_event jsonb, p_label text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_code text;
  v_label text;
begin
  if p_event is null or jsonb_typeof(p_event) = 'null' then
    return 'null'::jsonb;
  end if;
  if jsonb_typeof(p_event) <> 'object' then
    raise exception '% has an invalid milestone.', p_label;
  end if;
  if p_event ->> 'type' = 'standard' then
    v_code := p_event ->> 'code';
    if v_code not in ('order_confirmation', 'shipment', 'delivery', 'commissioning') then
      raise exception '% uses an unsupported milestone.', p_label;
    end if;
    return jsonb_build_object('type', 'standard', 'code', v_code);
  end if;
  if p_event ->> 'type' = 'custom' then
    if private.as_uuid(p_event ->> 'id') is null then
      raise exception '% needs a stable milestone identifier.', p_label;
    end if;
    v_label := btrim(coalesce(p_event ->> 'label', ''));
    if char_length(v_label) > 80 then
      raise exception '% has a milestone name that is too long.', p_label;
    end if;
    if v_label ~ '[\n\r]' then
      raise exception '% has a milestone name that cannot contain a line break.', p_label;
    end if;
    return jsonb_build_object('type', 'custom', 'id', p_event ->> 'id', 'label', v_label);
  end if;
  raise exception '% has an invalid milestone.', p_label;
end;
$$;

create or replace function private.sanitize_payment_schedule(p_schedule jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_id text;
  v_ids text[] := '{}';
  v_label text;
  v_name text;
  v_amount jsonb;
  v_amount_type text;
  v_due jsonb;
  v_due_type text;
  v_plan jsonb;
  v_first jsonb;
  v_first_type text;
  v_remainders integer := 0;
  v_count integer;
  v_offset integer;
  v_unit text;
  v_percent text;
  v_fixed text;
begin
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'object' then
    raise exception 'The payment schedule could not be read.';
  end if;
  if octet_length(p_schedule::text) > 100000 then
    raise exception 'The payment schedule is too large.';
  end if;
  if coalesce(p_schedule ->> 'schema_version', '') <> '1' then
    raise exception 'This payment schedule uses a version this application cannot read.';
  end if;
  if jsonb_typeof(p_schedule -> 'no_payment_due') is distinct from 'boolean'
    or jsonb_typeof(p_schedule -> 'dates_need_review') is distinct from 'boolean'
    or jsonb_typeof(p_schedule -> 'rows') is distinct from 'array'
  then
    raise exception 'The payment schedule could not be read.';
  end if;
  if jsonb_array_length(p_schedule -> 'rows') > 20 then
    raise exception 'A payment schedule can contain at most 20 payments.';
  end if;

  for v_row in select value from jsonb_array_elements(p_schedule -> 'rows') loop
    v_index := v_index + 1;
    v_name := 'Payment ' || v_index::text;
    if jsonb_typeof(v_row) <> 'object' then
      raise exception '% could not be read.', v_name;
    end if;
    v_id := v_row ->> 'id';
    if private.as_uuid(v_id) is null or v_id = any(v_ids) then
      raise exception '% needs its own payment identifier.', v_name;
    end if;
    v_ids := array_append(v_ids, v_id);
    v_label := btrim(coalesce(v_row ->> 'label', ''));
    if v_row -> 'label' is null or jsonb_typeof(v_row -> 'label') <> 'string' then
      raise exception '% could not be read.', v_name;
    end if;
    if char_length(v_label) > 80 then
      raise exception '% has a label that is too long.', coalesce(nullif(v_label, ''), v_name);
    end if;
    if v_label ~ '[\n\r]' then
      raise exception 'A payment label cannot contain a line break.';
    end if;
    if v_label <> '' then
      v_name := v_label;
    end if;

    v_amount := v_row -> 'amount';
    v_amount_type := v_amount ->> 'type';
    if v_amount_type = 'unset' then
      v_amount := '{"type":"unset"}'::jsonb;
    elsif v_amount_type = 'remainder' then
      v_remainders := v_remainders + 1;
      v_amount := '{"type":"remainder"}'::jsonb;
    elsif v_amount_type = 'percent' then
      v_percent := private.payment_clean_decimal(v_amount ->> 'percent', v_name || ': the percentage', 4, 100);
      v_amount := jsonb_build_object('type', 'percent', 'percent', v_percent);
    elsif v_amount_type = 'fixed' then
      v_fixed := private.payment_clean_decimal(v_amount ->> 'amount', v_name || ': the amount', 2, null);
      v_amount := jsonb_build_object('type', 'fixed', 'amount', v_fixed);
    else
      raise exception '% has an invalid amount.', v_name;
    end if;

    v_due := v_row -> 'due';
    v_due_type := v_due ->> 'type';
    if v_due_type = 'unset' then
      v_due := '{"type":"unset"}'::jsonb;
    elsif v_due_type = 'date' then
      if nullif(btrim(coalesce(v_due ->> 'date', '')), '') is not null then
        perform private.as_date(btrim(v_due ->> 'date'));
      end if;
      v_due := jsonb_build_object('type', 'date', 'date', nullif(btrim(coalesce(v_due ->> 'date', '')), ''));
    elsif v_due_type = 'before_shipment' then
      if nullif(btrim(coalesce(v_due ->> 'deadline', '')), '') is not null then
        perform private.as_date(btrim(v_due ->> 'deadline'));
      end if;
      v_due := jsonb_build_object('type', 'before_shipment', 'deadline', nullif(btrim(coalesce(v_due ->> 'deadline', '')), ''));
    elsif v_due_type = 'on_event' then
      v_due := jsonb_build_object('type', 'on_event', 'event', private.sanitize_payment_event(v_due -> 'event', v_name));
    elsif v_due_type = 'after_event' then
      v_unit := v_due ->> 'unit';
      if v_unit is not null and v_unit not in ('days', 'months') then
        raise exception '% must use days or calendar months.', v_name;
      end if;
      v_offset := private.payment_clean_whole(
        v_due -> 'offset',
        v_name || ': the milestone offset',
        0,
        case when v_unit = 'days' then 36600 else 1200 end
      );
      v_due := jsonb_build_object(
        'type', 'after_event',
        'event', private.sanitize_payment_event(v_due -> 'event', v_name),
        'offset', v_offset,
        'unit', v_unit
      );
    else
      raise exception '% has an invalid due rule.', v_name;
    end if;

    if v_row -> 'instalments' is null or jsonb_typeof(v_row -> 'instalments') = 'null' then
      v_plan := null;
    elsif jsonb_typeof(v_row -> 'instalments') <> 'object' then
      raise exception '% has invalid instalments.', v_name;
    else
      v_count := private.payment_clean_whole(v_row -> 'instalments' -> 'count', v_name || ': instalments', 2, 120);
      if (v_row -> 'instalments' ->> 'frequency') is null then
        v_unit := null;
      elsif (v_row -> 'instalments' ->> 'frequency') in ('monthly', 'yearly') then
        v_unit := v_row -> 'instalments' ->> 'frequency';
      else
        raise exception '% must use monthly or yearly instalments.', v_name;
      end if;
      v_first := v_row -> 'instalments' -> 'first';
      v_first_type := v_first ->> 'type';
      if v_first_type = 'unset' then
        v_first := '{"type":"unset"}'::jsonb;
      elsif v_first_type = 'date' then
        if nullif(btrim(coalesce(v_first ->> 'date', '')), '') is not null then
          perform private.as_date(btrim(v_first ->> 'date'));
        end if;
        v_first := jsonb_build_object('type', 'date', 'date', nullif(btrim(coalesce(v_first ->> 'date', '')), ''));
      elsif v_first_type = 'after_event' then
        if (v_first ->> 'unit') is not null and (v_first ->> 'unit') not in ('days', 'months') then
          raise exception '% must use days or calendar months.', v_name;
        end if;
        v_offset := private.payment_clean_whole(
          v_first -> 'offset',
          v_name || ': the milestone offset',
          0,
          case when v_first ->> 'unit' = 'days' then 36600 else 1200 end
        );
        v_first := jsonb_build_object(
          'type', 'after_event',
          'event', private.sanitize_payment_event(v_first -> 'event', v_name),
          'offset', v_offset,
          'unit', v_first ->> 'unit'
        );
      else
        raise exception '% has an invalid first instalment.', v_name;
      end if;
      v_plan := jsonb_build_object(
        'count', case when v_count is null then 'null'::jsonb else to_jsonb(v_count) end,
        'frequency', case when v_unit is null then 'null'::jsonb else to_jsonb(v_unit) end,
        'first', v_first
      );
      v_due := '{"type":"unset"}'::jsonb;
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'label', v_label,
      'amount', v_amount,
      'due', v_due,
      'instalments', v_plan
    ));
  end loop;

  if v_remainders > 1 then
    raise exception 'Only one payment can be the remaining balance.';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'no_payment_due', (p_schedule ->> 'no_payment_due')::boolean,
    'dates_need_review', (p_schedule ->> 'dates_need_review')::boolean,
    'rows', v_rows
  );
end;
$$;
create or replace function private.payment_label_redundant(p_label text, p_row jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_norm text := lower(btrim(coalesce(p_label, '')));
  v_name text;
begin
  if v_norm = '' then
    return true;
  end if;
  if p_row -> 'instalments' is not null and jsonb_typeof(p_row -> 'instalments') = 'object' then
    return false;
  end if;
  if p_row -> 'due' ->> 'type' = 'before_shipment' and v_norm in ('before shipment', 'shipment') then
    return true;
  end if;
  if p_row -> 'due' ->> 'type' = 'on_event' then
    v_name := private.payment_event_name(p_row -> 'due' -> 'event');
    if v_norm = v_name or v_norm = 'upon ' || v_name then
      return true;
    end if;
  end if;
  return false;
end;
$$;

create or replace function private.payment_amount_phrase(
  p_row jsonb,
  p_amount numeric,
  p_independent numeric,
  p_total numeric,
  p_currency text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := p_row -> 'amount' ->> 'type';
  v_text text := '';
  v_percent numeric;
  v_label text := btrim(coalesce(p_row ->> 'label', ''));
begin
  if v_type = 'remainder' then
    v_percent := round(p_amount / p_total * 100, 2);
    if (p_amount / p_total * 100) = v_percent
      and round(p_total * v_percent / 100, 2) = p_amount
    then
      return 'the remaining ' || private.payment_percent_from_numeric(v_percent) || '%';
    end if;
    return 'the remaining balance of ' || private.payment_money(p_currency, p_amount);
  end if;
  if v_type = 'percent' then
    v_text := private.payment_percent_text(p_row -> 'amount' ->> 'percent') || '%';
    if p_amount is distinct from p_independent then
      v_text := v_text || ' (' || private.payment_money(p_currency, p_amount) || ')';
    end if;
  elsif v_type = 'fixed' then
    v_text := private.payment_money(p_currency, p_amount);
  end if;
  if not private.payment_label_redundant(v_label, p_row) then
    v_text := v_text || ' ' || v_label;
  end if;
  return v_text;
end;
$$;

create or replace function private.payment_timing_suffix(p_row jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_due jsonb := p_row -> 'due';
begin
  if v_due ->> 'type' = 'date' then
    return ' due on ' || private.payment_long_date((v_due ->> 'date')::date);
  elsif v_due ->> 'type' = 'on_event' then
    return ' upon ' || private.payment_event_name(v_due -> 'event');
  elsif v_due ->> 'type' = 'after_event' then
    return ' due ' || private.payment_offset_phrase((v_due ->> 'offset')::integer, v_due ->> 'unit', private.payment_event_name(v_due -> 'event'));
  elsif v_due ->> 'type' = 'before_shipment' and nullif(v_due ->> 'deadline', '') is not null then
    return ' before shipment, and no later than ' || private.payment_long_date((v_due ->> 'deadline')::date);
  elsif v_due ->> 'type' = 'before_shipment' then
    return ' before shipment';
  end if;
  return '';
end;
$$;

create or replace function private.payment_contract_formula(p_row jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_due jsonb := p_row -> 'due';
begin
  if v_due ->> 'type' = 'date' then
    return private.payment_long_date((v_due ->> 'date')::date);
  elsif v_due ->> 'type' = 'on_event' then
    return 'upon ' || private.payment_event_name(v_due -> 'event');
  elsif v_due ->> 'type' = 'after_event' then
    return private.payment_offset_phrase((v_due ->> 'offset')::integer, v_due ->> 'unit', private.payment_event_name(v_due -> 'event'));
  elsif v_due ->> 'type' = 'before_shipment' and nullif(v_due ->> 'deadline', '') is not null then
    return 'before shipment, and no later than ' || private.payment_long_date((v_due ->> 'deadline')::date);
  elsif v_due ->> 'type' = 'before_shipment' then
    return 'before shipment';
  end if;
  return '';
end;
$$;

create or replace function private.payment_expand_instalments(
  p_row_id text,
  p_amount numeric,
  p_plan jsonb,
  p_currency text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer := (p_plan ->> 'count')::integer;
  v_frequency text := p_plan ->> 'frequency';
  v_first jsonb := p_plan -> 'first';
  v_regular numeric := round(p_amount / v_count, 2);
  v_parts numeric[] := '{}';
  v_sequence integer;
  v_due_date date;
  v_formula text;
  v_lines jsonb := '[]'::jsonb;
  v_equal boolean := true;
  v_first_phrase text;
  v_group text;
  v_step integer;
  v_offset integer;
  v_event text;
  v_gap integer;
begin
  for v_sequence in 1..v_count - 1 loop
    v_parts[v_sequence] := v_regular;
  end loop;
  v_parts[v_count] := round(p_amount - (v_regular * (v_count - 1)), 2);
  for v_sequence in 1..v_count loop
    if v_parts[v_sequence] is null or v_parts[v_sequence] <= 0 then
      return jsonb_build_object('error', 'an instalment would be zero. Use fewer instalments or a larger amount.');
    end if;
  end loop;

  for v_sequence in 1..v_count loop
    v_due_date := null;
    v_formula := '';
    if v_first ->> 'type' = 'date' then
      v_step := case when v_frequency = 'yearly' then 12 else 1 end;
      v_due_date := private.add_calendar_months((v_first ->> 'date')::date, (v_sequence - 1) * v_step);
      v_formula := private.payment_long_date(v_due_date);
    elsif v_first ->> 'unit' = 'months' then
      v_offset := (v_first ->> 'offset')::integer;
      v_step := case when v_frequency = 'yearly' then 12 else 1 end;
      v_event := private.payment_event_name(v_first -> 'event');
      v_formula := private.payment_offset_phrase(v_offset + ((v_sequence - 1) * v_step), 'months', v_event);
    elsif v_sequence = 1 then
      v_formula := private.payment_offset_phrase((v_first ->> 'offset')::integer, 'days', private.payment_event_name(v_first -> 'event'));
    else
      v_gap := v_sequence - 1;
      v_event := private.payment_event_name(v_first -> 'event');
      if v_frequency = 'yearly' then
        v_formula := case when v_gap = 1 then 'one year' else private.payment_small_number(v_gap) || ' years' end
          || ' after the first instalment, which is due '
          || private.payment_offset_phrase((v_first ->> 'offset')::integer, 'days', v_event);
      else
        v_formula := case when v_gap = 1 then 'one calendar month' else private.payment_small_number(v_gap) || ' calendar months' end
          || ' after the first instalment, which is due '
          || private.payment_offset_phrase((v_first ->> 'offset')::integer, 'days', v_event);
      end if;
    end if;
    if v_parts[v_sequence] is distinct from v_parts[1] then
      v_equal := false;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'parent_id', p_row_id,
      'sequence', v_sequence,
      'count', v_count,
      'amount', private.payment_plain_amount(v_parts[v_sequence]),
      'due_date', v_due_date,
      'due_formula', v_formula
    ));
  end loop;

  if v_first ->> 'type' = 'date' then
    v_first_phrase := 'on ' || private.payment_long_date((v_first ->> 'date')::date);
  else
    v_first_phrase := private.payment_offset_phrase((v_first ->> 'offset')::integer, v_first ->> 'unit', private.payment_event_name(v_first -> 'event'));
  end if;
  if v_equal then
    v_group := format('payable in %s %s instalments, with the first instalment due %s', v_count, v_frequency, v_first_phrase);
  else
    v_group := format(
      'payable in %s %s instalments of %s, with a final instalment of %s, the first instalment due %s',
      v_count,
      v_frequency,
      private.payment_money(p_currency, v_parts[1]),
      private.payment_money(p_currency, v_parts[v_count]),
      v_first_phrase
    );
  end if;
  return jsonb_build_object('error', null, 'formula', v_group, 'instalments', v_lines);
end;
$$;
create or replace function private.canonical_payment(p_schedule jsonb, p_currency text, p_total numeric)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_errors text := '';
  v_rows jsonb := coalesce(p_schedule -> 'rows', '[]'::jsonb);
  v_count integer := coalesce(jsonb_array_length(v_rows), 0);
  v_index integer;
  v_row jsonb;
  v_name text;
  v_basis text[] := '{}';
  v_amount numeric[] := '{}';
  v_percent numeric[] := '{}';
  v_independent numeric[] := '{}';
  v_row_json jsonb[] := '{}';
  v_ids text[] := '{}';
  v_remainder_count integer := 0;
  v_remainder_index integer := null;
  v_sum numeric := 0;
  v_percent_sum numeric := 0;
  v_percent_only boolean := true;
  v_known boolean := true;
  v_diff numeric;
  v_clauses text[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_text text;
  v_groups integer := 0;
  v_expanded integer := 0;
  v_presentation text;
  v_plan jsonb;
  v_expanded_json jsonb;
  v_due_date date;
  v_positive_issue boolean := false;
begin
  if p_currency not in ('EGP', 'USD', 'EUR') then
    raise exception 'Choose an office and currency before the payment amounts can be calculated.';
  end if;
  if p_total is null then
    raise exception 'Enter a price on every item before the payment amounts can be calculated.';
  end if;
  if p_total < 0 then
    raise exception 'The grand total cannot be negative.';
  end if;

  if coalesce((p_schedule ->> 'no_payment_due')::boolean, false) then
    if v_count > 0 then
      v_errors := private.payment_note(v_errors, 'Remove the payment rows, or turn off no payment due.');
    end if;
    if p_total <> 0 then
      v_errors := private.payment_note(v_errors, 'No payment due does not match the grand total. The PI total is not zero.');
    end if;
    if v_errors <> '' then
      raise exception '%', v_errors;
    end if;
    return jsonb_build_object(
      'schema_version', 1,
      'currency', p_currency,
      'grand_total', private.payment_plain_amount(p_total),
      'customer_text', 'No payment due.',
      'presentation', 'paragraph',
      'no_payment_due', true,
      'rows', '[]'::jsonb
    );
  end if;

  if p_total = 0 then
    raise exception 'This PI total is zero. Mark the schedule as no payment due, or change the PI total.';
  end if;
  if v_count = 0 then
    raise exception 'Add a payment before issuing.';
  end if;
  if v_count > 20 then
    v_errors := private.payment_note(v_errors, 'A payment schedule can contain at most 20 payments.');
  end if;

  for v_index in 1..v_count loop
    v_row := v_rows -> (v_index - 1);
    v_row_json[v_index] := v_row;
    v_name := nullif(btrim(coalesce(v_row ->> 'label', '')), '');
    if v_name is null then
      v_name := 'Payment ' || v_index::text;
    end if;
    if v_row ->> 'id' is null or v_row ->> 'id' = any(v_ids) then
      v_errors := private.payment_note(v_errors, v_name || ' needs its own payment identifier.');
    end if;
    v_ids := array_append(v_ids, coalesce(v_row ->> 'id', ''));
    v_basis[v_index] := v_row -> 'amount' ->> 'type';
    v_amount[v_index] := null;
    v_percent[v_index] := null;
    v_independent[v_index] := null;

    if v_basis[v_index] = 'unset' or v_basis[v_index] is null then
      v_errors := private.payment_note(v_errors, v_name || ': choose an amount.');
      v_basis[v_index] := 'fixed';
      v_known := false;
      v_percent_only := false;
    elsif v_basis[v_index] = 'remainder' then
      v_remainder_count := v_remainder_count + 1;
      v_remainder_index := v_index;
      v_percent_only := false;
    elsif v_basis[v_index] = 'percent' then
      if nullif(btrim(coalesce(v_row -> 'amount' ->> 'percent', '')), '') is null then
        v_errors := private.payment_note(v_errors, v_name || ': enter the percentage.');
        v_known := false;
        v_percent_only := false;
      else
        begin
          v_percent[v_index] := btrim(v_row -> 'amount' ->> 'percent')::numeric;
        exception when others then
          v_errors := private.payment_note(v_errors, v_name || ': the percentage must be a nonnegative number.');
          v_known := false;
          v_percent_only := false;
        end;
        if v_percent[v_index] is not null then
          if v_percent[v_index] = 0 then
            v_errors := private.payment_note(v_errors, v_name || ': the percentage must be greater than zero.');
          elsif v_percent[v_index] > 100 then
            v_errors := private.payment_note(v_errors, v_name || ': the percentage cannot be more than 100.');
          end if;
          v_amount[v_index] := round(p_total * v_percent[v_index] / 100, 2);
          v_independent[v_index] := v_amount[v_index];
          if v_amount[v_index] <= 0 then
            v_errors := private.payment_note(v_errors, v_name || ': the percentage rounds to zero. Increase it or use a fixed amount.');
          end if;
        end if;
      end if;
    elsif v_basis[v_index] = 'fixed' then
      v_percent_only := false;
      if nullif(btrim(coalesce(v_row -> 'amount' ->> 'amount', '')), '') is null then
        v_errors := private.payment_note(v_errors, v_name || ': enter the amount.');
        v_known := false;
      else
        begin
          v_amount[v_index] := round(btrim(v_row -> 'amount' ->> 'amount')::numeric, 2);
          v_independent[v_index] := v_amount[v_index];
        exception when others then
          v_errors := private.payment_note(v_errors, v_name || ': the amount must be a nonnegative number.');
          v_known := false;
        end;
        if v_amount[v_index] = 0 then
          v_errors := private.payment_note(v_errors, v_name || ': the amount must be greater than zero.');
        end if;
      end if;
    else
      v_errors := private.payment_note(v_errors, v_name || ': choose an amount.');
      v_known := false;
      v_percent_only := false;
    end if;

    v_plan := v_row -> 'instalments';
    if v_plan is not null and jsonb_typeof(v_plan) = 'object' then
      if v_plan ->> 'count' is null then
        v_errors := private.payment_note(v_errors, v_name || ': enter the number of instalments.');
      elsif (v_plan ->> 'count')::integer < 2 or (v_plan ->> 'count')::integer > 120 then
        v_errors := private.payment_note(v_errors, v_name || ': instalments must be a whole number from 2 to 120.');
      end if;
      if coalesce(v_plan ->> 'frequency', '') not in ('monthly', 'yearly') then
        v_errors := private.payment_note(v_errors, v_name || ': choose monthly or yearly instalments.');
      end if;
      if coalesce(v_plan -> 'first' ->> 'type', 'unset') = 'unset' then
        v_errors := private.payment_note(v_errors, v_name || ': choose when the first instalment is due.');
      elsif v_plan -> 'first' ->> 'type' = 'date' and nullif(v_plan -> 'first' ->> 'date', '') is null then
        v_errors := private.payment_note(v_errors, v_name || ': enter the first instalment date.');
      elsif v_plan -> 'first' ->> 'type' = 'after_event' then
        if v_plan -> 'first' -> 'event' is null or jsonb_typeof(v_plan -> 'first' -> 'event') = 'null' then
          v_errors := private.payment_note(v_errors, v_name || ': choose the milestone.');
        elsif v_plan -> 'first' -> 'event' ->> 'type' = 'custom' and btrim(coalesce(v_plan -> 'first' -> 'event' ->> 'label', '')) = '' then
          v_errors := private.payment_note(v_errors, v_name || ': enter a name for the custom milestone.');
        end if;
        if coalesce(v_plan -> 'first' ->> 'unit', '') not in ('days', 'months') then
          v_errors := private.payment_note(v_errors, v_name || ': choose days or calendar months.');
        elsif v_plan -> 'first' ->> 'offset' is null then
          v_errors := private.payment_note(v_errors, v_name || ': enter how many ' || coalesce(v_plan -> 'first' ->> 'unit', 'days') || ' after the milestone.');
        end if;
      end if;
    else
      if coalesce(v_row -> 'due' ->> 'type', 'unset') = 'unset' then
        v_errors := private.payment_note(v_errors, v_name || ': choose when it is due.');
      elsif v_row -> 'due' ->> 'type' = 'date' and nullif(v_row -> 'due' ->> 'date', '') is null then
        v_errors := private.payment_note(v_errors, v_name || ': enter the due date.');
      elsif v_row -> 'due' ->> 'type' = 'on_event' then
        if v_row -> 'due' -> 'event' is null or jsonb_typeof(v_row -> 'due' -> 'event') = 'null' then
          v_errors := private.payment_note(v_errors, v_name || ': choose the milestone.');
        elsif v_row -> 'due' -> 'event' ->> 'type' = 'custom' and btrim(coalesce(v_row -> 'due' -> 'event' ->> 'label', '')) = '' then
          v_errors := private.payment_note(v_errors, v_name || ': enter a name for the custom milestone.');
        end if;
      elsif v_row -> 'due' ->> 'type' = 'after_event' then
        if v_row -> 'due' -> 'event' is null or jsonb_typeof(v_row -> 'due' -> 'event') = 'null' then
          v_errors := private.payment_note(v_errors, v_name || ': choose the milestone.');
        elsif v_row -> 'due' -> 'event' ->> 'type' = 'custom' and btrim(coalesce(v_row -> 'due' -> 'event' ->> 'label', '')) = '' then
          v_errors := private.payment_note(v_errors, v_name || ': enter a name for the custom milestone.');
        end if;
        if coalesce(v_row -> 'due' ->> 'unit', '') not in ('days', 'months') then
          v_errors := private.payment_note(v_errors, v_name || ': choose days or calendar months.');
        elsif v_row -> 'due' ->> 'offset' is null then
          v_errors := private.payment_note(v_errors, v_name || ': enter how many ' || coalesce(v_row -> 'due' ->> 'unit', 'days') || ' after the milestone.');
        end if;
      end if;
    end if;
  end loop;

  if v_remainder_count > 1 then
    v_errors := private.payment_note(v_errors, 'Only one payment can be the remaining balance.');
    v_known := false;
  end if;

  if v_known then
    for v_index in 1..v_count loop
      if v_basis[v_index] = 'remainder' then
        continue;
      end if;
      v_sum := v_sum + coalesce(v_amount[v_index], 0);
      if v_basis[v_index] = 'percent' and v_percent[v_index] is not null then
        v_percent_sum := v_percent_sum + v_percent[v_index];
      end if;
    end loop;
    if v_percent_only and v_percent_sum = 100 then
      v_diff := p_total - v_sum;
      if v_diff <> 0 then
        if abs(v_diff) > (v_count * 0.01) then
          v_errors := private.payment_note(v_errors, 'The percentage payments differ from the grand total by ' || private.payment_plain_amount(abs(v_diff)) || ', which is too large to treat as rounding.');
        else
          v_amount[v_count] := v_amount[v_count] + v_diff;
          if v_amount[v_count] <= 0 then
            v_errors := private.payment_note(v_errors, coalesce(nullif(btrim(v_row_json[v_count] ->> 'label'), ''), 'Payment ' || v_count::text) || ': rounding would remove this payment. Adjust the percentages.');
          else
            v_sum := p_total;
          end if;
        end if;
      end if;
    end if;

    if v_remainder_index is not null then
      if v_sum > p_total then
        v_errors := private.payment_note(v_errors, 'The other payments allocate ' || private.payment_plain_amount(v_sum) || ' against a grand total of ' || private.payment_plain_amount(p_total) || '. Reduce a payment before the remaining balance can be used.');
      elsif p_total - v_sum <= 0 then
        v_errors := private.payment_note(v_errors, coalesce(nullif(btrim(v_row_json[v_remainder_index] ->> 'label'), ''), 'Payment ' || v_remainder_index::text) || ': the remaining balance is not positive.');
      else
        v_amount[v_remainder_index] := p_total - v_sum;
        v_independent[v_remainder_index] := v_amount[v_remainder_index];
        v_sum := p_total;
      end if;
    elsif v_sum > p_total then
      v_errors := private.payment_note(v_errors, 'The payment schedule allocates ' || private.payment_plain_amount(v_sum) || ' against a grand total of ' || private.payment_plain_amount(p_total) || '. Reduce a payment before issuing.');
    elsif v_sum < p_total then
      v_errors := private.payment_note(v_errors, 'The payment schedule allocates ' || private.payment_plain_amount(v_sum) || ' of ' || private.payment_plain_amount(p_total) || '. ' || private.payment_plain_amount(p_total - v_sum) || ' is still unallocated. Add a payment or a remaining-balance row before issuing.');
    end if;

    for v_index in 1..v_count loop
      if v_amount[v_index] is not null and v_amount[v_index] <= 0 then
        v_positive_issue := true;
      end if;
      v_plan := v_row_json[v_index] -> 'instalments';
      if v_amount[v_index] is not null and v_amount[v_index] > 0 and v_plan is not null and jsonb_typeof(v_plan) = 'object'
        and v_plan ->> 'count' is not null and v_plan ->> 'frequency' in ('monthly', 'yearly')
        and coalesce(v_plan -> 'first' ->> 'type', '') in ('date', 'after_event')
      then
        v_expanded_json := private.payment_expand_instalments(v_row_json[v_index] ->> 'id', v_amount[v_index], v_plan, p_currency);
        if v_expanded_json ->> 'error' is not null then
          v_errors := private.payment_note(v_errors, coalesce(nullif(btrim(v_row_json[v_index] ->> 'label'), ''), 'Payment ' || v_index::text) || ': ' || (v_expanded_json ->> 'error'));
        end if;
      end if;
    end loop;
    if v_positive_issue and v_sum = p_total then
      v_errors := private.payment_note(v_errors, 'Every scheduled payment must be greater than zero.');
    end if;
  end if;

  if v_errors <> '' then
    raise exception '%', v_errors;
  end if;

  for v_index in 1..v_count loop
    v_row := v_row_json[v_index];
    v_plan := v_row -> 'instalments';
    v_expanded_json := null;
    v_due_date := null;
    if v_plan is not null and jsonb_typeof(v_plan) = 'object' then
      v_expanded_json := private.payment_expand_instalments(v_row ->> 'id', v_amount[v_index], v_plan, p_currency);
      v_groups := v_groups + 1;
      v_expanded := v_expanded + coalesce(jsonb_array_length(v_expanded_json -> 'instalments'), 0);
      v_clauses := array_append(v_clauses, private.payment_amount_phrase(v_row, v_amount[v_index], v_independent[v_index], p_total, p_currency) || ' ' || (v_expanded_json ->> 'formula'));
    else
      v_clauses := array_append(v_clauses, private.payment_amount_phrase(v_row, v_amount[v_index], v_independent[v_index], p_total, p_currency) || private.payment_timing_suffix(v_row));
      if v_row -> 'due' ->> 'type' = 'date' then
        v_due_date := (v_row -> 'due' ->> 'date')::date;
      elsif v_row -> 'due' ->> 'type' = 'before_shipment' and nullif(v_row -> 'due' ->> 'deadline', '') is not null then
        v_due_date := (v_row -> 'due' ->> 'deadline')::date;
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_row ->> 'id',
      'position', v_index,
      'label', btrim(coalesce(v_row ->> 'label', '')),
      'amount_basis', v_row -> 'amount',
      'amount', private.payment_plain_amount(v_amount[v_index]),
      'due', case when v_plan is not null and jsonb_typeof(v_plan) = 'object' then '{"type":"unset"}'::jsonb else v_row -> 'due' end,
      'due_date', v_due_date,
      'due_formula', case
        when v_expanded_json is not null then v_expanded_json ->> 'formula'
        else private.payment_contract_formula(v_row)
      end,
      'instalment_plan', case when v_plan is null or jsonb_typeof(v_plan) = 'null' then null else v_plan end,
      'instalments', case when v_expanded_json is null then null else v_expanded_json -> 'instalments' end
    ));
  end loop;

  v_text := private.payment_join_clauses(v_clauses);
  if v_count > 4 or v_groups > 1 or v_expanded > 12 or char_length(v_text) > 420 then
    v_presentation := 'table';
  else
    v_presentation := 'paragraph';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'currency', p_currency,
    'grand_total', private.payment_plain_amount(p_total),
    'customer_text', v_text,
    'presentation', v_presentation,
    'no_payment_due', false,
    'rows', v_out
  );
end;
$$;

create or replace function private.copy_payment_schedule_for_duplicate(p_schedule jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_map jsonb := '{}'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_due jsonb;
  v_plan jsonb;
  v_first jsonb;
  v_event jsonb;
  v_cleared boolean := false;
begin
  if p_schedule is null then
    return null;
  end if;
  for v_row in select value from jsonb_array_elements(coalesce(p_schedule -> 'rows', '[]'::jsonb)) loop
    v_due := coalesce(v_row -> 'due', '{"type":"unset"}'::jsonb);
    if v_due ->> 'type' = 'date' and nullif(v_due ->> 'date', '') is not null then
      v_due := jsonb_set(v_due, '{date}', 'null'::jsonb);
      v_cleared := true;
    end if;
    if v_due ->> 'type' = 'before_shipment' and nullif(v_due ->> 'deadline', '') is not null then
      v_due := jsonb_set(v_due, '{deadline}', 'null'::jsonb);
      v_cleared := true;
    end if;
    if v_due ->> 'type' in ('on_event', 'after_event') then
      select e.event, e.map into v_event, v_map from private.payment_remap_event(v_due -> 'event', v_map) as e;
      v_due := jsonb_set(v_due, '{event}', coalesce(v_event, 'null'::jsonb));
    end if;
    v_plan := v_row -> 'instalments';
    if v_plan is not null and jsonb_typeof(v_plan) = 'object' then
      v_first := coalesce(v_plan -> 'first', '{"type":"unset"}'::jsonb);
      if v_first ->> 'type' = 'date' and nullif(v_first ->> 'date', '') is not null then
        v_first := jsonb_set(v_first, '{date}', 'null'::jsonb);
        v_cleared := true;
      end if;
      if v_first ->> 'type' = 'after_event' then
        select e.event, e.map into v_event, v_map from private.payment_remap_event(v_first -> 'event', v_map) as e;
        v_first := jsonb_set(v_first, '{event}', coalesce(v_event, 'null'::jsonb));
      end if;
      v_plan := jsonb_set(v_plan, '{first}', v_first);
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', extensions.gen_random_uuid(),
      'label', coalesce(v_row ->> 'label', ''),
      'amount', v_row -> 'amount',
      'due', v_due,
      'instalments', v_plan
    ));
  end loop;
  return jsonb_build_object(
    'schema_version', 1,
    'no_payment_due', coalesce((p_schedule ->> 'no_payment_due')::boolean, false),
    'dates_need_review', v_cleared,
    'rows', v_rows
  );
end;
$$;
-- Existing PI operations, with the schedule saved and checked in the same transaction.
create or replace function private.persist_draft(p_id uuid, p_expected_version integer, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_preset_code text;
  v_office text;
  v_currency text;
  v_date date;
  v_expiry date;
  v_client uuid;
  v_contact uuid;
  v_lead uuid;
  v_sales uuid[];
  v_line jsonb;
  v_index integer := 0;
  v_product uuid;
  v_vendor uuid;
  v_product_vendor uuid;
  v_vendor_name text;
  v_model text;
  v_quantity numeric;
  v_price numeric;
  v_payment_terms text;
  v_schedule jsonb;
begin
  if not private.is_active_member() then
    raise exception 'Your account is disabled or you are not signed in.';
  end if;
  if not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to edit drafts.';
  end if;

  select * into v_pi from public.proforma_invoices where id = p_id for update;
  if not found then
    raise exception 'PI not found.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  if not v_pi.draft_open then
    raise exception 'This PI is not an open draft. Create a revision before editing.';
  end if;
  if v_pi.tracking_status = 'cancelled' then
    raise exception 'Cancelled PIs cannot be edited.';
  end if;
  if v_pi.draft_version <> p_expected_version then
    raise exception 'This draft was updated by someone else. Reload the draft and try again.'
      using errcode = '40001';
  end if;

  v_preset_code := nullif(p_payload ->> 'preset_code', '');
  v_date := private.as_date(p_payload ->> 'pi_date');
  v_expiry := private.as_date(p_payload ->> 'expiry_date');
  v_client := private.as_uuid(p_payload ->> 'client_id');
  v_contact := private.as_uuid(p_payload ->> 'client_contact_id');
  v_lead := private.as_uuid(p_payload ->> 'lead_salesperson_id');

  if v_pi.pi_number is not null then
    if v_preset_code is distinct from v_pi.preset_code then
      raise exception 'Office and currency cannot change after a PI number is issued. Duplicate the PI instead.';
    end if;
    if v_date is not null and extract(year from v_date)::integer <> v_pi.pi_year then
      raise exception 'The PI year cannot change after a number is issued. Duplicate the PI instead.';
    end if;
  end if;

  if v_preset_code is not null then
    select office, currency into v_office, v_currency
    from public.company_presets where code = v_preset_code;
    if not found then
      raise exception 'Unknown office preset.';
    end if;
  end if;

  if v_client is not null and not exists (select 1 from public.clients where id = v_client) then
    raise exception 'Client not found.';
  end if;
  if v_contact is not null and not exists (
    select 1 from public.client_contacts where id = v_contact and client_id = v_client
  ) then
    raise exception 'The contact does not belong to the selected client.';
  end if;
  if v_lead is not null and not exists (
    select 1 from public.profiles where id = v_lead and is_salesperson
  ) then
    raise exception 'Lead salesperson must be a registered user marked as a salesperson.';
  end if;

  select coalesce(array_agg(distinct private.as_uuid(value)), '{}')
  into v_sales
  from jsonb_array_elements_text(coalesce(p_payload -> 'salesperson_ids', '[]'::jsonb)) as ids(value)
  where nullif(value, '') is not null;

  if v_lead is not null and not v_lead = any(v_sales) then
    v_sales := array_append(v_sales, v_lead);
  end if;
  if exists (
    select 1 from unnest(v_sales) as assigned(id)
    where not exists (select 1 from public.profiles p where p.id = assigned.id and p.is_salesperson)
  ) then
    raise exception 'Every assigned salesperson must be a registered user marked as a salesperson.';
  end if;

  if char_length(coalesce(p_payload ->> 'bill_to', '')) > 4000
    or char_length(coalesce(p_payload ->> 'ship_to', '')) > 4000
    or char_length(coalesce(p_payload ->> 'additional_notes', '')) > 8000
  then
    raise exception 'One of the text fields is too long.';
  end if;


  if p_payload ? 'payment_schedule' then
    if jsonb_typeof(p_payload -> 'payment_schedule') = 'null' then
      v_schedule := null;
      v_payment_terms := coalesce(p_payload ->> 'payment_terms', '');
    elsif jsonb_typeof(p_payload -> 'payment_schedule') = 'object' then
      v_schedule := private.sanitize_payment_schedule(p_payload -> 'payment_schedule');
      v_payment_terms := '';
    else
      raise exception 'The payment schedule could not be read.';
    end if;
  else
    v_schedule := v_pi.payment_schedule;
    if v_pi.payment_schedule is null then
      v_payment_terms := coalesce(p_payload ->> 'payment_terms', '');
    else
      v_payment_terms := '';
    end if;
  end if;

  update public.proforma_invoices
  set preset_code = v_preset_code,
      office = v_office,
      currency = v_currency,
      pi_date = v_date,
      expiry_date = v_expiry,
      client_id = v_client,
      client_contact_id = v_contact,
      bill_to = coalesce(p_payload ->> 'bill_to', ''),
      ship_to = case when coalesce((p_payload ->> 'ship_same_as_billing')::boolean, true)
        then coalesce(p_payload ->> 'bill_to', '')
        else coalesce(p_payload ->> 'ship_to', '') end,
      ship_same_as_billing = coalesce((p_payload ->> 'ship_same_as_billing')::boolean, true),
      customer_reference = coalesce(p_payload ->> 'customer_reference', ''),
      lead_salesperson_id = v_lead,
      discount_type = coalesce(p_payload ->> 'discount_type', 'none'),
      discount_value = private.as_numeric(p_payload ->> 'discount_value', 'Discount'),
      shipping_amount = private.as_numeric(p_payload ->> 'shipping_amount', 'Shipping'),
      installation_amount = private.as_numeric(p_payload ->> 'installation_amount', 'Installation'),
      bank_charge_amount = private.as_numeric(p_payload ->> 'bank_charge_amount', 'Bank charge'),
      tax_enabled = coalesce((p_payload ->> 'tax_enabled')::boolean, false),
      tax_percent = private.as_numeric(p_payload ->> 'tax_percent', 'Tax percentage'),
      tax_excludes_shipping = coalesce((p_payload ->> 'tax_excludes_shipping')::boolean, false),
      tax_excludes_installation = coalesce((p_payload ->> 'tax_excludes_installation')::boolean, false),
      tax_excludes_bank_charge = coalesce((p_payload ->> 'tax_excludes_bank_charge')::boolean, false),
      price_basis = coalesce(p_payload ->> 'price_basis', ''),
      payment_terms = v_payment_terms,
      payment_schedule = v_schedule,
      delivery_terms = coalesce(p_payload ->> 'delivery_terms', ''),
      warranty = coalesce(p_payload ->> 'warranty', ''),
      additional_notes = coalesce(p_payload ->> 'additional_notes', ''),
      draft_version = draft_version + 1,
      updated_at = now()
  where id = p_id;

  if (select discount_type from public.proforma_invoices where id = p_id) not in ('none', 'fixed', 'percent') then
    raise exception 'Invalid discount type.';
  end if;

  delete from public.pi_lines where pi_id = p_id;
  delete from public.pi_salespeople where pi_id = p_id;

  if jsonb_typeof(p_payload -> 'lines') = 'array' then
    if jsonb_array_length(p_payload -> 'lines') > 200 then
      raise exception 'A PI can contain at most 200 lines.';
    end if;
    for v_line in select value from jsonb_array_elements(p_payload -> 'lines')
    loop
      v_index := v_index + 1;
      v_product := private.as_uuid(v_line ->> 'product_id');
      v_vendor := private.as_uuid(v_line ->> 'vendor_id');
      v_quantity := private.as_numeric(v_line ->> 'quantity', 'Quantity');
      v_price := private.as_numeric(v_line ->> 'unit_price', 'Unit price');
      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Quantity must be greater than zero.';
      end if;
      if char_length(coalesce(v_line ->> 'description', '')) > 8000 then
        raise exception 'A line description is too long.';
      end if;
      if v_product is null then
        raise exception 'Every item must be a saved catalogue product. Select or create a model before saving.';
      end if;

      select p.model_code, p.vendor_id, v.company_name
      into v_model, v_product_vendor, v_vendor_name
      from public.products p
      left join public.vendors v on v.id = p.vendor_id
      where p.id = v_product;
      if not found then
        raise exception 'Product not found.';
      end if;
      if v_product_vendor is null or v_vendor_name is null or btrim(v_vendor_name) = '' then
        raise exception 'This product has no usable vendor. Assign a vendor on the product before saving it to a PI.';
      end if;
      if lower(btrim(coalesce(v_line ->> 'model_code', ''))) is distinct from lower(btrim(v_model)) then
        raise exception 'The model does not match the selected product (%). Select the product again before saving.', v_model;
      end if;
      if v_vendor is distinct from v_product_vendor then
        raise exception 'The vendor does not match the selected product. Select the product again before saving.';
      end if;

      insert into public.pi_lines (
        pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price
      ) values (
        p_id,
        v_index,
        v_product,
        v_product_vendor,
        v_vendor_name,
        v_model,
        coalesce(v_line ->> 'description', ''),
        coalesce(nullif(btrim(v_line ->> 'unit'), ''), 'unit'),
        v_quantity,
        v_price
      );
    end loop;
  end if;

  if coalesce(array_length(v_sales, 1), 0) > 0 then
    insert into public.pi_salespeople (pi_id, user_id)
    select p_id, assigned.id from unnest(v_sales) as assigned(id);
  end if;

  perform private.recalculate_pi(p_id);
end;
$$;
create or replace function private.assert_pi_ready(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_preset public.company_presets;
begin
  select * into v_pi from public.proforma_invoices where id = p_id;
  if v_pi.preset_code is null then
    raise exception 'Choose an office and currency before generating.';
  end if;
  select * into v_preset from public.company_presets where code = v_pi.preset_code;
  if btrim(v_preset.company_name) = ''
    or btrim(v_preset.address) = ''
    or btrim(v_preset.bank_name) = ''
    or btrim(v_preset.account_name) = ''
    or btrim(v_preset.account_number) = ''
    or btrim(v_preset.iban) = ''
    or btrim(v_preset.bank_swift) = ''
  then
    raise exception 'This preset is missing company or bank details. An administrator must complete it in Settings before a PI can be issued.';
  end if;
  if v_pi.pi_date is null or v_pi.expiry_date is null then
    raise exception 'PI date and expiry date are required.';
  end if;
  if v_pi.client_id is null or btrim(v_pi.bill_to) = '' then
    raise exception 'A client and billing address are required.';
  end if;
  if v_pi.lead_salesperson_id is null then
    raise exception 'A lead salesperson is required.';
  end if;
  if not exists (
    select 1 from public.pi_salespeople
    where pi_id = p_id and user_id = v_pi.lead_salesperson_id
  ) then
    raise exception 'The lead salesperson must be one of the assigned salespeople.';
  end if;
  if not exists (select 1 from public.pi_lines where pi_id = p_id) then
    raise exception 'Add at least one item before generating.';
  end if;
  if exists (
    select 1
    from public.pi_lines l
    where l.pi_id = p_id
      and (
        l.product_id is null
        or not exists (
          select 1
          from public.products p
          join public.vendors v on v.id = p.vendor_id
          where p.id = l.product_id
            and v.archived_at is null
            and btrim(v.company_name) <> ''
            and l.vendor_id = p.vendor_id
            and lower(btrim(l.model_code)) = lower(btrim(p.model_code))
        )
      )
  ) then
    raise exception 'Every item needs a saved product with a matching model and an active vendor before generating. Resolve the lines in the draft, or assign an active vendor on the product. Issued versions are not changed.';
  end if;
  if exists (
    select 1 from public.pi_lines
    where pi_id = p_id and (unit_price is null or btrim(description) = '' or btrim(unit) = '')
  ) then
    raise exception 'Every item needs a description, a unit, and an explicit selling price.';
  end if;
  if v_pi.payment_schedule is not null then
    perform private.canonical_payment(v_pi.payment_schedule, v_preset.currency, v_pi.grand_total);
  end if;
end;
$$;
create or replace function private.build_snapshot(p_id uuid, p_revision integer, p_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_preset public.company_presets;
  v_client public.clients;
  v_contact public.client_contacts;
  v_lead public.profiles;
  v_preparer text;
  v_display text;
  v_payment jsonb := null;
  v_layout text;
  v_payment_text text;
  v_snapshot jsonb;
begin
  select * into v_pi from public.proforma_invoices where id = p_id;
  select * into v_preset from public.company_presets where code = v_pi.preset_code;
  select * into v_client from public.clients where id = v_pi.client_id;
  select * into v_contact from public.client_contacts where id = v_pi.client_contact_id;
  select * into v_lead from public.profiles where id = v_pi.lead_salesperson_id;
  select full_name into v_preparer from public.profiles where id = (select auth.uid());
  v_display := case when p_revision = 0 then p_number else p_number || '-R' || p_revision::text end;


  if v_pi.payment_schedule is null then
    v_layout := case when v_preset.layout = 'uae' then 'uae-v1' else 'egypt-v1' end;
    v_payment_text := v_pi.payment_terms;
  else
    v_payment := private.canonical_payment(v_pi.payment_schedule, v_preset.currency, v_pi.grand_total);
    v_layout := case when v_preset.layout = 'uae' then 'uae-v2' else 'egypt-v2' end;
    v_payment_text := v_payment ->> 'customer_text';
  end if;

  v_snapshot := jsonb_build_object(
    'layout_version', v_layout,
    'preset_code', v_preset.code,
    'office', v_preset.office,
    'currency', v_preset.currency,
    'pi_number', p_number,
    'revision', p_revision,
    'revision_label', case when p_revision = 0 then null else 'R' || p_revision::text end,
    'display_number', v_display,
    'pi_date', v_pi.pi_date,
    'expiry_date', v_pi.expiry_date,
    'customer_reference', v_pi.customer_reference,
    'company', jsonb_build_object(
      'name', v_preset.company_name,
      'address', v_preset.address,
      'phone', v_preset.phone,
      'fax', v_preset.fax,
      'email', v_preset.email,
      'website', v_preset.website,
      'tax_registration', v_preset.tax_registration,
      'logo_base64', v_preset.logo_base64,
      'logo_content_type', v_preset.logo_content_type
    ),
    'bank', jsonb_build_object(
      'bank_name', v_preset.bank_name,
      'branch', v_preset.bank_branch,
      'address', v_preset.bank_address,
      'swift', v_preset.bank_swift,
      'account_name', v_preset.account_name,
      'account_number', v_preset.account_number,
      'iban', v_preset.iban,
      'correspondent_bank', v_preset.correspondent_bank,
      'notes', v_preset.bank_notes
    ),
    'client', jsonb_build_object(
      'company_name', coalesce(v_client.company_name, ''),
      'country', coalesce(v_client.country, ''),
      'tax_number', coalesce(v_client.tax_number, ''),
      'contact_name', coalesce(v_contact.name, ''),
      'contact_job_title', coalesce(v_contact.job_title, ''),
      'contact_phone', coalesce(v_contact.phone, ''),
      'contact_email', coalesce(v_contact.email, '')
    ),
    'bill_to', v_pi.bill_to,
    'ship_to', v_pi.ship_to,
    'sales', jsonb_build_object(
      'lead_name', coalesce(v_lead.full_name, ''),
      'lead_phone', coalesce(v_lead.phone, ''),
      'additional', coalesce((
        select jsonb_agg(jsonb_build_object('name', p.full_name) order by p.full_name)
        from public.pi_salespeople s
        join public.profiles p on p.id = s.user_id
        where s.pi_id = p_id and s.user_id <> v_pi.lead_salesperson_id
      ), '[]'::jsonb),
      'prepared_by', coalesce(v_preparer, '')
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'line_id', l.id,
        'product_id', l.product_id,
        'position', l.position,
        'model_code', l.model_code,
        'description', l.description,
        'unit', l.unit,
        'quantity', l.quantity::text,
        'unit_price', l.unit_price::text,
        'line_total', l.line_total::text
      ) order by l.position)
      from public.pi_lines l
      where l.pi_id = p_id
    ), '[]'::jsonb),
    'adjustments', jsonb_build_object(
      'discount_type', v_pi.discount_type,
      'discount_value', v_pi.discount_value::text,
      'discount_amount', v_pi.discount_amount::text,
      'shipping', v_pi.shipping_amount::text,
      'installation', v_pi.installation_amount::text,
      'bank_charge', v_pi.bank_charge_amount::text,
      'tax_enabled', v_pi.tax_enabled,
      'tax_percent', v_pi.tax_percent::text,
      'tax_excludes_shipping', v_pi.tax_excludes_shipping,
      'tax_excludes_installation', v_pi.tax_excludes_installation,
      'tax_excludes_bank_charge', v_pi.tax_excludes_bank_charge,
      'subtotal', v_pi.subtotal::text,
      'net_items', v_pi.net_items::text,
      'taxable_base', v_pi.taxable_base::text,
      'tax_amount', v_pi.tax_amount::text,
      'grand_total', v_pi.grand_total::text
    ),
    'terms', jsonb_build_object(
      'price_basis', v_pi.price_basis,
      'payment_terms', v_payment_text,
      'delivery_terms', v_pi.delivery_terms,
      'warranty', v_pi.warranty,
      'additional_notes', v_pi.additional_notes
    )
  );
  if v_payment is not null then
    v_snapshot := v_snapshot || jsonb_build_object('payment', v_payment);
  end if;
  return v_snapshot;
end;
$$;
create or replace function private.generate_pi(p_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_year integer;
  v_serial integer;
  v_number text;
  v_revision integer;
  v_version_id uuid;
  v_snapshot jsonb;
  v_preset public.company_presets;
begin
  if not private.is_active_member() then
    raise exception 'Your account is disabled or you are not signed in.';
  end if;
  if not private.has_flag('can_generate_pis') then
    raise exception 'You do not have permission to generate PIs.';
  end if;

  select * into v_pi from public.proforma_invoices where id = p_id for update;
  if not found then
    raise exception 'PI not found.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  if not v_pi.draft_open then
    raise exception 'This PI is already issued. Download it from version history, or create a revision.';
  end if;

  if private.has_flag('can_edit_drafts') then
    perform private.persist_draft(p_id, p_expected_version, p_payload);
  elsif v_pi.draft_version <> p_expected_version then
    raise exception 'This draft was updated by someone else. Reload the draft and try again.'
      using errcode = '40001';
  end if;

  perform private.assert_pi_ready(p_id);
  select * into v_pi from public.proforma_invoices where id = p_id;
  select * into v_preset from public.company_presets where code = v_pi.preset_code;
  v_year := extract(year from v_pi.pi_date)::integer;

  if v_pi.pi_number is null then
    v_serial := private.allocate_serial(v_preset.office, v_year);
    v_number := v_preset.office || '-' || v_year::text || '-' || lpad(v_serial::text, 5, '0');
    v_revision := 0;
    update public.proforma_invoices
    set pi_number = v_number,
        pi_year = v_year,
        serial = v_serial,
        office = v_preset.office,
        currency = v_preset.currency
    where id = p_id;
  else
    if v_year <> v_pi.pi_year or v_preset.office <> v_pi.office or v_preset.currency <> v_pi.currency then
      raise exception 'Office, currency, and PI year are locked on issued documents.';
    end if;
    select coalesce(max(revision), -1) + 1 into v_revision
    from public.pi_versions where pi_id = p_id;
    v_number := v_pi.pi_number;
  end if;

  v_snapshot := private.build_snapshot(p_id, v_revision, v_number);
  insert into public.pi_versions (
    pi_id, revision, pi_number, generated_by, snapshot, pdf_status, pdf_path, layout_version, grand_total
  ) values (
    p_id,
    v_revision,
    v_number,
    (select auth.uid()),
    v_snapshot,
    'issued',
    null,
    v_snapshot ->> 'layout_version',
    (select grand_total from public.proforma_invoices where id = p_id)
  )
  returning id into v_version_id;

  update public.proforma_invoices
  set draft_open = false,
      payment_terms = case
        when v_snapshot ? 'payment' then coalesce(v_snapshot #>> '{terms,payment_terms}', '')
        else payment_terms
      end,
      updated_at = now()
  where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'draft_version', (select draft_version from public.proforma_invoices where id = p_id),
    'version_id', v_version_id,
    'revision', v_revision,
    'pi_number', v_number,
    'display_number', v_snapshot ->> 'display_number',
    'snapshot', v_snapshot
  );
end;
$$;
create or replace function private.create_pi_draft()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_date date;
  v_expiry date;
begin
  if not private.is_active_member() then
    raise exception 'Your account is disabled or you are not signed in.';
  end if;
  if not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to create drafts.';
  end if;

  select dates.pi_date, dates.expiry_date
  into v_date, v_expiry
  from private.default_pi_dates() as dates;

  insert into public.proforma_invoices (
    created_by, pi_date, expiry_date, price_basis, payment_terms, delivery_terms, warranty, additional_notes, payment_schedule
  )
  select (select auth.uid()), v_date, v_expiry, price_basis, '', delivery_terms, warranty, additional_notes,
    jsonb_build_object(
      'schema_version', 1,
      'no_payment_due', false,
      'dates_need_review', false,
      'rows', '[]'::jsonb
    )
  from public.default_terms
  where id = 1
  returning id into v_id;
  return v_id;
end;
$$;
create or replace function private.duplicate_pi(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.proforma_invoices;
  v_id uuid;
  v_date date;
  v_expiry date;
begin
  if not private.is_active_member() or not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to duplicate PIs.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  select * into v_source from public.proforma_invoices where id = p_id for update;

  select dates.pi_date, dates.expiry_date
  into v_date, v_expiry
  from private.default_pi_dates() as dates;

  insert into public.proforma_invoices (
    preset_code, office, currency, pi_date, expiry_date, client_id, client_contact_id,
    bill_to, ship_to, ship_same_as_billing, customer_reference, lead_salesperson_id, created_by,
    discount_type, discount_value, shipping_amount, installation_amount, bank_charge_amount,
    tax_enabled, tax_percent, tax_excludes_shipping, tax_excludes_installation, tax_excludes_bank_charge,
    price_basis, payment_terms, delivery_terms, warranty, additional_notes, payment_schedule,
    subtotal, discount_amount, net_items, taxable_base, tax_amount, grand_total
  ) values (
    v_source.preset_code, v_source.office, v_source.currency, v_date, v_expiry,
    v_source.client_id, v_source.client_contact_id, v_source.bill_to, v_source.ship_to,
    v_source.ship_same_as_billing, v_source.customer_reference, v_source.lead_salesperson_id,
    (select auth.uid()), v_source.discount_type, v_source.discount_value, v_source.shipping_amount,
    v_source.installation_amount, v_source.bank_charge_amount, v_source.tax_enabled, v_source.tax_percent,
    v_source.tax_excludes_shipping, v_source.tax_excludes_installation, v_source.tax_excludes_bank_charge,
    v_source.price_basis,
    case when v_source.payment_schedule is null then v_source.payment_terms else '' end,
    v_source.delivery_terms, v_source.warranty,
    v_source.additional_notes,
    case when v_source.payment_schedule is null then null else private.copy_payment_schedule_for_duplicate(v_source.payment_schedule) end,
    v_source.subtotal, v_source.discount_amount, v_source.net_items,
    v_source.taxable_base, v_source.tax_amount, v_source.grand_total
  )
  returning id into v_id;

  insert into public.pi_lines (
    pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total
  )
  select v_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total
  from public.pi_lines where pi_id = p_id;

  insert into public.pi_salespeople (pi_id, user_id)
  select v_id, user_id from public.pi_salespeople where pi_id = p_id;

  return v_id;
end;
$$;
revoke all on function private.add_calendar_months(date, integer) from public, anon, authenticated;
revoke all on function private.payment_note(text, text) from public, anon, authenticated;
revoke all on function private.payment_plain_amount(numeric) from public, anon, authenticated;
revoke all on function private.payment_group_digits(text) from public, anon, authenticated;
revoke all on function private.payment_grouped_amount(numeric) from public, anon, authenticated;
revoke all on function private.payment_money(text, numeric) from public, anon, authenticated;
revoke all on function private.payment_percent_text(text) from public, anon, authenticated;
revoke all on function private.payment_percent_from_numeric(numeric) from public, anon, authenticated;
revoke all on function private.payment_long_date(date) from public, anon, authenticated;
revoke all on function private.payment_small_number(integer) from public, anon, authenticated;
revoke all on function private.payment_event_name(jsonb) from public, anon, authenticated;
revoke all on function private.payment_offset_phrase(integer, text, text) from public, anon, authenticated;
revoke all on function private.payment_join_clauses(text[]) from public, anon, authenticated;
revoke all on function private.payment_remap_event(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.payment_clean_decimal(text, text, integer, numeric) from public, anon, authenticated;
revoke all on function private.payment_clean_whole(jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function private.sanitize_payment_event(jsonb, text) from public, anon, authenticated;
revoke all on function private.sanitize_payment_schedule(jsonb) from public, anon, authenticated;
revoke all on function private.payment_label_redundant(text, jsonb) from public, anon, authenticated;
revoke all on function private.payment_amount_phrase(jsonb, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function private.payment_timing_suffix(jsonb) from public, anon, authenticated;
revoke all on function private.payment_contract_formula(jsonb) from public, anon, authenticated;
revoke all on function private.payment_expand_instalments(text, numeric, jsonb, text) from public, anon, authenticated;
revoke all on function private.canonical_payment(jsonb, text, numeric) from public, anon, authenticated;
revoke all on function private.copy_payment_schedule_for_duplicate(jsonb) from public, anon, authenticated;

comment on function private.canonical_payment(jsonb, text, numeric) is
  'Canonical payment amounts, instalments, and customer wording for one agreement. Ignores any amounts or prose supplied by the browser. Does not read purchase prices or record receipts.';
comment on function private.build_snapshot(uuid, integer, text) is
  'Issued document snapshot. Structured agreements use egypt-v2 or uae-v2 and store the canonical payment object. Legacy agreements stay on egypt-v1 or uae-v1. Older snapshots are not rewritten.';
