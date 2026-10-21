-- Rolled-back check for product PI history.
-- The block always raises, including on success, so none of its rows are committed.
-- Run it with a privileged database session against Value CRM after
-- 20261019150000_product_pi_history.sql. Do not remove the final RAISE.

do $test$
declare
  v_fail text := '';
  v_instance uuid;
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_owner uuid := gen_random_uuid();
  v_seller uuid := gen_random_uuid();
  v_preparer uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_sleeper uuid := gen_random_uuid();
  v_vendor uuid;
  v_product uuid;
  v_product_b uuid;
  v_alpha uuid;
  v_beta uuid;
  v_gamma uuid;
  v_delta uuid;
  v_model text;
  v_model_b text;
  v_model_renamed text;
  v_alpha_name text;
  v_alpha_new text;
  v_beta_name text;
  v_gamma_live text;
  v_gamma_saved text;
  v_gamma_changed text;
  v_delta_name text;
  v_legacy_number text;
  v_base jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_history jsonb;
  v_again jsonb;
  v_page jsonb;
  v_next jsonb;
  v_zero uuid;
  v_missing uuid;
  v_eur uuid;
  v_eur_version uuid;
  v_eur_line uuid;
  v_eur_snapshot jsonb;
  v_removed uuid;
  v_added uuid;
  v_lines uuid;
  v_duplicate uuid;
  v_legacy uuid;
  v_legacy_snapshot jsonb;
  v_sleeper_pi uuid;
  v_expected integer;
  v_count integer;
  v_total integer;
  v_owner_total integer;
  v_reader_total integer;
  v_issued_ord integer;
  v_draft_ord integer;
  v_prev text;
  v_date text;
  v_row jsonb;
  v_positions integer[];
  v_prices numeric[];
