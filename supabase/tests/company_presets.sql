-- Rolled-back checks for administrator-managed company presets.
-- The block always raises, including on success, so none of its rows are committed.
-- Run it on a disposable database after 20261023120000_administrator_company_presets.sql.
-- Do not remove the final RAISE. Do not run it on Value CRM.

do $test$
declare
  v_fail text := '';
  v_instance uuid;
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_admin uuid := gen_random_uuid();
  v_editor uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_client uuid;
  v_vendor uuid;
  v_machine uuid;
  v_plan uuid;
  v_option uuid;
  v_model_machine text;
  v_model_plan text;
  v_model_simple text;
  v_obligation uuid := gen_random_uuid();
  v_pi uuid;
  v_draft uuid;
  v_other uuid;
  v_revision uuid;
  v_duplicate uuid;
  v_version uuid;
  v_result jsonb;
  v_snapshot jsonb;
  v_original jsonb;
  v_payload jsonb;
  v_base jsonb;
  v_schedule jsonb;
  v_text text;
  v_count integer;
  v_expected integer;
  v_eg_before integer;
  v_ae_before integer;
  v_eg_after integer;
  v_ae_after integer;
  v_serial integer;
  v_number text;
  v_second text;
  v_storage bigint;
  v_code text;
  v_shared text;
  v_own text;
  v_eur text;
  v_plan_id uuid;
  v_pay_obligation uuid;
  v_amount numeric;
