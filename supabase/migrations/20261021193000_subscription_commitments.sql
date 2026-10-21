-- Subscription commitments and allocation-aware payment schedules.
-- Existing products stay one-time. Existing drafts, payment schema version 1,
-- and issued snapshots are not rewritten. Version 1 schedules remain percentages
-- of the PI grand total. Version 2 percentages apply only to the one-time amount.
-- Subscription Year 1 is payable 100% in advance and is not an instalment.
-- Later subscription years are stored as a commitment and are not part of the total.

alter table public.products
  add column if not exists billing_type text not null default 'one_time';

alter table public.products
  drop constraint if exists products_billing_type_check;

alter table public.products
  add constraint products_billing_type_check
  check (billing_type in ('one_time', 'subscription'));

comment on column public.products.billing_type is
  'one_time or subscription. Existing rows default to one_time. Selling-price columns are not converted into commitment prices.';

create table if not exists public.product_commitment_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  commitment_years integer not null,
  currency text not null,
  first_year_unit_price numeric(14, 2) not null,
  later_year_base_unit_price numeric(14, 2),
  later_year_rule text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_commitment_options_years_check check (commitment_years >= 1 and commitment_years <= 30),
  constraint product_commitment_options_currency_check check (currency in ('EGP', 'USD', 'EUR')),
  constraint product_commitment_options_first_price_check check (first_year_unit_price >= 0),
  constraint product_commitment_options_later_price_check check (later_year_base_unit_price is null or later_year_base_unit_price >= 0),
  constraint product_commitment_options_rule_check check (
    later_year_rule is null or later_year_rule in ('fixed_annual', 'vendor_confirmed_base_adjustment')
  ),
  constraint product_commitment_options_shape_check check (
    (commitment_years = 1 and later_year_base_unit_price is null and later_year_rule is null)
    or (commitment_years > 1 and later_year_base_unit_price is not null and later_year_rule is not null)
  )
);

alter table public.product_commitment_options enable row level security;

create unique index if not exists product_commitment_options_active_idx
  on public.product_commitment_options (product_id, commitment_years, currency)
  where archived_at is null;

create index if not exists product_commitment_options_product_idx
  on public.product_commitment_options (product_id, archived_at, commitment_years);

comment on table public.product_commitment_options is
  'Catalogue commitment prices for subscription products. One active option per product, duration, and currency. Archive instead of deleting an option that a draft still names. Prices are not converted between currencies.';

drop trigger if exists product_commitment_options_touch on public.product_commitment_options;
create trigger product_commitment_options_touch
before update on public.product_commitment_options
for each row execute function private.touch_updated_at();

alter table public.pi_lines
  add column if not exists subscription_agreement jsonb;

alter table public.pi_lines
  drop constraint if exists pi_lines_subscription_agreement_object;

alter table public.pi_lines
  add constraint pi_lines_subscription_agreement_object
  check (subscription_agreement is null or jsonb_typeof(subscription_agreement) = 'object');

comment on column public.pi_lines.subscription_agreement is
  'Self-contained Year 1 subscription agreement for this draft line. Null on one-time lines and on subscription lines whose commitment is not chosen yet. Issued snapshots copy it; they do not read the catalogue again.';

create or replace function private.protect_commitment_option()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.pi_lines
      where subscription_agreement ->> 'option_id' = old.id::text
    ) then
      raise exception 'This commitment is used on a draft. Archive it instead of deleting it.';
    end if;
    return old;
  end if;
  if new.product_id is distinct from old.product_id then
    raise exception 'A commitment option cannot be moved to another product. Archive it and create a new one.';
  end if;
  return new;
end;
$$;

drop trigger if exists product_commitment_options_protect on public.product_commitment_options;
create trigger product_commitment_options_protect
before update or delete on public.product_commitment_options
for each row execute function private.protect_commitment_option();

create or replace function private.pi_lines_reject_hidden_subscription()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subscription_agreement is not null and not exists (
    select 1 from public.products
    where id = new.product_id and billing_type = 'subscription'
  ) then
    raise exception 'A one-time item cannot carry a subscription commitment.';
  end if;
  return new;
end;
$$;

drop trigger if exists pi_lines_subscription_guard on public.pi_lines;
create trigger pi_lines_subscription_guard
before insert or update on public.pi_lines
for each row execute function private.pi_lines_reject_hidden_subscription();

create or replace function private.assert_subscription_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi_id uuid;
  v_schedule jsonb;
  v_has boolean;
begin
  if tg_table_name = 'pi_lines' then
    v_pi_id := coalesce(new.pi_id, old.pi_id);
  else
    v_pi_id := coalesce(new.id, old.id);
  end if;
  select payment_schedule into v_schedule
  from public.proforma_invoices
  where id = v_pi_id;
  select exists (
    select 1
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = v_pi_id and p.billing_type = 'subscription'
  ) into v_has;
  if v_has and (v_schedule is null or coalesce(v_schedule ->> 'schema_version', '') <> '2') then
    raise exception 'A PI with a subscription must use an allocation-aware payment schedule. The previous schedule was not changed.';
  end if;
  return null;
end;
$$;

drop trigger if exists pi_lines_subscription_schedule on public.pi_lines;
create constraint trigger pi_lines_subscription_schedule
after insert or update or delete on public.pi_lines
deferrable initially deferred
for each row execute function private.assert_subscription_payment_schedule();

drop trigger if exists proforma_invoices_subscription_schedule on public.proforma_invoices;
create constraint trigger proforma_invoices_subscription_schedule
after insert or update of payment_schedule on public.proforma_invoices
deferrable initially deferred
for each row execute function private.assert_subscription_payment_schedule();

create or replace function private.apportion_money(
  p_total numeric,
  p_weights numeric[],
  p_cap_at_weight boolean default false
) returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
  v_sum numeric := 0;
  v_exact numeric[];
  v_cents bigint[];
  v_total_cents bigint;
  v_sum_cents bigint := 0;
  v_drift bigint;
  v_index integer;
  v_best integer;
  v_best_score numeric;
  v_score numeric;
  v_cap bigint;
  v_result numeric[] := '{}';
