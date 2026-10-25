-- Rolled-back checks for the owner dashboard and the shared Payments register.
-- Run with a privileged session after 20261023213000_owner_dashboard_payments.sql
-- and 20261025143000_dashboard_overview_aggregates.sql.
-- The block always raises, including on success, so none of its rows are committed.
-- Do not run this against Value CRM if the session cannot roll the final exception back.

do $test$
declare
  v_fail text := '';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_instance uuid;
  v_admin uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_associated uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_today date;
  v_month date;
  v_window record;
  v_midnight timestamptz;
  v_client_secret uuid;
  v_client_mine uuid;
  v_vendor uuid;
  v_product uuid;
  v_model text;
  v_sub_product uuid;
  v_sub_model text;
  v_sub_option uuid;
  v_zero_product uuid;
  v_zero_model text;
  v_zero_option uuid;
  v_preset public.company_presets;
  v_row jsonb;
  v_report jsonb;
  v_summary jsonb;
  v_register jsonb;
  v_again jsonb;
  v_text text;
  v_amount numeric;
  v_count integer;
  v_pi uuid;
  v_made jsonb;
  v_lines jsonb;
  v_schedule jsonb;
  v_plan uuid;
  v_receipt uuid;
  v_left uuid;
  v_right uuid;
  v_issued uuid;
  v_draft uuid;
  v_duplicate uuid;
  v_cancelled uuid;
  v_old uuid;
  v_archived_pi uuid;
  v_mine uuid;
  v_former_pi uuid;
  v_pin uuid;
  v_receipt_pi uuid;
  v_sub_pi uuid;
  v_zero_pi uuid;
  v_instalment uuid;
  v_overdue uuid;
  v_due_today uuid;
  v_soon uuid;
  v_week_edge uuid;
  v_month_edge uuid;
  v_beyond uuid;
  v_awaiting uuid;
  v_deadline uuid;
  v_date_in uuid;
  v_date_out uuid;
  v_date_30 uuid;
  v_date_31 uuid;
  v_month_in uuid;
  v_month_out uuid;
  v_ids uuid[];
  v_page_ids uuid[];
  v_next_ids uuid[];
