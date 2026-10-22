-- Committed mixed PIs for the lock-order overlap test. Run only on a disposable database.
-- Each PI has a payable machine obligation and a zero-value subscription.

do $setup$
declare
  v_user uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  v_instance uuid;
  v_token text := left(gen_random_uuid()::text, 8);
  v_label text;
  v_client uuid;
  v_vendor uuid;
  v_machine uuid;
  v_plan_product uuid;
  v_option uuid;
  v_pi uuid;
  v_model_machine text;
  v_model_plan text;
  v_obligation uuid;
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
  set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false
  where id = v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  foreach v_label in array ARRAY['A', 'B'] loop
    v_model_machine := 'zz-lock-machine-' || v_label || '-' || v_token;
    v_model_plan := 'zz-lock-plan-' || v_label || '-' || v_token;
    v_obligation := gen_random_uuid();
    insert into public.clients (company_name, billing_address)
    values ('Lock Order ' || v_label || ' ' || v_token, 'Lock billing')
    returning id into v_client;
    insert into public.vendors (company_name) values ('Lock Vendor ' || v_label || ' ' || v_token) returning id into v_vendor;
    insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
    values (v_vendor, v_model_machine, 'Machine', 'unit', 10000, 'one_time')
    returning id into v_machine;
    insert into public.products (vendor_id, model_code, description, unit, billing_type)
    values (v_vendor, v_model_plan, 'Free plan', 'license', 'subscription')
    returning id into v_plan_product;
    insert into public.product_commitment_options (product_id, commitment_years, currency, first_year_unit_price)
    values (v_plan_product, 1, 'USD', 0)
    returning id into v_option;
    v_pi := public.create_pi_draft();
    v_payload := jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-01', 'expiry_date', '2026-11-01',
      'client_id', v_client, 'bill_to', 'Lock billing', 'ship_to', 'Lock billing', 'ship_same_as_billing', true,
      'customer_reference', 'lock-' || v_label || '-' || v_token, 'lead_salesperson_id', v_user, 'salesperson_ids', jsonb_build_array(v_user),
      'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
      'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
      'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
      'price_basis', '', 'payment_terms', '',
      'payment_schedule', jsonb_build_object(
        'schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null,
        'rows', jsonb_build_array(jsonb_build_object(
          'id', case when v_label = 'A' then 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' else 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2' end,
          'label', 'machine advance',
          'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
          'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
          'instalments', null
        ))
      ),
      'delivery_terms', '', 'warranty', '', 'additional_notes', v_token,
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_machine, 'description', 'Machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '10000.00', 'subscription', null),
        jsonb_build_object(
          'product_id', v_plan_product, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Free plan', 'unit', 'license', 'quantity', '1', 'unit_price', '0.00',
          'subscription', jsonb_build_object('option_id', v_option, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '0.00', 'later_year_base_unit_price', null)
        )
      )
    );
    perform public.save_pi_draft(v_pi, 1, v_payload);
    v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
    perform public.start_payment_tracking(v_pi, (v_result ->> 'version_id')::uuid, true);
  end loop;
end;
$setup$;

select
  case when c.company_name like 'Lock Order A %' then 'A' else 'B' end as label,
  p.id as plan_id,
  machine.id as machine_obligation_id,
  sub.id as zero_obligation_id
from public.payment_plans p
join public.proforma_invoices pi on pi.id = p.pi_id
join public.clients c on c.id = pi.client_id
join public.payment_obligations machine on machine.plan_id = p.id and machine.kind = 'payment_row'
join public.payment_obligations sub on sub.plan_id = p.id and sub.kind = 'subscription_advance'
where c.company_name like 'Lock Order %'
  and pi.additional_notes = (
    select additional_notes
    from public.proforma_invoices
    where additional_notes <> ''
    order by created_at desc
    limit 1
  )
order by 1;