begin
  v_count := coalesce(array_length(p_weights, 1), 0);
  if v_count = 0 then
    return array[]::numeric[];
  end if;
  if p_total < 0 then
    raise exception 'An allocated amount cannot be negative.';
  end if;
  for v_index in 1..v_count loop
    if p_weights[v_index] is null or p_weights[v_index] < 0 then
      raise exception 'An allocation weight cannot be negative.';
    end if;
    v_sum := v_sum + p_weights[v_index];
  end loop;
  if p_total = 0 then
    return array_fill(0::numeric, array[v_count]);
  end if;
  if v_sum = 0 then
    return null;
  end if;
  v_total_cents := round(p_total * 100)::bigint;
  v_exact := array_fill(0::numeric, array[v_count]);
  v_cents := array_fill(0::bigint, array[v_count]);
  for v_index in 1..v_count loop
    v_exact[v_index] := p_total * p_weights[v_index] / v_sum;
    v_cents[v_index] := round(v_exact[v_index] * 100)::bigint;
    if p_cap_at_weight then
      v_cap := round(p_weights[v_index] * 100)::bigint;
      if v_cents[v_index] > v_cap then
        v_cents[v_index] := v_cap;
      end if;
    end if;
    if v_cents[v_index] < 0 then
      v_cents[v_index] := 0;
    end if;
    v_sum_cents := v_sum_cents + v_cents[v_index];
  end loop;
  v_drift := v_total_cents - v_sum_cents;
  while v_drift <> 0 loop
    v_best := null;
    v_best_score := null;
    for v_index in 1..v_count loop
      if v_drift > 0 then
        if p_cap_at_weight and v_cents[v_index] >= round(p_weights[v_index] * 100)::bigint then
          continue;
        end if;
        v_score := (v_exact[v_index] * 100) - v_cents[v_index];
      else
        if v_cents[v_index] <= 0 then
          continue;
        end if;
        v_score := v_cents[v_index] - (v_exact[v_index] * 100);
      end if;
      if v_best is null or v_score > v_best_score then
        v_best := v_index;
        v_best_score := v_score;
      end if;
    end loop;
    if v_best is null then
      raise exception 'The allocation could not be reconciled to the cent.';
    end if;
    if v_drift > 0 then
      v_cents[v_best] := v_cents[v_best] + 1;
      v_drift := v_drift - 1;
    else
      v_cents[v_best] := v_cents[v_best] - 1;
      v_drift := v_drift + 1;
    end if;
  end loop;
  for v_index in 1..v_count loop
    v_result := array_append(v_result, v_cents[v_index]::numeric / 100);
  end loop;
  return v_result;
end;
$$;

