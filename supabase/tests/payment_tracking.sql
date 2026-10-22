-- Rolled-back checks for payment tracking, receipts, and subscription activation.
-- Run with a privileged session after 20261021220000_payment_tracking.sql.
-- The block always raises, including on success, so none of its rows are committed.
-- Deferred balance checks are exercised by direct inserts that commit a subtransaction.

do $test$
declare
  v_fail text := '';
  v_result jsonb;
  v_text text;
  v_instance uuid;
  v_manager uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_cashier uuid := gen_random_uuid();
  v_reverser uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_waiver uuid := gen_random_uuid();
  v_client uuid;
  v_vendor uuid;
  v_machine uuid;
  v_plan_product uuid;
  v_other_product uuid;
  v_eur_product uuid;
  v_zero_product uuid;
  v_three uuid;
  v_one uuid;
  v_eur_option uuid;
  v_zero_option uuid;
  v_pi uuid;
  v_v1 uuid;
  v_legacy uuid;
  v_zero uuid;
  v_eur uuid;
  v_duplicate uuid;
  v_version uuid;
  v_revision_version uuid;
  v_expected integer;
  v_payload jsonb;
  v_snapshot jsonb;
  v_original jsonb;
  v_today date;
  v_early date;
  v_later date;
  v_plan uuid;
  v_receipt uuid;
  v_sub_a uuid := '22222222-2222-4222-8222-222222222222';
  v_sub_b uuid := '33333333-3333-4333-8333-333333333333';
  v_key uuid := gen_random_uuid();
  v_count integer;
  v_paid numeric;
  v_model_machine text := 'zz-pay-machine-' || left(gen_random_uuid()::text, 8);
  v_model_plan text := 'zz-pay-plan-' || left(gen_random_uuid()::text, 8);
  v_model_other text := 'zz-pay-other-' || left(gen_random_uuid()::text, 8);
  v_model_eur text := 'zz-pay-eur-' || left(gen_random_uuid()::text, 8);
  v_model_zero text := 'zz-pay-zero-' || left(gen_random_uuid()::text, 8);
  v_model_v1 text := 'zz-pay-v1-' || left(gen_random_uuid()::text, 8);
  v_row_a text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_row_b text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
