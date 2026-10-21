-- Committed fixture for the two-session overlap test. Run only on a disposable database.

do $setup$
declare
  v_user uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  v_instance uuid;
  v_client uuid;
  v_vendor uuid;
  v_product uuid;
  v_pi uuid;
  v_model text := 'zz-concurrent-' || left(gen_random_uuid()::text, 8);
  v_payload jsonb;
  v_result jsonb;
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
    'pay-concurrent-' || v_user::text || '@example.invalid',
    'not-a-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    'c-concurrent-' || v_user::text, 'r-concurrent-' || v_user::text, 'n-concurrent-' || v_user::text, ''
  )
  on conflict (id) do nothing;
  update public.profiles
  set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all'
  where id = v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  insert into public.clients (company_name, billing_address) values ('Concurrent Client ' || v_model, 'Concurrent billing') returning id into v_client;
  insert into public.vendors (company_name) values ('Concurrent Vendor ' || v_model) returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
  values (v_vendor, v_model, 'Concurrent machine', 'unit', 100, 'one_time')
  returning id into v_product;
  v_pi := public.create_pi_draft();
  v_payload := jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-01', 'expiry_date', '2026-11-01',
    'client_id', v_client, 'bill_to', 'Concurrent billing', 'ship_to', 'Concurrent billing', 'ship_same_as_billing', true,
    'customer_reference', '', 'lead_salesperson_id', v_user, 'salesperson_ids', jsonb_build_array(v_user),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '',
    'payment_schedule', jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(jsonb_build_object(
        'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'label', 'advance payment',
        'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
        'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
        'instalments', null
      ))
    ),
    'delivery_terms', '', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'Concurrent machine',
      'unit', 'unit', 'quantity', '1', 'unit_price', '100.00', 'subscription', null
    ))
  );
  perform public.save_pi_draft(v_pi, 1, v_payload);
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  perform public.start_payment_tracking(v_pi, (v_result ->> 'version_id')::uuid, true);
end;
$setup$;

select p.id as plan_id, o.id as obligation_id
from public.payment_plans p
join public.payment_obligations o on o.plan_id = p.id
join public.proforma_invoices pi on pi.id = p.pi_id
join public.clients c on c.id = pi.client_id
where c.company_name like 'Concurrent Client %'
  and o.amount = 100
order by p.started_at desc
limit 1;