create or replace function private.commitment_customer_text(
  p_currency text,
  p_years integer,
  p_year_one numeric,
  p_rule text,
  p_later numeric
) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_words text[] := array['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  v_heading text;
  v_year_one text;
  v_later text;
  v_span text;
  v_index integer;
  v_middle text := '';
begin
  if p_years between 1 and 10 then
    v_heading := v_words[p_years + 1] || '-year commitment';
  else
    v_heading := p_years::text || '-year commitment';
  end if;
  v_year_one := private.payment_money(p_currency, p_year_one);
  if p_years <= 1 or p_rule is null or p_later is null then
    return v_heading || '. Year 1: ' || v_year_one || ' per unit. This charge is payable 100% in advance and is included in this PI total.';
  end if;
  v_later := private.payment_money(p_currency, p_later);
  if p_years = 2 then
    v_span := 'Year 2';
  elsif p_years = 3 then
    v_span := 'Years 2 and 3';
  else
    for v_index in 2..(p_years - 1) loop
      if v_middle <> '' then
        v_middle := v_middle || ', ';
      end if;
      v_middle := v_middle || v_index::text;
    end loop;
    v_span := 'Years ' || v_middle || ' and ' || p_years::text;
  end if;
  if p_rule = 'fixed_annual' then
    return v_heading || '. Year 1: ' || v_year_one || ' per unit. ' || v_span || ': ' || v_later
      || ' per unit. Each year is payable 100% in advance. Only Year 1 is included in this PI total.';
  end if;
  if p_years = 2 then
    return v_heading || '. Year 1: ' || v_year_one || ' per unit. ' || v_span || ': ' || v_later
      || ' per unit plus the applicable vendor-confirmed CPI adjustment for that year. The adjustment is applied independently to the '
      || v_later || ' base. Each year is payable 100% in advance. Only Year 1 is included in this PI total.';
  end if;
  return v_heading || '. Year 1: ' || v_year_one || ' per unit. ' || v_span || ': ' || v_later
    || ' per unit plus the applicable vendor-confirmed CPI adjustment for each year. Each annual adjustment is applied independently to the '
    || v_later || ' base. Each year is payable 100% in advance. Only Year 1 is included in this PI total.';
end;
$$;

create or replace function private.subscription_payment_allocation(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
  v_count integer := 0;
  v_weights numeric[] := '{}';
  v_billing text[] := '{}';
  v_obligation text[] := '{}';
  v_product text[] := '{}';
  v_line_id text[] := '{}';
  v_position integer[] := '{}';
  v_discount numeric;
  v_shipping numeric;
  v_installation numeric;
  v_bank numeric;
  v_tax numeric;
  v_grand numeric;
  v_discounts numeric[];
  v_discounted numeric[] := '{}';
  v_discounted_sum numeric := 0;
  v_index integer;
  v_has_subscription boolean := false;
  v_has_one_time boolean := false;
  v_residual text;
  v_bucket_index integer[] := '{}';
  v_bucket_weights numeric[] := '{}';
  v_bucket_sum numeric := 0;
  v_shares numeric[];
  v_shipping_shares numeric[];
  v_installation_shares numeric[];
  v_bank_shares numeric[];
  v_tax_shares numeric[];
  v_taxable numeric[] := '{}';
  v_allocated numeric[] := '{}';
  v_sum numeric := 0;
  v_drift numeric;
  v_subscription numeric := 0;
  v_one_time numeric := 0;
  v_choice text;
  v_out jsonb := '[]'::jsonb;
begin
  select * into v_pi from public.proforma_invoices where id = p_id;
  if not found then
    raise exception 'PI not found.';
  end if;
  v_grand := coalesce(v_pi.grand_total, 0);
  v_discount := coalesce(v_pi.discount_amount, 0);
  v_shipping := coalesce(v_pi.shipping_amount, 0);
  v_installation := coalesce(v_pi.installation_amount, 0);
  v_bank := coalesce(v_pi.bank_charge_amount, 0);
  v_tax := case when v_pi.tax_enabled then coalesce(v_pi.tax_amount, 0) else 0 end;
  v_residual := v_pi.payment_schedule ->> 'residual_target';

  for v_line in
    select l.id, l.position, l.product_id, l.line_total, l.subscription_agreement, p.billing_type
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = p_id
    order by l.position
  loop
    if v_line.line_total is null then
      raise exception 'Enter a price on every item before the subscription and one-time amounts can be separated.';
    end if;
    v_count := v_count + 1;
    v_weights := array_append(v_weights, v_line.line_total);
    v_billing := array_append(v_billing, v_line.billing_type);
    v_obligation := array_append(v_obligation, v_line.subscription_agreement ->> 'obligation_id');
    v_product := array_append(v_product, v_line.product_id::text);
    v_line_id := array_append(v_line_id, v_line.id::text);
    v_position := array_append(v_position, v_line.position);
    if v_line.billing_type = 'subscription' then
      v_has_subscription := true;
    else
      v_has_one_time := true;
    end if;
  end loop;

  v_discounts := private.apportion_money(v_discount, v_weights, true);
  if v_discounts is null then
    raise exception 'The invoice discount could not be allocated.';
  end if;
  for v_index in 1..v_count loop
    v_discounted := array_append(v_discounted, v_weights[v_index] - v_discounts[v_index]);
    v_discounted_sum := v_discounted_sum + (v_weights[v_index] - v_discounts[v_index]);
  end loop;

  if v_count = 0 then
    v_allocated := array[]::numeric[];
  elsif v_discounted_sum = 0 and v_grand > 0 then
    if v_residual is null or v_residual not in ('subscription', 'one_time')
      or (v_residual = 'subscription' and not v_has_subscription)
      or (v_residual = 'one_time' and not v_has_one_time)
    then
      if v_has_subscription and not v_has_one_time then
        v_choice := 'The only place they can go is the subscription advance.';
      elsif v_has_one_time and not v_has_subscription then
        v_choice := 'The only place they can go is the one-time schedule.';
      else
        v_choice := 'Choose the subscription advance or the one-time schedule.';
      end if;
      raise exception 'The PI total is % but every current line is zero after discounts, so shipping, installation, bank charges, and tax cannot be shared by line value. % This does not create a subscription price.',
        private.payment_plain_amount(v_grand), v_choice;
    end if;
    for v_index in 1..v_count loop
      if v_billing[v_index] = v_residual then
        v_bucket_index := array_append(v_bucket_index, v_index);
        v_bucket_weights := array_append(v_bucket_weights, v_weights[v_index]);
        v_bucket_sum := v_bucket_sum + v_weights[v_index];
      end if;
    end loop;
    if v_bucket_sum = 0 then
      v_bucket_weights := array_fill(1::numeric, array[coalesce(array_length(v_bucket_index, 1), 0)]);
    end if;
    v_shares := private.apportion_money(v_grand, v_bucket_weights, false);
    if v_shares is null then
      raise exception 'The residual charges could not be allocated.';
    end if;
    v_allocated := array_fill(0::numeric, array[v_count]);
    for v_index in 1..coalesce(array_length(v_bucket_index, 1), 0) loop
      v_allocated[v_bucket_index[v_index]] := v_shares[v_index];
    end loop;
  else
    v_shipping_shares := coalesce(private.apportion_money(v_shipping, v_discounted, false), array_fill(0::numeric, array[v_count]));
    v_installation_shares := coalesce(private.apportion_money(v_installation, v_discounted, false), array_fill(0::numeric, array[v_count]));
    v_bank_shares := coalesce(private.apportion_money(v_bank, v_discounted, false), array_fill(0::numeric, array[v_count]));
    for v_index in 1..v_count loop
      v_taxable := array_append(v_taxable, v_discounted[v_index]
        + case when v_pi.tax_excludes_shipping then 0 else v_shipping_shares[v_index] end
        + case when v_pi.tax_excludes_installation then 0 else v_installation_shares[v_index] end
        + case when v_pi.tax_excludes_bank_charge then 0 else v_bank_shares[v_index] end);
    end loop;
    if v_pi.tax_enabled and v_tax <> 0 then
      v_tax_shares := private.apportion_money(v_tax, v_taxable, false);
      if v_tax_shares is null then
        raise exception 'The tax could not be allocated.';
      end if;
    else
      v_tax_shares := array_fill(0::numeric, array[greatest(v_count, 1)]);
      if v_count = 0 then
        v_tax_shares := array[]::numeric[];
      else
        v_tax_shares := array_fill(0::numeric, array[v_count]);
      end if;
    end if;
    for v_index in 1..v_count loop
      v_allocated := array_append(v_allocated, v_discounted[v_index] + v_shipping_shares[v_index] + v_installation_shares[v_index] + v_bank_shares[v_index] + v_tax_shares[v_index]);
    end loop;
  end if;

  if v_count > 0 then
    for v_index in 1..v_count loop
      v_sum := v_sum + coalesce(v_allocated[v_index], 0);
    end loop;
    v_drift := v_grand - v_sum;
    if abs(v_drift) > (v_count * 0.01) then
      raise exception 'The payment allocation does not match the PI total.';
    end if;
    for v_index in reverse v_count..1 loop
      exit when v_drift = 0;
      if v_allocated[v_index] + v_drift >= 0 then
        v_allocated[v_index] := v_allocated[v_index] + v_drift;
        v_drift := 0;
      end if;
    end loop;
    if v_drift <> 0 then
      raise exception 'The payment allocation does not match the PI total.';
    end if;
  elsif v_grand <> 0 then
    raise exception 'Add an item before the charges can be allocated.';
  end if;

  for v_index in 1..v_count loop
    if v_billing[v_index] = 'subscription' then
      v_subscription := v_subscription + v_allocated[v_index];
    else
      v_one_time := v_one_time + v_allocated[v_index];
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'position', v_position[v_index],
      'line_id', v_line_id[v_index],
      'billing_type', v_billing[v_index],
      'obligation_id', v_obligation[v_index],
      'product_id', v_product[v_index],
      'line_total', private.payment_plain_amount(v_weights[v_index]),
      'discount', private.payment_plain_amount(coalesce(v_discounts[v_index], 0)),
      'discounted', private.payment_plain_amount(coalesce(v_discounted[v_index], 0)),
      'shipping', private.payment_plain_amount(case when v_discounted_sum = 0 and v_grand > 0 then 0 else coalesce(v_shipping_shares[v_index], 0) end),
      'installation', private.payment_plain_amount(case when v_discounted_sum = 0 and v_grand > 0 then 0 else coalesce(v_installation_shares[v_index], 0) end),
      'bank_charge', private.payment_plain_amount(case when v_discounted_sum = 0 and v_grand > 0 then 0 else coalesce(v_bank_shares[v_index], 0) end),
      'tax', private.payment_plain_amount(case when v_discounted_sum = 0 and v_grand > 0 then 0 else coalesce(v_tax_shares[v_index], 0) end),
      'allocated_total', private.payment_plain_amount(v_allocated[v_index])
    ));
  end loop;

  if v_subscription + v_one_time <> v_grand then
    raise exception 'The subscription and one-time amounts do not add up to the PI total.';
  end if;

  return jsonb_build_object(
    'subscription_total', private.payment_plain_amount(v_subscription),
    'one_time_total', private.payment_plain_amount(v_one_time),
    'residual_applied', v_discounted_sum = 0 and v_grand > 0,
    'lines', v_out
  );
end;
$$;