begin
  v_model := 'zz-hist-a-' || v_tag;
  v_model_b := 'zz-hist-b-' || v_tag;
  v_model_renamed := 'zz-hist-renamed-' || v_tag;
  v_alpha_name := 'zz-hist-alpha-' || v_tag;
  v_alpha_new := v_alpha_name || '-renamed';
  v_beta_name := 'zz-hist-beta-' || v_tag;
  v_gamma_live := 'zz-hist-gamma-live-' || v_tag;
  v_gamma_saved := 'zz-hist-gamma-saved-' || v_tag;
  v_gamma_changed := 'zz-hist-gamma-changed-' || v_tag;
  v_delta_name := 'zz-hist-delta-' || v_tag;
  v_legacy_number := 'ZZ-HIST-' || v_tag;

  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls' and evtenabled = 'O') then
    v_fail := v_fail || 'ensure_rls trigger is missing; ';
  end if;
  if has_function_privilege('anon', 'public.product_pi_history(uuid,boolean,text,text,text,integer,integer)', 'execute')
    or has_function_privilege('anon', 'private.product_pi_history(uuid,boolean,text,text,text,integer,integer)', 'execute')
    or has_function_privilege('authenticated', 'private.history_uuid(text)', 'execute')
  then
    v_fail := v_fail || 'history functions are granted too widely; ';
  end if;
  if not has_function_privilege('authenticated', 'public.product_pi_history(uuid,boolean,text,text,text,integer,integer)', 'execute')
    or not has_function_privilege('authenticated', 'private.product_pi_history(uuid,boolean,text,text,text,integer,integer)', 'execute')
  then
    v_fail := v_fail || 'authenticated cannot execute history; ';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'product_pi_history' and p.prosecdef
      and p.proconfig::text like '%search_path=%'
  ) or exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'product_pi_history' and p.prosecdef
  ) then
    v_fail := v_fail || 'history security definer or search_path is wrong; ';
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
    (v_instance, v_owner, 'authenticated', 'authenticated', 'zz-hist-owner-' || v_tag || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Hist Owner"}'::jsonb, now(), now(), 'c-o-' || v_tag, 'r-o-' || v_tag, 'n-o-' || v_tag, ''),
    (v_instance, v_seller, 'authenticated', 'authenticated', 'zz-hist-seller-' || v_tag || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Hist Seller"}'::jsonb, now(), now(), 'c-s-' || v_tag, 'r-s-' || v_tag, 'n-s-' || v_tag, ''),
    (v_instance, v_preparer, 'authenticated', 'authenticated', 'zz-hist-preparer-' || v_tag || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Hist Preparer"}'::jsonb, now(), now(), 'c-p-' || v_tag, 'r-p-' || v_tag, 'n-p-' || v_tag, ''),
    (v_instance, v_outsider, 'authenticated', 'authenticated', 'zz-hist-outsider-' || v_tag || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Hist Outsider"}'::jsonb, now(), now(), 'c-u-' || v_tag, 'r-u-' || v_tag, 'n-u-' || v_tag, ''),
    (v_instance, v_reader, 'authenticated', 'authenticated', 'zz-hist-reader-' || v_tag || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Hist Reader"}'::jsonb, now(), now(), 'c-r-' || v_tag, 'r-r-' || v_tag, 'n-r-' || v_tag, ''),
    (v_instance, v_sleeper, 'authenticated', 'authenticated', 'zz-hist-sleeper-' || v_tag || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Hist Sleeper"}'::jsonb, now(), now(), 'c-z-' || v_tag, 'r-z-' || v_tag, 'n-z-' || v_tag, '');

  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
      can_edit_drafts = true, can_generate_pis = true, can_view_purchase_prices = true, full_name = 'Hist Owner'
  where id = v_owner;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
      can_edit_drafts = false, can_generate_pis = false, full_name = 'Hist Seller'
  where id = v_seller;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'associated',
      can_edit_drafts = false, can_generate_pis = false, full_name = 'Hist Preparer'
  where id = v_preparer;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'associated',
      can_edit_drafts = false, can_generate_pis = false, full_name = 'Hist Outsider'
  where id = v_outsider;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = false, pi_visibility = 'all',
      can_edit_drafts = false, can_generate_pis = false, full_name = 'Hist Reader'
  where id = v_reader;
  update public.profiles
  set is_active = true, is_admin = false, is_salesperson = true, pi_visibility = 'associated',
      can_edit_drafts = true, can_generate_pis = true, full_name = 'Hist Sleeper'
  where id = v_sleeper;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into public.clients (company_name, country, billing_address) values (v_alpha_name, 'Egypt', 'Alpha billing') returning id into v_alpha;
  insert into public.clients (company_name, country, billing_address) values (v_beta_name, 'Egypt', 'Beta billing') returning id into v_beta;
  insert into public.clients (company_name, country, billing_address) values (v_gamma_live, 'Egypt', 'Gamma billing') returning id into v_gamma;
  insert into public.clients (company_name, country, billing_address) values (v_delta_name, 'Egypt', 'Delta billing') returning id into v_delta;
  insert into public.vendors (company_name, country) values ('zz-hist-vendor-' || v_tag, 'Egypt') returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_egp, sell_price_usd, sell_price_eur)
  values (v_vendor, v_model, 'Catalogue description', 'license', 100, 200, 300)
  returning id into v_product;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_egp)
  values (v_vendor, v_model_b, 'Other catalogue description', 'unit', 50)
  returning id into v_product_b;
  insert into public.product_costs (product_id, purchase_price, purchase_currency)
  values (v_product, 123456.78, 'USD');

  v_base := jsonb_build_object(
    'client_contact_id', null,
    'bill_to', 'Hist billing',
    'ship_to', 'Hist billing',
    'ship_same_as_billing', true,
    'customer_reference', '',
    'lead_salesperson_id', v_owner,
    'salesperson_ids', jsonb_build_array(v_owner),
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
    'expiry_date', '2026-12-19'
  );

  v_zero := public.create_pi_draft();
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'EG-EGP', 'pi_date', '2026-10-16', 'client_id', v_alpha,
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Explicit zero', 'unit', 'license', 'quantity', '2', 'unit_price', '0'
    ))
  );
  perform public.save_pi_draft(v_zero, 1, v_payload);

  v_missing := public.create_pi_draft();
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-17', 'client_id', v_alpha,
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Missing price', 'unit', 'license', 'quantity', '1', 'unit_price', null
    ))
  );
  perform public.save_pi_draft(v_missing, 1, v_payload);

  v_eur := public.create_pi_draft();
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'AE-EUR', 'pi_date', '2026-10-18', 'client_id', v_alpha,
    'discount_type', 'percent', 'discount_value', '10',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'Discounted quote', 'unit', 'license', 'quantity', '1', 'unit_price', '10.50'),
      jsonb_build_object('product_id', v_product_b, 'vendor_id', v_vendor, 'model_code', v_model_b, 'description', 'Other product only', 'unit', 'unit', 'quantity', '1', 'unit_price', '4.00')
    )
  );
  v_result := public.generate_pi(v_eur, 1, v_payload);
  v_eur_version := (v_result ->> 'version_id')::uuid;
  select id into v_eur_line from public.pi_lines where pi_id = v_eur and position = 1;
  select snapshot into v_eur_snapshot from public.pi_versions where id = v_eur_version;
  if v_eur_snapshot #>> '{lines,0,product_id}' is distinct from v_product::text
    or v_eur_snapshot #>> '{lines,0,line_id}' is distinct from v_eur_line::text
    or v_eur_snapshot #>> '{lines,0,position}' is distinct from '1'
    or v_eur_snapshot #>> '{lines,0,model_code}' is distinct from v_model
    or v_eur_snapshot #>> '{lines,0,unit_price}' is null
  then
    v_fail := v_fail || 'new snapshot did not keep line identity; ';
  end if;
  if (select pdf_status from public.pi_versions where id = v_eur_version) is distinct from 'issued'
    or (select pdf_path from public.pi_versions where id = v_eur_version) is not null
  then
    v_fail := v_fail || 'new version is not an issued snapshot without a file; ';
  end if;

  v_removed := public.create_pi_draft();
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'EG-EGP', 'pi_date', '2026-08-01', 'client_id', v_alpha,
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Removed later', 'unit', 'license', 'quantity', '1', 'unit_price', '42.00'
    ))
  );
  perform public.generate_pi(v_removed, 1, v_payload);
  v_expected := public.create_pi_revision(v_removed);
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'EG-EGP', 'pi_date', '2026-08-15', 'client_id', v_alpha,
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product_b, 'vendor_id', v_vendor, 'model_code', v_model_b,
      'description', 'Replacement only', 'unit', 'unit', 'quantity', '1', 'unit_price', '9.00'
    ))
  );
  perform public.generate_pi(v_removed, v_expected, v_payload);
  update public.proforma_invoices set tracking_status = 'cancelled' where id = v_removed;

  v_added := public.create_pi_draft();
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-07-01', 'client_id', v_beta,
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product_b, 'vendor_id', v_vendor, 'model_code', v_model_b,
      'description', 'Before A existed', 'unit', 'unit', 'quantity', '1', 'unit_price', '6.00'
    ))
  );
  perform public.generate_pi(v_added, 1, v_payload);
  v_expected := public.create_pi_revision(v_added);
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-07-20', 'client_id', v_beta,
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Added later', 'unit', 'license', 'quantity', '3', 'unit_price', '77.00'
    ))
  );
  perform public.generate_pi(v_added, v_expected, v_payload);
  update public.proforma_invoices set tracking_status = 'accepted' where id = v_added;
  insert into public.pi_salespeople (pi_id, user_id) values (v_added, v_seller);

  v_lines := public.create_pi_draft();
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'AE-USD', 'pi_date', '2026-10-10', 'client_id', v_alpha,
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'First saved line', 'unit', 'license', 'quantity', '2', 'unit_price', '15.00'),
      jsonb_build_object('product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model, 'description', 'Second saved line', 'unit', 'set', 'quantity', '5', 'unit_price', '0'),
      jsonb_build_object('product_id', v_product_b, 'vendor_id', v_vendor, 'model_code', v_model_b, 'description', 'Other product only', 'unit', 'unit', 'quantity', '1', 'unit_price', '2.00')
    )
  );
  perform public.generate_pi(v_lines, 1, v_payload);
  v_duplicate := public.duplicate_pi(v_lines);
  update public.proforma_invoices set tracking_status = 'sent' where id = v_lines;

  insert into public.proforma_invoices (
    preset_code, office, currency, pi_number, pi_date, client_id, bill_to, draft_open, tracking_status, created_by
  ) values (
    'AE-USD', 'AE', 'USD', v_legacy_number, '2026-06-01', v_gamma, 'Gamma billing', false, 'sent', v_owner
  ) returning id into v_legacy;
  v_legacy_snapshot := jsonb_build_object(
    'currency', 'USD',
    'pi_date', '2026-06-01',
    'pi_number', v_legacy_number,
    'revision', 0,
    'display_number', v_legacy_number,
    'revision_label', null,
    'client', jsonb_build_object('company_name', v_gamma_saved),
    'lines', jsonb_build_array(
      jsonb_build_object('model_code', '  ' || upper(v_model) || '  ', 'description', 'Legacy description', 'unit', 'set', 'quantity', '4', 'unit_price', '7.25', 'line_total', '29.00'),
      jsonb_build_object('product_id', v_product_b, 'model_code', v_model, 'description', 'Wrong product id', 'unit', 'unit', 'quantity', '1', 'unit_price', '1.00', 'line_total', '1.00'),
      jsonb_build_object('product_id', v_product, 'line_id', gen_random_uuid(), 'position', 3, 'model_code', 'NOT-THE-MODEL', 'description', 'Identity line', 'unit', 'license', 'quantity', '3', 'unit_price', '8.00', 'line_total', '24.00')
    ),
    'adjustments', jsonb_build_object('discount_type', 'fixed', 'discount_value', '5', 'discount_amount', '5.00')
  );
  insert into public.pi_versions (
    pi_id, revision, pi_number, generated_by, snapshot, pdf_status, pdf_path, layout_version, grand_total
  ) values (
    v_legacy, 0, v_legacy_number, v_preparer, v_legacy_snapshot, 'issued', null, 'egypt-v1', 0
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_sleeper::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sleeper::text, true);
  v_sleeper_pi := public.create_pi_draft();
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'EG-EGP', 'pi_date', '2026-05-01', 'client_id', v_delta,
    'lead_salesperson_id', v_sleeper, 'salesperson_ids', jsonb_build_array(v_sleeper),
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Sleeper draft', 'unit', 'license', 'quantity', '1', 'unit_price', '3.00'
    ))
  );
  perform public.save_pi_draft(v_sleeper_pi, 1, v_payload);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  update public.clients set company_name = v_alpha_new where id = v_alpha;
  update public.clients set company_name = v_gamma_changed where id = v_gamma;
  update public.products set description = 'Changed catalogue', sell_price_eur = 1, sell_price_usd = 1, sell_price_egp = 1 where id = v_product;
  update public.pi_lines set unit_price = 9999, description = 'Changed working copy' where pi_id = v_eur;

  v_history := public.product_pi_history(v_product, false, null, null, null, 100, 0);
  if v_history::text like '%123456.78%' or v_history::text like '%purchase%' or v_history::text like '%EG590010007200000100022610548%' then
    v_fail := v_fail || 'history leaked cost, purchase, or bank data; ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_history -> 'rows') item
    where (item ->> 'unit_price')::numeric = 9999 or item ->> 'description' = 'Changed working copy'
  ) then
    v_fail := v_fail || 'closed working copy was used as history; ';
  end if;
  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_eur::text and item ->> 'source' = 'latest_issued'
    and (item ->> 'unit_price')::numeric = 10.50 and item ->> 'currency' = 'EUR'
    and item ->> 'client_name' = v_alpha_name and item ->> 'pi_status' = 'issued'
    and (item ->> 'discount_on_pi')::boolean and item ->> 'discount_type' = 'percent'
    and (item ->> 'discount_value')::numeric = 10 and item ->> 'match_kind' = 'product_id'
    and item ->> 'model_code' = v_model and item ->> 'description' = 'Discounted quote';
  if v_count <> 1 then
    v_fail := v_fail || 'eur latest quoted price was not the snapshot; ';
  end if;
  if (select snapshot from public.pi_versions where id = v_eur_version) is distinct from v_eur_snapshot then
    v_fail := v_fail || 'catalogue edits changed the issued snapshot; ';
  end if;

  v_expected := public.create_pi_revision(v_eur);
  v_payload := v_base || jsonb_build_object(
    'preset_code', 'AE-EUR', 'pi_date', '2026-10-18', 'client_id', v_alpha,
    'discount_type', 'percent', 'discount_value', '10',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Revision draft price', 'unit', 'license', 'quantity', '4', 'unit_price', '99.00'
    ))
  );
  perform public.save_pi_draft(v_eur, v_expected, v_payload);

  v_history := public.product_pi_history(v_product, true, null, null, null, 100, 0);
  v_again := public.product_pi_history(v_product, true, null, null, null, 100, 0);
  if v_history <> v_again then
    v_fail := v_fail || 'history order was not deterministic; ';
  end if;
  v_owner_total := (v_history ->> 'total')::integer;
  if v_owner_total <> jsonb_array_length(v_history -> 'rows') or v_owner_total > 100 then
    v_fail := v_fail || 'owner count did not match the returned rows; ';
  end if;
  v_prev := '9999-12-31';
  for v_row in select value from jsonb_array_elements(v_history -> 'rows')
  loop
    v_date := v_row ->> 'pi_date';
    if v_date > v_prev then
      v_fail := v_fail || 'history was not newest first; ';
      exit;
    end if;
    v_prev := v_date;
  end loop;

  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_eur::text;
  if v_count <> 2 then
    v_fail := v_fail || 'eur did not keep issued and revision draft; ';
  end if;
  select min(ordinality) filter (where value ->> 'source' = 'latest_issued'),
         min(ordinality) filter (where value ->> 'source' = 'revision_draft')
  into v_issued_ord, v_draft_ord
  from jsonb_array_elements(v_history -> 'rows') with ordinality
  where value ->> 'pi_id' = v_eur::text;
  if v_issued_ord is null or v_draft_ord is null or v_issued_ord > v_draft_ord then
    v_fail := v_fail || 'latest issued did not sort before its revision draft; ';
  end if;
  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_eur::text and item ->> 'source' = 'revision_draft'
    and (item ->> 'unit_price')::numeric = 99 and item ->> 'pi_status' = 'draft'
    and item ->> 'pi_number' = (select pi_number from public.proforma_invoices where id = v_eur)
    and item ->> 'display_number' is null and item ->> 'client_name' = v_alpha_new;
  if v_count <> 1 then
    v_fail := v_fail || 'revision draft did not use saved draft values; ';
  end if;

  if exists (select 1 from jsonb_array_elements(v_history -> 'rows') item where item ->> 'pi_id' = v_removed::text and item ->> 'source' <> 'older_revision')
    or (select count(*) from jsonb_array_elements(v_history -> 'rows') item where item ->> 'pi_id' = v_removed::text) <> 1
  then
    v_fail := v_fail || 'removed product was not limited to the older revision; ';
  end if;
  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_removed::text and item ->> 'source' = 'older_revision' and (item ->> 'revision')::integer = 0
    and (item ->> 'unit_price')::numeric = 42 and item ->> 'pi_status' = 'cancelled'
    and item ->> 'display_number' = (select pi_number from public.proforma_invoices where id = v_removed)
    and item ->> 'display_number' not like '%-R%';
  if v_count <> 1 then
    v_fail := v_fail || 'older revision did not keep its own label and price; ';
  end if;
  v_page := public.product_pi_history(v_product, false, null, null, null, 100, 0);
  if exists (select 1 from jsonb_array_elements(v_page -> 'rows') item where item ->> 'pi_id' = v_removed::text) then
    v_fail := v_fail || 'default history showed a product removed from the latest revision; ';
  end if;
  if v_page -> 'statuses' ? 'cancelled' then
    v_fail := v_fail || 'default status options revealed an older revision; ';
  end if;
  if (public.product_pi_history(v_product, null, null, null, 'cancelled', 100, 0) ->> 'total')::integer <> 0 then
    v_fail := v_fail || 'null older flag still counted a removed revision; ';
  end if;

  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item where item ->> 'pi_id' = v_added::text;
  if v_count <> 1 then
    v_fail := v_fail || 'product added later was not a single latest row; ';
  end if;
  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_added::text and item ->> 'source' = 'latest_issued' and (item ->> 'revision')::integer = 1
    and (item ->> 'unit_price')::numeric = 77 and item ->> 'currency' = 'USD' and item ->> 'client_name' = v_beta_name
    and item ->> 'pi_status' = 'accepted' and item ->> 'display_number' like '%-R1' and item ->> 'description' = 'Added later';
  if v_count <> 1 then
    v_fail := v_fail || 'later revision price or label was wrong; ';
  end if;

  select array_agg((item.value ->> 'position')::integer order by ordinality),
         array_agg((item.value ->> 'unit_price')::numeric order by ordinality)
  into v_positions, v_prices
  from jsonb_array_elements(v_history -> 'rows') with ordinality item
  where item.value ->> 'pi_id' = v_lines::text and item.value ->> 'source' = 'latest_issued';
  if v_positions is distinct from array[1, 2] or v_prices is distinct from array[15, 0]::numeric[] then
    v_fail := v_fail || 'matching lines were merged or reordered; ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_history -> 'rows') item
    where item ->> 'description' in ('Other product only', 'Wrong product id', 'Replacement only', 'Before A existed')
  ) then
    v_fail := v_fail || 'another product was included; ';
  end if;

  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_duplicate::text and item ->> 'source' = 'initial_draft';
  if v_duplicate = v_lines or v_count <> 2 then
    v_fail := v_fail || 'duplicate PI was not an independent draft; ';
  end if;

  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'description' = 'Explicit zero' and item ->> 'source' = 'initial_draft'
    and item ->> 'currency' = 'EGP' and (item ->> 'unit_price')::numeric = 0 and item ->> 'unit_price' is not null
    and item ->> 'client_name' = v_alpha_new and item ->> 'pi_status' = 'draft';
  if v_count <> 1 then
    v_fail := v_fail || 'explicit zero was not preserved on the draft; ';
  end if;
  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'description' = 'Missing price' and item ->> 'currency' = 'USD' and item ->> 'unit_price' is null;
  if v_count <> 1 then
    v_fail := v_fail || 'missing price was turned into a number; ';
  end if;

  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_legacy::text and item ->> 'match_kind' = 'legacy_model'
    and item ->> 'description' = 'Legacy description' and (item ->> 'unit_price')::numeric = 7.25
    and item ->> 'client_name' = v_gamma_saved and item ->> 'model_code' = '  ' || upper(v_model) || '  '
    and (item ->> 'discount_on_pi')::boolean and item ->> 'discount_type' = 'fixed';
  if v_count <> 1 then
    v_fail := v_fail || 'legacy model match failed; ';
  end if;
  select count(*) into v_count from jsonb_array_elements(v_history -> 'rows') item
  where item ->> 'pi_id' = v_legacy::text and item ->> 'match_kind' = 'product_id'
    and item ->> 'description' = 'Identity line' and item ->> 'model_code' = 'NOT-THE-MODEL'
    and (item ->> 'unit_price')::numeric = 8 and (item ->> 'position')::integer = 3;
  if v_count <> 1 then
    v_fail := v_fail || 'stored product id did not win over model text; ';
  end if;
  if (select snapshot -> 'lines' -> 0 ? 'product_id' from public.pi_versions where pi_id = v_legacy) then
    v_fail := v_fail || 'legacy snapshot was rewritten; ';
  end if;

  if not (v_history -> 'currencies' = '["EGP","USD","EUR"]'::jsonb) then
    v_fail := v_fail || 'currencies were converted or incomplete; ';
  end if;
  if not (v_history -> 'clients' ? v_alpha_name and v_history -> 'clients' ? v_alpha_new and v_history -> 'clients' ? v_beta_name and v_history -> 'clients' ? v_gamma_saved)
    or v_history -> 'clients' ? v_delta_name or v_history -> 'clients' ? v_gamma_changed or v_history -> 'clients' ? v_gamma_live
  then
    v_fail := v_fail || 'client options did not follow saved names; ';
  end if;

  v_page := public.product_pi_history(v_product, true, v_alpha_name, null, null, 100, 0);
  if (v_page ->> 'total')::integer <> jsonb_array_length(v_page -> 'rows')
    or exists (select 1 from jsonb_array_elements(v_page -> 'rows') item where item ->> 'client_name' is distinct from v_alpha_name)
    or exists (select 1 from jsonb_array_elements(v_page -> 'rows') item where item ->> 'source' in ('initial_draft', 'revision_draft'))
  then
    v_fail := v_fail || 'saved client filter did not match issued rows only; ';
  end if;
  v_page := public.product_pi_history(v_product, true, null, 'EUR', null, 100, 0);
  if (v_page ->> 'total')::integer <> 2
    or exists (select 1 from jsonb_array_elements(v_page -> 'rows') item where item ->> 'currency' is distinct from 'EUR')
  then
    v_fail := v_fail || 'currency filter mixed currencies; ';
  end if;
  v_page := public.product_pi_history(v_product, true, null, null, 'draft', 100, 0);
  if exists (select 1 from jsonb_array_elements(v_page -> 'rows') item where item ->> 'source' in ('latest_issued', 'older_revision')) then
    v_fail := v_fail || 'draft filter included issued rows; ';
  end if;
  v_page := public.product_pi_history(v_product, true, null, null, 'issued', 100, 0);
  if (v_page ->> 'total')::integer <> 1 or (v_page -> 'rows' -> 0 ->> 'pi_id') is distinct from v_eur::text then
    v_fail := v_fail || 'issued status did not mean the current tracking status; ';
  end if;
  v_page := public.product_pi_history(v_product, true, null, null, 'sent', 100, 0);
  if (v_page ->> 'total')::integer <> 4 then
    v_fail := v_fail || 'sent filter count was ' || coalesce(v_page ->> 'total', 'null') || '; ';
  end if;
  if (public.product_pi_history(v_product, false, null, null, 'cancelled', 100, 0) ->> 'total')::integer <> 0
    or (public.product_pi_history(v_product, true, null, null, 'cancelled', 100, 0) ->> 'total')::integer <> 1
  then
    v_fail := v_fail || 'cancelled count did not follow the older-revision switch; ';
  end if;

  v_page := public.product_pi_history(v_product, true, null, null, null, 1, 0);
  v_next := public.product_pi_history(v_product, true, null, null, null, 1, 1);
  if (v_page ->> 'total')::integer <> v_owner_total
    or (v_next ->> 'total')::integer <> v_owner_total
    or jsonb_array_length(v_page -> 'rows') <> 1
    or (v_page -> 'rows' -> 0) is distinct from (v_history -> 'rows' -> 0)
    or (v_next -> 'rows' -> 0) is distinct from (v_history -> 'rows' -> 1)
    or (v_page -> 'rows' -> 0 ->> 'row_id') = (v_next -> 'rows' -> 0 ->> 'row_id')
  then
    v_fail := v_fail || 'pagination did not use the same count and order; ';
  end if;
  if (public.product_pi_history(v_product, true, null, null, null, 1, -5) -> 'rows' -> 0) is distinct from (v_page -> 'rows' -> 0) then
    v_fail := v_fail || 'negative offset was not treated as the first page; ';
  end if;

  v_total := v_owner_total;
  update public.products set archived_at = now() where id = v_product;
  update public.vendors set archived_at = now() where id = v_vendor;
  if (public.product_pi_history(v_product, true, null, null, null, 100, 0) ->> 'total')::integer <> v_total then
    v_fail := v_fail || 'archiving the product or vendor erased history; ';
  end if;
  update public.products set archived_at = null, model_code = v_model_renamed where id = v_product;
  v_page := public.product_pi_history(v_product, true, null, null, null, 100, 0);
  if exists (select 1 from jsonb_array_elements(v_page -> 'rows') item where item ->> 'description' = 'Legacy description') then
    v_fail := v_fail || 'renamed model still matched a legacy snapshot; ';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_page -> 'rows') item
    where item ->> 'description' = 'Identity line' and item ->> 'match_kind' = 'product_id'
  ) or not exists (
    select 1 from jsonb_array_elements(v_page -> 'rows') item
    where item ->> 'description' = 'Discounted quote' and item ->> 'model_code' = v_model
  ) then
    v_fail := v_fail || 'product id match did not survive the rename; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_seller::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_seller::text, true);
  v_page := public.product_pi_history(v_product, true, null, null, null, 100, 0);
  if (v_page ->> 'total')::integer <> 1
    or v_page -> 'clients' is distinct from jsonb_build_array(v_beta_name)
    or (v_page -> 'rows' -> 0 ->> 'pi_id') is distinct from v_added::text
  then
    v_fail := v_fail || 'assigned seller saw another client or PI; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_preparer::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_preparer::text, true);
  v_page := public.product_pi_history(v_product, true, null, null, null, 100, 0);
  if (v_page ->> 'total')::integer <> 1 or v_page -> 'clients' is distinct from jsonb_build_array(v_gamma_saved) then
    v_fail := v_fail || 'preparer visibility did not follow the issued version; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  v_page := public.product_pi_history(v_product, true, v_alpha_name, 'EUR', 'sent', 100, 0);
  if (v_page ->> 'total')::integer <> 0 or v_page -> 'rows' <> '[]'::jsonb or v_page -> 'clients' <> '[]'::jsonb
    or v_page -> 'currencies' <> '[]'::jsonb or v_page -> 'statuses' <> '[]'::jsonb
  then
    v_fail := v_fail || 'outsider received rows or filter options; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_reader::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  v_page := public.product_pi_history(v_product, true, null, null, null, 100, 0);
  v_reader_total := (v_page ->> 'total')::integer;
  -- owner_total includes the legacy model row. The rename removed that row, and this
  -- reader also sees the sleeper draft, so the two differences cancel.
  if v_reader_total <> v_owner_total
    or not exists (select 1 from jsonb_array_elements(v_page -> 'rows') item where item ->> 'description' = 'Sleeper draft')
  then
    v_fail := v_fail || 'all-visibility reader missed an authorized draft; ';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  if exists (
    select 1 from jsonb_array_elements(public.product_pi_history(v_product, true, null, null, null, 100, 0) -> 'rows') item
    where item ->> 'description' = 'Sleeper draft' or item ->> 'client_name' = v_delta_name
  ) then
    v_fail := v_fail || 'associated owner saw another user''s draft; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sleeper::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sleeper::text, true);
  if (public.product_pi_history(v_product, false, null, null, null, 100, 0) ->> 'total')::integer <> 1 then
    v_fail := v_fail || 'sleeper could not see their own draft; ';
  end if;
  update public.profiles set is_active = false where id = v_sleeper;
  v_page := public.product_pi_history(v_product, true, null, null, null, 100, 0);
  if (v_page ->> 'total')::integer <> 0 or v_page -> 'clients' <> '[]'::jsonb then
    v_fail := v_fail || 'inactive user still received history; ';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_reader::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  if (public.product_pi_history(v_product, true, null, null, null, 100, 0) ->> 'total')::integer <> v_reader_total then
    v_fail := v_fail || 'deactivating a user erased history for someone else; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  begin
    execute 'set local role authenticated';
    if (public.product_pi_history(v_product, true, null, null, null, 100, 0) ->> 'total')::integer <> 0 then
      v_fail := v_fail || 'authenticated outsider received rows; ';
    end if;
  exception
    when others then
      v_fail := v_fail || 'authenticated history call failed: ' || sqlerrm || '; ';
  end;

  if v_fail <> '' then
    raise exception 'PRODUCT_PI_HISTORY_FAIL %', v_fail;
  end if;
  raise exception 'PRODUCT_PI_HISTORY_OK';
end
$test$;
