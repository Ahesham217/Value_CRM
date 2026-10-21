-- Payment tracking, receipt allocation, and subscription activation.
-- Additive: issued snapshots, PI numbering, and draft saves are unchanged.
-- Existing rows are not activated and no receipts are invented.
-- New write flags default to false. Administrators already pass private.has_flag.

alter table public.profiles
  add column if not exists can_manage_payments boolean not null default false,
  add column if not exists can_reverse_payments boolean not null default false,
  add column if not exists can_activate_zero_subscriptions boolean not null default false;

comment on column public.profiles.can_manage_payments is
  'Start payment tracking and record receipts. Existing members are not granted this by the migration.';
comment on column public.profiles.can_reverse_payments is
  'Reverse a posted receipt. Existing members are not granted this by the migration.';
comment on column public.profiles.can_activate_zero_subscriptions is
  'Activate a zero-value subscription at an explicit start date. Existing members are not granted this by the migration.';

create or replace function private.has_flag(p_flag text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles;
begin
  select * into v from public.profiles where id = (select auth.uid());
  if not found or not v.is_active then
    return false;
  end if;
  if v.is_admin then
    return true;
  end if;
  case p_flag
    when 'can_edit_drafts' then return v.can_edit_drafts;
    when 'can_generate_pis' then return v.can_generate_pis;
    when 'can_manage_clients' then return v.can_manage_clients;
    when 'can_manage_vendors' then return v.can_manage_vendors;
    when 'can_manage_products' then return v.can_manage_products;
    when 'can_view_purchase_prices' then return v.can_view_purchase_prices;
    when 'can_manage_payments' then return v.can_manage_payments;
    when 'can_reverse_payments' then return v.can_reverse_payments;
    when 'can_activate_zero_subscriptions' then return v.can_activate_zero_subscriptions;
    else return false;
  end case;
end;
$$;

create or replace function private.cairo_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (timezone('Africa/Cairo', pg_catalog.now()))::date;
$$;

create or replace function private.anniversary_date(p_anchor date, p_years integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_year integer;
  v_month integer;
  v_day integer;
begin
  if p_anchor is null or p_years is null or p_years < 0 then
    raise exception 'Invalid anniversary.';
  end if;
  v_year := extract(year from p_anchor)::integer + p_years;
  v_month := extract(month from p_anchor)::integer;
  v_day := extract(day from p_anchor)::integer;
  if v_month = 2 and v_day = 29 and not (
    (v_year % 4 = 0 and v_year % 100 <> 0) or (v_year % 400 = 0)
  ) then
    v_day := 28;
  end if;
  return make_date(v_year, v_month, v_day);
end;
$$;

comment on function private.anniversary_date(date, integer) is
  'Adds whole years to the original anchor. A 29 February anchor clamps to 28 February in a non-leap year and returns to 29 February in a later leap year.';

create or replace function private.next_committed_payment_date(p_start date, p_years integer, p_on date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_year integer;
  v_date date;
  v_next date := null;
begin
  if p_start is null or p_years is null or p_years < 2 or p_on is null then
    return null;
  end if;
  for v_year in 2..p_years loop
    v_date := private.anniversary_date(p_start, v_year - 1);
    if v_date >= p_on and (v_next is null or v_date < v_next) then
      v_next := v_date;
    end if;
  end loop;
  return v_next;
end;
$$;

create or replace function private.payment_collection_status(p_amount numeric, p_paid numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_amount = 0 then 'no_charge'
    when coalesce(p_paid, 0) <= 0 then 'unpaid'
    when coalesce(p_paid, 0) >= p_amount then 'paid'
    else 'partial'
  end;
$$;

create or replace function private.payment_due_state(
  p_timing text,
  p_due_date date,
  p_status text,
  p_today date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'paid' then 'settled'
    when p_timing is distinct from 'fixed' or p_due_date is null then 'unscheduled'
    when p_due_date < p_today then 'overdue'
    when p_due_date = p_today then 'due_today'
    else 'upcoming'
  end;
$$;

create or replace function private.awaiting_event_label(p_event jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event is null or jsonb_typeof(p_event) = 'null' then 'Awaiting date'
    when p_event ->> 'type' = 'custom' and btrim(coalesce(p_event ->> 'label', '')) <> '' then
      'Awaiting ' || btrim(p_event ->> 'label') || ' date'
    when p_event ->> 'type' = 'custom' then 'Awaiting milestone date'
    when p_event ->> 'code' = 'order_confirmation' then 'Awaiting confirmation date'
    when p_event ->> 'code' = 'shipment' then 'Awaiting shipment date'
    when p_event ->> 'code' = 'delivery' then 'Awaiting delivery date'
    when p_event ->> 'code' = 'commissioning' then 'Awaiting commissioning date'
    else 'Awaiting date'
  end;
$$;

create table public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  pi_id uuid not null unique references public.proforma_invoices (id) on delete restrict,
  source_version_id uuid not null unique references public.pi_versions (id) on delete restrict,
  currency text not null check (currency in ('EGP', 'USD', 'EUR')),
  agreed_total numeric(14, 2) not null check (agreed_total >= 0),
  schema_version smallint not null check (schema_version in (1, 2)),
  started_by uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  customer_agreed boolean not null default true check (customer_agreed)
);

comment on table public.payment_plans is
  'One active collection plan per PI, pinned to the issued version the customer agreed. A later revision does not replace it.';

create table public.payment_obligations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.payment_plans (id) on delete restrict,
  source_key text not null,
  kind text not null check (kind in ('payment_row', 'instalment', 'subscription_advance')),
  source_row_id text,
  sequence integer,
  label text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  due_date date,
  due_formula text not null default '',
  due_timing text not null check (due_timing in ('fixed', 'awaiting_event', 'deadline_unset', 'advance')),
  awaiting_label text not null default '',
  position integer not null check (position > 0),
  subscription_obligation_id text,
  unique (plan_id, source_key)
);

comment on column public.payment_obligations.source_key is
  'Stable identity from the source row id and instalment sequence, or the subscription obligation id. Display labels are not part of it.';

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.payment_plans (id) on delete restrict,
  currency text not null check (currency in ('EGP', 'USD', 'EUR')),
  amount numeric(14, 2) not null check (amount > 0),
  received_on date not null,
  method text not null check (method in ('bank_transfer', 'cash', 'cheque', 'other')),
  reference text,
  note text,
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null default now(),
  idempotency_key uuid not null,
  reversed_at timestamptz,
  reversed_by uuid references public.profiles (id),
  reversal_reason text,
  unique (plan_id, idempotency_key),
  check (reference is null or char_length(reference) <= 80),
  check (note is null or char_length(note) <= 400),
  check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (
      reversed_at is not null
      and reversed_by is not null
      and reversal_reason is not null
      and char_length(btrim(reversal_reason)) > 0
      and char_length(reversal_reason) <= 400
    )
  )
);

comment on table public.payment_receipts is
  'Money received against one PI. Posted rows are reversed, not edited or deleted. Bank references are not unique.';

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.payment_receipts (id) on delete restrict,
  obligation_id uuid not null references public.payment_obligations (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  unique (receipt_id, obligation_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete restrict,
  client_name text not null,
  client_link_matches_snapshot boolean not null,
  product_id uuid references public.products (id) on delete restrict,
  product_model text not null,
  product_description text not null,
  vendor_identity text not null default 'unavailable' check (vendor_identity = 'unavailable'),
  quantity numeric not null check (quantity > 0),
  currency text not null check (currency in ('EGP', 'USD', 'EUR')),
  pi_id uuid not null references public.proforma_invoices (id) on delete restrict,
  source_version_id uuid not null references public.pi_versions (id) on delete restrict,
  source_obligation_id text not null,
  payment_obligation_id uuid not null unique references public.payment_obligations (id) on delete restrict,
  commitment_years integer not null check (commitment_years >= 1 and commitment_years <= 30),
  first_year_negotiated_unit_price numeric(14, 2) not null check (first_year_negotiated_unit_price >= 0),
  later_year_base_unit_price numeric(14, 2),
  later_year_rule text,
  adjustment_compounds boolean not null default false,
  start_date date not null,
  commitment_end_date date not null,
  annual_periods jsonb not null,
  activated_by uuid not null references public.profiles (id),
  activated_at timestamptz not null default now(),
  activation_kind text not null check (activation_kind in ('payment', 'no_charge')),
  no_charge_reason text,
  state text not null check (state in ('active', 'payment_review_required')),
  agreement jsonb not null,
  unique (pi_id, source_obligation_id),
  check (commitment_end_date > start_date),
  check (adjustment_compounds = false),
  check (later_year_rule is null or later_year_rule in ('fixed_annual', 'vendor_confirmed_base_adjustment')),
  check (
    (commitment_years = 1 and later_year_base_unit_price is null and later_year_rule is null)
    or (commitment_years > 1 and later_year_base_unit_price is not null and later_year_rule is not null)
  ),
  check (
    (activation_kind = 'payment' and no_charge_reason is null)
    or (
      activation_kind = 'no_charge'
      and no_charge_reason is not null
      and char_length(btrim(no_charge_reason)) > 0
    )
  )
);

comment on table public.subscriptions is
  'One operational subscription per source obligation on a PI. The agreement is copied from the issued snapshot. Renewal invoices are not created here.';
comment on column public.subscriptions.vendor_identity is
  'Issued snapshots do not store a vendor. This stays unavailable so a current catalogue vendor is not treated as the historical one.';
comment on column public.subscriptions.client_link_matches_snapshot is
  'True only when the PI client record name still matches the client name saved from the issued snapshot.';

create index payment_obligations_plan_position_idx on public.payment_obligations (plan_id, position);
create index payment_receipts_plan_received_idx on public.payment_receipts (plan_id, received_on, recorded_at, id);
create index payment_allocations_obligation_idx on public.payment_allocations (obligation_id);
create index subscriptions_pi_idx on public.subscriptions (pi_id);

create or replace function private.payment_plan_version_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.pi_versions
    where id = new.source_version_id and pi_id = new.pi_id
  ) then
    raise exception 'The issued version does not belong to this PI.';
  end if;
  return new;
end;
$$;

create trigger payment_plans_version_matches
before insert or update on public.payment_plans
for each row execute function private.payment_plan_version_matches();

create or replace function private.payment_plans_are_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A payment plan cannot be deleted. Receipts stay with the agreed version.';
  end if;
  if new.pi_id is distinct from old.pi_id
    or new.source_version_id is distinct from old.source_version_id
    or new.currency is distinct from old.currency
    or new.agreed_total is distinct from old.agreed_total
    or new.schema_version is distinct from old.schema_version
    or new.started_by is distinct from old.started_by
    or new.started_at is distinct from old.started_at
  then
    raise exception 'The active payment plan cannot be retargeted or replaced in this phase.';
  end if;
  return new;
end;
$$;

create trigger payment_plans_immutable
before update or delete on public.payment_plans
for each row execute function private.payment_plans_are_immutable();

create or replace function private.payment_obligations_are_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment obligations cannot be deleted.';
  end if;
  if new is distinct from old then
    raise exception 'Payment obligations are copied from the issued version and cannot be edited.';
  end if;
  return new;
end;
$$;

create trigger payment_obligations_immutable
before update or delete on public.payment_obligations
for each row execute function private.payment_obligations_are_immutable();

create or replace function private.payment_receipts_are_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Posted receipts cannot be deleted. Reverse the receipt instead.';
  end if;
  if new.plan_id is distinct from old.plan_id
    or new.currency is distinct from old.currency
    or new.amount is distinct from old.amount
    or new.received_on is distinct from old.received_on
    or new.method is distinct from old.method
    or new.reference is distinct from old.reference
    or new.note is distinct from old.note
    or new.recorded_by is distinct from old.recorded_by
    or new.recorded_at is distinct from old.recorded_at
    or new.idempotency_key is distinct from old.idempotency_key
  then
    raise exception 'Posted receipts cannot be edited. Reverse the receipt and record a replacement.';
  end if;
  if old.reversed_at is not null and (
    new.reversed_at is distinct from old.reversed_at
    or new.reversed_by is distinct from old.reversed_by
    or new.reversal_reason is distinct from old.reversal_reason
  ) then
    raise exception 'This receipt has already been reversed.';
  end if;
  return new;
end;
$$;

create trigger payment_receipts_immutable
before update or delete on public.payment_receipts
for each row execute function private.payment_receipts_are_immutable();

create or replace function private.payment_allocations_are_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Receipt allocations cannot be changed. Reverse the receipt instead.';
end;
$$;

create trigger payment_allocations_immutable
before update or delete on public.payment_allocations
for each row execute function private.payment_allocations_are_immutable();

create or replace function private.payment_allocation_same_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select o.plan_id from public.payment_obligations o where o.id = new.obligation_id
  ) is distinct from (
    select r.plan_id from public.payment_receipts r where r.id = new.receipt_id
  ) then
    raise exception 'A receipt can only be allocated within its own PI.';
  end if;
  return new;
end;
$$;

create trigger payment_allocations_same_plan
before insert on public.payment_allocations
for each row execute function private.payment_allocation_same_plan();

create or replace function private.subscriptions_are_guarded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A subscription cannot be deleted. Payment review keeps the record.';
  end if;
  if new.id is distinct from old.id
    or new.client_id is distinct from old.client_id
    or new.client_name is distinct from old.client_name
    or new.client_link_matches_snapshot is distinct from old.client_link_matches_snapshot
    or new.product_id is distinct from old.product_id
    or new.product_model is distinct from old.product_model
    or new.product_description is distinct from old.product_description
    or new.vendor_identity is distinct from old.vendor_identity
    or new.quantity is distinct from old.quantity
    or new.currency is distinct from old.currency
    or new.pi_id is distinct from old.pi_id
    or new.source_version_id is distinct from old.source_version_id
    or new.source_obligation_id is distinct from old.source_obligation_id
    or new.payment_obligation_id is distinct from old.payment_obligation_id
    or new.commitment_years is distinct from old.commitment_years
    or new.first_year_negotiated_unit_price is distinct from old.first_year_negotiated_unit_price
    or new.later_year_base_unit_price is distinct from old.later_year_base_unit_price
    or new.later_year_rule is distinct from old.later_year_rule
    or new.adjustment_compounds is distinct from old.adjustment_compounds
    or new.start_date is distinct from old.start_date
    or new.commitment_end_date is distinct from old.commitment_end_date
    or new.annual_periods is distinct from old.annual_periods
    or new.activated_by is distinct from old.activated_by
    or new.activated_at is distinct from old.activated_at
    or new.activation_kind is distinct from old.activation_kind
    or new.no_charge_reason is distinct from old.no_charge_reason
    or new.agreement is distinct from old.agreement
  then
    raise exception 'The saved subscription agreement and start date cannot be edited.';
  end if;
  if old.state = 'payment_review_required' and new.state is distinct from old.state then
    raise exception 'Clearing payment review is not available in this phase.';
  end if;
  if old.state = 'active' and new.state not in ('active', 'payment_review_required') then
    raise exception 'That subscription state is not available.';
  end if;
  return new;
end;
$$;

create trigger subscriptions_guarded
before update or delete on public.subscriptions
for each row execute function private.subscriptions_are_guarded();

create or replace function private.payment_enforce_balances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obligation uuid := null;
  v_receipt uuid := null;
  v_paid numeric;
  v_amount numeric;
  v_allocated numeric;
  v_receipt_amount numeric;
begin
  if tg_table_name = 'payment_allocations' then
    v_obligation := new.obligation_id;
    v_receipt := new.receipt_id;
  else
    v_receipt := new.id;
  end if;

  if v_obligation is not null then
    select amount into v_amount from public.payment_obligations where id = v_obligation;
    select coalesce(sum(a.amount), 0) into v_paid
    from public.payment_allocations a
    join public.payment_receipts r on r.id = a.receipt_id
    where a.obligation_id = v_obligation
      and r.reversed_at is null;
    if v_paid > v_amount then
      raise exception 'An allocation exceeds the unpaid balance of a payment obligation.';
    end if;
  end if;

  if v_receipt is not null then
    select amount into v_receipt_amount from public.payment_receipts where id = v_receipt;
    select coalesce(sum(amount), 0) into v_allocated
    from public.payment_allocations
    where receipt_id = v_receipt;
    if v_allocated <> v_receipt_amount then
      raise exception 'Allocations must add up to the amount received.';
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger payment_allocations_balance
after insert on public.payment_allocations
deferrable initially deferred
for each row execute function private.payment_enforce_balances();

create constraint trigger payment_receipts_allocated
after insert on public.payment_receipts
deferrable initially deferred
for each row execute function private.payment_enforce_balances();

create or replace function private.classify_snapshot_due(p_due jsonb, p_due_date date, p_plan jsonb)
returns table (timing text, label text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := coalesce(p_due ->> 'type', '');
  v_first jsonb := p_plan -> 'first';
begin
  if p_due_date is not null then
    timing := 'fixed';
    label := '';
    return next;
    return;
  end if;
  if v_type = 'before_shipment' or coalesce(v_first ->> 'type', '') = 'before_shipment' then
    timing := 'deadline_unset';
    label := 'Deadline to be set';
    return next;
    return;
  end if;
  timing := 'awaiting_event';
  if v_type in ('on_event', 'after_event') then
    label := private.awaiting_event_label(p_due -> 'event');
  elsif coalesce(v_first ->> 'type', '') = 'after_event' then
    label := private.awaiting_event_label(v_first -> 'event');
  else
    label := 'Awaiting date';
  end if;
  return next;
end;
$$;

create or replace function private.payment_obligations_from_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_payment jsonb := p_snapshot -> 'payment';
  v_schema text;
  v_currency text;
  v_total numeric;
  v_adjustment numeric;
  v_rows jsonb;
  v_row jsonb;
  v_item jsonb;
  v_obligations jsonb := '[]'::jsonb;
  v_keys text[] := '{}';
  v_sub_ids text[] := '{}';
  v_position integer := 0;
  v_sum numeric := 0;
  v_amount numeric;
  v_due_date date;
  v_class record;
  v_key text;
  v_row_id text;
  v_sequence integer;
  v_label text;
  v_sub_id text;
  v_no_payment boolean;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Choose an issued version.';
  end if;
  if v_payment is null or jsonb_typeof(v_payment) = 'null' then
    raise exception 'This issued version uses a payment paragraph. Automatic payment allocation is not available, and the paragraph is not parsed.';
  end if;
  if jsonb_typeof(v_payment) <> 'object' then
    raise exception 'This issued version does not have a structured payment schedule.';
  end if;
  v_schema := v_payment ->> 'schema_version';
  if v_schema not in ('1', '2') then
    raise exception 'This payment schema version cannot be tracked. It was not reinterpreted as another version.';
  end if;
  v_currency := v_payment ->> 'currency';
  if v_currency is distinct from p_snapshot ->> 'currency' or v_currency not in ('EGP', 'USD', 'EUR') then
    raise exception 'The issued payment currency does not match the PI.';
  end if;
  begin
    v_total := (v_payment ->> 'grand_total')::numeric;
    v_adjustment := (p_snapshot #>> '{adjustments,grand_total}')::numeric;
  exception when others then
    raise exception 'The issued payment total could not be read.';
  end;
  if v_total is null or v_adjustment is null or v_total <> v_adjustment or v_total < 0 then
    raise exception 'The issued payment total does not match the issued PI total.';
  end if;
  v_no_payment := coalesce((v_payment ->> 'no_payment_due')::boolean, false);
  v_rows := coalesce(v_payment -> 'rows', '[]'::jsonb);
  if v_no_payment and coalesce(jsonb_array_length(v_rows), 0) > 0 then
    raise exception 'This issued version says no payment is due and also lists payments. Automatic allocation was not started.';
  end if;
  if v_schema = '1' and v_no_payment and v_total <> 0 then
    raise exception 'This issued version says no payment is due, but the total is not zero.';
  end if;

  if v_schema = '2' then
    for v_item in
      select value from jsonb_array_elements(coalesce(v_payment -> 'subscription_obligations', '[]'::jsonb))
    loop
      v_sub_id := nullif(btrim(coalesce(v_item ->> 'id', '')), '');
      if v_sub_id is null then
        raise exception 'This issued version is missing a subscription obligation identifier.';
      end if;
      if v_sub_id = any (v_sub_ids) then
        raise exception 'This issued version repeats a subscription obligation.';
      end if;
      v_sub_ids := array_append(v_sub_ids, v_sub_id);
      if not exists (
        select 1
        from jsonb_array_elements(coalesce(p_snapshot -> 'lines', '[]'::jsonb)) line(value)
        where line.value #>> '{subscription,obligation_id}' = v_sub_id
      ) then
        raise exception 'This issued version is missing the subscription agreement for an advance obligation.';
      end if;
      begin
        v_amount := round((v_item ->> 'amount')::numeric, 2);
      exception when others then
        raise exception 'A subscription advance amount could not be read.';
      end;
      if v_amount is null or v_amount < 0 or v_amount <> (v_item ->> 'amount')::numeric then
        raise exception 'A subscription advance amount is not a valid currency amount.';
      end if;
      v_key := 'subscription:' || v_sub_id;
      if v_key = any (v_keys) then
        raise exception 'This issued version repeats a payment obligation.';
      end if;
      v_keys := array_append(v_keys, v_key);
      v_position := v_position + 1;
      v_sum := v_sum + v_amount;
      v_label := 'Subscription advance';
      select coalesce(nullif(btrim(line.value ->> 'model_code'), ''), 'Subscription') || ' advance'
      into v_label
      from jsonb_array_elements(coalesce(p_snapshot -> 'lines', '[]'::jsonb)) line(value)
      where line.value #>> '{subscription,obligation_id}' = v_sub_id
      limit 1;
      v_obligations := v_obligations || jsonb_build_array(jsonb_build_object(
        'source_key', v_key,
        'kind', 'subscription_advance',
        'source_row_id', v_sub_id,
        'sequence', null,
        'label', v_label,
        'amount', private.payment_plain_amount(v_amount),
        'due_date', null,
        'due_formula', 'payable 100% in advance',
        'due_timing', 'advance',
        'awaiting_label', '',
        'position', v_position,
        'subscription_obligation_id', v_sub_id
      ));
    end loop;
  end if;

  for v_row in select value from jsonb_array_elements(v_rows) loop
    v_row_id := nullif(btrim(coalesce(v_row ->> 'id', '')), '');
    if v_row_id is null then
      raise exception 'This issued payment is missing a stable identifier.';
    end if;
    v_label := coalesce(nullif(btrim(coalesce(v_row ->> 'label', '')), ''), 'Payment');
    if jsonb_typeof(v_row -> 'instalments') = 'array' and jsonb_array_length(v_row -> 'instalments') > 0 then
      for v_item in select value from jsonb_array_elements(v_row -> 'instalments') loop
        begin
          v_sequence := (v_item ->> 'sequence')::integer;
          v_amount := round((v_item ->> 'amount')::numeric, 2);
          v_due_date := nullif(v_item ->> 'due_date', '')::date;
        exception when others then
          raise exception 'An instalment on this issued version could not be read.';
        end;
        if v_sequence is null or v_sequence < 1 then
          raise exception 'An instalment is missing its sequence.';
        end if;
        if v_item ? 'parent_id' and nullif(v_item ->> 'parent_id', '') is not null
          and v_item ->> 'parent_id' <> v_row_id
        then
          raise exception 'An instalment does not belong to its source payment row.';
        end if;
        if v_amount is null or v_amount <= 0 or v_amount <> (v_item ->> 'amount')::numeric then
          raise exception 'An instalment amount is not a valid currency amount.';
        end if;
        v_key := v_row_id || ':' || v_sequence::text;
        if v_key = any (v_keys) then
          raise exception 'This issued version repeats a payment obligation.';
        end if;
        v_keys := array_append(v_keys, v_key);
        select * into v_class from private.classify_snapshot_due('{"type":"unset"}'::jsonb, v_due_date, v_row -> 'instalment_plan');
        v_position := v_position + 1;
        v_sum := v_sum + v_amount;
        v_obligations := v_obligations || jsonb_build_array(jsonb_build_object(
          'source_key', v_key,
          'kind', 'instalment',
          'source_row_id', v_row_id,
          'sequence', v_sequence,
          'label', v_label || ' · Instalment ' || v_sequence::text,
          'amount', private.payment_plain_amount(v_amount),
          'due_date', v_due_date,
          'due_formula', coalesce(v_item ->> 'due_formula', ''),
          'due_timing', v_class.timing,
          'awaiting_label', v_class.label,
          'position', v_position,
          'subscription_obligation_id', null
        ));
      end loop;
    else
      begin
        v_amount := round((v_row ->> 'amount')::numeric, 2);
        v_due_date := nullif(v_row ->> 'due_date', '')::date;
      exception when others then
        raise exception 'A payment amount on this issued version could not be read.';
      end;
      if v_amount is null or v_amount <= 0 or v_amount <> (v_row ->> 'amount')::numeric then
        raise exception 'A payment amount is not a valid currency amount.';
      end if;
      v_key := v_row_id;
      if v_key = any (v_keys) then
        raise exception 'This issued version repeats a payment obligation.';
      end if;
      v_keys := array_append(v_keys, v_key);
      select * into v_class from private.classify_snapshot_due(v_row -> 'due', v_due_date, null);
      v_position := v_position + 1;
      v_sum := v_sum + v_amount;
      v_obligations := v_obligations || jsonb_build_array(jsonb_build_object(
        'source_key', v_key,
        'kind', 'payment_row',
        'source_row_id', v_row_id,
        'sequence', null,
        'label', v_label,
        'amount', private.payment_plain_amount(v_amount),
        'due_date', v_due_date,
        'due_formula', coalesce(v_row ->> 'due_formula', ''),
        'due_timing', v_class.timing,
        'awaiting_label', v_class.label,
        'position', v_position,
        'subscription_obligation_id', null
      ));
    end if;
  end loop;

  if v_sum <> v_total then
    raise exception 'The issued payment amounts do not add up to the agreed total. Automatic allocation was not started.';
  end if;

  return jsonb_build_object(
    'schema_version', v_schema::integer,
    'currency', v_currency,
    'agreed_total', private.payment_plain_amount(v_total),
    'obligations', v_obligations
  );
end;
$$;

create or replace function private.require_pi_reader(p_pi_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_active_member() then
    raise exception 'Sign in required.';
  end if;
  if not private.can_read_pi(p_pi_id) then
    raise exception 'You do not have access to this PI.';
  end if;
end;
$$;

create or replace function private.obligation_paid(p_obligation_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.amount), 0)
  from public.payment_allocations a
  join public.payment_receipts r on r.id = a.receipt_id
  where a.obligation_id = p_obligation_id
    and r.reversed_at is null;
$$;

create or replace function private.subscription_completion_date(p_obligation_id uuid, p_required numeric)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select received_on
  from (
    select
      r.received_on,
      r.recorded_at,
      r.id,
      sum(a.amount) over (order by r.received_on, r.recorded_at, r.id) as running
    from public.payment_allocations a
    join public.payment_receipts r on r.id = a.receipt_id
    where a.obligation_id = p_obligation_id
      and r.reversed_at is null
  ) ordered
  where running >= p_required
  order by received_on, recorded_at, id
  limit 1;
$$;

create or replace function private.insert_subscription(
  p_plan public.payment_plans,
  p_obligation public.payment_obligations,
  p_start date,
  p_kind text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_line jsonb;
  v_sub jsonb;
  v_years integer;
  v_price numeric;
  v_base numeric;
  v_rule text;
  v_quantity numeric;
  v_product uuid;
  v_client_name text;
  v_client_id uuid;
  v_live_name text;
  v_link boolean := false;
  v_periods jsonb := '[]'::jsonb;
  v_year integer;
  v_id uuid;
  v_agreement jsonb;
begin
  if p_obligation.kind <> 'subscription_advance' or p_obligation.subscription_obligation_id is null then
    raise exception 'Only a subscription advance can activate a subscription.';
  end if;
  select id into v_id
  from public.subscriptions
  where pi_id = p_plan.pi_id
    and source_obligation_id = p_obligation.subscription_obligation_id;
  if v_id is not null then
    return v_id;
  end if;

  select snapshot into v_snapshot from public.pi_versions where id = p_plan.source_version_id;
  select value into v_line
  from jsonb_array_elements(coalesce(v_snapshot -> 'lines', '[]'::jsonb))
  where value #>> '{subscription,obligation_id}' = p_obligation.subscription_obligation_id
  limit 1;
  if v_line is null then
    raise exception 'The issued version no longer contains this subscription agreement.';
  end if;
  v_sub := v_line -> 'subscription';
  if coalesce((v_sub ->> 'adjustment_compounds')::boolean, false) then
    raise exception 'This agreement compounds later-year adjustments. It cannot be activated.';
  end if;
  if coalesce(v_sub ->> 'currency', '') <> p_plan.currency then
    raise exception 'The subscription currency does not match the payment plan.';
  end if;
  begin
    v_years := (v_sub ->> 'commitment_years')::integer;
    v_price := round((v_sub ->> 'negotiated_first_year_unit_price')::numeric, 2);
    v_base := nullif(v_sub ->> 'later_year_base_unit_price', '')::numeric;
    v_quantity := (v_line ->> 'quantity')::numeric;
  exception when others then
    raise exception 'The issued subscription agreement could not be read.';
  end;
  v_rule := nullif(v_sub ->> 'later_year_rule', '');
  if v_years is null or v_years < 1 or v_price is null or v_price < 0 or v_quantity is null or v_quantity <= 0 then
    raise exception 'The issued subscription agreement is incomplete.';
  end if;
  if v_years = 1 then
    v_base := null;
    v_rule := null;
  elsif v_base is null or v_rule is null then
    raise exception 'The issued subscription agreement is missing its later-year rule.';
  else
    v_base := round(v_base, 2);
  end if;
  v_client_name := btrim(coalesce(v_snapshot #>> '{client,company_name}', ''));
  if v_client_name = '' then
    raise exception 'The issued version has no client name to save on the subscription.';
  end if;
  if nullif(btrim(coalesce(v_line ->> 'model_code', '')), '') is null then
    raise exception 'The issued subscription line has no model.';
  end if;
  begin
    v_product := nullif(coalesce(v_line ->> 'product_id', v_sub ->> 'product_id'), '')::uuid;
  exception when others then
    v_product := null;
  end;
  if v_product is not null and not exists (select 1 from public.products where id = v_product) then
    v_product := null;
  end if;
  select c.id, btrim(c.company_name)
  into v_client_id, v_live_name
  from public.proforma_invoices pi
  join public.clients c on c.id = pi.client_id
  where pi.id = p_plan.pi_id;
  if v_client_id is not null and v_live_name = v_client_name then
    v_link := true;
  else
    v_client_id := null;
    v_link := false;
  end if;
  for v_year in 1..v_years loop
    v_periods := v_periods || jsonb_build_array(jsonb_build_object(
      'year', v_year,
      'starts_on', private.anniversary_date(p_start, v_year - 1),
      'ends_on', private.anniversary_date(p_start, v_year)
    ));
  end loop;
  v_agreement := jsonb_build_object(
    'client_name', v_client_name,
    'currency', p_plan.currency,
    'line', jsonb_build_object(
      'model_code', v_line ->> 'model_code',
      'description', coalesce(v_line ->> 'description', ''),
      'unit', coalesce(v_line ->> 'unit', ''),
      'quantity', v_line ->> 'quantity',
      'unit_price', v_line ->> 'unit_price',
      'product_id', v_line ->> 'product_id'
    ),
    'subscription', v_sub
  );

  insert into public.subscriptions (
    client_id, client_name, client_link_matches_snapshot,
    product_id, product_model, product_description, vendor_identity, quantity, currency,
    pi_id, source_version_id, source_obligation_id, payment_obligation_id,
    commitment_years, first_year_negotiated_unit_price, later_year_base_unit_price, later_year_rule,
    adjustment_compounds, start_date, commitment_end_date, annual_periods,
    activated_by, activation_kind, no_charge_reason, state, agreement
  ) values (
    v_client_id, v_client_name, v_link,
    v_product, btrim(v_line ->> 'model_code'), coalesce(v_line ->> 'description', ''), 'unavailable', v_quantity, p_plan.currency,
    p_plan.pi_id, p_plan.source_version_id, p_obligation.subscription_obligation_id, p_obligation.id,
    v_years, v_price, v_base, v_rule,
    false, p_start, private.anniversary_date(p_start, v_years), v_periods,
    (select auth.uid()), p_kind, p_reason, 'active', v_agreement
  )
  on conflict (pi_id, source_obligation_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.subscriptions
    where pi_id = p_plan.pi_id
      and source_obligation_id = p_obligation.subscription_obligation_id;
  end if;
  return v_id;
end;
$$;

create or replace function private.activate_paid_subscriptions(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans;
  v_obligation public.payment_obligations;
  v_paid numeric;
  v_start date;
  v_existing uuid;
  v_id uuid;
  v_created boolean;
  v_result jsonb := '[]'::jsonb;
begin
  select * into v_plan from public.payment_plans where id = p_plan_id;
  for v_obligation in
    select * from public.payment_obligations
    where plan_id = p_plan_id and kind = 'subscription_advance'
    order by id
  loop
    if v_obligation.amount = 0 then
      continue;
    end if;
    v_paid := private.obligation_paid(v_obligation.id);
    if v_paid < v_obligation.amount then
      continue;
    end if;
    select id into v_existing
    from public.subscriptions
    where payment_obligation_id = v_obligation.id;
    v_start := private.subscription_completion_date(v_obligation.id, v_obligation.amount);
    if v_start is null then
      raise exception 'The subscription payment date could not be determined.';
    end if;
    v_created := v_existing is null;
    v_id := private.insert_subscription(v_plan, v_obligation, v_start, 'payment', null);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'subscription_id', v_id,
      'source_obligation_id', v_obligation.subscription_obligation_id,
      'obligation_id', v_obligation.id,
      'start_date', v_start,
      'already_active', not v_created
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function private.flag_subscription_review(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_paid numeric;
  v_result jsonb := '[]'::jsonb;
begin
  for v_row in
    select s.id, s.state, o.amount, o.id as obligation_id
    from public.payment_allocations a
    join public.payment_obligations o on o.id = a.obligation_id
    join public.subscriptions s on s.payment_obligation_id = o.id
    where a.receipt_id = p_receipt_id
      and s.activation_kind = 'payment'
    order by s.id
  loop
    v_paid := private.obligation_paid(v_row.obligation_id);
    if v_paid < v_row.amount and v_row.state = 'active' then
      update public.subscriptions
      set state = 'payment_review_required'
      where id = v_row.id and state = 'active';
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'subscription_id', v_row.id,
      'state', (select state from public.subscriptions where id = v_row.id),
      'outstanding', private.payment_plain_amount(greatest(v_row.amount - v_paid, 0))
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function private.normalize_allocations(p_allocations jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    return '[]'::jsonb;
  end if;
  for v_item in
    select value
    from jsonb_array_elements(p_allocations)
    order by lower((value ->> 'obligation_id')::uuid::text)
  loop
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'obligation_id', lower((v_item ->> 'obligation_id')::uuid::text),
      'amount', private.payment_plain_amount((v_item ->> 'amount')::numeric)
    ));
  end loop;
  return v_result;
exception when others then
  return null;
end;
$$;

create or replace function private.receipt_allocations_json(p_receipt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'obligation_id', lower(obligation_id::text),
    'amount', private.payment_plain_amount(amount)
  ) order by obligation_id), '[]'::jsonb)
  from public.payment_allocations
  where receipt_id = p_receipt_id;
$$;

create or replace function private.start_payment_tracking(
  p_pi_id uuid,
  p_version_id uuid,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans;
  v_version public.pi_versions;
  v_parsed jsonb;
  v_item jsonb;
  v_display text;
  v_count integer;
begin
  perform private.require_pi_reader(p_pi_id);
  if not private.has_flag('can_manage_payments') then
    raise exception 'You do not have permission to manage payment tracking.';
  end if;
  select * into v_version
  from public.pi_versions
  where id = p_version_id and pi_id = p_pi_id;
  if not found then
    raise exception 'Choose an issued version of this PI.';
  end if;

  perform 1 from public.proforma_invoices where id = p_pi_id for update;
  select * into v_plan from public.payment_plans where pi_id = p_pi_id;
  if found then
    if v_plan.source_version_id <> p_version_id then
      select coalesce(snapshot ->> 'display_number', pi_number) into v_display
      from public.pi_versions where id = v_plan.source_version_id;
      raise exception 'Payment tracking is already active for %. It stays on that issued version. A later revision does not replace it or move receipts.', v_display;
    end if;
    select count(*) into v_count from public.payment_obligations where plan_id = v_plan.id;
    return jsonb_build_object(
      'plan_id', v_plan.id,
      'pi_id', v_plan.pi_id,
      'source_version_id', v_plan.source_version_id,
      'display_number', coalesce(v_version.snapshot ->> 'display_number', v_version.pi_number),
      'currency', v_plan.currency,
      'agreed_total', private.payment_plain_amount(v_plan.agreed_total),
      'schema_version', v_plan.schema_version,
      'already_tracking', true,
      'obligation_count', v_count
    );
  end if;

  if p_confirmed is distinct from true then
    raise exception 'Confirm that this issued version is the one agreed with the customer.';
  end if;

  v_parsed := private.payment_obligations_from_snapshot(v_version.snapshot);
  insert into public.payment_plans (
    pi_id, source_version_id, currency, agreed_total, schema_version, started_by, customer_agreed
  ) values (
    p_pi_id,
    p_version_id,
    v_parsed ->> 'currency',
    (v_parsed ->> 'agreed_total')::numeric,
    (v_parsed ->> 'schema_version')::smallint,
    (select auth.uid()),
    true
  )
  returning * into v_plan;

  for v_item in select value from jsonb_array_elements(v_parsed -> 'obligations') loop
    insert into public.payment_obligations (
      plan_id, source_key, kind, source_row_id, sequence, label, amount,
      due_date, due_formula, due_timing, awaiting_label, position, subscription_obligation_id
    ) values (
      v_plan.id,
      v_item ->> 'source_key',
      v_item ->> 'kind',
      v_item ->> 'source_row_id',
      nullif(v_item ->> 'sequence', '')::integer,
      v_item ->> 'label',
      (v_item ->> 'amount')::numeric,
      nullif(v_item ->> 'due_date', '')::date,
      coalesce(v_item ->> 'due_formula', ''),
      v_item ->> 'due_timing',
      coalesce(v_item ->> 'awaiting_label', ''),
      (v_item ->> 'position')::integer,
      nullif(v_item ->> 'subscription_obligation_id', '')
    );
  end loop;

  select count(*) into v_count from public.payment_obligations where plan_id = v_plan.id;
  return jsonb_build_object(
    'plan_id', v_plan.id,
    'pi_id', v_plan.pi_id,
    'source_version_id', v_plan.source_version_id,
    'display_number', coalesce(v_version.snapshot ->> 'display_number', v_version.pi_number),
    'currency', v_plan.currency,
    'agreed_total', private.payment_plain_amount(v_plan.agreed_total),
    'schema_version', v_plan.schema_version,
    'already_tracking', false,
    'obligation_count', v_count
  );
end;
$$;

create or replace function private.record_payment_receipt(p_plan_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans;
  v_existing public.payment_receipts;
  v_obligation public.payment_obligations;
  v_user uuid := (select auth.uid());
  v_amount numeric;
  v_received date;
  v_method text;
  v_reference text;
  v_note text;
  v_key uuid;
  v_item jsonb;
  v_alloc_amount numeric;
  v_sum numeric := 0;
  v_paid numeric;
  v_outstanding numeric;
  v_plan_outstanding numeric;
  v_receipt_id uuid;
  v_seen uuid[] := '{}';
  v_normalized jsonb;
  v_existing_alloc jsonb;
  v_activations jsonb;
begin
  if v_user is null or not private.is_active_member() then
    raise exception 'Sign in required.';
  end if;
  if not private.has_flag('can_manage_payments') then
    raise exception 'You do not have permission to record payments.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The payment could not be read.';
  end if;

  select * into v_plan from public.payment_plans where id = p_plan_id for update;
  if not found or not private.can_read_pi(v_plan.pi_id) then
    raise exception 'This payment plan was not found, or you do not have access to it.';
  end if;
  perform private.require_pi_reader(v_plan.pi_id);
  perform 1 from public.payment_obligations where plan_id = v_plan.id order by id for update;

  begin
    v_key := private.as_uuid(p_payload ->> 'idempotency_key');
  exception when others then
    v_key := null;
  end;
  if v_key is null then
    raise exception 'This payment is missing its submission id. Close the form and record it again.';
  end if;

  begin
    v_amount := private.as_numeric(p_payload ->> 'amount', 'Amount received');
  exception when others then
    raise exception 'Amount received must be greater than zero.';
  end;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Amount received must be greater than zero.';
  end if;
  if v_amount <> round(v_amount, 2) then
    raise exception 'Amount received can use at most two decimal places.';
  end if;
  begin
    v_received := private.as_date(p_payload ->> 'received_on');
  exception when others then
    raise exception 'Invalid date.';
  end;
  if v_received is null then
    raise exception 'Enter the date the payment was received.';
  end if;
  if v_received > private.cairo_today() then
    raise exception 'The received date cannot be in the future.';
  end if;
  v_method := p_payload ->> 'method';
  if v_method not in ('bank_transfer', 'cash', 'cheque', 'other') then
    raise exception 'Choose a payment method: bank transfer, cash, cheque, or other.';
  end if;
  if coalesce(p_payload ->> 'currency', v_plan.currency) <> v_plan.currency then
    raise exception 'This PI is in %. Record the receipt in %. EGP, USD, and EUR are not converted.', v_plan.currency, v_plan.currency;
  end if;
  v_reference := nullif(btrim(coalesce(p_payload ->> 'reference', '')), '');
  v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  if v_reference is not null and char_length(v_reference) > 80 then
    raise exception 'The payment reference must be 80 characters or fewer.';
  end if;
  if v_note is not null and char_length(v_note) > 400 then
    raise exception 'The note must be 400 characters or fewer.';
  end if;
  if p_payload -> 'allocations' is null or jsonb_typeof(p_payload -> 'allocations') <> 'array'
    or jsonb_array_length(p_payload -> 'allocations') = 0
  then
    raise exception 'Choose how this receipt is allocated. Nothing is allocated automatically.';
  end if;

  v_normalized := private.normalize_allocations(p_payload -> 'allocations');
  if v_normalized is null then
    raise exception 'Each allocation must be a currency amount.';
  end if;

  select * into v_existing
  from public.payment_receipts
  where plan_id = v_plan.id and idempotency_key = v_key;
  if found then
    v_existing_alloc := private.receipt_allocations_json(v_existing.id);
    if v_existing.amount = v_amount
      and v_existing.received_on = v_received
      and v_existing.method = v_method
      and v_existing.reference is not distinct from v_reference
      and v_existing.note is not distinct from v_note
      and v_existing_alloc = v_normalized
    then
      return jsonb_build_object(
        'receipt_id', v_existing.id,
        'plan_id', v_plan.id,
        'already_recorded', true,
        'amount', private.payment_plain_amount(v_existing.amount),
        'currency', v_existing.currency,
        'received_on', v_existing.received_on,
        'activations', '[]'::jsonb
      );
    end if;
    raise exception 'This payment was already submitted with different details.';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'allocations') loop
    begin
      v_alloc_amount := private.as_numeric(v_item ->> 'amount', 'Allocation');
    exception when others then
      raise exception 'Each allocation must be greater than zero.';
    end;
    if v_alloc_amount is null or v_alloc_amount <= 0 then
      raise exception 'Each allocation must be greater than zero. Leave out obligations that are not part of this receipt.';
    end if;
    if v_alloc_amount <> round(v_alloc_amount, 2) then
      raise exception 'Each allocation can use at most two decimal places.';
    end if;
    begin
      v_obligation.id := private.as_uuid(v_item ->> 'obligation_id');
    exception when others then
      raise exception 'One of the selected payment obligations is not on this PI.';
    end;
    if v_obligation.id is null or v_obligation.id = any (v_seen) then
      raise exception 'Allocate each obligation once on this receipt.';
    end if;
    v_seen := array_append(v_seen, v_obligation.id);
    select * into v_obligation
    from public.payment_obligations
    where id = v_obligation.id and plan_id = v_plan.id;
    if not found then
      raise exception 'One of the selected payment obligations is not on this PI.';
    end if;
    v_paid := private.obligation_paid(v_obligation.id);
    v_outstanding := v_obligation.amount - v_paid;
    if v_alloc_amount > v_outstanding then
      raise exception 'The allocation to % is % more than its unpaid balance of %.',
        v_obligation.label,
        private.payment_money(v_plan.currency, v_alloc_amount - v_outstanding),
        private.payment_money(v_plan.currency, v_outstanding);
    end if;
    v_sum := v_sum + v_alloc_amount;
  end loop;

  if v_sum <> v_amount then
    raise exception 'The allocations add up to %. The amount received is %. They must be equal. This PI does not keep an unallocated credit.',
      private.payment_money(v_plan.currency, v_sum),
      private.payment_money(v_plan.currency, v_amount);
  end if;

  select v_plan.agreed_total - coalesce(sum(amount), 0) into v_plan_outstanding
  from public.payment_receipts
  where plan_id = v_plan.id and reversed_at is null;
  if v_amount > v_plan_outstanding then
    raise exception 'This receipt is more than the outstanding balance of %. A receipt cannot exceed what this PI still has unpaid.',
      private.payment_money(v_plan.currency, v_plan_outstanding);
  end if;

  insert into public.payment_receipts (
    plan_id, currency, amount, received_on, method, reference, note, recorded_by, idempotency_key
  ) values (
    v_plan.id, v_plan.currency, v_amount, v_received, v_method, v_reference, v_note, v_user, v_key
  )
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_payload -> 'allocations') loop
    insert into public.payment_allocations (receipt_id, obligation_id, amount)
    values (
      v_receipt_id,
      (v_item ->> 'obligation_id')::uuid,
      round((v_item ->> 'amount')::numeric, 2)
    );
  end loop;

  v_activations := private.activate_paid_subscriptions(v_plan.id);
  return jsonb_build_object(
    'receipt_id', v_receipt_id,
    'plan_id', v_plan.id,
    'already_recorded', false,
    'amount', private.payment_plain_amount(v_amount),
    'currency', v_plan.currency,
    'received_on', v_received,
    'activations', v_activations
  );
end;
$$;

create or replace function private.reverse_payment_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.payment_receipts;
  v_plan public.payment_plans;
  v_reason text;
  v_reviews jsonb;
begin
  if (select auth.uid()) is null or not private.is_active_member() then
    raise exception 'Sign in required.';
  end if;
  if not private.has_flag('can_reverse_payments') then
    raise exception 'You do not have permission to reverse payments.';
  end if;
  select * into v_receipt from public.payment_receipts where id = p_receipt_id for update;
  if found then
    select * into v_plan from public.payment_plans where id = v_receipt.plan_id for update;
  end if;
  if not found or not private.can_read_pi(v_plan.pi_id) then
    raise exception 'This receipt was not found, or you do not have access to it.';
  end if;
  perform private.require_pi_reader(v_plan.pi_id);
  perform 1
  from public.payment_obligations o
  where o.plan_id = v_plan.id
    and o.id in (select obligation_id from public.payment_allocations where receipt_id = v_receipt.id)
  order by o.id
  for update;

  if v_receipt.reversed_at is not null then
    return jsonb_build_object(
      'receipt_id', v_receipt.id,
      'already_reversed', true,
      'reversed_at', v_receipt.reversed_at,
      'reversal_reason', v_receipt.reversal_reason,
      'reviews', private.flag_subscription_review(v_receipt.id)
    );
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Enter a reason for reversing this payment.';
  end if;
  if char_length(v_reason) > 400 then
    raise exception 'The reversal reason must be 400 characters or fewer.';
  end if;

  update public.payment_receipts
  set reversed_at = pg_catalog.now(),
      reversed_by = (select auth.uid()),
      reversal_reason = v_reason
  where id = v_receipt.id and reversed_at is null;
  if not found then
    select * into v_receipt from public.payment_receipts where id = p_receipt_id;
    return jsonb_build_object(
      'receipt_id', v_receipt.id,
      'already_reversed', true,
      'reversed_at', v_receipt.reversed_at,
      'reversal_reason', v_receipt.reversal_reason,
      'reviews', '[]'::jsonb
    );
  end if;

  v_reviews := private.flag_subscription_review(v_receipt.id);
  return jsonb_build_object(
    'receipt_id', v_receipt.id,
    'already_reversed', false,
    'reversed_at', (select reversed_at from public.payment_receipts where id = v_receipt.id),
    'reversal_reason', v_reason,
    'reviews', v_reviews
  );
end;
$$;

create or replace function private.activate_subscription_at_no_charge(
  p_obligation_id uuid,
  p_start_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obligation public.payment_obligations;
  v_plan public.payment_plans;
  v_existing uuid;
  v_reason text;
  v_id uuid;
  v_saved date;
begin
  if (select auth.uid()) is null or not private.is_active_member() then
    raise exception 'Sign in required.';
  end if;
  if not private.has_flag('can_activate_zero_subscriptions') then
    raise exception 'You do not have permission to activate a zero-value subscription.';
  end if;
  select * into v_obligation from public.payment_obligations where id = p_obligation_id for update;
  if found then
    select * into v_plan from public.payment_plans where id = v_obligation.plan_id for update;
  end if;
  if not found or not private.can_read_pi(v_plan.pi_id) then
    raise exception 'This subscription obligation was not found, or you do not have access to it.';
  end if;
  perform private.require_pi_reader(v_plan.pi_id);
  if v_obligation.kind <> 'subscription_advance' then
    raise exception 'Only a subscription advance can be activated.';
  end if;
  select id, start_date into v_existing, v_saved
  from public.subscriptions
  where payment_obligation_id = v_obligation.id;
  if v_existing is not null then
    return jsonb_build_object(
      'subscription_id', v_existing,
      'already_activated', true,
      'start_date', v_saved,
      'requested_start_date_ignored', p_start_date is distinct from v_saved
    );
  end if;
  if v_obligation.amount <> 0 then
    raise exception 'A subscription with an amount due is activated by recording the payment, not by waiving it.';
  end if;
  if p_start_date is null then
    raise exception 'Enter the start date for this no-charge subscription.';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Enter a reason for activating this subscription at no charge.';
  end if;
  if char_length(v_reason) > 400 then
    raise exception 'The reason must be 400 characters or fewer.';
  end if;
  v_id := private.insert_subscription(v_plan, v_obligation, p_start_date, 'no_charge', v_reason);
  return jsonb_build_object(
    'subscription_id', v_id,
    'already_activated', false,
    'start_date', (select start_date from public.subscriptions where id = v_id),
    'activation_kind', 'no_charge'
  );
end;
$$;

create or replace function public.start_payment_tracking(p_pi_id uuid, p_version_id uuid, p_confirmed boolean)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.start_payment_tracking(p_pi_id, p_version_id, p_confirmed);
$$;

create or replace function public.record_payment_receipt(p_plan_id uuid, p_payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_payment_receipt(p_plan_id, p_payload);
$$;

create or replace function public.reverse_payment_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reverse_payment_receipt(p_receipt_id, p_reason);
$$;

create or replace function public.activate_subscription_at_no_charge(
  p_obligation_id uuid,
  p_start_date date,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.activate_subscription_at_no_charge(p_obligation_id, p_start_date, p_reason);
$$;

create view public.payment_obligation_balances
with (security_invoker = true) as
select
  o.id,
  o.plan_id,
  p.pi_id,
  p.currency,
  o.source_key,
  o.kind,
  o.label,
  o.amount,
  o.due_date,
  o.due_formula,
  o.due_timing,
  o.awaiting_label,
  o.position,
  o.subscription_obligation_id,
  coalesce(paid.paid_amount, 0)::numeric(14, 2) as paid_amount,
  (o.amount - coalesce(paid.paid_amount, 0))::numeric(14, 2) as outstanding_amount,
  private.payment_collection_status(o.amount, coalesce(paid.paid_amount, 0)) as collection_status,
  private.payment_due_state(
    o.due_timing,
    o.due_date,
    private.payment_collection_status(o.amount, coalesce(paid.paid_amount, 0)),
    private.cairo_today()
  ) as due_state
from public.payment_obligations o
join public.payment_plans p on p.id = o.plan_id
left join lateral (
  select sum(a.amount) as paid_amount
  from public.payment_allocations a
  join public.payment_receipts r on r.id = a.receipt_id and r.reversed_at is null
  where a.obligation_id = o.id
) paid on true;

comment on view public.payment_obligation_balances is
  'Outstanding balances for obligations the caller can read. Reversed receipts are excluded. An unresolved due date is not overdue.';

create view public.subscription_list
with (security_invoker = true) as
select
  s.id,
  s.client_id,
  s.client_name,
  s.client_link_matches_snapshot,
  s.product_id,
  s.product_model,
  s.product_description,
  s.quantity,
  s.commitment_years,
  s.start_date,
  s.commitment_end_date,
  private.next_committed_payment_date(s.start_date, s.commitment_years, private.cairo_today()) as next_payment_on,
  s.currency,
  s.state,
  s.pi_id,
  s.source_version_id,
  s.source_obligation_id,
  s.payment_obligation_id,
  s.later_year_rule,
  s.first_year_negotiated_unit_price,
  s.later_year_base_unit_price,
  s.activation_kind
from public.subscriptions s;

comment on view public.subscription_list is
  'Subscriptions whose source PI the caller can read. Next payment is the next committed anniversary, not a renewal invoice.';

alter table public.payment_plans enable row level security;
alter table public.payment_obligations enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.subscriptions enable row level security;

create policy payment_plans_select on public.payment_plans
for select to authenticated
using (private.can_read_pi(pi_id));

create policy payment_obligations_select on public.payment_obligations
for select to authenticated
using (
  exists (
    select 1 from public.payment_plans p
    where p.id = payment_obligations.plan_id
      and private.can_read_pi(p.pi_id)
  )
);

create policy payment_receipts_select on public.payment_receipts
for select to authenticated
using (
  exists (
    select 1 from public.payment_plans p
    where p.id = payment_receipts.plan_id
      and private.can_read_pi(p.pi_id)
  )
);

create policy payment_allocations_select on public.payment_allocations
for select to authenticated
using (
  exists (
    select 1
    from public.payment_receipts r
    join public.payment_plans p on p.id = r.plan_id
    where r.id = payment_allocations.receipt_id
      and private.can_read_pi(p.pi_id)
  )
);

create policy subscriptions_select on public.subscriptions
for select to authenticated
using (private.can_read_pi(pi_id));

revoke all on table
  public.payment_plans,
  public.payment_obligations,
  public.payment_receipts,
  public.payment_allocations,
  public.subscriptions
from public, anon, authenticated;

grant select on table
  public.payment_plans,
  public.payment_obligations,
  public.payment_receipts,
  public.payment_allocations,
  public.subscriptions
to authenticated;

revoke all on table public.payment_obligation_balances, public.subscription_list from public, anon, authenticated;
grant select on table public.payment_obligation_balances, public.subscription_list to authenticated;

revoke all on function private.cairo_today() from public, anon, authenticated;
revoke all on function private.anniversary_date(date, integer) from public, anon, authenticated;
revoke all on function private.next_committed_payment_date(date, integer, date) from public, anon, authenticated;
revoke all on function private.payment_collection_status(numeric, numeric) from public, anon, authenticated;
revoke all on function private.payment_due_state(text, date, text, date) from public, anon, authenticated;
revoke all on function private.awaiting_event_label(jsonb) from public, anon, authenticated;
revoke all on function private.payment_plan_version_matches() from public, anon, authenticated;
revoke all on function private.payment_plans_are_immutable() from public, anon, authenticated;
revoke all on function private.payment_obligations_are_immutable() from public, anon, authenticated;
revoke all on function private.payment_receipts_are_immutable() from public, anon, authenticated;
revoke all on function private.payment_allocations_are_immutable() from public, anon, authenticated;
revoke all on function private.payment_allocation_same_plan() from public, anon, authenticated;
revoke all on function private.subscriptions_are_guarded() from public, anon, authenticated;
revoke all on function private.payment_enforce_balances() from public, anon, authenticated;
revoke all on function private.classify_snapshot_due(jsonb, date, jsonb) from public, anon, authenticated;
revoke all on function private.payment_obligations_from_snapshot(jsonb) from public, anon, authenticated;
revoke all on function private.require_pi_reader(uuid) from public, anon, authenticated;
revoke all on function private.obligation_paid(uuid) from public, anon, authenticated;
revoke all on function private.subscription_completion_date(uuid, numeric) from public, anon, authenticated;
revoke all on function private.insert_subscription(public.payment_plans, public.payment_obligations, date, text, text) from public, anon, authenticated;
revoke all on function private.activate_paid_subscriptions(uuid) from public, anon, authenticated;
revoke all on function private.flag_subscription_review(uuid) from public, anon, authenticated;
revoke all on function private.normalize_allocations(jsonb) from public, anon, authenticated;
revoke all on function private.receipt_allocations_json(uuid) from public, anon, authenticated;
revoke all on function private.start_payment_tracking(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.record_payment_receipt(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.reverse_payment_receipt(uuid, text) from public, anon, authenticated;
revoke all on function private.activate_subscription_at_no_charge(uuid, date, text) from public, anon, authenticated;

grant execute on function private.cairo_today() to authenticated;
grant execute on function private.anniversary_date(date, integer) to authenticated;
grant execute on function private.next_committed_payment_date(date, integer, date) to authenticated;
grant execute on function private.payment_collection_status(numeric, numeric) to authenticated;
grant execute on function private.payment_due_state(text, date, text, date) to authenticated;
grant execute on function private.start_payment_tracking(uuid, uuid, boolean) to authenticated;
grant execute on function private.record_payment_receipt(uuid, jsonb) to authenticated;
grant execute on function private.reverse_payment_receipt(uuid, text) to authenticated;
grant execute on function private.activate_subscription_at_no_charge(uuid, date, text) to authenticated;

revoke all on function public.start_payment_tracking(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_payment_receipt(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reverse_payment_receipt(uuid, text) from public, anon, authenticated;
revoke all on function public.activate_subscription_at_no_charge(uuid, date, text) from public, anon, authenticated;

grant execute on function public.start_payment_tracking(uuid, uuid, boolean) to authenticated;
grant execute on function public.record_payment_receipt(uuid, jsonb) to authenticated;
grant execute on function public.reverse_payment_receipt(uuid, text) to authenticated;
grant execute on function public.activate_subscription_at_no_charge(uuid, date, text) to authenticated;
