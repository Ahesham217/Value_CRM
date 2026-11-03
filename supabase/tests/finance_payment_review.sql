-- Rolled-back checks for finance review of recorded receipts.
-- Run with a privileged session after 20261103150000_finance_payment_review.sql.
-- The block always raises, including on success, so none of its rows are committed.
-- Do not run this against Value CRM.

create or replace function pg_temp.finance_issue(
  p_admin uuid,
  p_label text,
  p_token text,
  p_preset text,
  p_kind text
)
returns jsonb
language plpgsql
as $$
declare
  v_client uuid;
  v_vendor uuid;
  v_product uuid;
  v_plan_product uuid;
  v_option uuid;
  v_pi uuid;
  v_price numeric := case when p_kind = 'split' or p_kind = 'mixed' then 10000 else 1000 end;
  v_currency text := case when p_preset = 'EG-EGP' then 'EGP' else 'USD' end;
  v_model text := 'zz-fin-' || lower(p_label) || '-' || p_kind || '-' || p_token;
  v_plan_model text := 'zz-fin-sub-' || lower(p_label) || '-' || p_token;
  v_row_a text := gen_random_uuid()::text;
  v_row_b text := gen_random_uuid()::text;
  v_obligation uuid := gen_random_uuid();
  v_payload jsonb;
  v_result jsonb;
  v_plan uuid;
  v_version uuid;
  v_number text;
  v_snapshot jsonb;
  v_obligations jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_admin::text, 'role', 'authenticated')::text, true);
  insert into public.clients (company_name, billing_address)
  values ('Finance ' || p_label || ' ' || p_token, 'Finance billing')
  returning id into v_client;
  insert into public.vendors (company_name) values ('Finance Vendor ' || p_label || ' ' || p_token) returning id into v_vendor;
  if p_kind = 'mixed' then
    insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
    values (v_vendor, v_model, 'Machine', 'unit', v_price, 'one_time')
    returning id into v_product;
    insert into public.products (vendor_id, model_code, description, unit, billing_type)
    values (v_vendor, v_plan_model, 'Free plan', 'license', 'subscription')
    returning id into v_plan_product;
    insert into public.product_commitment_options (product_id, commitment_years, currency, first_year_unit_price)
    values (v_plan_product, 1, 'USD', 0)
    returning id into v_option;
  else
    insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, sell_price_egp, billing_type)
    values (
      v_vendor, v_model, 'Machine', 'unit',
      case when v_currency = 'USD' then v_price else null end,
      case when v_currency = 'EGP' then v_price else null end,
      'one_time'
    )
    returning id into v_product;
  end if;

  v_pi := public.create_pi_draft();
  v_payload := jsonb_build_object(
    'preset_code', p_preset,
    'pi_date', '2026-10-01',
    'expiry_date', '2026-11-30',
    'client_id', v_client,
    'bill_to', 'Finance billing',
    'ship_to', 'Finance billing',
    'ship_same_as_billing', true,
    'customer_reference', 'fin-' || p_label || '-' || p_token,
    'lead_salesperson_id', p_admin,
    'salesperson_ids', jsonb_build_array(p_admin),
    'discount_type', 'none',
    'discount_value', null,
    'shipping_amount', null,
    'installation_amount', null,
    'bank_charge_amount', null,
    'tax_enabled', false,
    'tax_percent', null,
    'tax_excludes_shipping', false,
    'tax_excludes_installation', false,
    'tax_excludes_bank_charge', false,
    'price_basis', '',
    'payment_terms', '',
    'delivery_terms', '',
    'warranty', '',
    'additional_notes', p_token,
    'payment_schedule', jsonb_build_object(
      'schema_version', case when p_kind = 'mixed' then 2 else 1 end,
      'no_payment_due', false,
      'dates_need_review', false,
      'residual_target', null,
      'rows', case
        when p_kind = 'split' then jsonb_build_array(
          jsonb_build_object(
            'id', v_row_a, 'label', 'First part',
            'amount', jsonb_build_object('type', 'fixed', 'amount', '6000.00'),
            'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
            'instalments', null
          ),
          jsonb_build_object(
            'id', v_row_b, 'label', 'Second part',
            'amount', jsonb_build_object('type', 'fixed', 'amount', '4000.00'),
            'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
            'instalments', null
          )
        )
        else jsonb_build_array(jsonb_build_object(
          'id', v_row_a, 'label', 'machine advance',
          'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
          'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
          'instalments', null
        ))
      end
    ),
    'lines', case
      when p_kind = 'mixed' then jsonb_build_array(
        jsonb_build_object('product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'Machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '10000.00', 'subscription', null),
        jsonb_build_object(
          'product_id', v_plan_product, 'vendor_id', v_vendor, 'model_code', v_plan_model, 'description', 'Free plan', 'unit', 'license', 'quantity', '1', 'unit_price', '0.00',
          'subscription', jsonb_build_object('option_id', v_option, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '0.00', 'later_year_base_unit_price', null)
        )
      )
      else jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'Machine', 'unit', 'unit', 'quantity', '1',
        'unit_price', trim(to_char(v_price, '999999990.00')), 'subscription', null
      ))
    end
  );
  perform public.save_pi_draft(v_pi, 1, v_payload);
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  v_version := (v_result ->> 'version_id')::uuid;
  perform public.start_payment_tracking(v_pi, v_version, true);
  select id into v_plan from public.payment_plans where pi_id = v_pi;
  select pi_number into v_number from public.proforma_invoices where id = v_pi;
  select snapshot into v_snapshot from public.pi_versions where id = v_version;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'label', label, 'amount', amount
  ) order by position), '[]'::jsonb)
  into v_obligations
  from public.payment_obligations
  where plan_id = v_plan;
  return jsonb_build_object(
    'pi_id', v_pi,
    'plan_id', v_plan,
    'version_id', v_version,
    'pi_number', v_number,
    'snapshot', v_snapshot,
    'client_id', v_client,
    'obligations', v_obligations
  );