begin
  v_model := 'zz-dash-' || v_tag;
  v_sub_model := 'zz-dash-sub-' || v_tag;
  v_zero_model := 'zz-dash-zero-' || v_tag;
  v_today := private.cairo_today();
  v_month := date_trunc('month', v_today::timestamp)::date;

  if private.cairo_today() is distinct from (timezone('Africa/Cairo', pg_catalog.now()))::date then
    v_fail := v_fail || 'cairo today is not the Africa/Cairo date; ';
  end if;
  v_midnight := (timestamp '2026-10-24 00:00:00') at time zone 'Africa/Cairo';
  if (timezone('Africa/Cairo', v_midnight - interval '1 second'))::date is distinct from date '2026-10-23'
    or (timezone('Africa/Cairo', v_midnight))::date is distinct from date '2026-10-24'
  then
    v_fail := v_fail || 'cairo midnight boundary moved; ';
  end if;

  select * into v_window from private.reporting_window('last_7', null, null, date '2026-10-24', true);
  if v_window.unbounded or v_window.range_start is distinct from date '2026-10-18' or v_window.range_end is distinct from date '2026-10-24' then
    v_fail := v_fail || 'last 7 window; ';
  end if;
  select * into v_window from private.reporting_window('this_month', null, null, date '2026-10-24', true);
  if v_window.range_start is distinct from date '2026-10-01' or v_window.range_end is distinct from date '2026-10-24' then
    v_fail := v_fail || 'this month window; ';
  end if;
  select * into v_window from private.reporting_window('last_30', null, null, date '2026-10-24', true);
  if v_window.range_start is distinct from date '2026-09-25' or v_window.range_end is distinct from date '2026-10-24' then
    v_fail := v_fail || 'last 30 window; ';
  end if;
  select * into v_window from private.reporting_window('last_7', null, null, date '2026-03-01', true);
  if v_window.range_start is distinct from date '2026-02-23' or v_window.range_end is distinct from date '2026-03-01' then
    v_fail := v_fail || 'last 7 across February; ';
  end if;
  select * into v_window from private.reporting_window('this_month', null, null, date '2026-03-01', true);
  if v_window.range_start is distinct from date '2026-03-01' or v_window.range_end is distinct from date '2026-03-01' then
    v_fail := v_fail || 'this month on the first; ';
  end if;
  select * into v_window from private.reporting_window('custom', date '2026-01-02', date '2026-01-02', date '2026-10-24', true);
  if v_window.range_start is distinct from date '2026-01-02' or v_window.range_end is distinct from date '2026-01-02' then
    v_fail := v_fail || 'custom single day; ';
  end if;
  begin
    perform * from private.reporting_window('custom', date '2026-02-02', date '2026-02-01', v_today, true);
    v_fail := v_fail || 'inverted custom was accepted; ';
  exception when others then
    if sqlerrm not like '%on or before the end date%' then
      v_fail := v_fail || 'inverted custom ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform * from private.reporting_window('custom', null, v_today, v_today, true);
    v_fail := v_fail || 'incomplete custom was accepted; ';
  exception when others then
    if sqlerrm not like '%Enter both dates%' then
      v_fail := v_fail || 'incomplete custom ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform * from private.reporting_window('all', null, null, v_today, false);
    v_fail := v_fail || 'receipt period accepted all; ';
  exception when others then
    if sqlerrm not like '%Choose a date range%' then
      v_fail := v_fail || 'receipt all ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform * from private.reporting_window('yesterday', null, null, v_today, true);
    v_fail := v_fail || 'unknown period was accepted; ';
  exception when others then
    if sqlerrm not like '%Choose a date range%' then
      v_fail := v_fail || 'unknown period ' || sqlerrm || '; ';
    end if;
  end;

  if has_function_privilege('anon', 'public.active_pi_report(text,date,date,text,text,text,uuid,text,integer,integer,text)', 'execute')
    or has_function_privilege('anon', 'public.collection_summary(text,date,date,text)', 'execute')
    or has_function_privilege('anon', 'public.payment_register(text,text,text,text,uuid,text,date,date,text,text,integer,integer)', 'execute')
    or has_function_privilege('anon', 'private.active_pi_report(text,date,date,text,text,text,uuid,text,integer,integer,text)', 'execute')
    or has_function_privilege('authenticated', 'private.visible_tracked_obligations()', 'execute')
    or has_function_privilege('authenticated', 'private.reporting_window(text,date,date,date,boolean)', 'execute')
    or has_function_privilege('authenticated', 'private.obligation_due_label(text,date,text)', 'execute')
  then
    v_fail := v_fail || 'reporting functions are granted too widely; ';
  end if;
  if not has_function_privilege('authenticated', 'public.active_pi_report(text,date,date,text,text,text,uuid,text,integer,integer,text)', 'execute')
    or not has_function_privilege('authenticated', 'public.collection_summary(text,date,date,text)', 'execute')
    or not has_function_privilege('authenticated', 'public.payment_register(text,text,text,text,uuid,text,date,date,text,text,integer,integer)', 'execute')
    or not has_function_privilege('authenticated', 'private.active_pi_report(text,date,date,text,text,text,uuid,text,integer,integer,text)', 'execute')
    or not has_function_privilege('authenticated', 'private.collection_summary(text,date,date,text)', 'execute')
    or not has_function_privilege('authenticated', 'private.payment_register(text,text,text,text,uuid,text,date,date,text,text,integer,integer)', 'execute')
  then
    v_fail := v_fail || 'authenticated cannot execute the report wrappers; ';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'active_pi_report' and p.prosecdef and p.provolatile = 's'
      and p.proconfig::text like '%search_path=%'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'payment_register' and p.prosecdef and p.provolatile = 's'
  ) or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('active_pi_report', 'collection_summary', 'payment_register') and p.prosecdef
  ) then
    v_fail := v_fail || 'reporting security definer or search_path is wrong; ';
  end if;
  if pg_get_functiondef('private.active_pi_report(text,date,date,text,text,text,uuid,text,integer,integer,text)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('private.collection_summary(text,date,date,text)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('private.payment_register(text,text,text,text,uuid,text,date,date,text,text,integer,integer)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('private.visible_tracked_obligations()'::regprocedure) ilike '%product_costs%'
  then
    v_fail := v_fail || 'reporting read purchase prices; ';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'payment_receipts_active_received_idx') then
    v_fail := v_fail || 'received index is missing; ';
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
    (v_instance, v_admin, 'authenticated', 'authenticated', 'dash-admin-' || v_tag || '@example.invalid', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Report Admin"}'::jsonb, now(), now(), 'c-a-' || v_tag, 'r-a-' || v_tag, 'n-a-' || v_tag, ''),
    (v_instance, v_reader, 'authenticated', 'authenticated', 'dash-reader-' || v_tag || '@example.invalid', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Report Reader"}'::jsonb, now(), now(), 'c-r-' || v_tag, 'r-r-' || v_tag, 'n-r-' || v_tag, ''),
    (v_instance, v_associated, 'authenticated', 'authenticated', 'dash-assoc-' || v_tag || '@example.invalid', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Report Associate"}'::jsonb, now(), now(), 'c-s-' || v_tag, 'r-s-' || v_tag, 'n-s-' || v_tag, ''),
    (v_instance, v_other, 'authenticated', 'authenticated', 'dash-other-' || v_tag || '@example.invalid', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Report Other"}'::jsonb, now(), now(), 'c-o-' || v_tag, 'r-o-' || v_tag, 'n-o-' || v_tag, ''),
    (v_instance, v_former, 'authenticated', 'authenticated', 'dash-former-' || v_tag || '@example.invalid', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Report Former"}'::jsonb, now(), now(), 'c-f-' || v_tag, 'r-f-' || v_tag, 'n-f-' || v_tag, ''),
    (v_instance, v_inactive, 'authenticated', 'authenticated', 'dash-inactive-' || v_tag || '@example.invalid', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Report Inactive"}'::jsonb, now(), now(), 'c-i-' || v_tag, 'r-i-' || v_tag, 'n-i-' || v_tag, '');
  update public.profiles set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all' where id = v_admin;
  update public.profiles set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'all',
    can_edit_drafts = false, can_generate_pis = false, can_manage_payments = false, can_reverse_payments = false, can_activate_zero_subscriptions = false
  where id = v_reader;
  update public.profiles set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
    can_edit_drafts = false, can_generate_pis = false, can_manage_payments = false
  where id = v_associated;
  update public.profiles set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
    can_manage_payments = true, can_reverse_payments = true
  where id = v_other;
  update public.profiles set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated' where id = v_former;
  update public.profiles set is_active = false, is_admin = true, is_salesperson = true, pi_visibility = 'all', can_manage_payments = true where id = v_inactive;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  execute $fn$
    create function pg_temp.make_pi(
      p_preset text,
      p_date date,
      p_lead uuid,
      p_extra uuid,
      p_client uuid,
      p_lines jsonb,
      p_schedule jsonb,
      p_issue boolean
    ) returns jsonb
    language plpgsql
    as $body$
    declare
      v_id uuid;
      v_payload jsonb;
      v_version integer;
      v_result jsonb;
    begin
      v_id := public.create_pi_draft();
      v_payload := jsonb_build_object(
        'preset_code', p_preset,
        'pi_date', p_date,
        'expiry_date', p_date + 30,
        'client_id', p_client,
        'bill_to', 'Bill',
        'ship_to', 'Bill',
        'ship_same_as_billing', true,
        'customer_reference', '',
        'lead_salesperson_id', p_lead,
        'salesperson_ids', case when p_extra is null then jsonb_build_array(p_lead) else jsonb_build_array(p_lead, p_extra) end,
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
        'payment_schedule', p_schedule,
        'delivery_terms', '',
        'warranty', '',
        'additional_notes', '',
        'lines', p_lines
      );
      perform public.save_pi_draft(v_id, 1, v_payload);
      if not p_issue then
        return jsonb_build_object('pi_id', v_id, 'issued', false, 'payload', v_payload);
      end if;
      v_version := (select draft_version from public.proforma_invoices where id = v_id);
      v_result := public.generate_pi(v_id, v_version, v_payload);
      return jsonb_build_object(
        'pi_id', v_id,
        'version_id', v_result ->> 'version_id',
        'issued', true,
        'payload', v_payload,
        'total', (select grand_total from public.pi_versions where id = (v_result ->> 'version_id')::uuid)
      );
    end;
    $body$;
  $fn$;

  execute $fn$
    create function pg_temp.one_line(p_product uuid, p_vendor uuid, p_model text, p_price text, p_unit text) returns jsonb
    language sql as $body$
      select jsonb_build_array(jsonb_build_object(
        'product_id', p_product, 'vendor_id', p_vendor, 'model_code', p_model, 'description', 'Machine',
        'unit', p_unit, 'quantity', '1', 'unit_price', p_price, 'subscription', null
      ));
    $body$;
  $fn$;

  execute $fn$
    create function pg_temp.dated(p_label text, p_due date) returns jsonb
    language sql as $body$
      select jsonb_build_object(
        'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
        'rows', jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(), 'label', p_label,
          'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
          'due', jsonb_build_object('type', 'date', 'date', to_char(p_due, 'YYYY-MM-DD')),
          'instalments', null
        ))
      );
    $body$;
  $fn$;

  create temporary table expected_pi (
    id uuid primary key,
    currency text not null,
    pi_date date,
    amount numeric not null,
    kind text not null,
    lead_id uuid,
    tracked boolean not null,
    secret boolean not null
  ) on commit drop;

  insert into public.clients (company_name, billing_address) values ('Report Secret ' || v_tag, 'Secret bill') returning id into v_client_secret;
  insert into public.clients (company_name, billing_address) values ('Report Mine ' || v_tag, 'Mine bill') returning id into v_client_mine;
  insert into public.vendors (company_name) values ('Report Vendor ' || v_tag) returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_egp, sell_price_usd, sell_price_eur, billing_type)
  values (v_vendor, v_model, 'Machine', 'unit', 1000, 1000, 1000, 'one_time') returning id into v_product;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_sub_model, 'Plan', 'license', 'subscription') returning id into v_sub_product;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_zero_model, 'Free plan', 'license', 'subscription') returning id into v_zero_product;
  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price, later_year_base_unit_price, later_year_rule
  ) values (v_sub_product, 3, 'USD', 100, 80, 'vendor_confirmed_base_adjustment') returning id into v_sub_option;
  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price
  ) values (v_zero_product, 1, 'USD', 0) returning id into v_zero_option;

  -- EUR collection buckets. Each PI is one obligation so the windows can be added by hand.
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '100.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Overdue', v_today - 1), true);
  v_overdue := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_overdue, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_overdue, 'EUR', v_today, 100, 'issued', v_admin, true, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '50.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Today', v_today), true);
  v_due_today := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_due_today, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_due_today, 'EUR', v_today, 50, 'issued', v_admin, true, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '25.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Soon', v_today + 1), true);
  v_soon := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_soon, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_soon, 'EUR', v_today, 25, 'issued', v_admin, true, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '10.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Eighth', v_today + 8), true);
  v_week_edge := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_week_edge, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_week_edge, 'EUR', v_today, 10, 'issued', v_admin, true, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '5.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Thirtieth', v_today + 30), true);
  v_month_edge := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_month_edge, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_month_edge, 'EUR', v_today, 5, 'issued', v_admin, true, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '7.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Beyond', v_today + 31), true);
  v_beyond := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_beyond, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_beyond, 'EUR', v_today, 7, 'issued', v_admin, true, true);

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'label', 'Awaiting',
      'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
      'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'delivery')),
      'instalments', null
    ))
  );
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '80.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, v_schedule, true);
  v_awaiting := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_awaiting, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_awaiting, 'EUR', v_today, 80, 'issued', v_admin, true, true);

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'label', 'Before shipment',
      'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
      'due', jsonb_build_object('type', 'before_shipment', 'deadline', null),
      'instalments', null
    ))
  );
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '15.00', 'unit');
  v_made := pg_temp.make_pi('AE-EUR', v_today, v_admin, null, v_client_secret, v_lines, v_schedule, true);
  v_deadline := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_deadline, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_deadline, 'EUR', v_today, 15, 'issued', v_admin, true, true);

  v_summary := public.collection_summary('last_7', null, null, null);
  if v_summary #>> '{currencies,2,currency}' is distinct from 'EUR'
    or v_summary #>> '{currencies,2,outstanding}' is distinct from '292.00'
    or v_summary #>> '{currencies,2,overdue}' is distinct from '100.00'
    or v_summary #>> '{currencies,2,due_today}' is distinct from '50.00'
    or v_summary #>> '{currencies,2,next_7}' is distinct from '25.00'
    or v_summary #>> '{currencies,2,next_30}' is distinct from '40.00'
    or v_summary #>> '{currencies,2,unresolved}' is distinct from '95.00'
    or v_summary #>> '{currencies,2,received}' is distinct from '0.00'
    or v_summary #>> '{currencies,0,currency}' is distinct from 'EGP'
    or v_summary #>> '{currencies,1,currency}' is distinct from 'USD'
  then
    v_fail := v_fail || 'eur windows ' || v_summary::text || '; ';
  end if;
  if (v_summary #>> '{currencies,2,next_7}')::numeric + (v_summary #>> '{currencies,2,next_30}')::numeric
      + (v_summary #>> '{currencies,2,overdue}')::numeric
    > (v_summary #>> '{currencies,2,outstanding}')::numeric
  then
    v_fail := v_fail || 'next 7 was added on top of next 30; ';
  end if;
  if v_summary #>> '{currencies,2,due_1_7}' is distinct from '25.00'
    or v_summary #>> '{currencies,2,due_8_30}' is distinct from '15.00'
    or v_summary #>> '{currencies,2,due_after_30}' is distinct from '7.00'
    or v_summary #>> '{currencies,2,due_1_7}' is distinct from v_summary #>> '{currencies,2,next_7}'
    or (v_summary #>> '{currencies,2,plan_count}')::integer is distinct from 8
    or (v_summary #>> '{currencies,0,plan_count}')::integer is distinct from 0
    or (v_summary #>> '{currencies,1,plan_count}')::integer is distinct from 0
    or (
      (v_summary #>> '{currencies,2,overdue}')::numeric
      + (v_summary #>> '{currencies,2,due_today}')::numeric
      + (v_summary #>> '{currencies,2,due_1_7}')::numeric
      + (v_summary #>> '{currencies,2,due_8_30}')::numeric
      + (v_summary #>> '{currencies,2,due_after_30}')::numeric
      + (v_summary #>> '{currencies,2,unresolved}')::numeric
    ) is distinct from (v_summary #>> '{currencies,2,outstanding}')::numeric
  then
    v_fail := v_fail || 'disjoint due buckets ' || v_summary::text || '; ';
  end if;

  v_register := public.payment_register('awaiting', null, 'EUR', null, null, null, null, null, null, null, 20, 0);
  if (v_register ->> 'count')::integer is distinct from 2 then
    v_fail := v_fail || 'awaiting count ' || v_register::text || '; ';
  end if;
  select item ->> 'due_label' into v_text
  from jsonb_array_elements(v_register -> 'rows') item
  where (item ->> 'pi_id')::uuid = v_awaiting;
  if v_text is distinct from 'Awaiting delivery date' then
    v_fail := v_fail || 'awaiting label ' || coalesce(v_text, '') || '; ';
  end if;
  select item ->> 'due_label' into v_text
  from jsonb_array_elements(v_register -> 'rows') item
  where (item ->> 'pi_id')::uuid = v_deadline;
  if v_text is distinct from 'Deadline to be set' then
    v_fail := v_fail || 'deadline label ' || coalesce(v_text, '') || '; ';
  end if;
  v_register := public.payment_register('overdue', null, 'EUR', null, null, null, null, null, null, null, 20, 0);
  if (v_register ->> 'count')::integer is distinct from 1
    or exists (
      select 1 from jsonb_array_elements(v_register -> 'rows') item
      where (item ->> 'pi_id')::uuid in (v_awaiting, v_deadline)
    )
  then
    v_fail := v_fail || 'unresolved was treated as overdue; ';
  end if;

  v_plan := (select id from public.payment_plans where pi_id = v_overdue);
  v_receipt := (public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(),
    'amount', '100.00',
    'received_on', v_today - 10,
    'method', 'bank_transfer',
    'allocations', jsonb_build_array(jsonb_build_object(
      'obligation_id', (select id from public.payment_obligations where plan_id = v_plan),
      'amount', '100.00'
    ))
  )) ->> 'receipt_id')::uuid;
  v_summary := public.collection_summary('last_7', null, null, null);
  v_register := public.payment_register('overdue', null, 'EUR', null, null, null, null, null, null, null, 20, 0);
  v_again := public.payment_register('paid', null, 'EUR', null, null, null, null, null, null, null, 20, 0);
  if v_summary #>> '{currencies,2,overdue}' is distinct from '0.00'
    or v_summary #>> '{currencies,2,outstanding}' is distinct from '192.00'
    or v_summary #>> '{currencies,2,due_1_7}' is distinct from '25.00'
    or (v_summary #>> '{currencies,2,plan_count}')::integer is distinct from 8
    or v_summary #>> '{currencies,2,received}' is distinct from '0.00'
    or (v_register ->> 'count')::integer is distinct from 0
    or (v_again ->> 'count')::integer is distinct from 1
    or (v_again #>> '{rows,0,collection_status}') is distinct from 'paid'
    or (v_again #>> '{rows,0,due_state}') is distinct from 'settled'
  then
    v_fail := v_fail || 'paid past obligation stayed overdue ' || v_summary::text || ' ' || v_again::text || '; ';
  end if;
  v_summary := public.collection_summary('custom', v_today - 10, v_today - 10, null);
  if v_summary #>> '{currencies,2,received}' is distinct from '100.00' then
    v_fail := v_fail || 'received_on was ignored ' || v_summary::text || '; ';
  end if;

  -- USD receipts: one receipt split across two obligations counts once.
  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'label', 'Part A',
        'amount', jsonb_build_object('type', 'percent', 'percent', '60'),
        'due', jsonb_build_object('type', 'date', 'date', to_char(v_today - 2, 'YYYY-MM-DD')),
        'instalments', null
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'label', 'Part B',
        'amount', jsonb_build_object('type', 'percent', 'percent', '40'),
        'due', jsonb_build_object('type', 'date', 'date', to_char(v_today - 2, 'YYYY-MM-DD')),
        'instalments', null
      )
    )
  );
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '100.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_today - 400, v_admin, null, v_client_secret, v_lines, v_schedule, true);
  v_receipt_pi := (v_made ->> 'pi_id')::uuid;
  v_plan := (public.start_payment_tracking(v_receipt_pi, (v_made ->> 'version_id')::uuid, true) ->> 'plan_id')::uuid;
  insert into expected_pi values (v_receipt_pi, 'USD', v_today - 400, 100, 'issued', v_admin, true, true);
  select id into v_left from public.payment_obligations where plan_id = v_plan and label = 'Part A';
  select id into v_right from public.payment_obligations where plan_id = v_plan and label = 'Part B';
  v_receipt := (public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '30.00', 'received_on', v_today, 'method', 'cash',
    'allocations', jsonb_build_array(
      jsonb_build_object('obligation_id', v_left, 'amount', '20.00'),
      jsonb_build_object('obligation_id', v_right, 'amount', '10.00')
    )
  )) ->> 'receipt_id')::uuid;
  perform public.record_payment_receipt(v_plan, jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'amount', '15.00', 'received_on', v_today - 40, 'method', 'cheque',
    'allocations', jsonb_build_array(jsonb_build_object('obligation_id', v_left, 'amount', '15.00'))
  ));
  v_summary := public.collection_summary('last_7', null, null, null);
  if v_summary #>> '{currencies,1,received}' is distinct from '30.00' then
    v_fail := v_fail || 'split receipt counted more than once or used the wrong date ' || v_summary::text || '; ';
  end if;
  v_summary := public.collection_summary('custom', v_today - 40, v_today - 40, null);
  if v_summary #>> '{currencies,1,received}' is distinct from '15.00' then
    v_fail := v_fail || 'old received_on missing ' || v_summary::text || '; ';
  end if;
  if (select outstanding_amount from public.payment_obligation_balances where id = v_left) is distinct from 25.00
    or (select outstanding_amount from public.payment_obligation_balances where id = v_right) is distinct from 30.00
  then
    v_fail := v_fail || 'partial receipt did not reduce both balances; ';
  end if;
  perform public.reverse_payment_receipt(v_receipt, 'Recorded against the wrong invoice');
  v_summary := public.collection_summary('last_7', null, null, null);
  if v_summary #>> '{currencies,1,received}' is distinct from '0.00'
    or (select outstanding_amount from public.payment_obligation_balances where id = v_left) is distinct from 45.00
    or (select outstanding_amount from public.payment_obligation_balances where id = v_right) is distinct from 40.00
  then
    v_fail := v_fail || 'reversal was still received or the balance was not restored; ';
  end if;

  -- Instalments stay separate. A later issued revision does not retarget the plan.
  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'label', 'Balance',
      'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
      'due', jsonb_build_object('type', 'unset'),
      'instalments', jsonb_build_object(
        'count', 2, 'frequency', 'monthly',
        'first', jsonb_build_object('type', 'date', 'date', to_char(v_today + 40, 'YYYY-MM-DD'))
      )
    ))
  );
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '200.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_today, v_admin, null, v_client_secret, v_lines, v_schedule, true);
  v_instalment := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_instalment, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_instalment, 'USD', v_today, 200, 'issued', v_admin, true, true);
  v_register := public.payment_register('all', null, 'USD', null, null, null, null, null, null, null, 50, 0);
  select count(*) into v_count from jsonb_array_elements(v_register -> 'rows') item where (item ->> 'pi_id')::uuid = v_instalment;
  select coalesce(sum((item ->> 'outstanding_amount')::numeric), 0) into v_amount
  from jsonb_array_elements(v_register -> 'rows') item where (item ->> 'pi_id')::uuid = v_instalment;
  if v_count is distinct from 2 or v_amount is distinct from 200.00
    or (select count(distinct item ->> 'id') from jsonb_array_elements(v_register -> 'rows') item where (item ->> 'pi_id')::uuid = v_instalment) is distinct from 2
    or (select count(*) from jsonb_array_elements(v_register -> 'rows') item where (item ->> 'pi_id')::uuid = v_instalment and item ->> 'kind' = 'instalment') is distinct from 2
  then
    v_fail := v_fail || 'instalments were merged ' || v_count::text || ' ' || v_amount::text || '; ';
  end if;

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '1000.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Pinned', v_today + 3), true);
  v_pin := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_pin, (v_made ->> 'version_id')::uuid, true);
  v_count := public.create_pi_revision(v_pin);
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '1800.00', 'unit');
  v_row := v_made -> 'payload';
  v_row := jsonb_set(v_row, '{lines}', v_lines);
  perform public.save_pi_draft(v_pin, v_count, v_row);
  perform public.generate_pi(v_pin, (select draft_version from public.proforma_invoices where id = v_pin), v_row);
  insert into expected_pi values (v_pin, 'USD', v_today, 1800, 'issued', v_admin, true, true);
  v_register := public.payment_register('all', (select pi_number from public.proforma_invoices where id = v_pin), null, null, null, null, null, null, null, null, 20, 0);
  if (v_register ->> 'count')::integer is distinct from 1
    or v_register #>> '{rows,0,outstanding_amount}' is distinct from '1000.00'
    or v_register #>> '{rows,0,original_amount}' is distinct from '1000.00'
    or (v_register #>> '{rows,0,tracked_revision}')::integer is distinct from 0
    or (v_register #>> '{rows,0,latest_revision}')::integer is distinct from 1
    or (v_register #>> '{rows,0,revision_differs}')::boolean is distinct from true
    or (select agreed_total from public.payment_plans where pi_id = v_pin) is distinct from 1000.00
  then
    v_fail := v_fail || 'revision retargeted the plan ' || v_register::text || '; ';
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'Machine',
      'unit', 'unit', 'quantity', '1', 'unit_price', '200.00', 'subscription', null
    ),
    jsonb_build_object(
      'product_id', v_sub_product, 'vendor_id', v_vendor, 'model_code', v_sub_model, 'description', 'Plan',
      'unit', 'license', 'quantity', '1', 'unit_price', '100.00',
      'subscription', jsonb_build_object(
        'option_id', v_sub_option, 'obligation_id', gen_random_uuid(),
        'negotiated_first_year_unit_price', '100.00', 'later_year_base_unit_price', '80.00'
      )
    )
  );
  v_schedule := jsonb_build_object(
    'schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'label', 'Machine',
      'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
      'due', jsonb_build_object('type', 'date', 'date', to_char(v_today + 12, 'YYYY-MM-DD')),
      'instalments', null
    ))
  );
  v_made := pg_temp.make_pi('AE-USD', v_today, v_admin, null, v_client_secret, v_lines, v_schedule, true);
  v_sub_pi := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_sub_pi, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_sub_pi, 'USD', v_today, (v_made ->> 'total')::numeric, 'issued', v_admin, true, true);
  if (select count(*) from public.payment_obligations where plan_id = (select id from public.payment_plans where pi_id = v_sub_pi)) is distinct from 2
    or (select count(*) from public.payment_obligations where plan_id = (select id from public.payment_plans where pi_id = v_sub_pi) and kind = 'subscription_advance') is distinct from 1
    or (select amount from public.payment_obligations where plan_id = (select id from public.payment_plans where pi_id = v_sub_pi) and kind = 'subscription_advance') is distinct from 100.00
    or exists (
      select 1 from public.payment_obligations
      where plan_id = (select id from public.payment_plans where pi_id = v_sub_pi) and amount = 80.00
    )
  then
    v_fail := v_fail || 'future subscription years became receivables; ';
  end if;

  v_lines := jsonb_build_array(jsonb_build_object(
    'product_id', v_zero_product, 'vendor_id', v_vendor, 'model_code', v_zero_model, 'description', 'Free plan',
    'unit', 'license', 'quantity', '1', 'unit_price', '0.00',
    'subscription', jsonb_build_object(
      'option_id', v_zero_option, 'obligation_id', gen_random_uuid(),
      'negotiated_first_year_unit_price', '0.00', 'later_year_base_unit_price', null
    )
  ));
  v_schedule := jsonb_build_object(
    'schema_version', 2, 'no_payment_due', true, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb
  );
  v_made := pg_temp.make_pi('AE-USD', v_today, v_admin, null, v_client_secret, v_lines, v_schedule, true);
  v_zero_pi := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_zero_pi, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_zero_pi, 'USD', v_today, 0, 'issued', v_admin, true, true);
  v_register := public.payment_register('outstanding', (select pi_number from public.proforma_invoices where id = v_zero_pi), null, null, null, null, null, null, null, null, 20, 0);
  v_again := public.payment_register('all', (select pi_number from public.proforma_invoices where id = v_zero_pi), null, null, null, null, null, null, null, null, 20, 0);
  if (v_register ->> 'count')::integer is distinct from 0
    or (v_again ->> 'count')::integer is distinct from 1
    or v_again #>> '{rows,0,collection_status}' is distinct from 'no_charge'
    or v_again #>> '{rows,0,outstanding_amount}' is distinct from '0.00'
  then
    v_fail := v_fail || 'zero obligation was treated as money due ' || v_again::text || '; ';
  end if;

  -- EGP documents: one issued total, an open revision, a draft, a duplicate, a cancelled PI, and an old balance.
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '1000.00', 'unit');
  v_made := pg_temp.make_pi('EG-EGP', v_today, v_admin, v_reader, v_client_secret, v_lines, pg_temp.dated('Quoted', v_today + 4), true);
  v_issued := (v_made ->> 'pi_id')::uuid;
  v_duplicate := public.duplicate_pi(v_issued);
  v_count := public.create_pi_revision(v_issued);
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '1500.00', 'unit');
  v_row := v_made -> 'payload';
  v_row := jsonb_set(v_row, '{lines}', v_lines);
  perform public.save_pi_draft(v_issued, v_count, v_row);
  insert into expected_pi values (v_issued, 'EGP', v_today, 1000, 'issued', v_admin, false, true);
  insert into expected_pi values (v_duplicate, 'EGP', (select pi_date from public.proforma_invoices where id = v_duplicate), (select grand_total from public.proforma_invoices where id = v_duplicate), 'draft', v_admin, false, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '200.00', 'unit');
  v_made := pg_temp.make_pi('EG-EGP', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Draft', v_today + 4), false);
  v_draft := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_draft, 'EGP', v_today, 200, 'draft', v_admin, false, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '5000.00', 'unit');
  v_made := pg_temp.make_pi('EG-EGP', v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Cancel', v_today + 4), true);
  v_cancelled := (v_made ->> 'pi_id')::uuid;
  perform public.set_pi_tracking_status(v_cancelled, 'cancelled');

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '80.00', 'unit');
  v_made := pg_temp.make_pi('EG-EGP', v_today - 400, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Old', v_today - 3), true);
  v_old := (v_made ->> 'pi_id')::uuid;
  perform public.start_payment_tracking(v_old, (v_made ->> 'version_id')::uuid, true);
  insert into expected_pi values (v_old, 'EGP', v_today - 400, 80, 'issued', v_admin, true, true);

  v_preset := public.create_company_preset(jsonb_build_object(
    'display_name', 'Archive Office ' || v_tag,
    'office', 'QA',
    'currency', 'EGP',
    'layout', 'egypt',
    'new_prefix', 'Q' || upper(left(v_tag, 3)),
    'company_name', 'Archive Co',
    'address', 'Archive address',
    'bank_name', 'Archive Bank',
    'account_name', 'Archive Account',
    'account_number', '100',
    'iban', 'EG000' || v_tag,
    'bank_swift', 'ARCHEGCX'
  ));
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '40.00', 'unit');
  v_made := pg_temp.make_pi(v_preset.code, v_today, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Archive', v_today + 9), true);
  v_archived_pi := (v_made ->> 'pi_id')::uuid;
  update public.company_presets set archived_at = now(), display_name = 'Archive Office ' || v_tag where code = v_preset.code;
  insert into expected_pi values (v_archived_pi, 'EGP', v_today, 40, 'issued', v_admin, false, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '70.00', 'unit');
  v_made := pg_temp.make_pi('EG-EGP', v_today, v_associated, null, v_client_mine, v_lines, pg_temp.dated('Mine', v_today + 2), true);
  v_mine := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_mine, 'EGP', v_today, 70, 'issued', v_associated, false, false);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '5.00', 'unit');
  v_made := pg_temp.make_pi('EG-EGP', v_today, v_former, null, v_client_secret, v_lines, pg_temp.dated('Former', v_today + 2), true);
  v_former_pi := (v_made ->> 'pi_id')::uuid;
  update public.profiles set is_active = false where id = v_former;
  insert into expected_pi values (v_former_pi, 'EGP', v_today, 5, 'issued', v_former, false, true);

  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '11.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_today - 6, v_admin, null, v_client_secret, v_lines, pg_temp.dated('In7', v_today + 2), true);
  v_date_in := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_date_in, 'USD', v_today - 6, 11, 'issued', v_admin, false, true);
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '13.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_today - 7, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Out7', v_today + 2), true);
  v_date_out := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_date_out, 'USD', v_today - 7, 13, 'issued', v_admin, false, true);
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '17.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_today - 29, v_admin, null, v_client_secret, v_lines, pg_temp.dated('In30', v_today + 2), true);
  v_date_30 := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_date_30, 'USD', v_today - 29, 17, 'issued', v_admin, false, true);
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '19.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_today - 30, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Out30', v_today + 2), true);
  v_date_31 := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_date_31, 'USD', v_today - 30, 19, 'issued', v_admin, false, true);
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '23.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_month, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Month', v_today + 2), true);
  v_month_in := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_month_in, 'USD', v_month, 23, 'issued', v_admin, false, true);
  v_lines := pg_temp.one_line(v_product, v_vendor, v_model, '29.00', 'unit');
  v_made := pg_temp.make_pi('AE-USD', v_month - 1, v_admin, null, v_client_secret, v_lines, pg_temp.dated('Before month', v_today + 2), true);
  v_month_out := (v_made ->> 'pi_id')::uuid;
  insert into expected_pi values (v_month_out, 'USD', v_month - 1, 29, 'issued', v_admin, false, true);

  v_report := public.active_pi_report('all', null, null, null, null, 'EGP', null, null, 100, 0, 'active');
  v_again := public.active_pi_report('last_7', null, null, null, null, 'EGP', null, null, 100, 0, 'active');
  if v_report::text not like '%' || v_old::text || '%' or v_again::text like '%' || v_old::text || '%' then
    v_fail := v_fail || 'old unpaid PI did not stay out of the recent PI date filter; ';
  end if;
  perform public.set_pi_tracking_status(v_old, 'cancelled');
  delete from expected_pi where id = v_old;

  v_report := public.active_pi_report('all', null, null, null, null, 'EGP', null, null, 100, 0, 'active');
  select coalesce(array_agg(id order by id), '{}') into v_ids from expected_pi where currency = 'EGP';
  select coalesce(array_agg((item ->> 'id')::uuid order by (item ->> 'id')::uuid), '{}') into v_page_ids
  from jsonb_array_elements(v_report -> 'rows') item;
  if v_ids is distinct from v_page_ids or (v_report ->> 'count')::integer is distinct from cardinality(v_ids) then
    v_fail := v_fail || 'active EGP set ' || coalesce(v_report ->> 'count', '') || '; ';
  end if;
  if v_report::text like '%' || v_cancelled::text || '%' then
    v_fail := v_fail || 'cancelled PI remained active; ';
  end if;
  select coalesce(sum(amount) filter (where kind = 'issued'), 0) into v_amount from expected_pi where currency = 'EGP';
  select item ->> 'issued' into v_text from jsonb_array_elements(v_report -> 'totals') item where item ->> 'currency' = 'EGP';
  if v_text is distinct from private.payment_plain_amount(v_amount) then
    v_fail := v_fail || 'EGP issued quoted total ' || coalesce(v_text, '') || '; ';
  end if;
  select coalesce(sum(amount) filter (where kind = 'draft'), 0) into v_amount from expected_pi where currency = 'EGP';
  select item ->> 'draft' into v_text from jsonb_array_elements(v_report -> 'totals') item where item ->> 'currency' = 'EGP';
  if v_text is distinct from private.payment_plain_amount(v_amount) then
    v_fail := v_fail || 'EGP draft total ' || coalesce(v_text, '') || '; ';
  end if;
  v_again := public.active_pi_report('all', null, null, null, null, 'EGP', null, null, 1, 0, 'active');
  if v_report -> 'status_counts' is null
    or v_again -> 'status_counts' is distinct from v_report -> 'status_counts'
    or (v_again ->> 'count')::integer is distinct from (v_report ->> 'count')::integer
    or (v_report #>> '{status_counts,draft}')::integer is distinct from (select count(*) from expected_pi where currency = 'EGP' and kind = 'draft')
    or (v_report #>> '{status_counts,issued}')::integer is distinct from (select count(*) from expected_pi where currency = 'EGP' and kind = 'issued')
    or (v_report #>> '{status_counts,sent}')::integer is distinct from 0
    or (v_report #>> '{status_counts,accepted}')::integer is distinct from 0
    or (
      (v_report #>> '{status_counts,draft}')::integer
      + (v_report #>> '{status_counts,issued}')::integer
      + (v_report #>> '{status_counts,sent}')::integer
      + (v_report #>> '{status_counts,accepted}')::integer
    ) is distinct from (v_report ->> 'count')::integer
    or v_report::text like '%' || v_cancelled::text || '%'
  then
    v_fail := v_fail || 'status counts followed the page or dropped a PI ' || coalesce((v_report -> 'status_counts')::text, '') || '; ';
  end if;
  select item into v_row from jsonb_array_elements(v_report -> 'rows') item where (item ->> 'id')::uuid = v_issued;
  if v_row ->> 'total' is distinct from '1000.00'
    or v_row ->> 'amount_kind' is distinct from 'issued'
    or (v_row ->> 'revision_draft_open')::boolean is distinct from true
    or (select grand_total from public.proforma_invoices where id = v_issued) is distinct from 1500.00
  then
    v_fail := v_fail || 'open revision replaced the issued total ' || coalesce(v_row::text, '') || '; ';
  end if;
  select item into v_row from jsonb_array_elements(v_report -> 'rows') item where (item ->> 'id')::uuid = v_draft;
  if v_row ->> 'amount_kind' is distinct from 'draft' or v_row ->> 'display_number' is distinct from 'Draft' or v_row ->> 'total' is distinct from '200.00' then
    v_fail := v_fail || 'draft total was not separate ' || coalesce(v_row::text, '') || '; ';
  end if;
  if v_duplicate = v_issued
    or not exists (select 1 from jsonb_array_elements(v_report -> 'rows') item where (item ->> 'id')::uuid = v_duplicate and item ->> 'amount_kind' = 'draft')
  then
    v_fail := v_fail || 'duplicate was not a separate document; ';
  end if;
  select item into v_row from jsonb_array_elements(v_report -> 'rows') item where (item ->> 'id')::uuid = v_archived_pi;
  if v_row ->> 'preset_display_name' is distinct from 'Archive Office ' || v_tag
    or (v_row ->> 'preset_archived')::boolean is distinct from true
  then
    v_fail := v_fail || 'archived preset was not readable ' || coalesce(v_row::text, '') || '; ';
  end if;
  select item into v_row from jsonb_array_elements(v_report -> 'rows') item where (item ->> 'id')::uuid = v_former_pi;
  if v_row ->> 'lead_name' is distinct from 'Report Former' or (v_row ->> 'lead_active')::boolean is distinct from false then
    v_fail := v_fail || 'inactive lead disappeared ' || coalesce(v_row::text, '') || '; ';
  end if;

  v_report := public.active_pi_report('all', null, null, null, null, 'EGP', v_admin, null, 100, 0, 'active');
  if (v_report ->> 'count')::integer is distinct from (select count(*) from expected_pi where currency = 'EGP' and lead_id = v_admin)
    or exists (select 1 from jsonb_array_elements(v_report -> 'rows') item where (item ->> 'id')::uuid = v_mine)
  then
    v_fail := v_fail || 'lead filter multiplied or included another lead; ';
  end if;
  select coalesce(sum(amount) filter (where kind = 'issued'), 0) into v_amount
  from expected_pi where currency = 'EGP' and lead_id = v_admin;
  select item ->> 'issued' into v_text from jsonb_array_elements(v_report -> 'totals') item where item ->> 'currency' = 'EGP';
  if v_text is distinct from private.payment_plain_amount(v_amount) then
    v_fail := v_fail || 'lead filter total ' || coalesce(v_text, '') || '; ';
  end if;
  v_report := public.active_pi_report('all', null, null, null, null, 'EGP', v_reader, null, 100, 0, 'active');
  if (v_report ->> 'count')::integer is distinct from 0 then
    v_fail := v_fail || 'additional salesperson was treated as the lead; ';
  end if;

  v_report := public.active_pi_report('last_7', null, null, null, null, 'USD', null, null, 100, 0, 'active');
  if v_report::text not like '%' || v_date_in::text || '%' or v_report::text like '%' || v_date_out::text || '%' then
    v_fail := v_fail || 'last 7 boundary; ';
  end if;
  v_report := public.active_pi_report('last_30', null, null, null, null, 'USD', null, null, 100, 0, 'active');
  if v_report::text not like '%' || v_date_30::text || '%' or v_report::text like '%' || v_date_31::text || '%' then
    v_fail := v_fail || 'last 30 boundary; ';
  end if;
  v_report := public.active_pi_report('this_month', null, null, null, null, 'USD', null, null, 100, 0, 'active');
  if v_report::text not like '%' || v_month_in::text || '%' or v_report::text like '%' || v_month_out::text || '%' then
    v_fail := v_fail || 'this month boundary; ';
  end if;
  v_report := public.active_pi_report('last_7', null, null, null, null, 'EGP', null, null, 100, 0, 'active');
  if v_report::text like '%' || v_old::text || '%' then
    v_fail := v_fail || 'old PI followed the recent PI date filter; ';
  end if;

  v_summary := public.collection_summary('last_7', null, null, null);
  if v_summary #>> '{currencies,0,outstanding}' is distinct from '80.00'
    or v_summary #>> '{currencies,0,overdue}' is distinct from '80.00'
  then
    v_fail := v_fail || 'old unpaid balance followed the PI date or a cancellation ' || v_summary::text || '; ';
  end if;
  v_summary := public.collection_summary('last_7', null, null, 'cancelled');
  if v_summary #>> '{currencies,0,outstanding}' is distinct from '80.00' then
    v_fail := v_fail || 'cancelled parent was hidden ' || v_summary::text || '; ';
  end if;
  v_summary := public.collection_summary('last_7', null, null, 'issued');
  if v_summary #>> '{currencies,0,outstanding}' is distinct from '0.00' then
    v_fail := v_fail || 'parent status filter did not apply ' || v_summary::text || '; ';
  end if;

  v_report := public.active_pi_report('all', null, null, null, null, null, null, null, 100, 0, 'untracked');
  v_summary := public.collection_summary('last_7', null, null, null);
  if (v_report ->> 'count')::integer is distinct from (v_summary ->> 'untracked_count')::integer
    or v_report::text not like '%' || v_archived_pi::text || '%'
    or v_report::text like '%' || v_old::text || '%'
    or v_report::text like '%' || v_draft::text || '%'
    or v_report::text like '%' || v_cancelled::text || '%'
    or v_summary #>> '{currencies,0,outstanding}' is distinct from '80.00'
  then
    v_fail := v_fail || 'untracked coverage invented a balance or dropped a PI ' || coalesce(v_summary ->> 'untracked_count', '') || '; ';
  end if;

  v_register := public.payment_register('outstanding', null, 'EUR', null, null, null, null, null, null, null, 1, 0);
  if (v_register ->> 'count')::integer <= 1
    or (v_register #>> '{totals,0,outstanding}')::numeric is distinct from (
      select coalesce(sum(outstanding_amount), 0)
      from public.payment_obligation_balances b
      join public.payment_plans p on p.id = b.plan_id
      where p.currency = 'EUR' and b.outstanding_amount > 0
    )
  then
    v_fail := v_fail || 'page total did not cover the full EUR set ' || v_register::text || '; ';
  end if;
  v_register := public.payment_register('outstanding', null, 'EUR', null, null, null, null, null, null, null, 3, 0);
  v_again := public.payment_register('outstanding', null, 'EUR', null, null, null, null, null, null, null, 3, 3);
  select coalesce(array_agg(item ->> 'id' order by item ->> 'id'), '{}') into v_page_ids
  from jsonb_array_elements(v_register -> 'rows') item;
  select coalesce(array_agg(item ->> 'id' order by item ->> 'id'), '{}') into v_next_ids
  from jsonb_array_elements(v_again -> 'rows') item;
  if cardinality(v_page_ids) is distinct from 3
    or v_page_ids && v_next_ids
    or v_register -> 'rows' is distinct from public.payment_register('outstanding', null, 'EUR', null, null, null, null, null, null, null, 3, 0) -> 'rows'
  then
    v_fail := v_fail || 'pagination skipped or repeated rows; ';
  end if;
  v_register := public.payment_register('outstanding', null, null, null, null, null, null, null, null, null, 5, 0);
  if (v_register #>> '{rows,0,due_state}') is distinct from 'overdue' then
    v_fail := v_fail || 'outstanding sort did not put overdue first ' || coalesce(v_register #>> '{rows,0,due_state}', '') || '; ';
  end if;
  if v_register #>> '{rows,0,due_state}' is distinct from 'overdue'
    and exists (
      select 1 from jsonb_array_elements(v_register -> 'rows') item
      where item ->> 'due_state' = 'overdue'
    )
  then
    v_fail := v_fail || 'overdue was not first; ';
  end if;

  v_report := public.active_pi_report('all', null, null, null, null, null, null, '%', 20, 0, 'active');
  if (v_report ->> 'count')::integer is distinct from 0 then
    v_fail := v_fail || 'search wildcard was not escaped; ';
  end if;
  v_report := public.active_pi_report('all', null, null, null, null, null, null, 'Report Secret ' || v_tag, 100, 0, 'active');
  if (v_report ->> 'count')::integer < 1 or v_report::text not like '%Report Secret ' || v_tag || '%' then
    v_fail := v_fail || 'admin search missed a visible client; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_reader::text, 'role', 'authenticated')::text, true);
  v_register := public.payment_register('outstanding', null, null, null, null, null, null, null, null, null, 20, 0);
  if coalesce((v_register ->> 'count')::integer, 0) < 1 then
    v_fail := v_fail || 'all-visibility reader saw no payments; ';
  end if;
  begin
    perform public.record_payment_receipt((select id from public.payment_plans limit 1), jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '1.00', 'received_on', v_today, 'method', 'cash',
      'allocations', '[]'::jsonb
    ));
    v_fail := v_fail || 'reading payments granted payment write; ';
  exception when others then
    if sqlerrm not like '%permission to record payments%' then
      v_fail := v_fail || 'reader write ' || sqlerrm || '; ';
    end if;
  end;
  if (select can_manage_payments from public.profiles where id = v_reader) then
    v_fail := v_fail || 'reader flag was changed; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_associated::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_associated::text, 'role', 'authenticated')::text, true);
  v_report := public.active_pi_report('all', null, null, null, null, null, null, null, 100, 0, 'active');
  v_summary := public.collection_summary('last_7', null, null, null);
  v_register := public.payment_register('all', null, null, null, null, null, null, null, null, null, 50, 0);
  if (v_report ->> 'count')::integer is distinct from 1
    or v_report #>> '{rows,0,id}' is distinct from v_mine::text
    or v_report::text like '%Report Secret ' || v_tag || '%'
    or v_summary::text like '%Report Secret ' || v_tag || '%'
    or v_register::text like '%Report Secret ' || v_tag || '%'
    or v_summary #>> '{currencies,0,outstanding}' is distinct from '0.00'
    or v_summary #>> '{currencies,2,outstanding}' is distinct from '0.00'
    or (v_summary #>> '{currencies,0,plan_count}')::integer is distinct from 0
    or (v_summary #>> '{currencies,1,plan_count}')::integer is distinct from 0
    or (v_summary #>> '{currencies,2,plan_count}')::integer is distinct from 0
    or (v_report #>> '{status_counts,issued}')::integer is distinct from 1
    or (v_report #>> '{status_counts,draft}')::integer is distinct from 0
    or (v_summary ->> 'untracked_count')::integer is distinct from 1
  then
    v_fail := v_fail || 'associated user saw another PI ' || coalesce(v_report ->> 'count', '') || '; ';
  end if;

  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  v_report := public.active_pi_report('all', null, null, null, null, null, null, null, 20, 0, 'active');
  v_summary := public.collection_summary('last_7', null, null, null);
  v_register := public.payment_register('all', null, null, null, null, null, null, null, null, null, 20, 0);
  if (v_report ->> 'count')::integer is distinct from 0
    or (v_register ->> 'count')::integer is distinct from 0
    or (v_summary ->> 'untracked_count')::integer is distinct from 0
    or (v_summary #>> '{currencies,0,plan_count}')::integer is distinct from 0
    or (v_summary #>> '{currencies,2,plan_count}')::integer is distinct from 0
    or (v_report #>> '{status_counts,issued}')::integer is distinct from 0
    or v_summary #>> '{currencies,0,outstanding}' is distinct from '0.00'
    or v_report::text like '%Report Secret%'
    or v_report::text like '%Report Mine%'
    or v_register::text like '%Report Secret%'
  then
    v_fail := v_fail || 'unrelated user saw PI data; ';
  end if;
  begin
    perform public.record_payment_receipt((select id from public.payment_plans limit 1), jsonb_build_object(
      'idempotency_key', gen_random_uuid(), 'amount', '1.00', 'received_on', v_today, 'method', 'cash', 'allocations', '[]'::jsonb
    ));
    v_fail := v_fail || 'unrelated payment flag bypassed PI visibility; ';
  exception when others then
    if sqlerrm not like '%do not have access%' and sqlerrm not like '%permission to record payments%' and sqlerrm not like '%Sign in required%' then
      v_fail := v_fail || 'unrelated write ' || sqlerrm || '; ';
    end if;
  end;

  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_inactive::text, 'role', 'authenticated')::text, true);
  begin
    perform public.active_pi_report('all', null, null, null, null, null, null, null, 20, 0, 'active');
    v_fail := v_fail || 'inactive read active PIs; ';
  exception when others then
    if sqlerrm not like '%Sign in required%' then v_fail := v_fail || 'inactive active ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.collection_summary('last_7', null, null, null);
    v_fail := v_fail || 'inactive read collections; ';
  exception when others then
    if sqlerrm not like '%Sign in required%' then v_fail := v_fail || 'inactive summary ' || sqlerrm || '; '; end if;
  end;
  begin
    perform public.payment_register('all', null, null, null, null, null, null, null, null, null, 20, 0);
    v_fail := v_fail || 'inactive read payments; ';
  exception when others then
    if sqlerrm not like '%Sign in required%' then v_fail := v_fail || 'inactive register ' || sqlerrm || '; '; end if;
  end;

  begin
    execute 'set local role anon';
    perform public.payment_register('all', null, null, null, null, null, null, null, null, null, 20, 0);
    v_fail := v_fail || 'anonymous read payments; ';
  exception when insufficient_privilege then
    null;
  when others then
    v_fail := v_fail || 'anon ' || sqlerrm || '; ';
  end;
  execute 'reset role';

  if v_fail <> '' then
    raise exception 'DASHBOARD_PAYMENTS_FAIL %', v_fail;
  end if;
  raise exception 'DASHBOARD_PAYMENTS_OK';
end
$test$;
