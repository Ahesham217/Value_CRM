-- Rolled-back check for on-demand PI PDFs.
-- The block always raises, including on success, so none of its rows are committed.
-- Run it with a privileged database session against Value CRM after
-- 20261019080451_on_demand_pi_pdfs.sql. Do not remove the final RAISE.

do $test$
declare
  v_fail text := '';
  v_instance uuid;
  v_issuer uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_client uuid;
  v_vendor uuid;
  v_product_first uuid;
  v_product_second uuid;
  v_pi uuid;
  v_result jsonb;
  v_version uuid;
  v_snapshot jsonb;
  v_original_snapshot jsonb;
  v_company text;
  v_bank text;
  v_logo text;
  v_counter_before integer;
  v_counter_after integer;
  v_storage_before bigint;
  v_storage_after bigint;
  v_count integer;
  v_payload jsonb;
  v_model_first text := 'zz-pdf-first-' || left(gen_random_uuid()::text, 8);
  v_model_second text := 'zz-pdf-second-' || left(gen_random_uuid()::text, 8);
begin
  if to_regprocedure('public.prepare_pdf_retry(uuid)') is not null
    or to_regprocedure('public.confirm_pi_pdf(uuid)') is not null
    or to_regprocedure('private.can_write_pending_pdf(text)') is not null
  then
    v_fail := v_fail || 'pdf upload functions still exist; ';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('pi_pdfs_insert', 'pi_pdfs_delete')
  ) then
    v_fail := v_fail || 'pi-pdfs write policies still exist; ';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'pi_pdfs_select'
  ) then
    v_fail := v_fail || 'pi-pdfs select policy is missing; ';
  end if;
  if not exists (
    select 1 from pg_event_trigger where evtname = 'ensure_rls' and evtenabled = 'O'
  ) then
    v_fail := v_fail || 'ensure_rls trigger is missing; ';
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
    (v_instance, v_issuer, 'authenticated', 'authenticated', 'pdf-issuer-' || v_issuer::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"PDF Test Issuer"}'::jsonb, now(), now(), 'c-' || v_issuer::text, 'r-' || v_issuer::text, 'n-' || v_issuer::text, ''),
    (v_instance, v_reader, 'authenticated', 'authenticated', 'pdf-reader-' || v_reader::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"PDF Test Reader"}'::jsonb, now(), now(), 'c-' || v_reader::text, 'r-' || v_reader::text, 'n-' || v_reader::text, ''),
    (v_instance, v_stranger, 'authenticated', 'authenticated', 'pdf-stranger-' || v_stranger::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"PDF Test Stranger"}'::jsonb, now(), now(), 'c-' || v_stranger::text, 'r-' || v_stranger::text, 'n-' || v_stranger::text, '');

  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
      can_edit_drafts = true, can_generate_pis = true, full_name = 'PDF Test Issuer'
  where id = v_issuer;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
      can_edit_drafts = false, can_generate_pis = false, full_name = 'PDF Test Reader'
  where id = v_reader;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'associated',
      can_edit_drafts = false, can_generate_pis = false, full_name = 'PDF Test Stranger'
  where id = v_stranger;

  perform set_config('request.jwt.claims', json_build_object('sub', v_issuer::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_issuer::text, true);

  insert into public.clients (company_name, country, billing_address)
  values ('Snapshot Client', 'Egypt', 'Snapshot billing address')
  returning id into v_client;
  insert into public.vendors (company_name, country)
  values ('Snapshot Vendor', 'Egypt')
  returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_egp)
  values (v_vendor, v_model_first, 'Catalogue description', 'unit', 10)
  returning id into v_product_first;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_egp)
  values (v_vendor, v_model_second, 'Second catalogue description', 'set', 5)
  returning id into v_product_second;

  v_pi := public.create_pi_draft();
  update public.proforma_invoices set payment_schedule = null where id = v_pi;
  select company_name, bank_name, logo_base64
  into v_company, v_bank, v_logo
  from public.company_presets where code = 'EG-EGP';
  update public.company_presets
  set logo_base64 = 'LOGO-AT-ISSUE', logo_content_type = 'image/png'
  where code = 'EG-EGP';

  v_payload := jsonb_build_object(
    'preset_code', 'EG-EGP',
    'pi_date', '2026-10-19',
    'expiry_date', '2026-11-19',
    'client_id', v_client,
    'client_contact_id', null,
    'bill_to', 'Snapshot billing address',
    'ship_to', 'Snapshot shipping address',
    'ship_same_as_billing', false,
    'customer_reference', 'SNAPSHOT-REF',
    'lead_salesperson_id', v_issuer,
    'salesperson_ids', jsonb_build_array(v_issuer),
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
    'price_basis', 'Site Delivery',
    'payment_terms', '100% in advance',
    'payment_schedule', 'null'::jsonb,
    'delivery_terms', 'Available in stock',
    'warranty', '',
    'additional_notes', '',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', v_product_first, 'vendor_id', v_vendor, 'model_code', v_model_first, 'description', 'Snapshot pump', 'unit', 'unit', 'quantity', '2', 'unit_price', '10.00'),
      jsonb_build_object('product_id', v_product_second, 'vendor_id', v_vendor, 'model_code', v_model_second, 'description', 'Snapshot valve', 'unit', 'set', 'quantity', '1', 'unit_price', '5.00')
    )
  );

  select coalesce(last_value, 0) into v_counter_before
  from private.pi_counters where office = 'EG' and pi_year = 2026;
  if not found then
    v_counter_before := 0;
  end if;
  select count(*) into v_storage_before from storage.objects where bucket_id = 'pi-pdfs';

  v_result := public.generate_pi(v_pi, 1, v_payload);
  if v_result ? 'pdf_path' then
    v_fail := v_fail || 'generate result still returns pdf_path; ';
  end if;
  if coalesce(v_result ->> 'display_number', '') !~ '^EG-2026-[0-9]{5}$' then
    v_fail := v_fail || 'unexpected number ' || coalesce(v_result ->> 'display_number', 'null') || '; ';
  end if;
  if (v_result ->> 'revision')::integer <> 0 then
    v_fail := v_fail || 'first revision was not 0; ';
  end if;

  select id, snapshot into v_version, v_snapshot
  from public.pi_versions where id = (v_result ->> 'version_id')::uuid;
  v_original_snapshot := v_snapshot;
  if (select count(*) from public.pi_versions where pi_id = v_pi) <> 1 then
    v_fail := v_fail || 'expected one issued version; ';
  end if;
  if (select pdf_status from public.pi_versions where id = v_version) <> 'issued'
    or (select pdf_path from public.pi_versions where id = v_version) is not null
  then
    v_fail := v_fail || 'new version is not issued without a file path; ';
  end if;
  if v_snapshot ->> 'layout_version' <> 'egypt-v1' then
    v_fail := v_fail || 'layout was not egypt-v1; ';
  end if;
  if v_snapshot #>> '{lines,0,model_code}' <> v_model_first
    or v_snapshot #>> '{lines,1,model_code}' <> v_model_second
    or v_snapshot #>> '{lines,0,description}' <> 'Snapshot pump'
    or v_snapshot #>> '{client,company_name}' <> 'Snapshot Client'
    or v_snapshot #>> '{company,name}' <> v_company
    or v_snapshot #>> '{bank,bank_name}' <> v_bank
    or v_snapshot #>> '{company,logo_base64}' <> 'LOGO-AT-ISSUE'
    or v_snapshot #>> '{sales,prepared_by}' <> 'PDF Test Issuer'
    or v_snapshot #>> '{sales,lead_name}' <> 'PDF Test Issuer'
    or (v_snapshot #>> '{adjustments,grand_total}')::numeric <> 25
  then
    v_fail := v_fail || 'snapshot did not keep the issued content; ';
  end if;

  select last_value into v_counter_after
  from private.pi_counters where office = 'EG' and pi_year = 2026;
  if v_counter_after <> v_counter_before + 1 then
    v_fail := v_fail || 'counter did not advance once; ';
  end if;

  update public.products set description = 'CHANGED PRODUCT' where id = v_product_first;
  update public.pi_lines set description = 'CHANGED LINE' where pi_id = v_pi and position = 1;
  update public.clients set company_name = 'CHANGED CLIENT' where id = v_client;
  update public.company_presets
  set company_name = 'CHANGED COMPANY', bank_name = 'CHANGED BANK', logo_base64 = 'LOGO-AFTER'
  where code = 'EG-EGP';
  update public.profiles set full_name = 'CHANGED USER' where id = v_issuer;

  select snapshot into v_snapshot from public.pi_versions where id = v_version;
  if v_snapshot is distinct from v_original_snapshot
    or v_snapshot::text like '%CHANGED%'
    or v_snapshot::text like '%LOGO-AFTER%'
  then
    v_fail := v_fail || 'live edits changed the issued snapshot; ';
  end if;

  begin
    perform public.generate_pi(v_pi, 1, v_payload);
    v_fail := v_fail || 'second generate created another version; ';
  exception
    when others then
      if sqlerrm not like '%already issued%' then
        v_fail := v_fail || 'second generate: ' || sqlerrm || '; ';
      end if;
  end;
  if (select count(*) from public.pi_versions where pi_id = v_pi) <> 1 then
    v_fail := v_fail || 'second generate changed the version count; ';
  end if;
  if (select last_value from private.pi_counters where office = 'EG' and pi_year = 2026) <> v_counter_after then
    v_fail := v_fail || 'second generate allocated another number; ';
  end if;

  begin
    update public.pi_versions set pdf_path = 'replaced.pdf' where id = v_version;
    v_fail := v_fail || 'issued pdf metadata was writable; ';
  exception
    when others then
      if sqlerrm not like '%storage metadata%' then
        v_fail := v_fail || 'pdf metadata guard: ' || sqlerrm || '; ';
      end if;
  end;
  begin
    update public.pi_versions set snapshot = snapshot || '{"tampered":true}'::jsonb where id = v_version;
    v_fail := v_fail || 'issued snapshot was writable; ';
  exception
    when others then
      if sqlerrm not like '%immutable%' then
        v_fail := v_fail || 'snapshot guard: ' || sqlerrm || '; ';
      end if;
  end;

  insert into public.pi_versions (
    pi_id, revision, pi_number, generated_by, snapshot, pdf_status, pdf_path, layout_version, grand_total
  ) values
    (v_pi, 1, v_result ->> 'pi_number', v_issuer, v_original_snapshot || jsonb_build_object('display_number', 'LEGACY-PENDING'), 'pending', 'legacy-pending.pdf', 'egypt-v1', 25),
    (v_pi, 2, v_result ->> 'pi_number', v_issuer, v_original_snapshot || jsonb_build_object('display_number', 'LEGACY-READY'), 'ready', 'legacy-ready.pdf', 'egypt-v1', 25);

  select count(*) into v_storage_after from storage.objects where bucket_id = 'pi-pdfs';
  if v_storage_after <> v_storage_before then
    v_fail := v_fail || 'storage object count changed; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_reader::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from public.pi_versions where pi_id = v_pi;
  if v_count <> 3 then
    v_fail := v_fail || 'reader saw ' || v_count::text || ' versions; ';
  end if;
  if not exists (
    select 1 from public.pi_versions
    where pi_id = v_pi and pdf_status = 'pending' and snapshot ->> 'display_number' = 'LEGACY-PENDING'
  ) or not exists (
    select 1 from public.pi_versions
    where pi_id = v_pi and pdf_status = 'ready' and snapshot ->> 'display_number' = 'LEGACY-READY'
  ) or not exists (
    select 1 from public.pi_versions
    where pi_id = v_pi and pdf_status = 'issued' and snapshot #>> '{lines,0,description}' = 'Snapshot pump'
  ) then
    v_fail := v_fail || 'reader could not read pending, ready, and issued snapshots; ';
  end if;

  begin
    perform public.generate_pi(v_pi, 1, v_payload);
    v_fail := v_fail || 'reader without generate permission issued a PI; ';
  exception
    when others then
      if sqlerrm not like '%permission to generate%' then
        v_fail := v_fail || 'reader generate: ' || sqlerrm || '; ';
      end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  select count(*) into v_count from public.pi_versions where pi_id = v_pi;
  if v_count <> 0 then
    v_fail := v_fail || 'stranger saw ' || v_count::text || ' versions; ';
  end if;

  if v_fail <> '' then
    raise exception 'ON_DEMAND_PDF_TEST_FAIL %', v_fail;
  end if;
  raise exception 'ON_DEMAND_PDF_TEST_OK';
end
$test$;
