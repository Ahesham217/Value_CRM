-- Committed receipt for the finance-review and reversal overlap.
-- Run only on a disposable database. Never run this on Value CRM.

do $setup$
declare
  v_user uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
  v_instance uuid;
  v_token text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_client uuid;
  v_vendor uuid;
  v_product uuid;
  v_model text := 'zz-fin-conc-' || v_token;
  v_pi uuid;
  v_payload jsonb;
  v_result jsonb;
  v_plan uuid;
  v_obligation uuid;
  v_today date;
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
    'fin-conc-' || v_user::text || '@example.invalid',
    'not-a-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    'c-fin-conc-' || v_user::text, 'r-fin-conc-' || v_user::text, 'n-fin-conc-' || v_user::text, ''
  )
  on conflict (id) do nothing;
  update public.profiles
  set full_name = 'Finance Concurrent', is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false, can_review_payments = false
  where id = v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  insert into public.clients (company_name, billing_address)
  values ('Finance Concurrent ' || v_token, 'Concurrent billing')
  returning id into v_client;
  insert into public.vendors (company_name) values ('Finance Concurrent Vendor ' || v_token) returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
  values (v_vendor, v_model, 'Machine', 'unit', 10000, 'one_time')
  returning id into v_product;
  v_pi := public.create_pi_draft();
  v_payload := jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-01', 'expiry_date', '2026-11-30',
    'client_id', v_client, 'bill_to', 'Concurrent billing', 'ship_to', 'Concurrent billing', 'ship_same_as_billing', true,
    'customer_reference', 'fin-conc-' || v_token, 'lead_salesperson_id', v_user, 'salesperson_ids', jsonb_build_array(v_user),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '',
    'payment_schedule', jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null,
      'rows', jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'label', 'machine advance',
        'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
        'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
        'instalments', null
      ))
    ),
    'delivery_terms', '', 'warranty', '', 'additional_notes', v_token,
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'Machine', 'unit', 'unit',
      'quantity', '1', 'unit_price', '10000.00', 'subscription', null
    ))
  );
  perform public.save_pi_draft(v_pi, 1, v_payload);
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  perform public.start_payment_tracking(v_pi, (v_result ->> 'version_id')::uuid, true);
  select id into v_plan from public.payment_plans where pi_id = v_pi;
  select id into v_obligation from public.payment_obligations where plan_id = v_plan and kind = 'payment_row';
  v_today := private.cairo_today();
  perform public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '4000.00', 'received_on', v_today, 'method', 'bank_transfer', 'reference', 'CONC-1',
    'allocations', jsonb_build_array(jsonb_build_object('obligation_id', v_obligation, 'amount', '4000.00'))
  ));
  perform public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '3000.00', 'received_on', v_today, 'method', 'cash', 'reference', 'CONC-2',
    'allocations', jsonb_build_array(jsonb_build_object('obligation_id', v_obligation, 'amount', '3000.00'))
  ));
end;
$setup$;

select
  p.id::text || '|' || first_receipt.id::text || '|' || second_receipt.id::text || '|' || obligation.id::text
from public.payment_plans p
join public.proforma_invoices pi on pi.id = p.pi_id
join public.clients c on c.id = pi.client_id
join public.payment_obligations obligation on obligation.plan_id = p.id and obligation.kind = 'payment_row'
join public.payment_receipts first_receipt on first_receipt.plan_id = p.id and first_receipt.reference = 'CONC-1'
join public.payment_receipts second_receipt on second_receipt.plan_id = p.id and second_receipt.reference = 'CONC-2'
where c.company_name like 'Finance Concurrent %'
order by pi.created_at desc
limit 1;
