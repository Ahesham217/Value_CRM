-- Committed fixture for two overlapping PI issues. Run only on a disposable database.

do $setup$
declare
  v_user uuid := gen_random_uuid();
  v_instance uuid;
  v_client uuid;
  v_vendor uuid;
  v_product uuid;
  v_model text := 'zz-num-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_prefix text := 'N' || upper(left(replace(gen_random_uuid()::text, '-', ''), 4));
  v_code text;
  v_first uuid;
  v_second uuid;
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
    'num-concurrent-' || v_user::text || '@example.invalid',
    'not-a-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Numbering Issuer"}'::jsonb,
    now(), now(),
    'c-' || v_user::text, 'r-' || v_user::text, 'n-' || v_user::text, ''
  );
  update public.profiles
  set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_edit_drafts = true, can_generate_pis = true
  where id = v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.numbering_sequences (prefix) values (v_prefix) returning code into v_code;
  insert into public.company_presets (
    display_name, office, currency, layout, sequence_code,
    company_name, address, bank_name, account_name, account_number, iban, bank_swift
  ) values (
    'Concurrent ' || v_prefix, v_prefix, 'USD', 'uae', v_code,
    'Concurrent Office', 'Address', 'Concurrent Bank', 'Concurrent Office', '000123', 'QA00CONCURRENT', 'CONCURQA'
  );

  insert into public.clients (company_name, billing_address)
  values ('Concurrent numbering ' || v_model, 'Concurrent billing')
  returning id into v_client;
  insert into public.vendors (company_name)
  values ('Concurrent numbering vendor ' || v_model)
  returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd)
  values (v_vendor, v_model, 'Concurrent item', 'unit', 100)
  returning id into v_product;

  v_payload := jsonb_build_object(
    'preset_code', (select code from public.company_presets where sequence_code = v_code order by updated_at desc limit 1),
    'pi_date', '2026-10-23', 'expiry_date', '2026-11-23',
    'client_id', v_client, 'bill_to', 'Concurrent billing', 'ship_to', 'Concurrent billing',
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
      'description', 'Concurrent item', 'unit', 'unit', 'quantity', '1', 'unit_price', '100.00',
      'subscription', null
    ))
  );

  v_first := public.create_pi_draft();
  perform public.save_pi_draft(v_first, 1, v_payload);
  v_second := public.create_pi_draft();
  perform public.save_pi_draft(v_second, 1, v_payload);

  update public.profiles
  set is_admin = false, can_edit_drafts = false, can_generate_pis = true
  where id = v_user;

  create temp table preset_numbering_race (
    user_id uuid,
    first_id uuid,
    first_version integer,
    second_id uuid,
    second_version integer,
    prefix text
  );
  insert into preset_numbering_race
  select v_user, v_first, draft_version, v_second,
    (select draft_version from public.proforma_invoices where id = v_second),
    v_prefix
  from public.proforma_invoices
  where id = v_first;
end
$setup$;

select user_id::text || '|' || first_id::text || '|' || first_version::text || '|' || second_id::text || '|' || second_version::text || '|' || prefix
from preset_numbering_race;