end;
$$;

create or replace function pg_temp.finance_record(
  p_plan uuid,
  p_amount numeric,
  p_on date,
  p_reference text,
  p_allocations jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_result jsonb;
begin
  v_result := public.record_payment_receipt(p_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(),
    'amount', trim(to_char(p_amount, '999999990.00')),
    'received_on', p_on,
    'method', 'bank_transfer',
    'reference', p_reference,
    'note', 'Recorded before finance review',
    'allocations', p_allocations
  ));
  return (v_result ->> 'receipt_id')::uuid;
end;
$$;

create or replace function pg_temp.finance_state(p_receipt uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'receipt', (select to_jsonb(r) from public.payment_receipts r where r.id = p_receipt),
    'allocations', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.obligation_id), '[]'::jsonb)
      from public.payment_allocations a where a.receipt_id = p_receipt
    ),
    'balances', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'paid', b.paid_amount, 'outstanding', b.outstanding_amount
      ) order by b.position), '[]'::jsonb)
      from public.payment_obligation_balances b
      where b.plan_id = (select plan_id from public.payment_receipts where id = p_receipt)
    )
  );
$$;

do $test$
declare
  v_fail text := '';
  v_token text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_instance uuid;
  v_admin uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_all uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_reverser uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_visible jsonb;
  v_hidden jsonb;
  v_egypt jsonb;
  v_mixed jsonb;
  v_first uuid;
  v_second uuid;
  v_machine uuid;
  v_zero uuid;
  v_partial uuid;
  v_split uuid;
  v_today uuid;
  v_secret uuid;
  v_egp uuid;
  v_mixed_receipt uuid;
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
  v_sub_before jsonb;
  v_sub_after jsonb;
  v_snapshot jsonb;
  v_number text;
  v_status text;
  v_counters jsonb;
  v_counters_after jsonb;
  v_count integer;
  v_events integer;
  v_text text;
  v_today_date date;
  v_ids uuid[];
  v_key uuid;