create or replace function private.sanitize_allocated_schedule(p_schedule jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_residual text;
  v_clean jsonb;
begin
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'object' then
    raise exception 'The payment schedule could not be read.';
  end if;
  if coalesce(p_schedule ->> 'schema_version', '') <> '2' then
    raise exception 'This payment schedule uses a version this application cannot read.';
  end if;
  if p_schedule ? 'subscription_obligations'
    or p_schedule ? 'customer_text'
    or p_schedule ? 'allocation'
    or p_schedule ? 'subscription_total'
    or p_schedule ? 'one_time_total'
    or p_schedule ? 'grand_total'
  then
    raise exception 'Payment amounts and wording are calculated by the database. Remove the extra payment fields and try again.';
  end if;
  if not (p_schedule ? 'residual_target') or jsonb_typeof(p_schedule -> 'residual_target') = 'null' then
    v_residual := null;
  else
    v_residual := p_schedule ->> 'residual_target';
    if v_residual not in ('subscription', 'one_time') then
      raise exception 'Choose whether the unpriced charges belong to the subscription advance or the one-time schedule.';
    end if;
  end if;
  v_clean := private.sanitize_payment_schedule(jsonb_build_object(
    'schema_version', 1,
    'no_payment_due', p_schedule -> 'no_payment_due',
    'dates_need_review', p_schedule -> 'dates_need_review',
    'rows', p_schedule -> 'rows'
  ));
  return jsonb_build_object(
    'schema_version', 2,
    'no_payment_due', v_clean -> 'no_payment_due',
    'dates_need_review', v_clean -> 'dates_need_review',
    'rows', v_clean -> 'rows',
    'residual_target', case when v_residual is null then 'null'::jsonb else to_jsonb(v_residual) end
  );
end;
$$;

create or replace function private.resolve_subscription_agreement(
  p_product_id uuid,
  p_model text,
  p_billing_type text,
  p_currency text,
  p_unit_price numeric,
  p_input jsonb,
  p_previous jsonb
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_option public.product_commitment_options;
  v_option_found boolean := false;
  v_option_id uuid;
  v_same boolean := false;
  v_years integer;
  v_rule text;
  v_catalogue_first numeric;
  v_catalogue_later numeric;
  v_agreement_currency text;
  v_negotiated numeric;
  v_later numeric;
  v_later_specified boolean := false;
  v_obligation uuid;
begin
  if p_billing_type = 'one_time' then
    if p_input is not null and jsonb_typeof(p_input) <> 'null' then
      raise exception 'Subscription terms cannot be saved on a one-time product. Remove the commitment or choose a subscription product. The saved terms were not replaced.';
    end if;
    return null;
  end if;
  if p_billing_type is distinct from 'subscription' then
    raise exception 'Unknown product billing type.';
  end if;
  if p_input is null or jsonb_typeof(p_input) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_input) <> 'object' then
    raise exception 'The subscription commitment could not be read.';
  end if;
  if p_input ? 'current_year' and coalesce(p_input ->> 'current_year', '') <> '1' then
    raise exception 'This PI can only include the current subscription year, which is Year 1. Later years are not billed on this document.';
  end if;
  v_option_id := private.as_uuid(p_input ->> 'option_id');
  if v_option_id is null then
    raise exception 'Select a commitment for %. Leave the commitment empty only by clearing it, not by sending a partial commitment.', p_model;
  end if;
  v_same := p_previous is not null
    and p_previous ->> 'option_id' = v_option_id::text
    and p_previous ->> 'product_id' = p_product_id::text;
  select * into v_option from public.product_commitment_options where id = v_option_id;
  v_option_found := found;
  if not v_option_found then
    if not v_same then
      raise exception 'The selected commitment could not be found. Choose an active commitment. The saved terms were not replaced.';
    end if;
  elsif v_option.product_id <> p_product_id then
    raise exception 'This commitment does not belong to the selected product. Choose one of that product''s commitments. The saved terms were not replaced.';
  elsif not v_same and v_option.archived_at is not null then
    raise exception 'This commitment is archived. Choose an active commitment. The saved terms were not replaced.';
  end if;

  if p_currency is null then
    raise exception 'Choose an office and currency before selecting a subscription commitment.';
  end if;

  if v_same then
    v_years := (p_previous ->> 'commitment_years')::integer;
    v_rule := p_previous ->> 'later_year_rule';
    v_catalogue_first := (p_previous ->> 'catalogue_first_year_unit_price')::numeric;
    v_catalogue_later := (p_previous ->> 'catalogue_later_year_base_unit_price')::numeric;
    v_agreement_currency := p_previous ->> 'currency';
  else
    if v_option.currency <> p_currency then
      raise exception 'This commitment is priced in %. This PI is %. Prices are not converted between currencies. Choose a commitment in %.',
        v_option.currency, p_currency, p_currency;
    end if;
    v_years := v_option.commitment_years;
    v_rule := v_option.later_year_rule;
    v_catalogue_first := v_option.first_year_unit_price;
    v_catalogue_later := v_option.later_year_base_unit_price;
    v_agreement_currency := v_option.currency;
  end if;

  if v_agreement_currency is distinct from p_currency then
    raise exception 'The saved commitment is priced in %. This PI is %. Prices are not converted between currencies. Choose a commitment in %. The saved terms were not replaced.',
      v_agreement_currency, p_currency, p_currency;
  end if;
  if v_years is null or v_years < 1 or v_years > 30 then
    raise exception 'Commitment duration must be a whole number of years.';
  end if;
  if v_years = 1 then
    v_rule := null;
    v_catalogue_later := null;
  elsif v_rule is null or v_rule not in ('fixed_annual', 'vendor_confirmed_base_adjustment') then
    raise exception 'A multi-year commitment needs a supported later-year pricing rule.';
  end if;
  if p_input ? 'later_year_rule'
    and jsonb_typeof(p_input -> 'later_year_rule') <> 'null'
    and coalesce(p_input ->> 'later_year_rule', '') is distinct from coalesce(v_rule, '')
  then
    raise exception 'The later-year pricing rule comes from the selected commitment and cannot be changed on the PI.';
  end if;

  v_negotiated := round(private.as_numeric(p_input ->> 'negotiated_first_year_unit_price', 'Year 1 unit price'), 2);
  if v_negotiated is null then
    raise exception 'Enter the Year 1 unit price for %.', p_model;
  end if;
  if p_unit_price is null or round(p_unit_price, 2) is distinct from v_negotiated then
    raise exception 'The Year 1 price for % does not match the subscription commitment.', p_model;
  end if;

  if p_input ? 'later_year_base_unit_price' then
    v_later_specified := true;
    if jsonb_typeof(p_input -> 'later_year_base_unit_price') = 'null' or nullif(p_input ->> 'later_year_base_unit_price', '') is null then
      v_later := null;
    else
      v_later := round(private.as_numeric(p_input ->> 'later_year_base_unit_price', 'Later-year base unit price'), 2);
    end if;
  end if;
  if v_years = 1 then
    if v_later_specified and v_later is not null then
      raise exception 'A one-year commitment has no later-year price.';
    end if;
    v_later := null;
  else
    if v_later_specified and v_later is null then
      raise exception 'Enter the later-year base price for %.', p_model;
    end if;
    if not v_later_specified then
      if v_same then
        v_later := (p_previous ->> 'later_year_base_unit_price')::numeric;
      else
        v_later := v_catalogue_later;
      end if;
    end if;
    if v_later is null or v_later < 0 then
      raise exception 'Enter the later-year base price for %.', p_model;
    end if;
    v_later := round(v_later, 2);
  end if;

  v_obligation := private.as_uuid(p_input ->> 'obligation_id');
  if v_obligation is null then
    v_obligation := extensions.gen_random_uuid();
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'option_id', v_option_id,
    'obligation_id', v_obligation,
    'product_id', p_product_id,
    'billing_type', 'subscription',
    'commitment_years', v_years,
    'currency', v_agreement_currency,
    'current_year', 1,
    'catalogue_first_year_unit_price', private.payment_plain_amount(v_catalogue_first),
    'negotiated_first_year_unit_price', private.payment_plain_amount(v_negotiated),
    'later_year_rule', to_jsonb(v_rule),
    'later_year_base_unit_price', case when v_later is null then 'null'::jsonb else to_jsonb(private.payment_plain_amount(v_later)) end,
    'catalogue_later_year_base_unit_price', case when v_catalogue_later is null then 'null'::jsonb else to_jsonb(private.payment_plain_amount(v_catalogue_later)) end,
    'adjustment_compounds', false,
    'payable_in_advance', true,
    'customer_text', private.commitment_customer_text(v_agreement_currency, v_years, v_negotiated, v_rule, v_later)
  );