begin
  v_model_machine := 'zz-pre-m-' || v_tag;
  v_model_plan := 'zz-pre-s-' || v_tag;
  v_model_simple := 'zz-pre-o-' || v_tag;

  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls' and evtenabled = 'O') then
    v_fail := v_fail || 'ensure_rls trigger is missing; ';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.numbering_sequences'::regclass and relrowsecurity
  ) then
    v_fail := v_fail || 'numbering_sequences RLS is off; ';
  end if;
  if (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'numbering_sequences'
  ) < 3 then
    v_fail := v_fail || 'numbering sequence policies are missing; ';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'company_presets' and policyname = 'presets_insert'
  ) then
    v_fail := v_fail || 'preset insert policy is missing; ';
  end if;
  if has_table_privilege('anon', 'public.numbering_sequences', 'select')
    or has_table_privilege('anon', 'public.company_presets', 'insert')
    or has_function_privilege('anon', 'public.create_company_preset(jsonb)', 'execute')
    or has_function_privilege('anon', 'private.format_pi_number(text, integer, integer)', 'execute')
    or has_function_privilege('authenticated', 'private.format_pi_number(text, integer, integer)', 'execute')
  then
    v_fail := v_fail || 'anon or authenticated can reach a private numbering helper or an ungranted table; ';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.proforma_invoices'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(office, pi_year, serial)%'
  ) then
    v_fail := v_fail || 'office serial unique remains; ';
  end if;

  if (select count(*) from public.company_presets where code in ('EG-EGP', 'AE-USD', 'AE-EUR')) <> 3
    or (select office || currency || layout || sequence_code from public.company_presets where code = 'EG-EGP') <> 'EGEGPegyptEG'
    or (select office || currency || sequence_code from public.company_presets where code = 'AE-USD') <> 'AEUSDAE'
    or (select office || currency || sequence_code from public.company_presets where code = 'AE-EUR') <> 'AEEURAE'
    or (select display_name from public.company_presets where code = 'EG-EGP') <> 'Egypt — EGP'
    or (select display_name from public.company_presets where code = 'AE-EUR') <> 'UAE — EUR'
    or (select account_number from public.company_presets where code = 'EG-EGP') <> '100022610548'
    or (select account_number from public.company_presets where code = 'AE-USD') <> '1000081724'
    or (select iban from public.company_presets where code = 'AE-EUR') <> 'AE630070100001000080086'
    or (select company_name from public.company_presets where code = 'AE-USD') <> 'Value Technologies EMEA FZ-LLC'
    or exists (select 1 from public.company_presets where code in ('EG-EGP', 'AE-USD', 'AE-EUR') and archived_at is not null)
    or (select prefix from public.numbering_sequences where code = 'EG') <> 'EG'
    or (select prefix from public.numbering_sequences where code = 'AE') <> 'AE'
  then
    v_fail := v_fail || 'original presets or sequences changed; ';
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
    (v_instance, v_admin, 'authenticated', 'authenticated', 'pre-admin-' || v_admin::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Preset Admin"}'::jsonb, now(), now(), 'c-' || v_admin::text, 'r-' || v_admin::text, 'n-' || v_admin::text, ''),
    (v_instance, v_editor, 'authenticated', 'authenticated', 'pre-editor-' || v_editor::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Preset Editor"}'::jsonb, now(), now(), 'c-' || v_editor::text, 'r-' || v_editor::text, 'n-' || v_editor::text, ''),
    (v_instance, v_reader, 'authenticated', 'authenticated', 'pre-reader-' || v_reader::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Preset Reader"}'::jsonb, now(), now(), 'c-' || v_reader::text, 'r-' || v_reader::text, 'n-' || v_reader::text, ''),
    (v_instance, v_inactive, 'authenticated', 'authenticated', 'pre-inactive-' || v_inactive::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Inactive Admin"}'::jsonb, now(), now(), 'c-' || v_inactive::text, 'r-' || v_inactive::text, 'n-' || v_inactive::text, '');
  update public.profiles
  set is_active = true, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_edit_drafts = true, can_generate_pis = true, full_name = 'Preset Admin'
  where id = v_admin;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'all',
      can_edit_drafts = true, can_generate_pis = true, full_name = 'Preset Editor'
  where id = v_editor;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
      can_edit_drafts = false, can_generate_pis = false, full_name = 'Preset Reader'
  where id = v_reader;
  update public.profiles
  set is_active = false, is_admin = true, is_salesperson = true, pi_visibility = 'all',
      can_edit_drafts = true, can_generate_pis = true, full_name = 'Inactive Admin'
  where id = v_inactive;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_editor::text, true);
    perform public.create_company_preset(jsonb_build_object(
      'display_name', 'Editor preset', 'office', 'ZZ', 'currency', 'USD', 'layout', 'uae', 'sequence_code', 'AE'
    ));
    v_fail := v_fail || 'editor created a preset; ';
  exception when others then
    if sqlerrm not like '%administrator%' then
      v_fail := v_fail || 'editor preset ' || sqlerrm || '; ';
    end if;
  end;
  execute 'reset role';

  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_editor::text, true);
    insert into public.numbering_sequences (prefix) values ('ZZ');
    v_fail := v_fail || 'editor created a sequence; ';
  exception when others then
    if sqlerrm not like '%row-level security%' then
      v_fail := v_fail || 'editor sequence ' || sqlerrm || '; ';
    end if;
  end;
  execute 'reset role';

  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_inactive::text, true);
    perform public.create_company_preset(jsonb_build_object(
      'display_name', 'Inactive preset', 'office', 'ZZ', 'currency', 'USD', 'layout', 'egypt', 'sequence_code', 'EG'
    ));
    v_fail := v_fail || 'inactive admin created a preset; ';
  exception when others then
    if sqlerrm not like '%administrator%' then
      v_fail := v_fail || 'inactive preset ' || sqlerrm || '; ';
    end if;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  execute 'set local role authenticated';
  update public.company_presets set company_name = 'Hacked' where code = 'EG-EGP';
  update public.numbering_sequences set prefix = 'EX' where code = 'EG';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  if (select company_name from public.company_presets where code = 'EG-EGP') = 'Hacked'
    or (select prefix from public.numbering_sequences where code = 'EG') <> 'EG'
  then
    v_fail := v_fail || 'non-admin changed a preset or prefix; ';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  select count(*) into v_count from public.company_presets;
  if v_count < 3 then
    v_fail := v_fail || 'reader could not read presets; ';
  end if;
  select count(*) into v_count from public.numbering_sequences;
  if v_count < 2 then
    v_fail := v_fail || 'reader could not read sequences; ';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.company_presets;
  if v_count <> 0 then
    v_fail := v_fail || 'inactive user read presets; ';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    execute 'set local role anon';
    perform public.create_company_preset('{}'::jsonb);
    v_fail := v_fail || 'anon created a preset; ';
  exception when insufficient_privilege then
    null;
  when others then
    v_fail := v_fail || 'anon preset ' || sqlerrm || '; ';
  end;
  execute 'reset role';

  begin
    perform public.create_company_preset(jsonb_build_object(
      'display_name', 'Bad currency', 'office', 'ZZ', 'currency', 'GBP', 'layout', 'egypt', 'sequence_code', 'EG',
      'company_name', 'X', 'address', 'Y', 'bank_name', 'B', 'account_name', 'A', 'account_number', '1', 'iban', 'I', 'bank_swift', 'S'
    ));
    v_fail := v_fail || 'GBP preset inserted; ';
  exception when others then
    if sqlerrm not like '%EGP%' and sqlerrm not like '%USD%' and sqlerrm not like '%EUR%' then
      v_fail := v_fail || 'GBP ' || sqlerrm || '; ';
    end if;
  end;
  begin
    insert into public.numbering_sequences (prefix) values ('eg');
    v_fail := v_fail || 'conflicting prefix inserted; ';
  exception when others then
    if sqlerrm not like '%prefix%' then
      v_fail := v_fail || 'prefix conflict ' || sqlerrm || '; ';
    end if;
  end;
  begin
    insert into public.numbering_sequences (prefix) values ('A-E');
    v_fail := v_fail || 'hyphenated prefix inserted; ';
  exception when others then
    if sqlerrm not like '%prefix%' then
      v_fail := v_fail || 'hyphen prefix ' || sqlerrm || '; ';
    end if;
  end;
  begin
    insert into public.company_presets (code, display_name, office, currency, layout, sequence_code)
    values ('EG-EGP', 'Duplicate', 'EG', 'EGP', 'egypt', 'EG');
    v_fail := v_fail || 'duplicate preset identifier inserted; ';
  exception when unique_violation then
    null;
  when others then
    v_fail := v_fail || 'duplicate code ' || sqlerrm || '; ';
  end;
  begin
    update public.numbering_sequences set prefix = 'EX' where code = 'EG';
    v_fail := v_fail || 'original EG prefix changed; ';
  exception when others then
    if sqlerrm not like '%prefix%' then
      v_fail := v_fail || 'EG prefix ' || sqlerrm || '; ';
    end if;
  end;
  if (select prefix from public.numbering_sequences where code = 'EG') <> 'EG'
    or (select prefix from public.numbering_sequences where code = 'AE') <> 'AE'
  then
    v_fail := v_fail || 'original prefix was rewritten; ';
  end if;

  select count(*) into v_storage from storage.objects where bucket_id = 'pi-pdfs';
  insert into public.clients (company_name, country, billing_address)
  values ('Preset Client ' || v_tag, 'Qatar', 'Doha billing')
  returning id into v_client;
  insert into public.vendors (company_name, country)
  values ('Preset Vendor ' || v_tag, 'Qatar')
  returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_egp, sell_price_usd, sell_price_eur)
  values (v_vendor, v_model_simple, 'Simple item', 'unit', 10, 10, 10)
  returning id into v_machine;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_usd, billing_type)
  values (v_vendor, v_model_machine, 'Machine', 'unit', 10000, 'one_time');
  insert into public.products (vendor_id, model_code, description, unit, billing_type)
  values (v_vendor, v_model_plan, 'Plan', 'license', 'subscription')
  returning id into v_plan;
  insert into public.product_commitment_options (
    product_id, commitment_years, currency, first_year_unit_price, later_year_base_unit_price, later_year_rule
  ) values (v_plan, 3, 'USD', 1950, 1950, 'vendor_confirmed_base_adjustment')
  returning id into v_option;

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-0000000000c1', 'label', 'advance payment',
      'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
      'due', jsonb_build_object('type', 'date', 'date', '2026-11-01'),
      'instalments', null
    ))
  );
  v_base := jsonb_build_object(
    'pi_date', '2026-10-23', 'expiry_date', '2026-11-23',
    'client_id', v_client, 'client_contact_id', null,
    'bill_to', 'Doha billing', 'ship_to', 'Doha billing', 'ship_same_as_billing', true,
    'customer_reference', '', 'lead_salesperson_id', v_admin,
    'salesperson_ids', jsonb_build_array(v_admin),
    'discount_type', 'none', 'discount_value', null,
    'shipping_amount', null, 'installation_amount', null, 'bank_charge_amount', null,
    'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '', 'payment_schedule', v_schedule,
    'delivery_terms', '', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_simple,
      'description', 'Simple item', 'unit', 'unit', 'quantity', '1', 'unit_price', '10.50', 'subscription', null
    ))
  );

  v_eg_before := coalesce((select last_value from private.pi_counters where office = 'EG' and pi_year = 2026), 0);
  v_ae_before := coalesce((select last_value from private.pi_counters where office = 'AE' and pi_year = 2026), 0);

  v_pi := public.create_pi_draft();
  v_result := public.generate_pi(v_pi, 1, v_base || jsonb_build_object('preset_code', 'EG-EGP'));
  if v_result ->> 'pi_number' is distinct from private.format_pi_number('EG', 2026, v_eg_before + 1)
    or (select office from public.proforma_invoices where id = v_pi) <> 'EG'
    or (select sequence_code from public.proforma_invoices where id = v_pi) <> 'EG'
    or (select currency from public.proforma_invoices where id = v_pi) <> 'EGP'
    or coalesce((select last_value from private.pi_counters where office = 'AE' and pi_year = 2026), 0) <> v_ae_before
  then
    v_fail := v_fail || 'Egypt numbering changed ' || coalesce(v_result ->> 'pi_number', '') || '; ';
  end if;

  v_pi := public.create_pi_draft();
  v_result := public.generate_pi(v_pi, 1, v_base || jsonb_build_object('preset_code', 'AE-USD'));
  v_number := v_result ->> 'pi_number';
  v_pi := public.create_pi_draft();
  v_result := public.generate_pi(v_pi, 1, v_base || jsonb_build_object('preset_code', 'AE-EUR'));
  v_second := v_result ->> 'pi_number';
  if v_number is distinct from private.format_pi_number('AE', 2026, v_ae_before + 1)
    or v_second is distinct from private.format_pi_number('AE', 2026, v_ae_before + 2)
    or (select currency from public.proforma_invoices where pi_number = v_second) <> 'EUR'
    or coalesce((select last_value from private.pi_counters where office = 'EG' and pi_year = 2026), 0) <> v_eg_before + 1
  then
    v_fail := v_fail || 'UAE shared sequence changed ' || coalesce(v_number, '') || ' ' || coalesce(v_second, '') || '; ';
  end if;

  v_result := to_jsonb(public.create_company_preset(jsonb_build_object(
    'display_name', 'Qatar Office — USD',
    'office', 'qa',
    'currency', 'usd',
    'layout', 'uae',
    'sequence_code', 'AE',
    'company_name', 'Qatar Office LLC',
    'address', 'Doha, Qatar',
    'phone', '+974 4000 0000',
    'email', 'accounts@qatar.example',
    'bank_name', 'Qatar National Bank',
    'account_name', 'Qatar Office LLC',
    'account_number', '000123',
    'iban', 'QA00QATAR000123',
    'bank_swift', 'QNBAQAQA'
  )));
  v_shared := v_result ->> 'code';
  if v_shared is null or v_shared in ('EG-EGP', 'AE-USD', 'AE-EUR')
    or (v_result ->> 'office') <> 'QA'
    or (v_result ->> 'currency') <> 'USD'
    or (v_result ->> 'layout') <> 'uae'
    or (v_result ->> 'sequence_code') <> 'AE'
    or (v_result ->> 'account_number') <> '000123'
    or (v_result ->> 'display_name') <> 'Qatar Office — USD'
  then
    v_fail := v_fail || 'shared preset was not created ' || coalesce(v_result::text, '') || '; ';
  end if;

  v_ae_after := coalesce((select last_value from private.pi_counters where office = 'AE' and pi_year = 2026), 0);
  v_pi := public.create_pi_draft();
  v_result := public.generate_pi(v_pi, 1, v_base || jsonb_build_object('preset_code', v_shared));
  v_snapshot := v_result -> 'snapshot';
  if v_result ->> 'pi_number' is distinct from private.format_pi_number('AE', 2026, v_ae_after + 1)
    or (select office from public.proforma_invoices where id = v_pi) <> 'QA'
    or (select sequence_code from public.proforma_invoices where id = v_pi) <> 'AE'
    or (select currency from public.proforma_invoices where id = v_pi) <> 'USD'
    or v_snapshot ->> 'layout_version' <> 'uae-v2'
    or v_snapshot #>> '{company,name}' <> 'Qatar Office LLC'
    or v_snapshot #>> '{bank,account_number}' <> '000123'
    or v_snapshot #>> '{bank,iban}' <> 'QA00QATAR000123'
    or v_snapshot #>> '{company,name}' like '%EMEA%'
    or v_snapshot ->> 'pdf_path' is not null
    or (select pdf_path from public.pi_versions where id = (v_result ->> 'version_id')::uuid) is not null
    or (select pdf_status from public.pi_versions where id = (v_result ->> 'version_id')::uuid) <> 'issued'
  then
    v_fail := v_fail || 'shared sequence issue ' || coalesce(v_result ->> 'pi_number', '') || ' ' || coalesce(v_snapshot ->> 'layout_version', '') || '; ';
  end if;
  execute 'set local role authenticated';
  select preset_code, preset_display_name into v_code, v_text
  from public.pi_list where id = v_pi;
  execute 'reset role';
  if v_code is distinct from v_shared or v_text is distinct from 'Qatar Office — USD' then
    v_fail := v_fail || 'list filter missed the new preset ' || coalesce(v_text, '') || '; ';
  end if;

  v_result := to_jsonb(public.create_company_preset(jsonb_build_object(
    'display_name', 'North Office — USD',
    'office', 'NX',
    'currency', 'USD',
    'layout', 'uae',
    'new_prefix', 'nx',
    'company_name', 'North Office LLC',
    'address', 'Doha, Qatar',
    'phone', '+974 4000 1111',
    'email', 'accounts@north.example',
    'bank_name', 'North Bank',
    'account_name', 'North Office LLC',
    'account_number', '000123',
    'iban', 'QA00NORTH000123',
    'bank_swift', 'NORTHQAQ'
  )));
  v_own := v_result ->> 'code';
  if (v_result ->> 'sequence_code') <> 'NX'
    or (select prefix from public.numbering_sequences where code = 'NX') <> 'NX'
    or coalesce((select last_value from private.pi_counters where office = 'NX'), 0) <> 0
  then
    v_fail := v_fail || 'new sequence was not created empty ' || coalesce(v_result::text, '') || '; ';
  end if;

  v_eg_after := coalesce((select last_value from private.pi_counters where office = 'EG' and pi_year = 2026), 0);
  v_ae_after := coalesce((select last_value from private.pi_counters where office = 'AE' and pi_year = 2026), 0);
  v_pi := public.create_pi_draft();
  v_result := public.generate_pi(v_pi, 1, v_base || jsonb_build_object('preset_code', v_own, 'pi_date', '2026-10-23', 'expiry_date', '2026-11-23'));
  v_other := public.create_pi_draft();
  perform public.generate_pi(v_other, 1, v_base || jsonb_build_object('preset_code', v_own, 'pi_date', '2027-01-15', 'expiry_date', '2027-02-15'));
  v_draft := public.create_pi_draft();
  perform public.generate_pi(v_draft, 1, v_base || jsonb_build_object('preset_code', v_own, 'pi_date', '2026-12-01', 'expiry_date', '2027-01-01'));
  if (select pi_number from public.proforma_invoices where id = v_pi) <> 'NX-2026-00001'
    or (select pi_number from public.proforma_invoices where id = v_other) <> 'NX-2027-00001'
    or (select pi_number from public.proforma_invoices where id = v_draft) <> 'NX-2026-00002'
    or coalesce((select last_value from private.pi_counters where office = 'EG' and pi_year = 2026), 0) <> v_eg_after
    or coalesce((select last_value from private.pi_counters where office = 'AE' and pi_year = 2026), 0) <> v_ae_after
  then
    v_fail := v_fail || 'new office counter did not stay separate; ';
  end if;

  begin
    update public.numbering_sequences set prefix = 'NY' where code = 'NX';
    v_fail := v_fail || 'used prefix changed; ';
  exception when others then
    if sqlerrm not like '%prefix%' then
      v_fail := v_fail || 'used prefix ' || sqlerrm || '; ';
    end if;
  end;
  if (select prefix from public.numbering_sequences where code = 'NX') <> 'NX'
    or (select pi_number from public.proforma_invoices where id = v_pi) <> 'NX-2026-00001'
  then
    v_fail := v_fail || 'used prefix or issued number changed; ';
  end if;

  v_eur := (to_jsonb(public.create_company_preset(jsonb_build_object(
    'display_name', 'Unused prefix office',
    'office', 'UP',
    'currency', 'EUR',
    'layout', 'egypt',
    'new_prefix', 'UP',
    'company_name', 'Unused Office',
    'address', 'Address',
    'bank_name', 'Bank',
    'account_name', 'Unused Office',
    'account_number', '1',
    'iban', 'IBAN1',
    'bank_swift', 'UNUSEDXX'
  ))) ->> 'code');
  update public.numbering_sequences set prefix = 'UQ' where code = 'UP';
  if (select prefix from public.numbering_sequences where code = 'UP') <> 'UQ' then
    v_fail := v_fail || 'unused prefix could not be corrected; ';
  end if;

  begin
    update public.company_presets set currency = 'EGP' where code = v_own;
    v_fail := v_fail || 'used preset currency changed; ';
  exception when others then
    if sqlerrm not like '%Create a new preset%' then
      v_fail := v_fail || 'used currency ' || sqlerrm || '; ';
    end if;
  end;
  begin
    update public.company_presets set office = 'QA' where code = v_own;
    v_fail := v_fail || 'used preset office changed; ';
  exception when others then
    if sqlerrm not like '%Create a new preset%' then
      v_fail := v_fail || 'used office ' || sqlerrm || '; ';
    end if;
  end;
  begin
    update public.company_presets set sequence_code = 'AE' where code = v_own;
    v_fail := v_fail || 'used preset sequence changed; ';
  exception when others then
    if sqlerrm not like '%Create a new preset%' then
      v_fail := v_fail || 'used sequence ' || sqlerrm || '; ';
    end if;
  end;
  if (select currency || office || sequence_code from public.company_presets where code = v_own) <> 'USDNXNX' then
    v_fail := v_fail || 'used preset identity was rewritten; ';
  end if;

  v_schedule := jsonb_build_object(
    'schema_version', 2, 'no_payment_due', false, 'dates_need_review', false, 'residual_target', null,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-0000000000d1', 'label', 'advance payment', 'amount', jsonb_build_object('type', 'percent', 'percent', '30'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-0000000000d2', 'label', 'before shipment', 'amount', jsonb_build_object('type', 'percent', 'percent', '70'), 'due', jsonb_build_object('type', 'before_shipment', 'deadline', null), 'instalments', null)
    )
  );
  v_payload := jsonb_build_object(
    'preset_code', v_own, 'pi_date', '2026-10-23', 'expiry_date', '2026-11-23',
    'client_id', v_client, 'bill_to', 'Doha billing', 'ship_to', 'Doha billing', 'ship_same_as_billing', true,
    'customer_reference', 'NX-REF', 'lead_salesperson_id', v_admin, 'salesperson_ids', jsonb_build_array(v_admin),
    'discount_type', 'none', 'discount_value', null, 'shipping_amount', null, 'installation_amount', null,
    'bank_charge_amount', null, 'tax_enabled', false, 'tax_percent', null,
    'tax_excludes_shipping', false, 'tax_excludes_installation', false, 'tax_excludes_bank_charge', false,
    'price_basis', '', 'payment_terms', '', 'payment_schedule', v_schedule,
    'delivery_terms', 'Stock', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products where model_code = v_model_machine), 'vendor_id', v_vendor, 'model_code', v_model_machine, 'description', 'Machine', 'unit', 'unit', 'quantity', '1', 'unit_price', '10000.00', 'subscription', null),
      jsonb_build_object('product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license', 'quantity', '1', 'unit_price', '1950.00', 'subscription', jsonb_build_object('option_id', v_option, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00'))
    )
  );
  v_pi := public.create_pi_draft();
  perform public.save_pi_draft(v_pi, 1, v_payload);
  if (select count(*) from public.payment_plans) <> 0 or (select count(*) from public.subscriptions) <> 0 then
    v_fail := v_fail || 'saving the new preset started tracking; ';
  end if;
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  v_version := (v_result ->> 'version_id')::uuid;
  v_snapshot := v_result -> 'snapshot';
  v_original := v_snapshot;
  if v_result ->> 'pi_number' <> 'NX-2026-00003'
    or v_snapshot ->> 'layout_version' <> 'uae-v3'
    or v_snapshot #>> '{payment,schema_version}' <> '2'
    or v_snapshot #>> '{payment,subscription_total}' <> '1950.00'
    or v_snapshot #>> '{payment,one_time_total}' <> '10000.00'
    or v_snapshot #>> '{company,name}' <> 'North Office LLC'
    or v_snapshot #>> '{bank,account_number}' <> '000123'
    or v_snapshot #>> '{bank,bank_name}' <> 'North Bank'
    or v_snapshot::text like '%Value Technologies EMEA%'
    or (select pdf_path from public.pi_versions where id = v_version) is not null
    or (select count(*) from public.subscriptions where pi_id = v_pi) <> 0
    or (select count(*) from public.payment_plans where pi_id = v_pi) <> 0
  then
    v_fail := v_fail || 'new preset subscription issue ' || coalesce(v_snapshot ->> 'layout_version', '') || ' ' || coalesce(v_snapshot #>> '{payment,customer_text}', '') || '; ';
  end if;

  update public.company_presets
  set company_name = 'North Office Renamed', bank_name = 'Renamed Bank', display_name = 'North renamed', layout = 'egypt'
  where code = v_own;
  if (select snapshot from public.pi_versions where id = v_version) is distinct from v_original
    or (select snapshot #>> '{company,name}' from public.pi_versions where id = v_version) <> 'North Office LLC'
    or (select snapshot ->> 'layout_version' from public.pi_versions where id = v_version) <> 'uae-v3'
  then
    v_fail := v_fail || 'editing the preset changed an issued snapshot; ';
  end if;

  v_result := public.start_payment_tracking(v_pi, v_version, true);
  v_plan_id := (v_result ->> 'plan_id')::uuid;
  if (v_result ->> 'currency') <> 'USD' or (select currency from public.payment_plans where id = v_plan_id) <> 'USD' then
    v_fail := v_fail || 'tracking currency was not the preset currency; ';
  end if;
  select id, amount into v_pay_obligation, v_amount
  from public.payment_obligations
  where plan_id = v_plan_id and kind = 'subscription_advance';
  if v_pay_obligation is null or v_amount <> 1950 then
    v_fail := v_fail || 'subscription obligation was not copied from the snapshot; ';
  end if;
  perform public.record_payment_receipt(v_plan_id, jsonb_build_object(
    'idempotency_key', gen_random_uuid(),
    'amount', v_amount,
    'received_on', private.cairo_today(),
    'method', 'bank_transfer',
    'reference', '000123',
    'allocations', jsonb_build_array(jsonb_build_object('obligation_id', v_pay_obligation, 'amount', v_amount))
  ));
  if (select currency from public.subscriptions where pi_id = v_pi) <> 'USD'
    or (select state from public.subscriptions where pi_id = v_pi) <> 'active'
    or (select activation_kind from public.subscriptions where pi_id = v_pi) <> 'payment'
    or (select count(*) from public.payment_obligations where plan_id = v_plan_id and kind <> 'subscription_advance' and amount > 0) < 1
    or (select snapshot from public.pi_versions where id = v_version) is distinct from v_original
  then
    v_fail := v_fail || 'payment tracking did not follow the new preset; ';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'pi-pdfs') <> v_storage then
    v_fail := v_fail || 'a PDF file was stored; ';
  end if;

  v_draft := public.create_pi_draft();
  perform public.save_pi_draft(v_draft, 1, v_base || jsonb_build_object('preset_code', v_own, 'additional_notes', 'kept'));

  update public.company_presets set archived_at = now() where code = v_own;
  if (select snapshot from public.pi_versions where id = v_version) is distinct from v_original then
    v_fail := v_fail || 'archiving changed an issued snapshot; ';
  end if;
  perform public.create_pi_revision(v_pi);
  v_result := public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
  if v_result ->> 'pi_number' <> 'NX-2026-00003'
    or (v_result ->> 'revision')::integer <> 1
    or (select snapshot from public.pi_versions where id = v_version) is distinct from v_original
    or (select currency from public.proforma_invoices where id = v_pi) <> 'USD'
    or (select sequence_code from public.proforma_invoices where id = v_pi) <> 'NX'
  then
    v_fail := v_fail || 'archived preset blocked a revision or changed the number; ';
  end if;

  begin
    perform public.generate_pi(v_draft, (select draft_version from public.proforma_invoices where id = v_draft), v_base || jsonb_build_object('preset_code', v_own));
    v_fail := v_fail || 'archived preset issued a new draft; ';
  exception when others then
    if sqlerrm not like '%archived%' then
      v_fail := v_fail || 'archived issue ' || sqlerrm || '; ';
    end if;
  end;
  perform public.save_pi_draft(
    v_draft,
    (select draft_version from public.proforma_invoices where id = v_draft),
    v_base || jsonb_build_object('preset_code', v_own, 'additional_notes', 'still kept')
  );
  if (select preset_code from public.proforma_invoices where id = v_draft) <> v_own
    or (select additional_notes from public.proforma_invoices where id = v_draft) <> 'still kept'
    or (select pi_number from public.proforma_invoices where id = v_draft) is not null
  then
    v_fail := v_fail || 'archived draft could not keep its preset; ';
  end if;
  v_result := public.generate_pi(
    v_draft,
    (select draft_version from public.proforma_invoices where id = v_draft),
    v_base || jsonb_build_object('preset_code', v_eur)
  );
  if v_result ->> 'pi_number' is distinct from 'UQ-2026-00001'
    or (select preset_code from public.proforma_invoices where id = v_draft) <> v_eur
    or (select currency from public.proforma_invoices where id = v_draft) <> 'EUR'
  then
    v_fail := v_fail || 'archived draft was not issued after an active preset was chosen ' || coalesce(v_result ->> 'pi_number', '') || '; ';
  end if;

  v_duplicate := public.duplicate_pi(v_pi);
  if (select pi_number from public.proforma_invoices where id = v_duplicate) is not null
    or (select preset_code from public.proforma_invoices where id = v_duplicate) <> v_own
  then
    v_fail := v_fail || 'duplicate did not stay a new draft on the original preset; ';
  end if;
  begin
    perform public.generate_pi(
      v_duplicate,
      (select draft_version from public.proforma_invoices where id = v_duplicate),
      v_payload || jsonb_build_object('preset_code', v_own)
    );
    v_fail := v_fail || 'duplicate issued on an archived preset; ';
  exception when others then
    if sqlerrm not like '%archived%' then
      v_fail := v_fail || 'duplicate archive ' || sqlerrm || '; ';
    end if;
  end;
  v_expected := (select draft_version from public.proforma_invoices where id = v_duplicate);
  v_result := public.generate_pi(
    v_duplicate,
    v_expected,
    v_payload || jsonb_build_object('preset_code', 'AE-USD')
  );
  if v_result ->> 'pi_number' like 'NX-%'
    or v_result ->> 'pi_number' = 'NX-2026-00003'
    or (select currency from public.proforma_invoices where id = v_duplicate) <> 'USD'
    or (select sequence_code from public.proforma_invoices where id = v_duplicate) <> 'AE'
    or (select pi_number from public.proforma_invoices where id = v_pi) <> 'NX-2026-00003'
  then
    v_fail := v_fail || 'duplicate did not take a new number on an active preset ' || coalesce(v_result ->> 'pi_number', '') || '; ';
  end if;

  v_other := public.create_pi_draft();
  perform public.save_pi_draft(v_other, 1, v_base || jsonb_build_object('preset_code', 'AE-USD', 'lines', jsonb_build_array(jsonb_build_object(
    'product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_simple,
    'description', 'Simple item', 'unit', 'unit', 'quantity', '2', 'unit_price', '10.50', 'subscription', null
  ))));
  perform public.save_pi_draft(
    v_other,
    (select draft_version from public.proforma_invoices where id = v_other),
    v_base || jsonb_build_object('preset_code', 'AE-EUR', 'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_machine, 'vendor_id', v_vendor, 'model_code', v_model_simple,
      'description', 'Simple item', 'unit', 'unit', 'quantity', '2', 'unit_price', '10.50', 'subscription', null
    )))
  );
  if (select currency from public.proforma_invoices where id = v_other) <> 'EUR'
    or (select unit_price from public.pi_lines where pi_id = v_other) <> 10.50
  then
    v_fail := v_fail || 'currency change converted or dropped a one-time price; ';
  end if;
  begin
    perform public.save_pi_draft(
      v_other,
      (select draft_version from public.proforma_invoices where id = v_other),
      (v_base || jsonb_build_object('preset_code', 'EG-EGP')) || jsonb_build_object('lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_plan, 'vendor_id', v_vendor, 'model_code', v_model_plan, 'description', 'Plan', 'unit', 'license',
        'quantity', '1', 'unit_price', '1950.00',
        'subscription', jsonb_build_object('option_id', v_option, 'obligation_id', v_obligation, 'negotiated_first_year_unit_price', '1950.00', 'later_year_base_unit_price', '1950.00')
      )))
    );
    v_fail := v_fail || 'USD subscription was saved on an EGP preset; ';
  exception when others then
    if sqlerrm not like '%not converted%' and sqlerrm not like '%priced in%' then
      v_fail := v_fail || 'currency subscription ' || sqlerrm || '; ';
    end if;
  end;

  v_code := (to_jsonb(public.create_company_preset(jsonb_build_object(
    'display_name', 'Incomplete office',
    'office', 'IC',
    'currency', 'EGP',
    'layout', 'egypt',
    'sequence_code', 'EG',
    'company_name', '',
    'address', '',
    'bank_name', '',
    'account_name', '',
    'account_number', '',
    'iban', '',
    'bank_swift', ''
  ))) ->> 'code');
  v_draft := public.create_pi_draft();
  perform public.save_pi_draft(v_draft, 1, v_base || jsonb_build_object('preset_code', v_code));
  begin
    perform public.generate_pi(v_draft, (select draft_version from public.proforma_invoices where id = v_draft), v_base || jsonb_build_object('preset_code', v_code));
    v_fail := v_fail || 'incomplete preset issued; ';
  exception when others then
    if sqlerrm not like '%missing company or bank%' then
      v_fail := v_fail || 'incomplete ' || sqlerrm || '; ';
    end if;
  end;

  begin
    delete from public.company_presets where code = v_own;
    v_fail := v_fail || 'used preset was deleted; ';
  exception when others then
    if sqlerrm not like '%cannot be deleted%' then
      v_fail := v_fail || 'preset delete ' || sqlerrm || '; ';
    end if;
  end;
  begin
    delete from public.numbering_sequences where code = 'NX';
    v_fail := v_fail || 'sequence was deleted; ';
  exception when others then
    if sqlerrm not like '%cannot be deleted%' then
      v_fail := v_fail || 'sequence delete ' || sqlerrm || '; ';
    end if;
  end;

  if v_fail <> '' then
    raise exception 'COMPANY_PRESET_FAIL %', v_fail;
  end if;
  raise exception 'COMPANY_PRESET_OK';
end
$test$;
