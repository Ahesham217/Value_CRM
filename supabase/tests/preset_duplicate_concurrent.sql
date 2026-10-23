-- Committed fixtures for duplicate overlapping save and generate.
-- Run only on a disposable database. The shell drops the helper objects afterwards.

drop table if exists public.preset_duplicate_race;
drop trigger if exists pause_duplicate_pi_insert on public.proforma_invoices;
drop function if exists public.pause_duplicate_pi_insert();

create or replace function public.pause_duplicate_pi_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The source PI and its preset are already locked. Sleeping here keeps that
  -- window open so a concurrent save or generate can block before the insert's
  -- foreign-key checks run.
  if pg_catalog.current_setting('test.pause_pi_insert', true) is distinct from 'on' then
    return new;
  end if;
  perform pg_catalog.pg_sleep(5);
  return new;
end;
$$;

create trigger pause_duplicate_pi_insert
before insert on public.proforma_invoices
for each row execute function public.pause_duplicate_pi_insert();

do $setup$
declare
  v_editor uuid := gen_random_uuid();
  v_issuer uuid := gen_random_uuid();
  v_instance uuid;
  v_client uuid;
  v_vendor uuid;
  v_product uuid;
  v_model text := 'zz-dup-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_kind text;
  v_tag text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 3));
  v_prefix text;
  v_preset text;
  v_pi uuid;
  v_base jsonb;
  v_save jsonb;
  v_line jsonb;
begin
  select instance_id into v_instance from auth.users limit 1;
  if v_instance is null then
    v_instance := '00000000-0000-0000-0000-000000000000';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values
  (
    v_instance, v_editor, 'authenticated', 'authenticated',
    'dup-editor-' || v_editor::text || '@example.invalid',
    'not-a-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Duplicate Editor"}'::jsonb,
    now(), now(),
    'c-' || v_editor::text, 'r-' || v_editor::text, 'n-' || v_editor::text, ''
  ),
  (
    v_instance, v_issuer, 'authenticated', 'authenticated',
    'dup-issuer-' || v_issuer::text || '@example.invalid',
    'not-a-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Duplicate Issuer"}'::jsonb,
    now(), now(),
    'c-' || v_issuer::text, 'r-' || v_issuer::text, 'n-' || v_issuer::text, ''
  );
  update public.profiles
  set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_edit_drafts = true, can_generate_pis = true
  where id = v_editor;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
      can_edit_drafts = false, can_generate_pis = true
  where id = v_issuer;

  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.clients (company_name, billing_address)
  values ('Duplicate client ' || v_model, 'Duplicate billing')
  returning id into v_client;
  insert into public.vendors (company_name)
  values ('Duplicate vendor ' || v_model)
  returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd)
  values (v_vendor, v_model, 'Duplicate item', 'unit', 10.50)
  returning id into v_product;

  create table public.preset_duplicate_race (
    kind text primary key,
    editor_id uuid not null,
    issuer_id uuid not null,
    preset_code text not null,
    pi_id uuid not null,
    draft_version integer not null,
    prefix text not null,
    save_payload jsonb not null
  );

  foreach v_kind in array ARRAY['dup_save', 'save_dup', 'dup_generate', 'generate_dup']
  loop
    v_prefix := case v_kind
      when 'dup_save' then 'E' || v_tag
      when 'save_dup' then 'F' || v_tag
      when 'dup_generate' then 'G' || v_tag
      else 'H' || v_tag
    end;
    v_preset := (to_jsonb(public.create_company_preset(jsonb_build_object(
      'display_name', v_kind,
      'office', v_prefix,
      'currency', 'USD',
      'layout', 'egypt',
      'new_prefix', v_prefix,
      'company_name', v_kind,
      'address', 'Address',
      'bank_name', 'Bank',
      'account_name', v_kind,
      'account_number', '000123',
      'iban', 'IBAN-' || v_prefix,
      'bank_swift', 'RACE' || v_prefix || 'QA'
    ))) ->> 'code');
    v_line := jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Duplicate item', 'unit', 'unit', 'quantity', '1', 'unit_price', '10.50',
      'subscription', null
    );
    v_base := jsonb_build_object(
      'preset_code', v_preset,
      'pi_date', '2026-10-23', 'expiry_date', '2026-11-23',
      'client_id', v_client, 'bill_to', 'Duplicate billing', 'ship_to', 'Duplicate billing',
      'ship_same_as_billing', true, 'customer_reference', '',
      'lead_salesperson_id', v_editor, 'salesperson_ids', jsonb_build_array(v_editor),
      'discount_type', 'none', 'discount_value', null,
      'shipping_amount', null, 'installation_amount', null, 'bank_charge_amount', null,
      'tax_enabled', false, 'tax_percent', null,
      'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
      'price_basis', '', 'payment_terms', '',
      'payment_schedule', jsonb_build_object(
        'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
        'rows', jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(), 'label', 'advance payment',
          'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
          'due', jsonb_build_object('type', 'date', 'date', '2026-11-01'),
          'instalments', null
        ))
      ),
      'delivery_terms', '', 'warranty', '', 'additional_notes', 'saved draft',
      'lines', jsonb_build_array(v_line)
    );
    v_save := v_base || jsonb_build_object(
      'additional_notes', 'saved over duplicate',
      'lines', jsonb_build_array(v_line || jsonb_build_object('unit_price', '12.00'))
    );
    v_pi := public.create_pi_draft();
    perform public.save_pi_draft(v_pi, 1, v_base);
    insert into public.preset_duplicate_race
    select v_kind, v_editor, v_issuer, v_preset, v_pi, draft_version, v_prefix, v_save
    from public.proforma_invoices
    where id = v_pi;
  end loop;
end
$setup$;

select kind || '|' || editor_id::text || '|' || issuer_id::text || '|' || preset_code || '|' || pi_id::text || '|' || draft_version::text || '|' || prefix
from public.preset_duplicate_race
order by kind;