end;
$$;

create or replace function private.remap_subscription_agreement(p_agreement jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_agreement is null or jsonb_typeof(p_agreement) = 'null' then
    return null;
  end if;
  return jsonb_set(p_agreement, '{obligation_id}', to_jsonb(extensions.gen_random_uuid()::text));
end;
$$;

create or replace function private.canonical_allocated_payment(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_allocation jsonb;
  v_subscription numeric;
  v_one_time numeric;
  v_grand numeric;
  v_rows jsonb;
  v_v1 jsonb;
  v_one jsonb;
  v_one_text text;
  v_text text;
  v_presentation text;
  v_obligations jsonb := '[]'::jsonb;
  v_line jsonb;
  v_sentence text;
begin
  select * into v_pi from public.proforma_invoices where id = p_id;
  if v_pi.payment_schedule is null or coalesce(v_pi.payment_schedule ->> 'schema_version', '') <> '2' then
    raise exception 'This payment schedule version cannot be calculated as a split between subscription and one-time amounts.';
  end if;
  if v_pi.currency not in ('EGP', 'USD', 'EUR') then
    raise exception 'Choose an office and currency before the payment amounts can be calculated.';
  end if;
  v_allocation := private.subscription_payment_allocation(p_id);
  v_subscription := (v_allocation ->> 'subscription_total')::numeric;
  v_one_time := (v_allocation ->> 'one_time_total')::numeric;
  v_grand := v_pi.grand_total;
  v_rows := v_pi.payment_schedule -> 'rows';

  for v_line in select value from jsonb_array_elements(v_allocation -> 'lines') loop
    if v_line ->> 'billing_type' = 'subscription' then
      if nullif(v_line ->> 'obligation_id', '') is null then
        raise exception 'Select a commitment for every subscription before generating.';
      end if;
      v_obligations := v_obligations || jsonb_build_array(jsonb_build_object(
        'id', v_line ->> 'obligation_id',
        'line_id', v_line ->> 'line_id',
        'product_id', v_line ->> 'product_id',
        'position', (v_line ->> 'position')::integer,
        'amount', v_line ->> 'allocated_total',
        'due_formula', 'payable 100% in advance'
      ));
    end if;
  end loop;

  if coalesce((v_pi.payment_schedule ->> 'no_payment_due')::boolean, false) then
    if coalesce(jsonb_array_length(v_rows), 0) > 0 then
      raise exception 'Remove the payment rows, or turn off no payment due.';
    end if;
    if v_grand <> 0 then
      raise exception 'No payment due does not match the grand total. The PI total is not zero.';
    end if;
    return jsonb_build_object(
      'schema_version', 2,
      'currency', v_pi.currency,
      'grand_total', private.payment_plain_amount(v_grand),
      'subscription_total', private.payment_plain_amount(v_subscription),
      'one_time_total', private.payment_plain_amount(v_one_time),
      'customer_text', 'No payment due.',
      'presentation', 'paragraph',
      'no_payment_due', true,
      'subscription_obligations', v_obligations,
      'rows', '[]'::jsonb,
      'allocation', v_allocation || jsonb_build_object('residual_target', v_pi.payment_schedule -> 'residual_target')
    );
  end if;

  if v_grand = 0 then
    raise exception 'This PI total is zero. Mark the schedule as no payment due, or change the PI total.';
  end if;

  if v_one_time = 0 then
    if coalesce(jsonb_array_length(v_rows), 0) > 0 then
      raise exception 'This PI has no one-time amount. Remove those payment rows. The subscription charge is payable 100%% in advance and cannot be split into instalments.';
    end if;
    v_text := 'Subscription charges of ' || private.payment_money(v_pi.currency, v_subscription) || ' are payable 100% in advance.';
    v_presentation := 'paragraph';
    v_one := jsonb_build_object('rows', '[]'::jsonb, 'presentation', 'paragraph');
  else
    v_v1 := jsonb_build_object(
      'schema_version', 1,
      'no_payment_due', false,
      'dates_need_review', coalesce((v_pi.payment_schedule ->> 'dates_need_review')::boolean, false),
      'rows', v_rows
    );
    begin
      v_one := private.canonical_payment_v1(v_v1, v_pi.currency, v_one_time);
    exception when others then
      raise exception '%', replace(replace(sqlerrm, 'grand total', 'one-time amount'), 'Grand total', 'One-time amount');
    end;
    v_one_text := v_one ->> 'customer_text';
    v_sentence := regexp_replace(v_one_text, '\.$', '');
    if v_subscription > 0 then
      v_text := 'Subscription charges of ' || private.payment_money(v_pi.currency, v_subscription)
        || ' are payable 100% in advance. Of the remaining ' || private.payment_money(v_pi.currency, v_one_time)
        || ' for one-time items, ' || v_sentence || '.';
    else
      v_text := v_one_text;
    end if;
    if coalesce(v_one ->> 'presentation', '') = 'table' or char_length(v_text) > 420 then
      v_presentation := 'table';
    else
      v_presentation := 'paragraph';
    end if;
  end if;

  return jsonb_build_object(
    'schema_version', 2,
    'currency', v_pi.currency,
    'grand_total', private.payment_plain_amount(v_grand),
    'subscription_total', private.payment_plain_amount(v_subscription),
    'one_time_total', private.payment_plain_amount(v_one_time),
    'customer_text', v_text,
    'presentation', v_presentation,
    'no_payment_due', false,
    'subscription_obligations', v_obligations,
    'rows', coalesce(v_one -> 'rows', '[]'::jsonb),
    'allocation', v_allocation || jsonb_build_object('residual_target', v_pi.payment_schedule -> 'residual_target')
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
  if coalesce(p_schedule ->> 'schema_version', '1') not in ('1', '2') then
    raise exception 'This payment schedule uses a version this application cannot read.';
  end if;
  return jsonb_build_object(
    'schema_version', (p_schedule ->> 'schema_version')::integer,
    'no_payment_due', coalesce((p_schedule ->> 'no_payment_due')::boolean, false),
    'dates_need_review', v_cleared,
    'rows', v_rows
  ) || case
    when coalesce(p_schedule ->> 'schema_version', '1') = '2'
      then jsonb_build_object('residual_target', coalesce(p_schedule -> 'residual_target', 'null'::jsonb))
    else '{}'::jsonb
  end;
end;
$$;

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
  v_schedule_state text;
  v_billing text;
  v_agreement jsonb;
  v_previous jsonb;
  v_stored jsonb := '[]'::jsonb;
  v_had_agreement boolean := false;
  v_mentions boolean := false;
  v_has_subscription boolean := false;
  v_price_to_save numeric;
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
      if v_pi.payment_schedule is not null then
        raise exception 'A structured payment schedule cannot be replaced by the legacy payment paragraph.';
      end if;
      v_schedule := null;
      v_schedule_state := 'null';
      v_payment_terms := coalesce(p_payload ->> 'payment_terms', '');
    elsif jsonb_typeof(p_payload -> 'payment_schedule') = 'object' then
      if coalesce(p_payload -> 'payment_schedule' ->> 'schema_version', '') = '2' then
        v_schedule := private.sanitize_allocated_schedule(p_payload -> 'payment_schedule');
        v_schedule_state := 'v2';
      else
        v_schedule := private.sanitize_payment_schedule(p_payload -> 'payment_schedule');
        v_schedule_state := 'v1';
      end if;
      v_payment_terms := '';
    else
      raise exception 'The payment schedule could not be read.';
    end if;
  else
    if v_pi.payment_schedule is not null then
      raise exception 'This draft has a structured payment schedule. Close this editor and open the PI again before saving.';
    end if;
    v_schedule := null;
    v_schedule_state := 'omitted';
    v_payment_terms := coalesce(p_payload ->> 'payment_terms', '');
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'obligation_id', subscription_agreement ->> 'obligation_id',
    'agreement', subscription_agreement
  )), '[]'::jsonb)
  into v_stored
  from public.pi_lines
  where pi_id = p_id and subscription_agreement is not null;
  v_had_agreement := v_stored <> '[]'::jsonb;

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

      select p.model_code, p.vendor_id, v.company_name, p.billing_type
      into v_model, v_product_vendor, v_vendor_name, v_billing
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

      if v_billing = 'subscription' then
        v_has_subscription := true;
      end if;
      if v_line ? 'subscription' then
        v_mentions := true;
      end if;
      v_previous := null;
      if jsonb_typeof(v_line -> 'subscription') = 'object' then
        select elem -> 'agreement'
        into v_previous
        from jsonb_array_elements(v_stored) elem
        where elem ->> 'obligation_id' = v_line -> 'subscription' ->> 'obligation_id'
        limit 1;
      end if;
      v_agreement := private.resolve_subscription_agreement(
        v_product,
        v_model,
        v_billing,
        v_currency,
        v_price,
        case when v_line ? 'subscription' then v_line -> 'subscription' else 'null'::jsonb end,
        v_previous
      );
      v_price_to_save := case
        when v_agreement is null then v_price
        else (v_agreement ->> 'negotiated_first_year_unit_price')::numeric
      end;

      insert into public.pi_lines (
        pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, subscription_agreement
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
        v_price_to_save,
        v_agreement
      );
    end loop;
  end if;

  if v_had_agreement and not v_mentions then
    raise exception 'This draft has a saved subscription commitment. Close this editor and open the PI again before saving.';
  end if;
  if v_has_subscription then
    if v_schedule_state = 'omitted' then
      raise exception 'This draft includes a subscription. Close this editor and open the PI again, then update the payment allocation. The current payment agreement was left unchanged.';
    elsif v_schedule_state = 'null' then
      raise exception 'A subscription needs an allocation-aware payment schedule. The legacy payment paragraph was left unchanged.';
    elsif v_schedule_state = 'v1' then
      raise exception 'This draft uses a payment schedule based on the whole PI total. A subscription is payable 100%% in advance and cannot be included in those instalments. Update the payment allocation, then save. The current schedule was left unchanged.';
    end if;
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
  if exists (
    select 1
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = p_id and p.billing_type = 'one_time' and l.subscription_agreement is not null
  ) then
    raise exception 'A one-time item cannot carry a subscription commitment.';
  end if;
  if exists (
    select 1
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = p_id
      and p.billing_type = 'subscription'
      and (
        l.subscription_agreement is null
        or coalesce(l.subscription_agreement ->> 'schema_version', '') <> '1'
        or coalesce(l.subscription_agreement ->> 'current_year', '') <> '1'
        or l.subscription_agreement ->> 'currency' is distinct from v_preset.currency
        or nullif(l.subscription_agreement ->> 'obligation_id', '') is null
        or l.unit_price is distinct from (l.subscription_agreement ->> 'negotiated_first_year_unit_price')::numeric
        or coalesce(l.subscription_agreement ->> 'commitment_years', '') !~ '^[1-9][0-9]*$'
        or not exists (
          select 1 from public.product_commitment_options o
          where o.id = private.as_uuid(l.subscription_agreement ->> 'option_id')
            and o.product_id = l.product_id
        )
      )
  ) then
    raise exception 'Select a current commitment for every subscription, priced in this PI currency, before generating. Saved terms are not replaced from the catalogue.';
  end if;
  if exists (
    select 1
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = p_id and p.billing_type = 'subscription'
  ) and (
    v_pi.payment_schedule is null
    or coalesce(v_pi.payment_schedule ->> 'schema_version', '') <> '2'
  ) then
    raise exception 'A PI with a subscription must use an allocation-aware payment schedule before it can be issued.';
  end if;
  if v_pi.payment_schedule is not null and coalesce(v_pi.payment_schedule ->> 'schema_version', '') = '2' then
    perform private.canonical_allocated_payment(p_id);
  elsif v_pi.payment_schedule is not null then
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
  elsif coalesce(v_pi.payment_schedule ->> 'schema_version', '') = '2' then
    v_payment := private.canonical_allocated_payment(p_id);
    v_layout := case when v_preset.layout = 'uae' then 'uae-v3' else 'egypt-v3' end;
    v_payment_text := v_payment ->> 'customer_text';
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
      select jsonb_agg(
        jsonb_build_object(
          'line_id', l.id,
          'product_id', l.product_id,
          'position', l.position,
          'model_code', l.model_code,
          'description', l.description,
          'unit', l.unit,
          'quantity', l.quantity::text,
          'unit_price', l.unit_price::text,
          'line_total', l.line_total::text
        ) || case
          when l.subscription_agreement is null then '{}'::jsonb
          else jsonb_build_object(
            'subscription', l.subscription_agreement || jsonb_build_object(
              'payment_allocation', (
                select alloc.value
                from jsonb_array_elements(coalesce(v_payment -> 'allocation' -> 'lines', '[]'::jsonb)) alloc(value)
                where (alloc.value ->> 'position')::integer = l.position
                limit 1
              )
            )
          )
        end
        order by l.position
      )
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
    pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total, subscription_agreement
  )
  select v_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total,
    private.remap_subscription_agreement(subscription_agreement)
  from public.pi_lines where pi_id = p_id;

  insert into public.pi_salespeople (pi_id, user_id)
  select v_id, user_id from public.pi_salespeople where pi_id = p_id;

  return v_id;
