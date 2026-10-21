-- Rolled-back checks for subscription commitments and allocation-aware payments.
-- Run with a privileged session after 20261021193000_subscription_commitments.sql.
-- The block always raises, including on success, so none of its rows are committed.

do $test$
declare
  v_fail text := '';
  v_result jsonb;
  v_text text;
  v_instance uuid;
  v_manager uuid := gen_random_uuid();
  v_editor uuid := gen_random_uuid();
  v_client uuid;
  v_vendor uuid;
  v_machine uuid;
  v_plan uuid;
  v_other uuid;
  v_one uuid;
  v_three uuid;
  v_pi uuid;
  v_duplicate uuid;
  v_expected integer;
  v_payload jsonb;
  v_schedule jsonb;
  v_before jsonb;
  v_snapshot jsonb;
  v_original jsonb;
  v_obligation uuid := '11111111-1111-4111-8111-111111111111';
  v_model_machine text := 'zz-sub-machine-' || left(gen_random_uuid()::text, 8);
  v_model_plan text := 'zz-sub-plan-' || left(gen_random_uuid()::text, 8);
  v_model_other text := 'zz-sub-other-' || left(gen_random_uuid()::text, 8);
  v_shares numeric[];
begin
  if to_regclass('public.subscriptions') is not null
    or to_regclass('public.subscription_periods') is not null
  then
    v_fail := v_fail || 'operational subscription table exists; ';
  end if;

  if private.commitment_customer_text('USD', 1, 2200, null, null)
    <> 'One-year commitment. Year 1: USD 2,200.00 per unit. This charge is payable 100% in advance and is included in this PI total.'
  then
    v_fail := v_fail || 'one-year wording; ';
  end if;
  v_text := private.commitment_customer_text('USD', 3, 1950, 'vendor_confirmed_base_adjustment', 1950);
  if v_text <> 'Three-year commitment. Year 1: USD 1,950.00 per unit. Years 2 and 3: USD 1,950.00 per unit plus the applicable vendor-confirmed CPI adjustment for each year. Each annual adjustment is applied independently to the USD 1,950.00 base. Each year is payable 100% in advance. Only Year 1 is included in this PI total.'
    or v_text like '%currently due%'
  then
    v_fail := v_fail || 'three-year wording ' || v_text || '; ';
  end if;
  if private.commitment_customer_text('USD', 3, 1800, 'vendor_confirmed_base_adjustment', 1950) not like '%Year 1: USD 1,800.00%'
    or private.commitment_customer_text('USD', 3, 1800, 'vendor_confirmed_base_adjustment', 1950) not like '%USD 1,950.00 base%'
  then
    v_fail := v_fail || 'negotiated wording kept the later base; ';
  end if;

  v_shares := private.apportion_money(0.01, array[1, 1]::numeric[], true);
  if v_shares[1] <> 0 or v_shares[2] <> 0.01 then
    v_fail := v_fail || 'one-cent apportion ' || v_shares::text || '; ';
  end if;

  begin
    perform private.canonical_payment(jsonb_build_object(
      'schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'rows', '[]'::jsonb
    ), 'USD', 100);
    v_fail := v_fail || 'version 2 was read as a grand-total schedule; ';
  exception when others then
    if sqlerrm not like '%cannot be calculated as a percentage of the grand total%' then
      v_fail := v_fail || 'version 2 guard ' || sqlerrm || '; ';
    end if;
  end;
  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a1', 'label', 'advance payment', 'amount', jsonb_build_object('type', 'percent', 'percent', '30'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a2', 'label', 'before shipment', 'amount', jsonb_build_object('type', 'percent', 'percent', '70'), 'due', jsonb_build_object('type', 'before_shipment', 'deadline', null), 'instalments', null)
    )
  ), 'USD', 11950);
  if v_result #>> '{rows,0,amount}' <> '3585.00' or v_result #>> '{rows,1,amount}' <> '8365.00' or v_result ->> 'schema_version' <> '1' then
    v_fail := v_fail || 'version 1 meaning changed ' || coalesce(v_result::text, '') || '; ';
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
    (v_instance, v_manager, 'authenticated', 'authenticated', 'sub-manager-' || v_manager::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_manager::text, 'r-' || v_manager::text, 'n-' || v_manager::text, ''),
    (v_instance, v_editor, 'authenticated', 'authenticated', 'sub-editor-' || v_editor::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_editor::text, 'r-' || v_editor::text, 'n-' || v_editor::text, '');
  update public.profiles
  set is_active = true, is_salesperson = true, pi_visibility = 'all', can_edit_drafts = true, can_generate_pis = true,
      can_manage_products = true, can_view_purchase_prices = true
  where id = v_manager;
  update public.profiles
  set is_active = true, is_salesperson = true, pi_visibility = 'all', can_edit_drafts = true, can_generate_pis = true,
      can_manage_products = false
  where id = v_editor;

  perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  insert into public.clients (company_name, billing_address) values ('Sub Client', 'Sub billing') returning id into v_client;
  insert into public.vendors (company_name) values ('Sub Vendor') returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
  values (v_vendor, v_model_machine, 'Machine', 'unit', 10000, 'one_time')
  returning id into v_machine;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_model_plan, 'Plan', 'license', 'subscription')
  returning id into v_plan;
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_model_other, 'Other plan', 'license', 'subscription')
  returning id into v_other;
  insert into public.product_costs (product_id, purchase_price, purchase_currency)
  values (v_plan, 123456.78, 'USD');

  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price, later_year_base_unit_price, later_year_rule
  ) values (v_plan, 1, 'USD', 2200.00, null, null)
  returning id into v_one;
  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price, later_year_base_unit_price, later_year_rule
  ) values (v_plan, 3, 'USD', 1950.00, 1950.00, 'vendor_confirmed_base_adjustment')
  returning id into v_three;
  if (select count(*) from public.product_commitment_options where product_id = v_plan and currency <> 'USD') <> 0 then
    v_fail := v_fail || 'currency was converted; ';
  end if;
  begin
    insert into public.product_commitment_options (
      product_id, commitment_years, currency, first_year_unit_price, later_year_base_unit_price, later_year_rule
    ) values (v_plan, 3, 'USD', 10, 10, 'fixed_annual');
    v_fail := v_fail || 'duplicate active option inserted; ';
  exception when unique_violation then
    null;
  end;
  begin
    insert into public.product_commitment_options (
      product_id, commitment_years, currency, first_year_unit_price, later_year_base_unit_price, later_year_rule
    ) values (v_plan, 1, 'EUR', 2200, 1, 'fixed_annual');
    v_fail := v_fail || 'one-year later price inserted; ';
  exception when check_violation then
    null;
  end;

  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_editor::text, true);
    insert into public.product_commitment_options (
      product_id, commitment_years, currency, first_year_unit_price
    ) values (v_plan, 1, 'EUR', 10);
    v_fail := v_fail || 'editor without product permission inserted an option; ';
  exception when others then
    if sqlerrm not like '%row-level security%' then
      v_fail := v_fail || 'permission ' || sqlerrm || '; ';
    end if;
  end;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  begin
    execute 'set local role anon';
    perform count(*) from public.product_commitment_options;
    v_fail := v_fail || 'anon read options; ';
  exception when insufficient_privilege then
    null;
  end;

  v_schedule := jsonb_build_object(
    'schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b1', 'label', 'advance payment', 'amount', jsonb_build_object('type', 'percent', 'percent', '30'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b2', 'label', 'before shipment', 'amount', jsonb_build_object('type', 'percent', 'percent', '70'), 'due', jsonb_build_object('type', 'before_shipment', 'deadline', null), 'instalments', null)
    )
  );
  v_pi := public.create_pi_draft();
  v_payload := jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
    'client_id', v_client, 'bill_to', 'Sub billing', 'ship_to', 'Sub billing', 'ship_same_as_billing', true,
    'customer_reference', '', 'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '', 'payment_schedule', v_schedule,
    'delivery_terms', '', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_machine, 'description', 'Machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '10000.00', 'billing_type', 'subscription', 'subscription', null),
      jsonb_build_object(
        'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00',
        'billing_type', 'one_time',
        'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')
      )
    )
  );
  perform public.save_pi_draft(v_pi, 1, v_payload);
  select grand_total::text into v_text from public.proforma_invoices where id = v_pi;
  if v_text <> '11950.00' or (select subtotal::text from public.proforma_invoices where id = v_pi) <> '11950.00' then
    v_fail := v_fail || 'mixed total included future years ' || coalesce(v_text, 'null') || '; ';
  end if;
  select subscription_agreement into v_result from public.pi_lines where pi_id = v_pi and product_id = v_plan;
  if v_result ->> 'catalogue_first_year_unit_price' <> '1950.00'
    or v_result ->> 'negotiated_first_year_unit_price' <> '1950.00'
    or v_result ->> 'later_year_base_unit_price' <> '1950.00'
    or v_result ->> 'later_year_rule' <> 'vendor_confirmed_base_adjustment'
    or v_result ->> 'adjustment_compounds' <> 'false'
    or v_result ->> 'current_year' <> '1'
    or v_result ->> 'obligation_id' <> v_obligation::text
    or (select subscription_agreement from public.pi_lines where pi_id = v_pi and product_id = v_machine) is not null
  then
    v_fail := v_fail || 'saved agreement ' || coalesce(v_result::text, 'null') || '; ';
  end if;

  v_expected := (select draft_version from public.proforma_invoices where id = v_pi);
  v_payload := jsonb_set(v_payload, '{lines,1,unit_price}', '"1800.00"');
  v_payload := jsonb_set(v_payload, '{lines,1,subscription,negotiated_first_year_unit_price}', '"1800.00"');
  perform public.save_pi_draft(v_pi, v_expected, v_payload);
  select subscription_agreement into v_result from public.pi_lines where pi_id = v_pi and product_id = v_plan;
  if v_result ->> 'negotiated_first_year_unit_price' <> '1800.00'
    or v_result ->> 'later_year_base_unit_price' <> '1950.00'
    or v_result ->> 'catalogue_first_year_unit_price' <> '1950.00'
  then
    v_fail := v_fail || 'year 1 edit changed the later base; ';
  end if;

  update public.product_commitment_options
  set first_year_unit_price = 2100, later_year_base_unit_price = 2000
  where id = v_three;
  v_expected := (select draft_version from public.proforma_invoices where id = v_pi);
  perform public.save_pi_draft(v_pi, v_expected, v_payload);
  select subscription_agreement into v_result from public.pi_lines where pi_id = v_pi and product_id = v_plan;
  if v_result ->> 'catalogue_first_year_unit_price' <> '1950.00'
    or v_result ->> 'later_year_base_unit_price' <> '1950.00'
    or v_result ->> 'negotiated_first_year_unit_price' <> '1800.00'
  then
    v_fail := v_fail || 'catalogue change replaced the saved terms; ';
  end if;
  update public.product_commitment_options
  set first_year_unit_price = 1950, later_year_base_unit_price = 1950
  where id = v_three;

  v_before := (select payment_schedule from public.proforma_invoices where id = v_pi);
  v_expected := (select draft_version from public.proforma_invoices where id = v_pi);
  begin
    perform public.save_pi_draft(v_pi, v_expected, v_payload || jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '0', 'unit_price', '1950',
        'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')
      )),
      'payment_schedule', jsonb_build_object('schema_version', 1, 'no_payment_due', false, 'dates_need_review', false, 'rows', '[]'::jsonb)
    ));
    v_fail := v_fail || 'invalid save was kept; ';
  exception when others then
    null;
  end;
  if (select payment_schedule from public.proforma_invoices where id = v_pi) is distinct from v_before
    or (select draft_version from public.proforma_invoices where id = v_pi) <> v_expected
    or (select subscription_agreement ->> 'negotiated_first_year_unit_price' from public.pi_lines where pi_id = v_pi and product_id = v_plan) <> '1800.00'
  then
    v_fail := v_fail || 'failed save was not atomic; ';
  end if;

  begin
    perform public.save_pi_draft(v_pi, v_expected - 1, v_payload);
    v_fail := v_fail || 'stale save succeeded; ';
  exception when others then
    if sqlerrm not like '%someone else%' then
      v_fail := v_fail || 'stale ' || sqlerrm || '; ';
    end if;
  end;

  v_payload := jsonb_set(v_payload, '{lines,1,unit_price}', '"1950.00"');
  v_payload := jsonb_set(v_payload, '{lines,1,subscription,negotiated_first_year_unit_price}', '"1950.00"');
  v_expected := (select draft_version from public.proforma_invoices where id = v_pi);
  begin
    perform public.save_pi_draft(v_pi, v_expected, v_payload || jsonb_build_object('payment_schedule', jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false, 'rows', v_schedule -> 'rows'
    )));
    v_fail := v_fail || 'version 1 accepted a subscription; ';
  exception when others then
    if sqlerrm not like '%whole PI total%' then
      v_fail := v_fail || 'version 1 bypass ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform public.save_pi_draft(v_pi, v_expected, (v_payload - 'payment_schedule') || jsonb_build_object('payment_terms', '100% in advance'));
    v_fail := v_fail || 'omitted schedule accepted a subscription; ';
  exception when others then
    if sqlerrm not like '%Close this editor%' then
      v_fail := v_fail || 'omitted schedule ' || sqlerrm || '; ';
    end if;
  end;
  if (select payment_schedule from public.proforma_invoices where id = v_pi) is distinct from v_before then
    v_fail := v_fail || 'rejected bypass changed the schedule; ';
  end if;

  perform public.save_pi_draft(v_pi, v_expected, v_payload);
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  v_snapshot := v_result -> 'snapshot';
  if v_snapshot ->> 'layout_version' <> 'uae-v3'
    or v_snapshot #>> '{payment,schema_version}' <> '2'
    or v_snapshot #>> '{payment,subscription_total}' <> '1950.00'
    or v_snapshot #>> '{payment,one_time_total}' <> '10000.00'
    or v_snapshot #>> '{payment,grand_total}' <> '11950.00'
    or v_snapshot #>> '{payment,rows,0,amount}' <> '3000.00'
    or v_snapshot #>> '{payment,rows,1,amount}' <> '7000.00'
    or v_snapshot #>> '{payment,subscription_obligations,0,id}' <> v_obligation::text
    or v_snapshot #>> '{payment,subscription_obligations,0,amount}' <> '1950.00'
    or v_snapshot #>> '{lines,1,subscription,customer_text}' not like '%Only Year 1 is included in this PI total.%'
    or v_snapshot::text like '%123456.78%'
    or v_snapshot #>> '{payment,customer_text}' like '%' || v_obligation::text || '%'
  then
    v_fail := v_fail || 'issued mixed snapshot ' || coalesce(v_snapshot ->> 'layout_version', '') || ' ' || coalesce(v_snapshot #>> '{payment,customer_text}', '') || '; ';
  end if;
  v_original := v_snapshot;
  update public.product_commitment_options set first_year_unit_price = 1 where id = v_three;
  if (select snapshot #>> '{lines,1,subscription,negotiated_first_year_unit_price}' from public.pi_versions where id = (v_result ->> 'version_id')::uuid) <> '1950.00' then
    v_fail := v_fail || 'catalogue change altered the issued agreement; ';
  end if;
  update public.product_commitment_options set first_year_unit_price = 1950 where id = v_three;

  perform public.create_pi_revision(v_pi);
  v_payload := jsonb_set(v_payload, '{lines,1,unit_price}', '"1700.00"');
  v_payload := jsonb_set(v_payload, '{lines,1,subscription,negotiated_first_year_unit_price}', '"1700.00"');
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  if (v_result -> 'snapshot' #>> '{payment,subscription_total}') <> '1700.00'
    or (v_result -> 'snapshot' #>> '{payment,rows,0,amount}') <> '3000.00'
    or (v_result -> 'snapshot' #>> '{lines,1,subscription,obligation_id}') <> v_obligation::text
    or (v_result -> 'snapshot' #>> '{lines,1,subscription,later_year_base_unit_price}') <> '1950.00'
    or (select snapshot from public.pi_versions where pi_id = v_pi and revision = 0) is distinct from v_original
  then
    v_fail := v_fail || 'revision did not keep the old snapshot or the obligation; ';
  end if;

  v_duplicate := public.duplicate_pi(v_pi);
  if (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_duplicate and product_id = v_plan) = v_obligation::text
    or (select subscription_agreement ->> 'negotiated_first_year_unit_price' from public.pi_lines where pi_id = v_duplicate and product_id = v_plan) <> '1700.00'
    or (select subscription_agreement ->> 'later_year_base_unit_price' from public.pi_lines where pi_id = v_duplicate and product_id = v_plan) <> '1950.00'
    or (select payment_schedule ->> 'schema_version' from public.proforma_invoices where id = v_duplicate) <> '2'
  then
    v_fail := v_fail || 'duplicate did not copy the agreement with a new obligation; ';
  end if;

  v_result := public.product_pi_history(v_plan, false, null, null, null, 20, 0);
  if v_result #>> '{rows,0,unit_price}' <> '1700.00'
    or v_result #>> '{rows,0,current_subscription_year}' <> '1'
    or v_result #>> '{rows,0,commitment_years}' <> '3'
  then
    v_fail := v_fail || 'history price ' || coalesce(v_result #>> '{rows,0,unit_price}', 'null') || '; ';
  end if;

  update public.product_commitment_options set archived_at = now() where id = v_three;
  begin
    perform public.save_pi_draft(v_duplicate, 1, jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none', 'payment_schedule', v_schedule,
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '2', 'unit_price', '1950.00',
        'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', gen_random_uuid(), 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')
      ))
    ));
    v_fail := v_fail || 'archived option was newly selected; ';
  exception when others then
    if sqlerrm not like '%archived%' then
      v_fail := v_fail || 'archived ' || sqlerrm || '; ';
    end if;
  end;
  perform public.save_pi_draft(v_duplicate, 1, jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
    'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
    'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none', 'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '2', 'unit_price', '1700.00',
      'subscription', jsonb_build_object(
        'option_id', v_three,
        'obligation_id', (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_duplicate and product_id = v_plan),
        'negotiated_first_year_unit_price', '1700.00',
        'later_year_base_unit_price', '1950.00'
      )
    ))
  ));
  if (select line_total::text from public.pi_lines where pi_id = v_duplicate and product_id = v_plan) <> '3400.00'
    or (select grand_total::text from public.proforma_invoices where id = v_duplicate) <> '3400.00'
  then
    v_fail := v_fail || 'quantity included future years; ';
  end if;

  begin
    perform public.save_pi_draft(v_duplicate, (select draft_version from public.proforma_invoices where id = v_duplicate), jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_other, 'vendor_id', v_vendor, 'model_code', v_model_other, 'description', 'Other', 'unit', 'license', 'quantity', '1', 'unit_price', '1950',
        'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', gen_random_uuid(), 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')
      ))
    ));
    v_fail := v_fail || 'wrong product option saved; ';
  exception when others then
    if sqlerrm not like '%does not belong%' then
      v_fail := v_fail || 'wrong product ' || sqlerrm || '; ';
    end if;
  end;

  v_pi := public.create_pi_draft();
  begin
    perform public.save_pi_draft(v_pi, 1, jsonb_build_object(
      'preset_code', 'AE-EUR', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '2200',
        'subscription', jsonb_build_object('option_id', v_one, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null)
      ))
    ));
    v_fail := v_fail || 'eur pi accepted a usd commitment; ';
  exception when others then
    if sqlerrm not like '%not converted%' then
      v_fail := v_fail || 'currency ' || sqlerrm || '; ';
    end if;
  end;

  perform public.save_pi_draft(v_pi, 1, jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
    'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
    'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none',
    'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', null,
      'subscription', null
    ))
  ));
  if (select subscription_agreement from public.pi_lines where pi_id = v_pi) is not null then
    v_fail := v_fail || 'incomplete draft stored an agreement; ';
  end if;
  begin
    perform public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00',
        'subscription', null
      ))
    ));
    v_fail := v_fail || 'incomplete subscription was issued; ';
  exception when others then
    if sqlerrm not like '%commitment%' and sqlerrm not like '%selling price%' then
      v_fail := v_fail || 'incomplete issue ' || sqlerrm || '; ';
    end if;
  end;

  perform public.save_pi_draft(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
    'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
    'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none',
    'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00',
      'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null)
    ))
  ));
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
    'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
    'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'none',
    'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00',
      'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null)
    ))
  ));
  if v_result #>> '{snapshot,payment,customer_text}' <> 'Subscription charges of USD 2,200.00 are payable 100% in advance.'
    or jsonb_array_length(v_result #> '{snapshot,payment,rows}') <> 0
    or v_result #>> '{snapshot,adjustments,grand_total}' <> '2200.00'
  then
    v_fail := v_fail || 'subscription-only advance ' || coalesce(v_result #>> '{snapshot,payment,customer_text}', '') || '; ';
  end if;

  update public.product_commitment_options set archived_at = null where id = v_three;
  v_pi := public.create_pi_draft();
  perform public.save_pi_draft(v_pi, 1, jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
    'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
    'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
    'discount_type', 'percent', 'discount_value', '10',
    'shipping_amount', '100', 'installation_amount', '50', 'bank_charge_amount', '25',
    'tax_enabled', true, 'tax_percent', '14',
    'tax_excludes_shipping', true, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'payment_schedule', jsonb_build_object(
      'schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null,
      'rows', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-4000-8000-0000000000c1', 'label', 'advance payment',
        'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
        'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
        'instalments', null
      ))
    ),
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_machine, 'description', 'Machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '10000.00', 'subscription', null),
      jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00'))
    )
  ));
  v_result := private.canonical_allocated_payment(v_pi);
  if (v_result ->> 'subscription_total')::numeric + (v_result ->> 'one_time_total')::numeric
      <> (select grand_total from public.proforma_invoices where id = v_pi)
    or v_result #>> '{rows,0,amount}' <> v_result ->> 'one_time_total'
    or (select sum((line.value ->> 'discount')::numeric) from jsonb_array_elements(v_result #> '{allocation,lines}') line(value))
      <> (select discount_amount from public.proforma_invoices where id = v_pi)
    or (select sum((line.value ->> 'tax')::numeric) from jsonb_array_elements(v_result #> '{allocation,lines}') line(value))
      <> (select tax_amount from public.proforma_invoices where id = v_pi)
    or (select sum((line.value ->> 'shipping')::numeric) from jsonb_array_elements(v_result #> '{allocation,lines}') line(value)) <> 100
  then
    v_fail := v_fail || 'discount tax charge allocation ' || coalesce(v_result ->> 'subscription_total', '') || '/' || coalesce(v_result ->> 'one_time_total', '') || '; ';
  end if;
  begin
    perform public.save_pi_draft(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'shipping_amount', '50',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_machine, 'description', 'Machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '0', 'subscription', null),
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '0', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '0.00', 'later_year_base_unit_price', '1950.00'))
      )
    ));
    perform private.canonical_allocated_payment(v_pi);
    v_fail := v_fail || 'zero-weight charges were allocated without a choice; ';
  exception when others then
    if sqlerrm not like '%does not create a subscription price%' then
      v_fail := v_fail || 'zero-weight ' || sqlerrm || '; ';
    end if;
  end;

  declare
    v_ob_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_ob_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    v_ob_copy_a text;
    v_ob_copy_b text;
    v_version_count integer;
  begin
    v_pi := public.create_pi_draft();
    perform public.save_pi_draft(v_pi, 1, jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan A', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_ob_a, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')),
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan B', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00', 'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_ob_b, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null))
      )
    ));
    if (select count(*) from public.pi_lines where pi_id = v_pi) <> 2
      or (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_pi and description = 'Plan A') <> v_ob_a::text
      or (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_pi and description = 'Plan B') <> v_ob_b::text
    then
      v_fail := v_fail || 'two lines of the same product were not saved with distinct obligations; ';
    end if;
    v_expected := (select draft_version from public.proforma_invoices where id = v_pi);
    v_before := (select jsonb_agg(jsonb_build_object('position', position, 'obligation_id', subscription_agreement ->> 'obligation_id') order by position) from public.pi_lines where pi_id = v_pi);
    begin
      perform public.save_pi_draft(v_pi, v_expected, jsonb_build_object(
        'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
        'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
        'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
        'discount_type', 'none',
        'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
        'lines', jsonb_build_array(
          jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan A', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_ob_a, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')),
          jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan B', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00', 'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_ob_a, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null))
        )
      ));
      v_fail := v_fail || 'duplicate obligation was saved; ';
    exception when others then
      if sqlerrm not like '%own obligation identifier%' then
        v_fail := v_fail || 'duplicate obligation ' || sqlerrm || '; ';
      end if;
    end;
    if (select draft_version from public.proforma_invoices where id = v_pi) <> v_expected
      or (select jsonb_agg(jsonb_build_object('position', position, 'obligation_id', subscription_agreement ->> 'obligation_id') order by position) from public.pi_lines where pi_id = v_pi) is distinct from v_before
    then
      v_fail := v_fail || 'duplicate obligation save changed the draft; ';
    end if;

    perform public.save_pi_draft(v_pi, v_expected, jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan B', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00', 'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_ob_b, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null)),
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan A', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_ob_a, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00'))
      )
    ));
    if (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_pi and position = 1) <> v_ob_b::text
      or (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_pi and position = 2) <> v_ob_a::text
    then
      v_fail := v_fail || 'reordering did not keep each obligation; ';
    end if;

    v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan B', 'unit', 'license', 'quantity', '1', 'unit_price', '2200.00', 'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_ob_b, 'negotiated_first_year_unit_price', '2200.00', 'later_year_base_unit_price', null)),
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan A', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_ob_a, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00'))
      )
    ));
    v_original := v_result -> 'snapshot';
    perform public.create_pi_revision(v_pi);
    if (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_pi and position = 1) <> v_ob_b::text
      or (select subscription_agreement ->> 'obligation_id' from public.pi_lines where pi_id = v_pi and position = 2) <> v_ob_a::text
    then
      v_fail := v_fail || 'revision draft lost obligation identity; ';
    end if;
    v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), jsonb_build_object(
      'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
      'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
      'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
      'discount_type', 'none',
      'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan B', 'unit', 'license', 'quantity', '1', 'unit_price', '2100.00', 'subscription', jsonb_build_object('option_id', v_one, 'obligation_id', v_ob_b, 'negotiated_first_year_unit_price', '2100.00', 'later_year_base_unit_price', null)),
        jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan A', 'unit', 'license', 'quantity', '1', 'unit_price', '1800.00', 'subscription', jsonb_build_object('option_id', v_three, 'obligation_id', v_ob_a, 'negotiated_first_year_unit_price', '1800.00', 'later_year_base_unit_price', '1950.00'))
      )
    ));
    if v_result #>> '{snapshot,lines,0,subscription,obligation_id}' <> v_ob_b::text
      or v_result #>> '{snapshot,lines,1,subscription,obligation_id}' <> v_ob_a::text
      or (select snapshot from public.pi_versions where pi_id = v_pi and revision = 0) is distinct from v_original
    then
      v_fail := v_fail || 'revision did not preserve obligation identity; ';
    end if;

    v_duplicate := public.duplicate_pi(v_pi);
    select subscription_agreement ->> 'obligation_id' into v_ob_copy_a from public.pi_lines where pi_id = v_duplicate and position = 1;
    select subscription_agreement ->> 'obligation_id' into v_ob_copy_b from public.pi_lines where pi_id = v_duplicate and position = 2;
    if v_ob_copy_a is null or v_ob_copy_b is null
      or v_ob_copy_a = v_ob_copy_b
      or v_ob_copy_a in (v_ob_a::text, v_ob_b::text)
      or v_ob_copy_b in (v_ob_a::text, v_ob_b::text)
    then
      v_fail := v_fail || 'duplicate PI did not create fresh obligation identifiers; ';
    end if;

    update public.pi_lines
    set subscription_agreement = jsonb_set(subscription_agreement, '{obligation_id}', to_jsonb(v_ob_copy_a))
    where pi_id = v_duplicate and position = 2;
    begin
      perform private.assert_pi_ready(v_duplicate);
      v_fail := v_fail || 'issue allowed a duplicate obligation; ';
    exception when others then
      if sqlerrm not like '%own obligation identifier%' then
        v_fail := v_fail || 'issue duplicate ' || sqlerrm || '; ';
      end if;
    end;
    select count(*) into v_version_count from public.pi_versions where pi_id = v_duplicate;
    update public.profiles set can_edit_drafts = false where id = v_manager;
    begin
      perform public.generate_pi(v_duplicate, (select draft_version from public.proforma_invoices where id = v_duplicate), jsonb_build_object(
        'preset_code', 'AE-USD', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
        'client_id', v_client, 'bill_to', 'Sub billing', 'ship_same_as_billing', true,
        'lead_salesperson_id', v_manager, 'salesperson_ids', jsonb_build_array(v_manager),
        'discount_type', 'none',
        'payment_schedule', jsonb_build_object('schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null, 'rows', '[]'::jsonb),
        'lines', '[]'::jsonb
      ));
      v_fail := v_fail || 'generate issued a duplicate obligation; ';
    exception when others then
      if sqlerrm not like '%own obligation identifier%' then
        v_fail := v_fail || 'generate duplicate ' || sqlerrm || '; ';
      end if;
    end;
    update public.profiles set can_edit_drafts = true where id = v_manager;
    if (select count(*) from public.pi_versions where pi_id = v_duplicate) <> v_version_count then
      v_fail := v_fail || 'rejected issue created a version; ';
    end if;
  end;

  if v_fail <> '' then
    raise exception 'SUBSCRIPTION_FAIL %', v_fail;
  end if;
  raise exception 'SUBSCRIPTION_OK';
end;
$test$;