begin
  if to_regclass('public.subscription_periods') is not null then
    v_fail := v_fail || 'period table was created; ';
  end if;
  if (select count(*) from public.subscriptions) <> 0
    or (select count(*) from public.payment_plans) <> 0
    or (select count(*) from public.payment_receipts) <> 0
  then
    v_fail := v_fail || 'migration backfilled payment rows; ';
  end if;

  if private.anniversary_date(date '2026-11-15', 1) <> date '2027-11-15'
    or private.anniversary_date(date '2026-11-15', 3) <> date '2029-11-15'
    or private.anniversary_date(date '2024-02-29', 1) <> date '2025-02-28'
    or private.anniversary_date(date '2024-02-29', 2) <> date '2026-02-28'
    or private.anniversary_date(date '2024-02-29', 4) <> date '2028-02-29'
    or private.next_committed_payment_date(date '2026-11-15', 1, date '2026-11-15') is not null
    or private.next_committed_payment_date(date '2026-11-15', 3, date '2026-11-15') <> date '2027-11-15'
    or private.next_committed_payment_date(date '2026-11-15', 3, date '2027-11-15') <> date '2027-11-15'
    or private.next_committed_payment_date(date '2026-11-15', 3, date '2028-11-16') is not null
  then
    v_fail := v_fail || 'anniversary boundaries drifted; ';
  end if;
  if private.payment_due_state('awaiting_event', null, 'unpaid', date '2026-10-21') <> 'unscheduled'
    or private.payment_due_state('deadline_unset', null, 'unpaid', date '2026-10-21') <> 'unscheduled'
    or private.payment_due_state('advance', null, 'unpaid', date '2026-10-21') <> 'unscheduled'
    or private.payment_due_state('fixed', date '2026-10-20', 'unpaid', date '2026-10-21') <> 'overdue'
    or private.payment_due_state('fixed', date '2026-10-21', 'partial', date '2026-10-21') <> 'due_today'
    or private.payment_due_state('fixed', date '2026-10-22', 'unpaid', date '2026-10-21') <> 'upcoming'
    or private.payment_due_state('fixed', date '2026-10-01', 'paid', date '2026-10-21') <> 'settled'
  then
    v_fail := v_fail || 'due state mislabeled an unresolved or settled date; ';
  end if;

  begin
    perform private.payment_obligations_from_snapshot(jsonb_build_object(
      'currency', 'USD',
      'terms', jsonb_build_object('payment_terms', '50% now and the rest later'),
      'adjustments', jsonb_build_object('grand_total', '100.00')
    ));
    v_fail := v_fail || 'legacy paragraph was parsed; ';
  exception when others then
    if sqlerrm not like '%payment paragraph%' or sqlerrm ilike '%50\%%' then
      v_fail := v_fail || 'legacy ' || sqlerrm || '; ';
    end if;
  end;

  v_result := private.payment_obligations_from_snapshot(jsonb_build_object(
    'currency', 'USD',
    'adjustments', jsonb_build_object('grand_total', '100.00'),
    'payment', jsonb_build_object(
      'schema_version', 1,
      'currency', 'USD',
      'grand_total', '100.00',
      'no_payment_due', false,
      'rows', jsonb_build_array(
        jsonb_build_object(
          'id', v_row_a, 'label', 'Same label', 'amount', '50.00',
          'due', jsonb_build_object('type', 'before_shipment', 'deadline', null),
          'due_date', null, 'due_formula', 'before shipment', 'instalments', null
        ),
        jsonb_build_object(
          'id', v_row_b, 'label', 'Same label', 'amount', '50.00',
          'due', '{"type":"unset"}'::jsonb, 'due_date', null, 'due_formula', 'instalments',
          'instalment_plan', jsonb_build_object(
            'count', 2, 'frequency', 'monthly',
            'first', jsonb_build_object('type', 'after_event', 'event', jsonb_build_object('type', 'standard', 'code', 'delivery'), 'offset', 1, 'unit', 'months')
          ),
          'instalments', jsonb_build_array(
            jsonb_build_object('parent_id', v_row_b, 'sequence', 1, 'count', 2, 'amount', '25.00', 'due_date', null, 'due_formula', 'one calendar month after delivery'),
            jsonb_build_object('parent_id', v_row_b, 'sequence', 2, 'count', 2, 'amount', '25.00', 'due_date', null, 'due_formula', 'two calendar months after delivery')
          )
        )
      )
    )
  ));
  if v_result ->> 'schema_version' <> '1'
    or v_result #>> '{obligations,0,source_key}' <> v_row_a
    or v_result #>> '{obligations,0,due_timing}' <> 'deadline_unset'
    or v_result #>> '{obligations,0,due_date}' is not null
    or v_result #>> '{obligations,0,source_key}' like '%Same label%'
    or v_result #>> '{obligations,1,source_key}' <> v_row_b || ':1'
    or v_result #>> '{obligations,2,source_key}' <> v_row_b || ':2'
    or v_result #>> '{obligations,1,kind}' <> 'instalment'
    or v_result #>> '{obligations,1,due_timing}' <> 'awaiting_event'
    or v_result #>> '{obligations,1,awaiting_label}' <> 'Awaiting delivery date'
    or v_result #>> '{obligations,1,source_key}' like '%Same label%'
    or v_result #>> '{obligations,1,label}' not like '%Instalment 1%'
  then
    v_fail := v_fail || 'schema 1 obligations ' || v_result::text || '; ';
  end if;

  v_result := private.payment_obligations_from_snapshot(jsonb_build_object(
    'currency', 'USD',
    'lines', jsonb_build_array(jsonb_build_object(
      'model_code', 'Plan',
      'subscription', jsonb_build_object('obligation_id', v_sub_a::text)
    )),
    'adjustments', jsonb_build_object('grand_total', '11950.00'),
    'payment', jsonb_build_object(
      'schema_version', 2,
      'currency', 'USD',
      'grand_total', '11950.00',
      'no_payment_due', false,
      'subscription_obligations', jsonb_build_array(jsonb_build_object(
        'id', v_sub_a::text, 'amount', '1950.00', 'position', 2
      )),
      'rows', jsonb_build_array(
        jsonb_build_object('id', v_row_a, 'label', 'advance payment', 'amount', '3000.00', 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'due_date', null, 'due_formula', 'upon order confirmation', 'instalments', null),
        jsonb_build_object('id', v_row_b, 'label', 'before shipment', 'amount', '7000.00', 'due', jsonb_build_object('type', 'before_shipment', 'deadline', null), 'due_date', null, 'due_formula', 'before shipment', 'instalments', null)
      )
    )
  ));
  if v_result ->> 'schema_version' <> '2'
    or v_result #>> '{obligations,0,kind}' <> 'subscription_advance'
    or v_result #>> '{obligations,0,amount}' <> '1950.00'
    or v_result #>> '{obligations,0,source_key}' <> 'subscription:' || v_sub_a::text
    or v_result #>> '{obligations,1,amount}' <> '3000.00'
    or v_result #>> '{obligations,2,amount}' <> '7000.00'
    or v_result #>> '{obligations,1,amount}' = '3585.00'
  then
    v_fail := v_fail || 'schema 2 was reinterpreted ' || v_result::text || '; ';
  end if;

  select instance_id into v_instance from auth.users limit 1;
  if v_instance is null then
    v_instance := '00000000-0000-0000-0000-000000000000';
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values
    (v_instance, v_manager, 'authenticated', 'authenticated', 'pay-manager-' || v_manager::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_manager::text, 'r-' || v_manager::text, 'n-' || v_manager::text, ''),
    (v_instance, v_reader, 'authenticated', 'authenticated', 'pay-reader-' || v_reader::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_reader::text, 'r-' || v_reader::text, 'n-' || v_reader::text, ''),
    (v_instance, v_cashier, 'authenticated', 'authenticated', 'pay-cashier-' || v_cashier::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_cashier::text, 'r-' || v_cashier::text, 'n-' || v_cashier::text, ''),
    (v_instance, v_reverser, 'authenticated', 'authenticated', 'pay-reverser-' || v_reverser::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_reverser::text, 'r-' || v_reverser::text, 'n-' || v_reverser::text, ''),
    (v_instance, v_stranger, 'authenticated', 'authenticated', 'pay-stranger-' || v_stranger::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_stranger::text, 'r-' || v_stranger::text, 'n-' || v_stranger::text, ''),
    (v_instance, v_member, 'authenticated', 'authenticated', 'pay-member-' || v_member::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_member::text, 'r-' || v_member::text, 'n-' || v_member::text, ''),
    (v_instance, v_inactive, 'authenticated', 'authenticated', 'pay-inactive-' || v_inactive::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_inactive::text, 'r-' || v_inactive::text, 'n-' || v_inactive::text, ''),
    (v_instance, v_waiver, 'authenticated', 'authenticated', 'pay-waiver-' || v_waiver::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_waiver::text, 'r-' || v_waiver::text, 'n-' || v_waiver::text, '');

  update public.profiles
  set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false
  where id = v_manager;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'all',
      can_edit_drafts = false, can_generate_pis = false, can_manage_payments = false,
      can_reverse_payments = false, can_activate_zero_subscriptions = false
  where id = v_reader;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
      can_manage_payments = true, can_reverse_payments = false, can_activate_zero_subscriptions = false
  where id = v_cashier;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
      can_manage_payments = false, can_reverse_payments = true, can_activate_zero_subscriptions = false
  where id = v_reverser;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'associated',
      can_manage_payments = true, can_reverse_payments = true, can_activate_zero_subscriptions = true
  where id = v_stranger;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
      can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false
  where id = v_member;
  update public.profiles
  set is_active = false, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_manage_payments = true
  where id = v_inactive;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
      can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = true
  where id = v_waiver;

  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);

  insert into public.clients (company_name, billing_address) values ('Pay Client', 'Pay billing') returning id into v_client;
  insert into public.vendors (company_name) values ('Pay Vendor') returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
  values (v_vendor, v_model_machine, 'Machine', 'unit', 10000, 'one_time') returning id into v_machine;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_model_plan, 'Plan', 'license', 'subscription') returning id into v_plan_product;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_model_other, 'Other plan', 'license', 'subscription') returning id into v_other_product;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_model_eur, 'Euro plan', 'license', 'subscription') returning id into v_eur_product;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_model_zero, 'Free plan', 'license', 'subscription') returning id into v_zero_product;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
  values (v_vendor, v_model_v1, 'Legacy machine', 'unit', 10000, 'one_time');

  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price, later_year_base_unit_price, later_year_rule
  ) values (v_plan_product, 3, 'USD', 1950, 1950, 'vendor_confirmed_base_adjustment') returning id into v_three;
  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price
  ) values (v_other_product, 1, 'USD', 2200) returning id into v_one;
  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price
  ) values (v_eur_product, 1, 'EUR', 100) returning id into v_eur_option;
  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price
  ) values (v_zero_product, 1, 'USD', 0) returning id into v_zero_option;

  v_today := private.cairo_today();
  v_early := v_today - 14;
  v_later := v_today - 1;

  v_pi := public.create_pi_draft();
  v_payload := jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-01', 'expiry_date', '2026-11-01',
    'client_id', v_client, 'bill_to', 'Pay billing', 'ship_to', 'Pay billing', 'ship_same_as_billing', true,
    'customer_reference', '', 'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager, v_member),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '',
    'payment_schedule', jsonb_build_object(
      'schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null,
      'rows', jsonb_build_array(
        jsonb_build_object('id', v_row_a, 'label', 'advance payment', 'amount', jsonb_build_object('type', 'percent', 'percent', '30'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null),
        jsonb_build_object('id', v_row_b, 'label', 'before shipment', 'amount', jsonb_build_object('type', 'percent', 'percent', '70'), 'due', jsonb_build_object('type', 'before_shipment', 'deadline', null), 'instalments', null)
      )
    ),
    'delivery_terms', '', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_machine, 'description', 'Machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '10000.00', 'subscription', null),
      jsonb_build_object('product_id', v_plan_product, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_sub_a, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')),
      jsonb_build_object('product_id', v_other_product, 'vendor_id', v_vendor, 'model_code', v_model_other, 'description', 'Other plan', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00', 'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_sub_b, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null))
    )
  );
  perform public.save_pi_draft(v_pi, 1, v_payload);
  if (select count(*) from public.payment_plans) <> 0 then
    v_fail := v_fail || 'saving a draft started payment tracking; ';
  end if;
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  v_version := (v_result ->> 'version_id')::uuid;
  v_snapshot := v_result -> 'snapshot';
  v_original := v_snapshot;
  if (select count(*) from public.payment_plans) <> 0 or (select count(*) from public.subscriptions) <> 0 then
    v_fail := v_fail || 'issuing a PI started tracking or activated a subscription; ';
  end if;
  if (select tracking_status from public.proforma_invoices where id = v_pi) <> 'draft' then
    v_fail := v_fail || 'issue changed the commercial status; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  begin
    perform public.start_payment_tracking(v_pi, v_version, true);
    v_fail := v_fail || 'read-only member started tracking; ';
  exception when others then
    if sqlerrm not like '%permission to manage payment tracking%' then
      v_fail := v_fail || 'reader start ' || sqlerrm || '; ';
    end if;
  end;
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  begin
    perform public.start_payment_tracking(v_pi, v_version, true);
    v_fail := v_fail || 'unrelated user started tracking; ';
  exception when others then
    if sqlerrm not like '%do not have access%' then
      v_fail := v_fail || 'stranger start ' || sqlerrm || '; ';
    end if;
  end;
  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  begin
    perform public.start_payment_tracking(v_pi, v_version, true);
    v_fail := v_fail || 'inactive user started tracking; ';
  exception when others then
    if sqlerrm not like '%Sign in required%' then
      v_fail := v_fail || 'inactive start ' || sqlerrm || '; ';
    end if;
  end;
  begin
    execute 'set local role anon';
    perform public.start_payment_tracking(v_pi, v_version, true);
    v_fail := v_fail || 'anonymous started tracking; ';
  exception when insufficient_privilege then
    null;
  when others then
    v_fail := v_fail || 'anon start ' || sqlerrm || '; ';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_manager::text, true);

  begin
    perform public.start_payment_tracking(v_pi, v_pi, true);
    v_fail := v_fail || 'draft id started tracking; ';
  exception when others then
    if sqlerrm not like '%issued version%' then
      v_fail := v_fail || 'draft start ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.start_payment_tracking(v_pi, v_version, false);
    v_fail := v_fail || 'unconfirmed start succeeded; ';
  exception when others then
    if sqlerrm not like '%agreed with the customer%' then
      v_fail := v_fail || 'confirm ' || sqlerrm || '; ';
    end if;
  end;
  if (select count(*) from public.payment_plans) <> 0 then
    v_fail := v_fail || 'rejected start created a plan; ';
  end if;

  v_result := public.start_payment_tracking(v_pi, v_version, true);
  v_plan := (v_result ->> 'plan_id')::uuid;
  if (v_result ->> 'already_tracking')::boolean
    or (v_result ->> 'source_version_id')::uuid <> v_version
    or v_result ->> 'currency' <> 'USD'
    or v_result ->> 'agreed_total' <> '14150.00'
    or v_result ->> 'schema_version' <> '2'
    or (select started_by from public.payment_plans where id = v_plan) <> v_manager
    or (select count(*) from public.subscriptions) <> 0
  then
    v_fail := v_fail || 'plan pin ' || coalesce(v_result::text, '') || '; ';
  end if;
  if (select amount::text from public.payment_obligations where plan_id = v_plan and subscription_obligation_id = v_sub_a::text) <> '1950.00'
    or (select amount::text from public.payment_obligations where plan_id = v_plan and subscription_obligation_id = v_sub_b::text) <> '2200.00'
    or (select amount::text from public.payment_obligations where plan_id = v_plan and source_key = v_row_a) <> '3000.00'
    or (select amount::text from public.payment_obligations where plan_id = v_plan and source_key = v_row_b) <> '7000.00'
    or (select due_timing from public.payment_obligations where plan_id = v_plan and source_key = v_row_a) <> 'awaiting_event'
    or (select awaiting_label from public.payment_obligations where plan_id = v_plan and source_key = v_row_a) <> 'Awaiting confirmation date'
    or (select due_state from public.payment_obligation_balances where plan_id = v_plan and source_key = v_row_a) <> 'unscheduled'
    or (select due_timing from public.payment_obligations where plan_id = v_plan and source_key = v_row_b) <> 'deadline_unset'
    or (select due_date from public.payment_obligations where plan_id = v_plan and source_key = v_row_b) is not null
    or (select due_state from public.payment_obligation_balances where plan_id = v_plan and source_key = v_row_b) <> 'unscheduled'
  then
    v_fail := v_fail || 'mixed obligations were not separated; ';
  end if;
  v_result := public.start_payment_tracking(v_pi, v_version, true);
  if (v_result ->> 'already_tracking')::boolean is distinct from true
    or (v_result ->> 'plan_id')::uuid <> v_plan
    or (select count(*) from public.payment_plans where pi_id = v_pi) <> 1
    or (select count(*) from public.payment_obligations where plan_id = v_plan) <> 4
  then
    v_fail := v_fail || 'second start duplicated the plan; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_cashier::text, true);
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', v_key, 'amount', '1000.00', 'received_on', v_early, 'method', 'bank_transfer',
      'reference', 'SAME-REF', 'currency', 'USD', 'recorded_by', v_stranger,
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and subscription_obligation_id = v_sub_a::text),
        'amount', '1000.00'
      ))
    ));
  exception when others then
    v_fail := v_fail || 'cashier partial ' || sqlerrm || '; ';
  end;
  if (select count(*) from public.subscriptions) <> 0 then
    v_fail := v_fail || 'partial advance activated a subscription; ';
  end if;
  if (select recorded_by from public.payment_receipts where idempotency_key = v_key) <> v_cashier then
    v_fail := v_fail || 'recorded_by was taken from the payload; ';
  end if;
  if (select outstanding_amount::text from public.payment_obligation_balances where plan_id = v_plan and subscription_obligation_id = v_sub_a::text) <> '950.00'
    or (select collection_status from public.payment_obligation_balances where plan_id = v_plan and subscription_obligation_id = v_sub_a::text) <> 'partial'
  then
    v_fail := v_fail || 'partial balance was not reduced; ';
  end if;
  v_count := (select count(*) from public.payment_receipts where plan_id = v_plan);
  v_result := public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', v_key, 'amount', '1000.00', 'received_on', v_early, 'method', 'bank_transfer',
    'reference', 'SAME-REF', 'allocations', jsonb_build_array(jsonb_build_object(
      'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and subscription_obligation_id = v_sub_a::text),
      'amount', '1000.00'
    ))
  ));
  if (v_result ->> 'already_recorded')::boolean is distinct from true
    or (select count(*) from public.payment_receipts where plan_id = v_plan) <> v_count
  then
    v_fail := v_fail || 'duplicate submission created another receipt; ';
  end if;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', v_key, 'amount', '10.00', 'received_on', v_early, 'method', 'cash',
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_a),
        'amount', '10.00'
      ))
    ));
    v_fail := v_fail || 'changed retry was accepted; ';
  exception when others then
    if sqlerrm not like '%different details%' then
      v_fail := v_fail || 'retry ' || sqlerrm || '; ';
    end if;
  end;

  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  v_result := public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '5000.00', 'received_on', v_later, 'method', 'bank_transfer',
    'reference', 'SAME-REF', 'note', 'Mixed allocation',
    'allocations', jsonb_build_array(
      jsonb_build_object('obligation_id', (select id from public.payment_obligations where plan_id = v_plan and subscription_obligation_id = v_sub_a::text), 'amount', '950.00'),
      jsonb_build_object('obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_a), 'amount', '3000.00'),
      jsonb_build_object('obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b), 'amount', '1050.00')
    )
  ));
  -- The spec example is 1950 + 3000 + 50. This receipt finishes the remaining 950 of that subscription,
  -- pays the machine advance, and puts 1050 on the shipment obligation. 950 + 3000 + 1050 = 5000.
  if (select count(*) from public.payment_receipts where plan_id = v_plan and reference = 'SAME-REF') <> 2 then
    v_fail := v_fail || 'repeated bank reference was rejected; ';
  end if;
  if (select count(*) from public.subscriptions where source_obligation_id = v_sub_a::text) <> 1
    or (select count(*) from public.subscriptions where source_obligation_id = v_sub_b::text) <> 0
    or (select start_date from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_later
    or (select start_date from public.subscriptions where source_obligation_id = v_sub_a::text) = v_today
    or (select outstanding_amount::text from public.payment_obligation_balances where plan_id = v_plan and source_key = v_row_a) <> '0.00'
    or (select outstanding_amount::text from public.payment_obligation_balances where plan_id = v_plan and source_key = v_row_b) <> '5950.00'
    or (select collection_status from public.payment_obligation_balances where plan_id = v_plan and subscription_obligation_id = v_sub_a::text) <> 'paid'
    or (
      select p.agreed_total - coalesce(sum(r.amount), 0)
      from public.payment_plans p
      left join public.payment_receipts r on r.plan_id = p.id and r.reversed_at is null
      where p.id = v_plan
      group by p.agreed_total
    ) <> 8150.00
  then
    v_fail := v_fail || 'mixed receipt did not keep subscription and machine balances apart; ';
  end if;
  if (select product_model from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_model_plan
    or (select first_year_negotiated_unit_price::text from public.subscriptions where source_obligation_id = v_sub_a::text) <> '1950.00'
    or (select later_year_base_unit_price::text from public.subscriptions where source_obligation_id = v_sub_a::text) <> '1950.00'
    or (select later_year_rule from public.subscriptions where source_obligation_id = v_sub_a::text) <> 'vendor_confirmed_base_adjustment'
    or (select adjustment_compounds from public.subscriptions where source_obligation_id = v_sub_a::text)
    or (select commitment_years from public.subscriptions where source_obligation_id = v_sub_a::text) <> 3
    or (select commitment_end_date from public.subscriptions where source_obligation_id = v_sub_a::text) <> private.anniversary_date(v_later, 3)
    or (select vendor_identity from public.subscriptions where source_obligation_id = v_sub_a::text) <> 'unavailable'
    or (select agreement::text from public.subscriptions where source_obligation_id = v_sub_a::text) like '%Pay Vendor%'
    or (select client_name from public.subscriptions where source_obligation_id = v_sub_a::text) <> 'Pay Client'
    or (select client_link_matches_snapshot from public.subscriptions where source_obligation_id = v_sub_a::text) is distinct from true
    or (select activated_by from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_manager
    or (select source_version_id from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_version
  then
    v_fail := v_fail || 'saved agreement did not come from the issued snapshot; ';
  end if;
  if (select annual_periods -> 0 ->> 'starts_on' from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_later::text
    or (select annual_periods -> 1 ->> 'starts_on' from public.subscriptions where source_obligation_id = v_sub_a::text) <> private.anniversary_date(v_later, 1)::text
    or (select annual_periods -> 2 ->> 'ends_on' from public.subscriptions where source_obligation_id = v_sub_a::text) <> private.anniversary_date(v_later, 3)::text
    or jsonb_array_length((select annual_periods from public.subscriptions where source_obligation_id = v_sub_a::text)) <> 3
  then
    v_fail := v_fail || 'annual boundaries were not anchored to the start date; ';
  end if;

  update public.products set model_code = v_model_plan || '-renamed', description = 'Changed catalogue text' where id = v_plan_product;
  update public.product_commitment_options set first_year_unit_price = 9999, later_year_base_unit_price = 9999 where id = v_three;
  if (select product_model from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_model_plan
    or (select first_year_negotiated_unit_price::text from public.subscriptions where source_obligation_id = v_sub_a::text) <> '1950.00'
    or (select later_year_base_unit_price::text from public.subscriptions where source_obligation_id = v_sub_a::text) <> '1950.00'
  then
    v_fail := v_fail || 'catalogue change rewrote the saved agreement; ';
  end if;
  update public.products set model_code = v_model_plan, description = 'Plan' where id = v_plan_product;
  update public.product_commitment_options set first_year_unit_price = 1950, later_year_base_unit_price = 1950 where id = v_three;

  v_result := public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '2200.00', 'received_on', v_today, 'method', 'cheque',
    'allocations', jsonb_build_array(jsonb_build_object(
      'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and subscription_obligation_id = v_sub_b::text),
      'amount', '2200.00'
    ))
  ));
  if (select count(*) from public.subscriptions where pi_id = v_pi) <> 2
    or (select start_date from public.subscriptions where source_obligation_id = v_sub_b::text) <> v_today
    or (select commitment_years from public.subscriptions where source_obligation_id = v_sub_b::text) <> 1
    or (select later_year_rule from public.subscriptions where source_obligation_id = v_sub_b::text) is not null
    or (select commitment_end_date from public.subscriptions where source_obligation_id = v_sub_b::text) <> private.anniversary_date(v_today, 1)
    or private.next_committed_payment_date(v_today, 1, v_today) is not null
    or (select start_date from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_later
  then
    v_fail := v_fail || 'subscriptions did not activate independently; ';
  end if;

  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '10.00', 'received_on', v_today, 'method', 'cash',
      'allocations', jsonb_build_array(
        jsonb_build_object('obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b), 'amount', '4.00'),
        jsonb_build_object('obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b), 'amount', '6.00')
      )
    ));
    v_fail := v_fail || 'duplicate obligation allocation succeeded; ';
  exception when others then
    if sqlerrm not like '%once%' then
      v_fail := v_fail || 'duplicate allocation ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '10.00', 'received_on', v_today, 'method', 'cash',
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b),
        'amount', '9.00'
      ))
    ));
    v_fail := v_fail || 'unequal allocation succeeded; ';
  exception when others then
    if sqlerrm not like '%must be equal%' then
      v_fail := v_fail || 'sum ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '1.00', 'received_on', v_today, 'method', 'cash',
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_a),
        'amount', '1.00'
      ))
    ));
    v_fail := v_fail || 'over-allocation succeeded; ';
  exception when others then
    if sqlerrm not like '%unpaid balance%' then
      v_fail := v_fail || 'over ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '10.00', 'received_on', v_today, 'method', 'cash', 'currency', 'EUR',
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b),
        'amount', '10.00'
      ))
    ));
    v_fail := v_fail || 'currency conversion succeeded; ';
  exception when others then
    if sqlerrm not like '%not converted%' then
      v_fail := v_fail || 'currency ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '0', 'received_on', v_today, 'method', 'cash', 'allocations', '[]'::jsonb
    ));
    v_fail := v_fail || 'zero amount succeeded; ';
  exception when others then
    if sqlerrm not like '%greater than zero%' then
      v_fail := v_fail || 'zero ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '-5', 'received_on', v_today, 'method', 'cash', 'allocations', '[]'::jsonb
    ));
    v_fail := v_fail || 'negative amount succeeded; ';
  exception when others then
    if sqlerrm not like '%greater than zero%' then
      v_fail := v_fail || 'negative ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '10', 'received_on', '2026-02-31', 'method', 'cash',
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b),
        'amount', '10'
      ))
    ));
    v_fail := v_fail || 'invalid date succeeded; ';
  exception when others then
    if sqlerrm not like '%Invalid date%' then
      v_fail := v_fail || 'date ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '10', 'received_on', (v_today + 2)::text, 'method', 'cash',
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b),
        'amount', '10'
      ))
    ));
    v_fail := v_fail || 'future date succeeded; ';
  exception when others then
    if sqlerrm not like '%future%' then
      v_fail := v_fail || 'future ' || sqlerrm || '; ';
    end if;
  end;

  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  begin
    perform public.record_payment_receipt(v_plan, jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '10', 'received_on', v_today, 'method', 'cash',
      'allocations', jsonb_build_array(jsonb_build_object(
        'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b),
        'amount', '10'
      ))
    ));
    v_fail := v_fail || 'read-only member recorded a payment; ';
  exception when others then
    if sqlerrm not like '%permission to record%' then
      v_fail := v_fail || 'reader record ' || sqlerrm || '; ';
    end if;
  end;
  perform set_config('request.jwt.claim.sub', v_cashier::text, true);
  begin
    perform public.reverse_payment_receipt((select id from public.payment_receipts where plan_id = v_plan and amount = 5000), 'mistake');
    v_fail := v_fail || 'cashier reversed a payment; ';
  exception when others then
    if sqlerrm not like '%permission to reverse%' then
      v_fail := v_fail || 'cashier reverse ' || sqlerrm || '; ';
    end if;
  end;
  perform set_config('request.jwt.claim.sub', v_reverser::text, true);
  begin
    perform public.reverse_payment_receipt((select id from public.payment_receipts where idempotency_key = v_key), '   ');
    v_fail := v_fail || 'blank reversal reason succeeded; ';
  exception when others then
    if sqlerrm not like '%reason%' then
      v_fail := v_fail || 'reason ' || sqlerrm || '; ';
    end if;
  end;
  v_paid := (select outstanding_amount from public.payment_obligation_balances where plan_id = v_plan and subscription_obligation_id = v_sub_a::text);
  v_result := public.reverse_payment_receipt((select id from public.payment_receipts where idempotency_key = v_key), 'Recorded against the wrong PI reference');
  if (v_result ->> 'already_reversed')::boolean
    or (select outstanding_amount from public.payment_obligation_balances where plan_id = v_plan and subscription_obligation_id = v_sub_a::text) <> v_paid + 1000
    or (select reversed_by from public.payment_receipts where idempotency_key = v_key) <> v_reverser
    or (select count(*) from public.payment_receipts where idempotency_key = v_key) <> 1
  then
    v_fail := v_fail || 'reversal did not restore the partial balance; ';
  end if;
  v_result := public.reverse_payment_receipt((select id from public.payment_receipts where idempotency_key = v_key), 'different reason');
  if (v_result ->> 'already_reversed')::boolean is distinct from true
    or (select reversal_reason from public.payment_receipts where idempotency_key = v_key) <> 'Recorded against the wrong PI reference'
    or (select outstanding_amount from public.payment_obligation_balances where plan_id = v_plan and subscription_obligation_id = v_sub_a::text) <> v_paid + 1000
  then
    v_fail := v_fail || 'repeated reversal changed history; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  v_receipt := (select id from public.payment_receipts where plan_id = v_plan and amount = 5000);
  v_result := public.reverse_payment_receipt(v_receipt, 'The allocation was wrong');
  if (select state from public.subscriptions where source_obligation_id = v_sub_a::text) <> 'payment_review_required'
    or (select id from public.subscriptions where source_obligation_id = v_sub_a::text) is null
    or (select start_date from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_later
    or (select state from public.subscriptions where source_obligation_id = v_sub_b::text) <> 'active'
    or (select outstanding_amount::text from public.payment_obligation_balances where plan_id = v_plan and subscription_obligation_id = v_sub_a::text) <> '1950.00'
    or (select outstanding_amount::text from public.payment_obligation_balances where plan_id = v_plan and source_key = v_row_a) <> '3000.00'
    or (select snapshot from public.pi_versions where id = v_version) is distinct from v_original
  then
    v_fail := v_fail || 'reversal after activation deleted the subscription or moved its start; ';
  end if;
  perform public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '1950.00', 'received_on', v_today, 'method', 'cash',
    'allocations', jsonb_build_array(jsonb_build_object(
      'obligation_id', (select id from public.payment_obligations where plan_id = v_plan and subscription_obligation_id = v_sub_a::text),
      'amount', '1950.00'
    ))
  ));
  if (select start_date from public.subscriptions where source_obligation_id = v_sub_a::text) <> v_later
    or (select state from public.subscriptions where source_obligation_id = v_sub_a::text) <> 'payment_review_required'
    or (select count(*) from public.subscriptions where source_obligation_id = v_sub_a::text) <> 1
  then
    v_fail := v_fail || 'a later receipt moved the existing start date; ';
  end if;

  v_count := (select count(*) from public.payment_plans);
  v_expected := public.create_pi_revision(v_pi);
  v_result := public.generate_pi(v_pi, v_expected, v_payload);
  v_revision_version := (v_result ->> 'version_id')::uuid;
  if v_revision_version = v_version
    or (select count(*) from public.payment_plans) <> v_count
    or (select source_version_id from public.payment_plans where id = v_plan) <> v_version
    or (select count(*) from public.subscriptions where pi_id = v_pi) <> 2
    or (select count(*) from public.payment_receipts where plan_id = v_plan) < 3
  then
    v_fail := v_fail || 'revision duplicated the plan, receipts, or subscription; ';
  end if;
  begin
    perform public.start_payment_tracking(v_pi, v_revision_version, true);
    v_fail := v_fail || 'revision replaced the tracked version; ';
  exception when others then
    if sqlerrm not like '%already active%' then
      v_fail := v_fail || 'revision start ' || sqlerrm || '; ';
    end if;
  end;
  if (select source_version_id from public.payment_plans where id = v_plan) <> v_version then
    v_fail := v_fail || 'failed replacement retargeted the plan; ';
  end if;
  v_duplicate := public.duplicate_pi(v_pi);
  if (select count(*) from public.payment_plans where pi_id = v_duplicate) <> 0
    or (select count(*) from public.subscriptions where pi_id = v_duplicate) <> 0
  then
    v_fail := v_fail || 'duplicate copied tracking or the subscription; ';
  end if;

  -- Deferred constraint: direct inserts skip the function's early check.
  begin
    insert into public.payment_receipts (
      plan_id, currency, amount, received_on, method, recorded_by, idempotency_key
    ) values (
      v_plan, 'USD', 3001, v_today, 'other', v_manager, gen_random_uuid()
    ) returning id into v_receipt;
    insert into public.payment_allocations (receipt_id, obligation_id, amount)
    values (
      v_receipt,
      (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_a),
      3001
    );
    set constraints public.payment_allocations_balance, public.payment_receipts_allocated immediate;
    v_fail := v_fail || 'deferred over-allocation was not checked; ';
  exception when others then
    if sqlerrm not like '%exceeds the unpaid balance%' then
      v_fail := v_fail || 'deferred over ' || sqlerrm || '; ';
    end if;
  end;
  begin
    insert into public.payment_receipts (
      plan_id, currency, amount, received_on, method, recorded_by, idempotency_key
    ) values (
      v_plan, 'USD', 50, v_today, 'other', v_manager, gen_random_uuid()
    ) returning id into v_receipt;
    insert into public.payment_allocations (receipt_id, obligation_id, amount)
    values (
      v_receipt,
      (select id from public.payment_obligations where plan_id = v_plan and source_key = v_row_b),
      40
    );
    set constraints public.payment_allocations_balance, public.payment_receipts_allocated immediate;
    v_fail := v_fail || 'deferred sum was not checked; ';
  exception when others then
    if sqlerrm not like '%add up to the amount received%' then
      v_fail := v_fail || 'deferred sum ' || sqlerrm || '; ';
    end if;
  end;
  if (select snapshot from public.pi_versions where id = v_version) is distinct from v_original
    or (select tracking_status from public.proforma_invoices where id = v_pi) <> 'draft'
  then
    v_fail := v_fail || 'payment activity changed the issued snapshot or commercial status; ';
  end if;

  -- Zero-value subscription is not activated by starting tracking.
  v_zero := public.create_pi_draft();
  v_payload := jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-01', 'expiry_date', '2026-11-01',
    'client_id', v_client, 'bill_to', 'Pay billing', 'ship_to', 'Pay billing', 'ship_same_as_billing', true,
    'customer_reference', '', 'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '',
    'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', true, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
    'delivery_terms', '', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_zero_product, 'vendor_id', v_vendor, 'model_code', v_model_zero, 'description', 'Free plan', 'unit', 'license', 'quantity', '1', 'unit_price', '0.00',
      'subscription', jsonb_build_object('option_id', v_zero_option, 'obligation_id', '44444444-4444-4444-8444-444444444444', 'negotiated_first_year_unit_price', '0.00', 'later_year_base_unit_price', null)
    ))
  );
  perform public.save_pi_draft(v_zero, 1, v_payload);
  v_result := public.generate_pi(v_zero, (select draft_version from public.proforma_invoices where id = v_zero), v_payload);
  v_result := public.start_payment_tracking(v_zero, (v_result ->> 'version_id')::uuid, true);
  if (select count(*) from public.subscriptions where pi_id = v_zero) <> 0
    or (select amount from public.payment_obligations where plan_id = (v_result ->> 'plan_id')::uuid) <> 0
  then
    v_fail := v_fail || 'zero-value subscription activated itself; ';
  end if;
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  begin
    perform public.activate_subscription_at_no_charge(
      (select id from public.payment_obligations where plan_id = (select id from public.payment_plans where pi_id = v_zero)),
      v_today, 'Included at no charge'
    );
    v_fail := v_fail || 'reader waived a subscription; ';
  exception when others then
    if sqlerrm not like '%permission to activate%' then
      v_fail := v_fail || 'waiver permission ' || sqlerrm || '; ';
    end if;
  end;
  perform set_config('request.jwt.claim.sub', v_waiver::text, true);
  begin
    perform public.activate_subscription_at_no_charge(
      (select id from public.payment_obligations where plan_id = (select id from public.payment_plans where pi_id = v_zero)),
      v_today, '   '
    );
    v_fail := v_fail || 'blank no-charge reason succeeded; ';
  exception when others then
    if sqlerrm not like '%reason%' then
      v_fail := v_fail || 'waiver reason ' || sqlerrm || '; ';
    end if;
  end;
  v_result := public.activate_subscription_at_no_charge(
    (select id from public.payment_obligations where plan_id = (select id from public.payment_plans where pi_id = v_zero)),
    v_early, 'Included at no charge with the machine'
  );
  if (v_result ->> 'already_activated')::boolean
    or (v_result ->> 'start_date')::date <> v_early
    or (select activated_by from public.subscriptions where pi_id = v_zero) <> v_waiver
    or (select activation_kind from public.subscriptions where pi_id = v_zero) <> 'no_charge'
    or (select no_charge_reason from public.subscriptions where pi_id = v_zero) <> 'Included at no charge with the machine'
  then
    v_fail := v_fail || 'no-charge activation was not audited; ';
  end if;
  v_result := public.activate_subscription_at_no_charge(
    (select id from public.payment_obligations where plan_id = (select id from public.payment_plans where pi_id = v_zero)),
    v_today, 'a different date'
  );
  if (v_result ->> 'already_activated')::boolean is distinct from true
    or (select start_date from public.subscriptions where pi_id = v_zero) <> v_early
    or (select count(*) from public.subscriptions where pi_id = v_zero) <> 1
  then
    v_fail := v_fail || 'no-charge activation was not idempotent; ';
  end if;

  -- Legacy paragraph and a whole-PI schedule keep their own meaning.
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  v_legacy := public.create_pi_draft();
  update public.proforma_invoices set payment_schedule = null, payment_terms = '50% in advance and the balance before shipment' where id = v_legacy;
  v_payload := jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-01', 'expiry_date', '2026-11-01',
    'client_id', v_client, 'bill_to', 'Pay billing', 'ship_to', 'Pay billing', 'ship_same_as_billing', true,
    'customer_reference', '', 'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '50% in advance and the balance before shipment',
    'payment_schedule', null,
    'delivery_terms', '', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where model_code = v_model_v1), 'vendor_id', v_vendor,
      'model_code', v_model_v1, 'description', 'Legacy machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '10000.00', 'subscription', null
    ))
  );
  perform public.save_pi_draft(v_legacy, 1, v_payload);
  v_result := public.generate_pi(v_legacy, (select draft_version from public.proforma_invoices where id = v_legacy), v_payload);
  v_original := v_result -> 'snapshot';
  begin
    perform public.start_payment_tracking(v_legacy, (v_result ->> 'version_id')::uuid, true);
    v_fail := v_fail || 'legacy prose started tracking; ';
  exception when others then
    if sqlerrm not like '%payment paragraph%' then
      v_fail := v_fail || 'legacy issue ' || sqlerrm || '; ';
    end if;
  end;
  if (select snapshot from public.pi_versions where id = (v_result ->> 'version_id')::uuid) is distinct from v_original
    or (select count(*) from public.payment_plans where pi_id = v_legacy) <> 0
  then
    v_fail := v_fail || 'legacy rejection changed the snapshot; ';
  end if;

  v_eur := public.create_pi_draft();
  v_payload := jsonb_build_object(
    'preset_code', 'AE-EUR', 'pi_date', '2026-10-01', 'expiry_date', '2026-11-01',
    'client_id', v_client, 'bill_to', 'Pay billing', 'ship_to', 'Pay billing', 'ship_same_as_billing', true,
    'customer_reference', '', 'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '',
    'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
    'delivery_terms', '', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_eur_product, 'vendor_id', v_vendor, 'model_code', v_model_eur, 'description', 'Euro plan', 'unit', 'license', 'quantity', '1', 'unit_price', '100.00',
      'subscription', jsonb_build_object('option_id', v_eur_option, 'obligation_id', '55555555-5555-4555-8555-555555555555', 'negotiated_first_year_unit_price', '100.00', 'later_year_base_unit_price', null)
    ))
  );
  perform public.save_pi_draft(v_eur, 1, v_payload);
  v_result := public.generate_pi(v_eur, (select draft_version from public.proforma_invoices where id = v_eur), v_payload);
  v_result := public.start_payment_tracking(v_eur, (v_result ->> 'version_id')::uuid, true);
  perform public.record_payment_receipt((v_result ->> 'plan_id')::uuid, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '100.00', 'received_on', v_today, 'method', 'bank_transfer',
    'allocations', jsonb_build_array(jsonb_build_object(
      'obligation_id', (select id from public.payment_obligations where plan_id = (v_result ->> 'plan_id')::uuid),
      'amount', '100.00'
    ))
  ));

  v_count := (
    select count(*) from public.payment_receipts r
    join public.payment_plans p on p.id = r.plan_id
    where p.pi_id = v_pi
  );
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.subscription_list) <> 2
    or (select count(*) from public.subscription_list where currency = 'EUR') <> 0
    or (select count(distinct currency) from public.subscription_list) <> 1
    or (select count(*) from public.payment_plans) <> 1
    or (select count(*) from public.payment_receipts) <> v_count
  then
    v_fail := v_fail || 'list or balances leaked an inaccessible PI; ';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.subscription_list) <> 0
    or (select count(*) from public.payment_plans) <> 0
    or (select count(*) from public.payment_receipts) <> 0
    or (select count(*) from public.subscriptions) <> 0
  then
    v_fail := v_fail || 'unrelated user read payment data; ';
  end if;
  begin
    insert into public.payment_receipts (plan_id, currency, amount, received_on, method, recorded_by, idempotency_key)
    values (v_plan, 'USD', 1, v_today, 'cash', v_stranger, gen_random_uuid());
    v_fail := v_fail || 'direct receipt insert succeeded; ';
  exception when insufficient_privilege then
    null;
  when others then
    v_fail := v_fail || 'direct insert ' || sqlerrm || '; ';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.subscription_list) <> 0 or (select count(*) from public.subscriptions) <> 0 then
    v_fail := v_fail || 'inactive user read subscriptions; ';
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  v_result := public.product_pi_history(v_machine, false, null, null, null, 20, 0);
  if coalesce((v_result ->> 'total')::integer, 0) < 1 then
    v_fail := v_fail || 'product history broke; ';
  end if;
  if pg_get_functiondef('private.insert_subscription(public.payment_plans, public.payment_obligations, date, text, text)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('private.record_payment_receipt(uuid, jsonb)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('public.generate_pi(uuid, integer, jsonb)'::regprocedure) ilike '%payment_plans%'
  then
    v_fail := v_fail || 'a function read purchase prices or issuing now creates plans; ';
  end if;

  if v_fail <> '' then
    raise exception 'PAYMENT_TRACKING_FAIL %', v_fail;
  end if;
  raise exception 'PAYMENT_TRACKING_OK';
end;
$test$;
