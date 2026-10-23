-- Committed fixtures for preset identity and prefix edits overlapping first issue.
-- Run only on a disposable database.

do $setup$
declare
  v_user uuid := gen_random_uuid();
  v_instance uuid;
  v_client uuid;
  v_vendor uuid;
  v_product uuid;
  v_model text := 'zz-id-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_kind text;
  v_tag text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 3));
  v_prefix text;
  v_preset text;
  v_pi uuid;
  v_payload jsonb;
begin
  select instance_id into v_instance from auth.users limit 1;
  if v_instance is null then
    v_instance := '00000000-0000-0000-0000-000000000000';
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    v_instance, v_user, 'authenticated', 'authenticated',
    'id-concurrent-' || v_user::text || '@example.invalid',
    'not-a-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Identity Issuer"}'::jsonb,
    now(), now(),
    'c-' || v_user::text, 'r-' || v_user::text, 'n-' || v_user::text, ''
  );
  update public.profiles
  set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_edit_drafts = true, can_generate_pis = true
  where id = v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.clients (company_name, billing_address)
  values ('Identity client ' || v_model, 'Identity billing')
  returning id into v_client;
  insert into public.vendors (company_name)
  values ('Identity vendor ' || v_model)
  returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd)
  values (v_vendor, v_model, 'Identity item', 'unit', 10.50)
  returning id into v_product;

  create temp table preset_identity_race (
    kind text primary key,
    user_id uuid not null,
    preset_code text not null,
    pi_id uuid not null,
    draft_version integer not null,
    prefix text not null
  );

  foreach v_kind in array ARRAY['currency_issue', 'currency_edit', 'prefix_issue', 'prefix_edit']
  loop
    v_prefix := case v_kind
      when 'currency_issue' then 'A' || v_tag
      when 'currency_edit' then 'B' || v_tag
      when 'prefix_issue' then 'C' || v_tag
      else 'D' || v_tag
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
    v_payload := jsonb_build_object(
      'preset_code', v_preset,
      'pi_date', '2026-10-23', 'expiry_date', '2026-11-23',
      'client_id', v_client, 'bill_to', 'Identity billing', 'ship_to', 'Identity billing',
      'ship_same_as_billing', true, 'customer_reference', '',
      'lead_salesperson_id', v_user, 'salesperson_ids', jsonb_build_array(v_user),
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
      'delivery_terms', '', 'warranty', '', 'additional_notes', '',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
        'description', 'Identity item', 'unit', 'unit', 'quantity', '1', 'unit_price', '10.50',
        'subscription', null
      ))
    );
    v_pi := public.create_pi_draft();
    perform public.save_pi_draft(v_pi, 1, v_payload);
    insert into preset_identity_race
    select v_kind, v_user, v_preset, v_pi, draft_version, v_prefix
    from public.proforma_invoices
    where id = v_pi;
  end loop;

  update public.profiles
  set is_admin = false, can_edit_drafts = false, can_generate_pis = true
  where id = v_user;
end
$setup$;

select kind || '|' || user_id::text || '|' || preset_code || '|' || pi_id::text || '|' || draft_version::text || '|' || prefix
from preset_identity_race
order by kind;