end;
$$;



alter function private.canonical_payment(jsonb, text, numeric) rename to canonical_payment_v1;

create or replace function private.canonical_payment(p_schedule jsonb, p_currency text, p_total numeric)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(p_schedule ->> 'schema_version', '') is distinct from '1' then
    raise exception 'This payment schedule version cannot be calculated as a percentage of the grand total.';
  end if;
  return private.canonical_payment_v1(p_schedule, p_currency, p_total);
end;
$$;

comment on function private.canonical_payment(jsonb, text, numeric) is
  'Schema version 1 only. Percentages are of the PI grand total. Version 2 is rejected here so it cannot be reinterpreted against a different base.';

comment on function private.canonical_allocated_payment(uuid) is
  'Schema version 2 payment. Subscription Year 1 is 100 percent in advance. One-time percentages use only the one-time allocation. Future subscription years are not included.';

drop function if exists public.lookup_product_by_model(text);

create or replace function public.lookup_product_by_model(p_model text)
returns table (
  id uuid,
  vendor_id uuid,
  brand text,
  model_code text,
  description text,
  unit text,
  sell_price_egp numeric,
  sell_price_usd numeric,
  sell_price_eur numeric,
  billing_type text,
  archived_at timestamptz,
  vendor_name text,
  vendor_archived_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.vendor_id,
    p.brand,
    p.model_code,
    p.description,
    p.unit,
    p.sell_price_egp,
    p.sell_price_usd,
    p.sell_price_eur,
    p.billing_type,
    p.archived_at,
    v.company_name,
    v.archived_at
  from public.products p
  join public.vendors v on v.id = p.vendor_id
  where lower(btrim(p.model_code)) = lower(btrim(coalesce(p_model, '')))
    and lower(btrim(coalesce(p_model, ''))) <> '';
$$;

revoke all on function public.lookup_product_by_model(text) from public, anon, authenticated;
grant execute on function public.lookup_product_by_model(text) to authenticated;


create or replace function private.product_pi_history(
  p_product_id uuid,
  p_include_older boolean,
  p_client text,
  p_currency text,
  p_status text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_model_key text;
  v_client text;
  v_currency text;
  v_status text;
  v_limit integer;
  v_offset integer;
  v_include_older boolean;
  v_empty jsonb := jsonb_build_object(
    'total', 0,
    'rows', '[]'::jsonb,
    'clients', '[]'::jsonb,
    'currencies', '[]'::jsonb,
    'statuses', '[]'::jsonb
  );
  v_result jsonb;
begin
  if not private.is_active_member() or p_product_id is null then
    return v_empty;
  end if;

  select lower(btrim(model_code)) into v_model_key
  from public.products
  where id = p_product_id;
  if not found or v_model_key is null or v_model_key = '' then
    return v_empty;
  end if;

  v_include_older := coalesce(p_include_older, false);
  v_client := nullif(btrim(coalesce(p_client, '')), '');
  v_currency := nullif(upper(btrim(coalesce(p_currency, ''))), '');
  v_status := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with latest as (
    select v.pi_id, max(v.revision) as revision
    from public.pi_versions v
    where private.can_read_pi(v.pi_id)
    group by v.pi_id
  ),
  issued_lines as (
    select
      v.pi_id,
      v.id as version_id,
      v.revision,
      v.pi_number,
      case when v.revision = latest.revision then 'latest_issued' else 'older_revision' end as source,
      case when v.revision = latest.revision then 0 else 2 end as source_rank,
      coalesce(private.history_uuid(line.value ->> 'line_id')::text, 'line') || ':' || line.ordinality::text as line_key,
      case
        when coalesce(line.value ->> 'position', '') ~ '^[1-9][0-9]*$' then (line.value ->> 'position')::integer
        else line.ordinality::integer
      end as line_position,
      coalesce(line.value ->> 'model_code', '') as model_code,
      coalesce(line.value ->> 'description', '') as description,
      coalesce(line.value ->> 'unit', '') as unit,
      nullif(btrim(line.value ->> 'quantity'), '') as quantity,
      nullif(btrim(line.value ->> 'unit_price'), '') as unit_price,
      upper(btrim(coalesce(v.snapshot ->> 'currency', ''))) as currency,
      nullif(btrim(coalesce(v.snapshot #>> '{client,company_name}', '')), '') as client_name,
      case
        when coalesce(v.snapshot ->> 'pi_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then (v.snapshot ->> 'pi_date')::date
        else null
      end as pi_date,
      case
        when pi.tracking_status = 'cancelled' then 'cancelled'
        when pi.tracking_status = 'accepted' then 'accepted'
        when pi.tracking_status = 'sent' then 'sent'
        else 'issued'
      end as pi_status,
      case
        when nullif(btrim(coalesce(line.value ->> 'product_id', '')), '') is not null then 'product_id'
        else 'legacy_model'
      end as match_kind,
      coalesce(nullif(v.snapshot #>> '{adjustments,discount_type}', ''), 'none') as discount_type,
      nullif(v.snapshot #>> '{adjustments,discount_value}', '') as discount_value,
      nullif(v.snapshot #>> '{adjustments,discount_amount}', '') as discount_amount,
      coalesce(
        nullif(v.snapshot ->> 'display_number', ''),
        case when v.revision = 0 then v.pi_number else v.pi_number || '-R' || v.revision::text end
      ) as display_number,
      coalesce(
        nullif(v.snapshot ->> 'revision_label', ''),
        case when v.revision > 0 then 'R' || v.revision::text else null end
      ) as revision_label
      , nullif(btrim(line.value #>> '{subscription,current_year}'), '') as subscription_year
      , nullif(btrim(line.value #>> '{subscription,commitment_years}'), '') as commitment_years
    from public.pi_versions v
    join latest on latest.pi_id = v.pi_id
    join public.proforma_invoices pi on pi.id = v.pi_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(v.snapshot -> 'lines') = 'array' then v.snapshot -> 'lines'
        else '[]'::jsonb
      end
    ) with ordinality as line(value, ordinality)
    where private.can_read_pi(v.pi_id)
      and (v_include_older or v.revision = latest.revision)
      and (
        case
          when nullif(btrim(coalesce(line.value ->> 'product_id', '')), '') is not null
            then private.history_uuid(line.value ->> 'product_id') = p_product_id
          else lower(btrim(coalesce(line.value ->> 'model_code', ''))) = v_model_key
            and v_model_key <> ''
        end
      )
  ),
  draft_lines as (
    select
      pi.id as pi_id,
      null::uuid as version_id,
      null::integer as revision,
      pi.pi_number,
      case
        when exists (select 1 from public.pi_versions issued where issued.pi_id = pi.id)
          then 'revision_draft'
        else 'initial_draft'
      end as source,
      case
        when exists (select 1 from public.pi_versions issued where issued.pi_id = pi.id)
          then 1
        else 3
      end as source_rank,
      l.id::text as line_key,
      l.position as line_position,
      l.model_code,
      l.description,
      l.unit,
      l.quantity::text as quantity,
      l.unit_price::text as unit_price,
      upper(btrim(coalesce(pi.currency, ''))) as currency,
      nullif(btrim(coalesce(c.company_name, '')), '') as client_name,
      pi.pi_date,
      'draft'::text as pi_status,
      case when l.product_id is not null then 'product_id' else 'legacy_model' end as match_kind,
      coalesce(pi.discount_type, 'none') as discount_type,
      pi.discount_value::text as discount_value,
      pi.discount_amount::text as discount_amount,
      null::text as display_number,
      null::text as revision_label
      , nullif(btrim(l.subscription_agreement ->> 'current_year'), '') as subscription_year
      , nullif(btrim(l.subscription_agreement ->> 'commitment_years'), '') as commitment_years
    from public.pi_lines l
    join public.proforma_invoices pi on pi.id = l.pi_id
    left join public.clients c on c.id = pi.client_id
    where pi.draft_open
      and private.can_read_pi(pi.id)
      and (
        case
          when l.product_id is not null then l.product_id = p_product_id
          else lower(btrim(l.model_code)) = v_model_key and v_model_key <> ''
        end
      )
  ),
  matched as (
    select * from issued_lines
    union all
    select * from draft_lines
  ),
  filtered as (
    select *
    from matched
    where private.can_read_pi(pi_id)
      and (v_client is null or client_name = v_client)
      and (v_currency is null or currency = v_currency)
      and (v_status is null or pi_status = v_status)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(
        s.payload
        order by s.sort_date desc nulls last, s.sort_number desc nulls last, s.sort_pi, s.sort_rank, s.sort_revision desc nulls last, s.sort_position, s.sort_line
      )
      from (
        select
          jsonb_build_object(
            'row_id', source || ':' || coalesce(version_id::text, 'draft') || ':' || line_key,
            'pi_id', pi_id,
            'source', source,
            'pi_number', pi_number,
            'revision', revision,
            'revision_label', revision_label,
            'display_number', display_number,
            'client_name', client_name,
            'pi_date', to_char(pi_date, 'YYYY-MM-DD'),
            'quantity', quantity,
            'unit', unit,
            'unit_price', unit_price,
            'currency', nullif(currency, ''),
            'pi_status', pi_status,
            'model_code', model_code,
            'description', description,
            'position', line_position,
            'match_kind', match_kind,
            'discount_on_pi', discount_type in ('percent', 'fixed') and coalesce(private.history_numeric(discount_value), 0) > 0,
            'discount_type', discount_type,
            'discount_value', discount_value,
            'discount_amount', discount_amount,
            'current_subscription_year', subscription_year,
            'commitment_years', commitment_years
          ) as payload,
          pi_date as sort_date,
          pi_number as sort_number,
          pi_id as sort_pi,
          source_rank as sort_rank,
          revision as sort_revision,
          line_position as sort_position,
          line_key as sort_line
        from filtered
        order by pi_date desc nulls last, pi_number desc nulls last, pi_id, source_rank, revision desc nulls last, line_position, line_key
        limit v_limit
        offset v_offset
      ) s
    ), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(c.client_name order by c.client_name)
      from (select distinct client_name from matched where client_name is not null) c
    ), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(c.currency order by c.currency_order, c.currency)
      from (
        select distinct currency,
          case currency when 'EGP' then 1 when 'USD' then 2 when 'EUR' then 3 else 4 end as currency_order
        from matched
        where currency <> ''
      ) c
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(s.pi_status order by s.status_order, s.pi_status)
      from (
        select distinct pi_status,
          case pi_status
            when 'draft' then 1
            when 'issued' then 2
            when 'sent' then 3
            when 'accepted' then 4
            when 'cancelled' then 5
            else 6
          end as status_order
        from matched
      ) s
    ), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, v_empty);
end;
$$;



drop policy if exists commitment_options_select on public.product_commitment_options;
create policy commitment_options_select on public.product_commitment_options
for select to authenticated
using (private.is_active_member());

drop policy if exists commitment_options_insert on public.product_commitment_options;
create policy commitment_options_insert on public.product_commitment_options
for insert to authenticated
with check (private.has_flag('can_manage_products'));

drop policy if exists commitment_options_update on public.product_commitment_options;
create policy commitment_options_update on public.product_commitment_options
for update to authenticated
using (private.has_flag('can_manage_products'))
with check (private.has_flag('can_manage_products'));

revoke all on table public.product_commitment_options from public, anon, authenticated;
grant select, insert, update on table public.product_commitment_options to authenticated;

revoke all on function private.protect_commitment_option() from public, anon, authenticated;
revoke all on function private.pi_lines_reject_hidden_subscription() from public, anon, authenticated;
revoke all on function private.assert_subscription_payment_schedule() from public, anon, authenticated;
revoke all on function private.apportion_money(numeric, numeric[], boolean) from public, anon, authenticated;
revoke all on function private.commitment_customer_text(text, integer, numeric, text, numeric) from public, anon, authenticated;
revoke all on function private.subscription_payment_allocation(uuid) from public, anon, authenticated;
revoke all on function private.sanitize_allocated_schedule(jsonb) from public, anon, authenticated;
revoke all on function private.resolve_subscription_agreement(uuid, text, text, text, numeric, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.remap_subscription_agreement(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_allocated_payment(uuid) from public, anon, authenticated;
revoke all on function private.canonical_payment_v1(jsonb, text, numeric) from public, anon, authenticated;
revoke all on function private.canonical_payment(jsonb, text, numeric) from public, anon, authenticated;

comment on function private.build_snapshot(uuid, integer, text) is
  'Issued document snapshot. Legacy paragraphs stay on egypt-v1 or uae-v1. Schema version 1 schedules stay on egypt-v2 or uae-v2. Schema version 2 allocation schedules use egypt-v3 or uae-v3 and store the subscription agreement. Older snapshots are not rewritten.';