begin
  if (select count(*) from public.payment_receipt_reviews) <> 0
    or (select count(*) from public.payment_receipt_review_events) <> 0
  then
    v_fail := v_fail || 'review tables were backfilled; ';
  end if;
  if exists (
    select 1 from public.profiles where can_review_payments
  ) then
    v_fail := v_fail || 'existing profile received finance review permission; ';
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
    (v_instance, v_admin, 'authenticated', 'authenticated', 'fin-admin-' || v_admin::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_admin::text, 'r-' || v_admin::text, 'n-' || v_admin::text, ''),
    (v_instance, v_staff, 'authenticated', 'authenticated', 'fin-staff-' || v_staff::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_staff::text, 'r-' || v_staff::text, 'n-' || v_staff::text, ''),
    (v_instance, v_finance, 'authenticated', 'authenticated', 'fin-review-' || v_finance::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_finance::text, 'r-' || v_finance::text, 'n-' || v_finance::text, ''),
    (v_instance, v_all, 'authenticated', 'authenticated', 'fin-all-' || v_all::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_all::text, 'r-' || v_all::text, 'n-' || v_all::text, ''),
    (v_instance, v_inactive, 'authenticated', 'authenticated', 'fin-inactive-' || v_inactive::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_inactive::text, 'r-' || v_inactive::text, 'n-' || v_inactive::text, ''),
    (v_instance, v_reverser, 'authenticated', 'authenticated', 'fin-reverser-' || v_reverser::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_reverser::text, 'r-' || v_reverser::text, 'n-' || v_reverser::text, ''),
    (v_instance, v_stranger, 'authenticated', 'authenticated', 'fin-stranger-' || v_stranger::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_stranger::text, 'r-' || v_stranger::text, 'n-' || v_stranger::text, '');

  update public.profiles set full_name = 'Finance Admin', is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
    can_review_payments = false
  where id = v_admin;
  update public.profiles set full_name = 'Ordinary Staff', is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
    can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false, can_review_payments = false,
    can_view_purchase_prices = false
  where id = v_staff;
  update public.profiles set full_name = 'Finance Reviewer', is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
    can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false, can_review_payments = true,
    can_view_purchase_prices = false
  where id = v_finance;
  update public.profiles set full_name = 'Finance All', is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
    can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false, can_review_payments = true,
    can_view_purchase_prices = false
  where id = v_all;
  update public.profiles set full_name = 'Inactive Finance', is_active = false, is_admin = false, pi_visibility = 'all', can_review_payments = true
  where id = v_inactive;
  update public.profiles set full_name = 'Reverser', is_active = true, is_admin = false, pi_visibility = 'all',
    can_manage_payments = false, can_reverse_payments = true, can_review_payments = false, can_view_purchase_prices = false
  where id = v_reverser;
  update public.profiles set full_name = 'Stranger', is_active = true, is_admin = false, pi_visibility = 'associated', can_review_payments = false
  where id = v_stranger;

  perform set_config('request.jwt.claim.sub', v_finance::text, true);
  if private.has_flag('can_review_payments') is not true
    or private.has_flag('can_manage_payments')
    or private.has_flag('can_reverse_payments')
    or private.has_flag('can_view_purchase_prices')
    or private.has_flag('can_activate_zero_subscriptions')
  then
    v_fail := v_fail || 'finance permission granted another flag; ';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  if private.has_flag('can_review_payments') is not true then
    v_fail := v_fail || 'administrator convention missed finance review; ';
  end if;
  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  if private.has_flag('can_review_payments') then
    v_fail := v_fail || 'inactive finance user passed the flag; ';
  end if;

  begin
    v_visible := pg_temp.finance_issue(v_admin, 'Visible', v_token, 'AE-USD', 'split');
    v_hidden := pg_temp.finance_issue(v_admin, 'Hidden', v_token, 'AE-USD', 'simple');
    v_egypt := pg_temp.finance_issue(v_admin, 'Egypt', v_token, 'EG-EGP', 'simple');
    v_mixed := pg_temp.finance_issue(v_admin, 'Mixed', v_token, 'AE-USD', 'mixed');
  exception when others then
    raise exception 'FINANCE_REVIEW_FAIL issue %', sqlerrm;
  end;

  insert into public.pi_salespeople (pi_id, user_id)
  select pi_id::uuid, v_finance from jsonb_array_elements_text(jsonb_build_array(v_visible ->> 'pi_id', v_egypt ->> 'pi_id', v_mixed ->> 'pi_id')) pi_id;
  insert into public.pi_salespeople (pi_id, user_id)
  values ((v_visible ->> 'pi_id')::uuid, v_staff);

  select (item ->> 'id')::uuid into v_first
  from jsonb_array_elements(v_visible -> 'obligations') item
  where item ->> 'label' = 'First part';
  select (item ->> 'id')::uuid into v_second
  from jsonb_array_elements(v_visible -> 'obligations') item
  where item ->> 'label' = 'Second part';
  select (item ->> 'id')::uuid into v_machine
  from jsonb_array_elements(v_mixed -> 'obligations') item
  where item ->> 'kind' = 'payment_row';
  select (item ->> 'id')::uuid into v_zero
  from jsonb_array_elements(v_mixed -> 'obligations') item
  where item ->> 'kind' = 'subscription_advance';
  if v_first is null or v_second is null or v_machine is null or v_zero is null then
    raise exception 'FINANCE_REVIEW_FAIL obligations % %', v_visible -> 'obligations', v_mixed -> 'obligations';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_today_date := private.cairo_today();
  v_partial := pg_temp.finance_record((v_visible ->> 'plan_id')::uuid, 1500, date '2026-10-01', 'BANK-PARTIAL',
    jsonb_build_array(jsonb_build_object('obligation_id', v_first, 'amount', '1500.00')));
  v_split := pg_temp.finance_record((v_visible ->> 'plan_id')::uuid, 1000, date '2026-10-20', 'BANK-SPLIT',
    jsonb_build_array(
      jsonb_build_object('obligation_id', v_first, 'amount', '400.00'),
      jsonb_build_object('obligation_id', v_second, 'amount', '600.00')
    ));
  v_today := pg_temp.finance_record((v_visible ->> 'plan_id')::uuid, 200, v_today_date, 'BANK-TODAY',
    jsonb_build_array(jsonb_build_object('obligation_id', v_second, 'amount', '200.00')));
  v_secret := pg_temp.finance_record((v_hidden ->> 'plan_id')::uuid, 100, date '2026-10-01', 'BANK-HIDDEN',
    jsonb_build_array(jsonb_build_object('obligation_id', (v_hidden #>> '{obligations,0,id}')::uuid, 'amount', '100.00')));
  v_egp := pg_temp.finance_record((v_egypt ->> 'plan_id')::uuid, 50, date '2026-10-01', 'BANK-EGP',
    jsonb_build_array(jsonb_build_object('obligation_id', (v_egypt #>> '{obligations,0,id}')::uuid, 'amount', '50.00')));
  v_mixed_receipt := pg_temp.finance_record((v_mixed ->> 'plan_id')::uuid, 10000, date '2026-10-02', 'BANK-MIXED',
    jsonb_build_array(jsonb_build_object('obligation_id', v_machine, 'amount', '10000.00')));
  perform public.activate_subscription_at_no_charge(v_zero, date '2026-10-03', 'Included with the machine');

  if (select count(*) from public.payment_receipt_reviews) <> 0 then
    v_fail := v_fail || 'recording a receipt created a review row; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_finance::text, true);
  v_result := public.received_payment_register('awaiting', null, null, null, null, 20, 0);
  if (v_result ->> 'count')::integer <> 5
    or v_result::text like '%' || v_secret::text || '%'
  then
    v_fail := v_fail || 'awaiting register leaked or miscounted ' || (v_result ->> 'count') || '; ';
  end if;
  v_result := public.received_payment_register('open', null, 'USD', null, null, 2, 0);
  if (v_result ->> 'count')::integer <> 4 or jsonb_array_length(v_result -> 'rows') <> 2 then
    v_fail := v_fail || 'usd page ' || v_result::text || '; ';
  end if;
  select coalesce(array_agg((item ->> 'id')::uuid), '{}') into v_ids
  from jsonb_array_elements(v_result -> 'rows') item;
  v_result := public.received_payment_register('open', null, 'USD', null, null, 2, 2);
  if (v_result ->> 'count')::integer <> 4
    or exists (select 1 from jsonb_array_elements(v_result -> 'rows') item where (item ->> 'id')::uuid = any (v_ids))
  then
    v_fail := v_fail || 'usd second page overlapped; ';
  end if;
  if (public.received_payment_register('open', null, 'EGP', null, null, 20, 0) ->> 'count')::integer <> 1
    or (public.received_payment_register('open', null, 'EUR', null, null, 20, 0) ->> 'count')::integer <> 0
  then
    v_fail := v_fail || 'currencies were combined; ';
  end if;
  v_result := public.received_payment_register('open', null, null, date '2026-10-15', date '2026-10-31', 20, 0);
  if (v_result ->> 'count')::integer <> 1 or (v_result #>> '{rows,0,reference}') is distinct from 'BANK-SPLIT' then
    v_fail := v_fail || 'received date filter ' || v_result::text || '; ';
  end if;
  v_result := public.received_payment_register('open', 'BANK-SPLIT', null, null, null, 20, 0);
  if (v_result ->> 'count')::integer <> 1 then
    v_fail := v_fail || 'split receipt was listed more than once ' || (v_result ->> 'count') || '; ';
  end if;
  v_result := public.received_payment_detail(v_split);
  if jsonb_array_length(v_result -> 'allocations') <> 2
    or (v_result #>> '{review,display_status}') is distinct from 'awaiting_review'
    or (v_result #>> '{review,version}') is distinct from '0'
    or jsonb_array_length(v_result -> 'history') <> 0
  then
    v_fail := v_fail || 'unreviewed split detail ' || v_result::text || '; ';
  end if;
  if (public.received_payment_register('open', 'BANK-HIDDEN', null, null, null, 20, 0) ->> 'count')::integer <> 0
    or (public.received_payment_register('open', 'Finance Hidden', null, null, null, 20, 0) ->> 'count')::integer <> 0
  then
    v_fail := v_fail || 'search leaked the hidden receipt; ';
  end if;
  if (public.received_payment_register('open', v_visible ->> 'pi_number', null, null, null, 20, 0) ->> 'count')::integer <> 3 then
    v_fail := v_fail || 'pi number search missed a visible receipt; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  if (public.received_payment_register('open', null, null, null, null, 20, 0) ->> 'count')::integer <> 0 then
    v_fail := v_fail || 'stranger saw receipts; ';
  end if;
  begin
    perform public.received_payment_detail(v_partial);
    v_fail := v_fail || 'stranger read a receipt; ';
  exception when others then
    if sqlerrm not like '%do not have access%' then v_fail := v_fail || 'stranger detail ' || sqlerrm || '; '; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  if (public.received_payment_register('open', 'BANK-PARTIAL', null, null, null, 20, 0) ->> 'count')::integer <> 1 then
    v_fail := v_fail || 'staff could not read an associated receipt; ';
  end if;
  begin
    perform public.review_payment_receipt(v_partial, 'verify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'NO'));
    v_fail := v_fail || 'staff reviewed a receipt; ';
  exception when others then
    if sqlerrm not like '%permission to review%' then v_fail := v_fail || 'staff review ' || sqlerrm || '; '; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_finance::text, true);
  begin
    perform public.record_payment_receipt((v_visible ->> 'plan_id')::uuid, jsonb_build_object('idempotency_key', gen_random_uuid(), 'amount', '1.00', 'received_on', v_today_date, 'method', 'cash', 'allocations', jsonb_build_array(jsonb_build_object('obligation_id', v_second, 'amount', '1.00'))));
    v_fail := v_fail || 'finance recorded a receipt; ';
  exception when others then
    if sqlerrm not like '%permission to record%' then v_fail := v_fail || 'finance record ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.reverse_payment_receipt(v_partial, 'Should not reverse');
    v_fail := v_fail || 'finance reversed a receipt; ';
  exception when others then
    if sqlerrm not like '%permission to reverse%' then v_fail := v_fail || 'finance reverse ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.review_payment_receipt(v_secret, 'verify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'HIDDEN'));
    v_fail := v_fail || 'finance reviewed a hidden receipt; ';
  exception when others then
    if sqlerrm not like '%do not have access%' then v_fail := v_fail || 'hidden review ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.review_payment_receipt(v_partial, 'verify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', '   '));
    v_fail := v_fail || 'blank reference was verified; ';
  exception when others then
    if sqlerrm not like '%internal payment reference%' then v_fail := v_fail || 'blank reference ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.review_payment_receipt(v_partial, 'clarify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'note', '  '));
    v_fail := v_fail || 'blank clarification was saved; ';
  exception when others then
    if sqlerrm not like '%reason for the clarification%' then v_fail := v_fail || 'blank clarification ' || sqlerrm || '; '; end if;
  end;

  v_before := pg_temp.finance_state(v_partial);
  v_snapshot := v_visible -> 'snapshot';
  v_number := v_visible ->> 'pi_number';
  select tracking_status into v_status from public.proforma_invoices where id = (v_visible ->> 'pi_id')::uuid;
  select coalesce(jsonb_object_agg(office || ':' || pi_year::text, last_value), '{}'::jsonb) into v_counters from private.pi_counters;
  v_key := gen_random_uuid();
  v_result := public.review_payment_receipt(v_partial, 'verify', 0, jsonb_build_object(
    'idempotency_key', v_key, 'internal_reference', 'VCH-SHARED', 'note', 'Checked',
    'reviewed_by', v_stranger, 'reviewed_at', '2000-01-01T00:00:00Z'
  ));
  if (v_result ->> 'already_applied')::boolean
    or (v_result #>> '{review,status}') is distinct from 'verified'
    or (v_result #>> '{review,internal_reference}') is distinct from 'VCH-SHARED'
    or (v_result #>> '{review,reviewed_by}') is distinct from v_finance::text
    or (v_result #>> '{review,reviewed_at}') like '2000-01-01%'
    or (v_result #>> '{receipt,reference}') is distinct from 'BANK-PARTIAL'
    or (v_result #>> '{receipt,amount}') is distinct from '1500.00'
  then
    v_fail := v_fail || 'verify result ' || v_result::text || '; ';
  end if;
  v_after := pg_temp.finance_state(v_partial);
  if v_before is distinct from v_after then
    v_fail := v_fail || 'verify changed the receipt or balance; ';
  end if;
  if (select snapshot from public.pi_versions where id = (v_visible ->> 'version_id')::uuid) is distinct from v_snapshot
    or (select pi_number from public.proforma_invoices where id = (v_visible ->> 'pi_id')::uuid) is distinct from v_number
    or (select tracking_status from public.proforma_invoices where id = (v_visible ->> 'pi_id')::uuid) is distinct from v_status
    or (select count(*) from public.subscriptions where pi_id = (v_visible ->> 'pi_id')::uuid) <> 0
  then
    v_fail := v_fail || 'verify changed the PI, snapshot, or subscriptions; ';
  end if;
  select coalesce(jsonb_object_agg(office || ':' || pi_year::text, last_value), '{}'::jsonb) into v_counters_after from private.pi_counters;
  if v_counters_after is distinct from v_counters then
    v_fail := v_fail || 'verify moved a numbering counter; ';
  end if;

  v_result := public.review_payment_receipt(v_partial, 'verify', 0, jsonb_build_object('idempotency_key', v_key, 'internal_reference', 'VCH-SHARED', 'note', 'Checked'));
  select count(*) into v_events from public.payment_receipt_review_events where receipt_id = v_partial;
  if (v_result ->> 'already_applied')::boolean is not true or v_events <> 1 then
    v_fail := v_fail || 'repeated submission created history ' || v_events::text || '; ';
  end if;
  v_result := public.review_payment_receipt(v_partial, 'verify', 1, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'VCH-SHARED', 'note', 'Checked'));
  select count(*) into v_events from public.payment_receipt_review_events where receipt_id = v_partial;
  if (v_result ->> 'already_applied')::boolean is not true or v_events <> 1 then
    v_fail := v_fail || 'repeated verification created history; ';
  end if;
  begin
    perform public.review_payment_receipt(v_partial, 'clarify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'note', 'Different'));
    v_fail := v_fail || 'stale clarification was saved; ';
  exception when others then
    if sqlerrm not like '%updated by someone else%' then v_fail := v_fail || 'stale ' || sqlerrm || '; '; end if;
  end;
  if (select status from public.payment_receipt_reviews where receipt_id = v_partial) is distinct from 'verified'
    or (select count(*) from public.payment_receipt_review_events where receipt_id = v_partial) <> 1
  then
    v_fail := v_fail || 'stale write changed the review; ';
  end if;
  begin
    perform public.review_payment_receipt(v_partial, 'verify', 1, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'VCH-NEW'));
    v_fail := v_fail || 'verified reference was overwritten; ';
  exception when others then
    if sqlerrm not like '%Reopen the review%' then v_fail := v_fail || 'overwrite ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.review_payment_receipt(v_partial, 'reopen', 1, jsonb_build_object('idempotency_key', gen_random_uuid(), 'note', '   '));
    v_fail := v_fail || 'blank reopen was saved; ';
  exception when others then
    if sqlerrm not like '%reason for reopening%' then v_fail := v_fail || 'blank reopen ' || sqlerrm || '; '; end if;
  end;

  v_result := public.review_payment_receipt(v_partial, 'reopen', 1, jsonb_build_object('idempotency_key', gen_random_uuid(), 'note', 'Wrong voucher'));
  if (v_result #>> '{review,display_status}') is distinct from 'awaiting_review'
    or (v_result #>> '{review,status}') is distinct from 'awaiting_review'
    or v_result #>> '{review,internal_reference}' is not null
    or v_result #>> '{review,reviewed_at}' is not null
    or (v_result #>> '{review,ever_verified}')::boolean is not true
    or (v_result #>> '{history,0,internal_reference}') is distinct from 'VCH-SHARED'
    or (v_result #>> '{history,1,action}') is distinct from 'reopened'
  then
    v_fail := v_fail || 'reopen result ' || v_result::text || '; ';
  end if;
  if pg_temp.finance_state(v_partial) is distinct from v_before then
    v_fail := v_fail || 'reopen changed the receipt; ';
  end if;
  v_result := public.review_payment_receipt(v_partial, 'verify', 2, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'VCH-CORRECTED', 'note', 'Corrected'));
  select count(*) into v_events from public.payment_receipt_review_events where receipt_id = v_partial;
  if (v_result #>> '{review,internal_reference}') is distinct from 'VCH-CORRECTED'
    or (v_result #>> '{history,0,internal_reference}') is distinct from 'VCH-SHARED'
    or v_events <> 3
    or (select internal_reference from public.payment_receipt_reviews where receipt_id = v_partial) is distinct from 'VCH-CORRECTED'
  then
    v_fail := v_fail || 'correction history ' || v_result::text || '; ';
  end if;

  v_result := public.review_payment_receipt(v_split, 'clarify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'note', 'Which account sent this?'));
  if (v_result #>> '{review,display_status}') is distinct from 'needs_clarification' then
    v_fail := v_fail || 'clarification ' || v_result::text || '; ';
  end if;
  v_result := public.review_payment_receipt(v_split, 'verify', 1, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'VCH-CORRECTED'));
  if (v_result #>> '{review,status}') is distinct from 'verified'
    or (select count(*) from public.payment_receipt_reviews where internal_reference = 'VCH-CORRECTED') <> 2
  then
    v_fail := v_fail || 'duplicate internal reference was rejected; ';
  end if;
  if (public.received_payment_register('open', 'VCH-CORRECTED', null, null, null, 20, 0) ->> 'count')::integer <> 2 then
    v_fail := v_fail || 'internal reference search missed a receipt; ';
  end if;
  if (public.received_payment_register('clarification', null, null, null, null, 20, 0) ->> 'count')::integer <> 0
    or (public.received_payment_register('verified', null, null, null, null, 20, 0) ->> 'count')::integer < 2
  then
    v_fail := v_fail || 'verified filter included the wrong receipts; ';
  end if;

  v_before := pg_temp.finance_state(v_today);
  v_result := public.review_payment_receipt(v_today, 'verify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'VCH-TODAY'));
  if pg_temp.finance_state(v_today) is distinct from v_before then
    v_fail := v_fail || 'verification changed a second receipt; ';
  end if;
  perform set_config('request.jwt.claim.sub', v_reverser::text, true);
  begin
    perform public.review_payment_receipt(v_today, 'reopen', 1, jsonb_build_object('idempotency_key', gen_random_uuid(), 'note', 'No'));
    v_fail := v_fail || 'reverser reviewed a receipt; ';
  exception when others then
    if sqlerrm not like '%permission to review%' then v_fail := v_fail || 'reverser review ' || sqlerrm || '; '; end if;
  end;
  perform public.reverse_payment_receipt(v_today, 'Posted to the wrong PI');
  perform set_config('request.jwt.claim.sub', v_finance::text, true);
  v_result := public.received_payment_detail(v_today);
  if (v_result #>> '{review,display_status}') is distinct from 'reversed_previously_verified'
    or (v_result #>> '{review,internal_reference}') is distinct from 'VCH-TODAY'
    or jsonb_array_length(v_result -> 'history') <> 1
    or (public.received_payment_register('awaiting', null, null, null, null, 20, 0)::text like '%' || v_today::text || '%')
    or (public.received_payment_register('verified', null, null, null, null, 20, 0)::text like '%' || v_today::text || '%')
    or (public.received_payment_register('reversed', 'BANK-TODAY', null, null, null, 20, 0) ->> 'count')::integer <> 1
  then
    v_fail := v_fail || 'reversed review ' || v_result::text || '; ';
  end if;
  foreach v_text in array ARRAY['verify', 'clarify', 'reopen'] loop
    begin
      perform public.review_payment_receipt(v_today, v_text, 1, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'AGAIN', 'note', 'Again'));
      v_fail := v_fail || 'reversed receipt accepted ' || v_text || '; ';
    exception when others then
      if sqlerrm not like '%reversed%' then v_fail := v_fail || 'reversed action ' || v_text || ' ' || sqlerrm || '; '; end if;
    end;
  end loop;
  if (select amount from public.payment_receipts where id = v_today) <> 200
    or (select reference from public.payment_receipts where id = v_today) is distinct from 'BANK-TODAY'
    or (select reversed_at from public.payment_receipts where id = v_today) is null
  then
    v_fail := v_fail || 'reversal changed the receipt amount or reference; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_all::text, true);
  v_result := public.review_payment_receipt(v_secret, 'verify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'VCH-ALL'));
  if (v_result #>> '{review,reviewed_by}') is distinct from v_all::text then
    v_fail := v_fail || 'all-PI finance review failed; ';
  end if;
  perform set_config('request.jwt.claim.sub', v_finance::text, true);
  if public.received_payment_register('verified', 'VCH-ALL', null, null, null, 20, 0)::text like '%' || v_secret::text || '%' then
    v_fail := v_fail || 'associated finance saw the all-PI review; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  begin
    perform public.received_payment_register('open', null, null, null, null, 20, 0);
    v_fail := v_fail || 'inactive user listed receipts; ';
  exception when others then
    if sqlerrm not like '%Sign in required%' then v_fail := v_fail || 'inactive register ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.review_payment_receipt(v_egp, 'verify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'NO'));
    v_fail := v_fail || 'inactive user reviewed; ';
  exception when others then
    if sqlerrm not like '%Sign in required%' then v_fail := v_fail || 'inactive review ' || sqlerrm || '; '; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_finance::text, true);
  select to_jsonb(s) into v_sub_before from public.subscriptions s where payment_obligation_id = v_zero;
  v_before := pg_temp.finance_state(v_mixed_receipt);
  perform public.review_payment_receipt(v_mixed_receipt, 'verify', 0, jsonb_build_object('idempotency_key', gen_random_uuid(), 'internal_reference', 'VCH-MIXED'));
  select to_jsonb(s) into v_sub_after from public.subscriptions s where payment_obligation_id = v_zero;
  if v_sub_before is null or v_sub_before is distinct from v_sub_after or pg_temp.finance_state(v_mixed_receipt) is distinct from v_before then
    v_fail := v_fail || 'review changed the subscription or mixed receipt; ';
  end if;

  begin
    update public.payment_receipts set reference = 'CHANGED' where id = v_partial;
    v_fail := v_fail || 'receipt reference was edited; ';
  exception when others then
    if sqlerrm not like '%cannot be edited%' then v_fail := v_fail || 'receipt edit ' || sqlerrm || '; '; end if;
  end;
  begin
    insert into public.payment_receipt_reviews (receipt_id, status, version) values (v_egp, 'verified', 1);
    v_fail := v_fail || 'direct review insert; ';
  exception when others then
    if sqlerrm not like '%review actions%' then v_fail := v_fail || 'direct insert ' || sqlerrm || '; '; end if;
  end;
  begin
    delete from public.payment_receipt_review_events where receipt_id = v_partial;
    v_fail := v_fail || 'history delete; ';
  exception when others then
    if sqlerrm not like '%cannot be edited or deleted%' then v_fail := v_fail || 'history delete ' || sqlerrm || '; '; end if;
  end;
  begin
    perform set_config('value_crm.receipt_review_write', 'on', true);
    update public.payment_receipt_review_events set note = 'tampered' where receipt_id = v_partial;
    v_fail := v_fail || 'flagged history update; ';
  exception when others then
    if sqlerrm not like '%cannot be edited or deleted%' then v_fail := v_fail || 'flagged history ' || sqlerrm || '; '; end if;
  end;
  perform set_config('value_crm.receipt_review_write', 'off', true);
  begin
    update public.payment_receipt_reviews set internal_reference = 'TAMPER' where receipt_id = v_partial;
    v_fail := v_fail || 'direct review update; ';
  exception when others then
    if sqlerrm not like '%review actions%' then v_fail := v_fail || 'direct update ' || sqlerrm || '; '; end if;
  end;

  if pg_get_functiondef('private.review_payment_receipt(uuid, text, integer, jsonb)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('private.received_payment_register(text, text, text, date, date, integer, integer)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('private.receipt_review_payload(uuid)'::regprocedure) ilike '%product_costs%'
  then
    v_fail := v_fail || 'review functions read purchase prices; ';
  end if;
  if has_table_privilege('anon', 'public.payment_receipt_reviews', 'select')
    or has_table_privilege('authenticated', 'public.payment_receipt_reviews', 'insert')
    or has_table_privilege('authenticated', 'public.payment_receipt_reviews', 'update')
    or has_table_privilege('authenticated', 'public.payment_receipt_reviews', 'delete')
    or not has_table_privilege('authenticated', 'public.payment_receipt_reviews', 'select')
    or not (select relrowsecurity from pg_class where oid = 'public.payment_receipt_reviews'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.payment_receipt_review_events'::regclass)
  then
    v_fail := v_fail || 'review table privileges; ';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', v_finance::text, true);
    execute 'set local role authenticated';
    select count(*) into v_count from public.payment_receipt_reviews;
    if v_count <> 4 then
      v_fail := v_fail || 'authenticated review count ' || v_count::text || '; ';
    end if;
    if exists (select 1 from public.payment_receipt_reviews where receipt_id = v_secret) then
      v_fail := v_fail || 'authenticated select saw the hidden review; ';
    end if;
    begin
      insert into public.payment_receipt_reviews (receipt_id, status, internal_reference, reviewed_by, reviewed_at, ever_verified, version)
      values (v_egp, 'verified', 'DIRECT', v_finance, now(), true, 1);
      v_fail := v_fail || 'authenticated insert; ';
    exception when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%permission denied%' and sqlerrm not like '%row-level security%' and sqlerrm not like '%review actions%' then
        v_fail := v_fail || 'authenticated insert ' || sqlerrm || '; ';
      end if;
    end;
  exception when others then
    v_fail := v_fail || 'rls ' || sqlerrm || '; ';
  end;
  execute 'reset role';

  begin
    execute 'set local role anon';
    perform public.received_payment_register('open', null, null, null, null, 20, 0);
    v_fail := v_fail || 'anonymous read receipts; ';
  exception when insufficient_privilege then
    null;
  when others then
    v_fail := v_fail || 'anon ' || sqlerrm || '; ';
  end;
  execute 'reset role';

  if v_fail <> '' then
    raise exception 'FINANCE_REVIEW_FAIL %', v_fail;
  end if;
  raise exception 'FINANCE_REVIEW_OK';
end;
$test$;
