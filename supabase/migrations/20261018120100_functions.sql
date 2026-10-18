-- Privileged PI operations live in the private schema. Public wrappers are security invoker
-- and are the only functions exposed to the API.

create or replace function private.as_numeric(p_value text, p_label text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  if btrim(p_value) !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception '% must be a nonnegative number.', p_label;
  end if;
  return btrim(p_value)::numeric;
end;
$$;

create or replace function private.as_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception
  when invalid_text_representation then
    raise exception 'Invalid identifier.';
end;
$$;

create or replace function private.as_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  if btrim(p_value) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid date.';
  end if;
  return btrim(p_value)::date;
exception
  when datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid date.';
end;
$$;

create or replace function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_active
  );
$$;

create or replace function private.has_flag(p_flag text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles;
begin
  select * into v from public.profiles where id = (select auth.uid());
  if not found or not v.is_active then
    return false;
  end if;
  if v.is_admin then
    return true;
  end if;
  case p_flag
    when 'can_edit_drafts' then return v.can_edit_drafts;
    when 'can_generate_pis' then return v.can_generate_pis;
    when 'can_manage_clients' then return v.can_manage_clients;
    when 'can_manage_vendors' then return v.can_manage_vendors;
    when 'can_manage_products' then return v.can_manage_products;
    when 'can_view_purchase_prices' then return v.can_view_purchase_prices;
    else return false;
  end case;
end;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_active and is_admin
  );
$$;

create or replace function private.can_read_pi(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or exists (
      select 1
      from public.profiles me
      where me.id = (select auth.uid())
        and me.is_active
        and (
          me.pi_visibility = 'all'
          or exists (
            select 1 from public.proforma_invoices pi
            where pi.id = p_id and pi.created_by = me.id
          )
          or exists (
            select 1 from public.pi_salespeople s
            where s.pi_id = p_id and s.user_id = me.id
          )
          or exists (
            select 1 from public.pi_versions v
            where v.pi_id = p_id and v.generated_by = me.id
          )
        )
    );
$$;

create or replace function private.allocate_serial(p_office text, p_year integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value integer;
begin
  insert into private.pi_counters as c (office, pi_year, last_value)
  values (p_office, p_year, 1)
  on conflict (office, pi_year)
  do update set last_value = c.last_value + 1
  returning last_value into v_value;
  return v_value;
end;
$$;

create or replace function private.recalculate_pi(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_line public.pi_lines;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_net numeric;
  v_base numeric;
  v_tax numeric := 0;
  v_grand numeric;
  v_line_total numeric;
begin
  select * into v_pi from public.proforma_invoices where id = p_id;
  for v_line in
    select * from public.pi_lines where pi_id = p_id order by position
  loop
    if v_line.unit_price is null then
      update public.pi_lines set line_total = null where id = v_line.id;
    else
      v_line_total := round(v_line.quantity * v_line.unit_price, 2);
      update public.pi_lines set line_total = v_line_total where id = v_line.id;
      v_subtotal := v_subtotal + v_line_total;
    end if;
  end loop;

  if v_pi.discount_type = 'percent' then
    if coalesce(v_pi.discount_value, 0) > 100 then
      raise exception 'Percentage discount must be between 0 and 100.';
    end if;
    v_discount := round(v_subtotal * coalesce(v_pi.discount_value, 0) / 100, 2);
  elsif v_pi.discount_type = 'fixed' then
    v_discount := coalesce(v_pi.discount_value, 0);
    if v_discount > v_subtotal then
      raise exception 'Fixed discount cannot be greater than the item subtotal.';
    end if;
  else
    v_discount := 0;
  end if;

  v_net := v_subtotal - v_discount;
  v_base := v_net;
  if not v_pi.tax_excludes_shipping then
    v_base := v_base + coalesce(v_pi.shipping_amount, 0);
  end if;
  if not v_pi.tax_excludes_installation then
    v_base := v_base + coalesce(v_pi.installation_amount, 0);
  end if;
  if not v_pi.tax_excludes_bank_charge then
    v_base := v_base + coalesce(v_pi.bank_charge_amount, 0);
  end if;

  if v_pi.tax_enabled then
    if coalesce(v_pi.tax_percent, 0) > 100 then
      raise exception 'Tax percentage must be between 0 and 100.';
    end if;
    v_tax := round(v_base * coalesce(v_pi.tax_percent, 0) / 100, 2);
  end if;

  v_grand := v_net
    + coalesce(v_pi.shipping_amount, 0)
    + coalesce(v_pi.installation_amount, 0)
    + coalesce(v_pi.bank_charge_amount, 0)
    + v_tax;

  update public.proforma_invoices
  set subtotal = v_subtotal,
      discount_amount = v_discount,
      net_items = v_net,
      taxable_base = case when v_pi.tax_enabled then v_base else null end,
      tax_amount = v_tax,
      grand_total = v_grand
  where id = p_id;
end;
$$;

create or replace function private.persist_draft(p_id uuid, p_expected_version integer, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_preset_code text;
  v_office text;
  v_currency text;
  v_date date;
  v_expiry date;
  v_client uuid;
  v_contact uuid;
  v_lead uuid;
  v_sales uuid[];
  v_line jsonb;
  v_index integer := 0;
  v_product uuid;
  v_vendor uuid;
  v_vendor_name text;
  v_quantity numeric;
  v_price numeric;
begin
  if not private.is_active_member() then
    raise exception 'Your account is disabled or you are not signed in.';
  end if;
  if not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to edit drafts.';
  end if;

  select * into v_pi from public.proforma_invoices where id = p_id for update;
  if not found then
    raise exception 'PI not found.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  if not v_pi.draft_open then
    raise exception 'This PI is not an open draft. Create a revision before editing.';
  end if;
  if v_pi.tracking_status = 'cancelled' then
    raise exception 'Cancelled PIs cannot be edited.';
  end if;
  if v_pi.draft_version <> p_expected_version then
    raise exception 'This draft was updated by someone else. Reload the draft and try again.'
      using errcode = '40001';
  end if;

  v_preset_code := nullif(p_payload ->> 'preset_code', '');
  v_date := private.as_date(p_payload ->> 'pi_date');
  v_expiry := private.as_date(p_payload ->> 'expiry_date');
  v_client := private.as_uuid(p_payload ->> 'client_id');
  v_contact := private.as_uuid(p_payload ->> 'client_contact_id');
  v_lead := private.as_uuid(p_payload ->> 'lead_salesperson_id');

  if v_pi.pi_number is not null then
    if v_preset_code is distinct from v_pi.preset_code then
      raise exception 'Office and currency cannot change after a PI number is issued. Duplicate the PI instead.';
    end if;
    if v_date is not null and extract(year from v_date)::integer <> v_pi.pi_year then
      raise exception 'The PI year cannot change after a number is issued. Duplicate the PI instead.';
    end if;
  end if;

  if v_preset_code is not null then
    select office, currency into v_office, v_currency
    from public.company_presets where code = v_preset_code;
    if not found then
      raise exception 'Unknown office preset.';
    end if;
  end if;

  if v_client is not null and not exists (select 1 from public.clients where id = v_client) then
    raise exception 'Client not found.';
  end if;
  if v_contact is not null and not exists (
    select 1 from public.client_contacts where id = v_contact and client_id = v_client
  ) then
    raise exception 'The contact does not belong to the selected client.';
  end if;
  if v_lead is not null and not exists (
    select 1 from public.profiles where id = v_lead and is_salesperson
  ) then
    raise exception 'Lead salesperson must be a registered user marked as a salesperson.';
  end if;

  select coalesce(array_agg(distinct private.as_uuid(value)), '{}')
  into v_sales
  from jsonb_array_elements_text(coalesce(p_payload -> 'salesperson_ids', '[]'::jsonb)) as ids(value)
  where nullif(value, '') is not null;

  if v_lead is not null and not v_lead = any(v_sales) then
    v_sales := array_append(v_sales, v_lead);
  end if;
  if exists (
    select 1 from unnest(v_sales) as assigned(id)
    where not exists (select 1 from public.profiles p where p.id = assigned.id and p.is_salesperson)
  ) then
    raise exception 'Every assigned salesperson must be a registered user marked as a salesperson.';
  end if;

  if char_length(coalesce(p_payload ->> 'bill_to', '')) > 4000
    or char_length(coalesce(p_payload ->> 'ship_to', '')) > 4000
    or char_length(coalesce(p_payload ->> 'additional_notes', '')) > 8000
  then
    raise exception 'One of the text fields is too long.';
  end if;

  update public.proforma_invoices
  set preset_code = v_preset_code,
      office = v_office,
      currency = v_currency,
      pi_date = v_date,
      expiry_date = v_expiry,
      client_id = v_client,
      client_contact_id = v_contact,
      bill_to = coalesce(p_payload ->> 'bill_to', ''),
      ship_to = case when coalesce((p_payload ->> 'ship_same_as_billing')::boolean, true)
        then coalesce(p_payload ->> 'bill_to', '')
        else coalesce(p_payload ->> 'ship_to', '') end,
      ship_same_as_billing = coalesce((p_payload ->> 'ship_same_as_billing')::boolean, true),
      customer_reference = coalesce(p_payload ->> 'customer_reference', ''),
      lead_salesperson_id = v_lead,
      discount_type = coalesce(p_payload ->> 'discount_type', 'none'),
      discount_value = private.as_numeric(p_payload ->> 'discount_value', 'Discount'),
      shipping_amount = private.as_numeric(p_payload ->> 'shipping_amount', 'Shipping'),
      installation_amount = private.as_numeric(p_payload ->> 'installation_amount', 'Installation'),
      bank_charge_amount = private.as_numeric(p_payload ->> 'bank_charge_amount', 'Bank charge'),
      tax_enabled = coalesce((p_payload ->> 'tax_enabled')::boolean, false),
      tax_percent = private.as_numeric(p_payload ->> 'tax_percent', 'Tax percentage'),
      tax_excludes_shipping = coalesce((p_payload ->> 'tax_excludes_shipping')::boolean, false),
      tax_excludes_installation = coalesce((p_payload ->> 'tax_excludes_installation')::boolean, false),
      tax_excludes_bank_charge = coalesce((p_payload ->> 'tax_excludes_bank_charge')::boolean, false),
      price_basis = coalesce(p_payload ->> 'price_basis', ''),
      payment_terms = coalesce(p_payload ->> 'payment_terms', ''),
      delivery_terms = coalesce(p_payload ->> 'delivery_terms', ''),
      warranty = coalesce(p_payload ->> 'warranty', ''),
      additional_notes = coalesce(p_payload ->> 'additional_notes', ''),
      draft_version = draft_version + 1,
      updated_at = now()
  where id = p_id;

  if (select discount_type from public.proforma_invoices where id = p_id) not in ('none', 'fixed', 'percent') then
    raise exception 'Invalid discount type.';
  end if;

  delete from public.pi_lines where pi_id = p_id;
  delete from public.pi_salespeople where pi_id = p_id;

  if jsonb_typeof(p_payload -> 'lines') = 'array' then
    if jsonb_array_length(p_payload -> 'lines') > 200 then
      raise exception 'A PI can contain at most 200 lines.';
    end if;
    for v_line in select value from jsonb_array_elements(p_payload -> 'lines')
    loop
      v_index := v_index + 1;
      v_product := private.as_uuid(v_line ->> 'product_id');
      v_vendor := private.as_uuid(v_line ->> 'vendor_id');
      v_quantity := private.as_numeric(v_line ->> 'quantity', 'Quantity');
      v_price := private.as_numeric(v_line ->> 'unit_price', 'Unit price');
      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Quantity must be greater than zero.';
      end if;
      if char_length(coalesce(v_line ->> 'description', '')) > 8000 then
        raise exception 'A line description is too long.';
      end if;
      if v_product is not null and not exists (select 1 from public.products where id = v_product) then
        raise exception 'Product not found.';
      end if;
      v_vendor_name := '';
      if v_vendor is not null then
        select company_name into v_vendor_name from public.vendors where id = v_vendor;
        if not found then
          raise exception 'Vendor not found.';
        end if;
      end if;
      insert into public.pi_lines (
        pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price
      ) values (
        p_id,
        v_index,
        v_product,
        v_vendor,
        coalesce(v_vendor_name, ''),
        left(coalesce(v_line ->> 'model_code', ''), 200),
        coalesce(v_line ->> 'description', ''),
        coalesce(nullif(v_line ->> 'unit', ''), 'unit'),
        v_quantity,
        v_price
      );
    end loop;
  end if;

  if coalesce(array_length(v_sales, 1), 0) > 0 then
    insert into public.pi_salespeople (pi_id, user_id)
    select p_id, assigned.id from unnest(v_sales) as assigned(id);
  end if;

  perform private.recalculate_pi(p_id);
end;
$$;

create or replace function private.assert_pi_ready(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_preset public.company_presets;
begin
  select * into v_pi from public.proforma_invoices where id = p_id;
  if v_pi.preset_code is null then
    raise exception 'Choose an office and currency before generating.';
  end if;
  select * into v_preset from public.company_presets where code = v_pi.preset_code;
  if btrim(v_preset.company_name) = ''
    or btrim(v_preset.address) = ''
    or btrim(v_preset.bank_name) = ''
    or btrim(v_preset.account_name) = ''
    or btrim(v_preset.account_number) = ''
    or btrim(v_preset.iban) = ''
    or btrim(v_preset.bank_swift) = ''
  then
    raise exception 'This preset is missing company or bank details. An administrator must complete it in Settings before a PI can be issued.';
  end if;
  if v_pi.pi_date is null or v_pi.expiry_date is null then
    raise exception 'PI date and expiry date are required.';
  end if;
  if v_pi.client_id is null or btrim(v_pi.bill_to) = '' then
    raise exception 'A client and billing address are required.';
  end if;
  if v_pi.lead_salesperson_id is null then
    raise exception 'A lead salesperson is required.';
  end if;
  if not exists (
    select 1 from public.pi_salespeople
    where pi_id = p_id and user_id = v_pi.lead_salesperson_id
  ) then
    raise exception 'The lead salesperson must be one of the assigned salespeople.';
  end if;
  if not exists (select 1 from public.pi_lines where pi_id = p_id) then
    raise exception 'Add at least one item before generating.';
  end if;
  if exists (
    select 1 from public.pi_lines
    where pi_id = p_id and (unit_price is null or btrim(description) = '' or btrim(unit) = '')
  ) then
    raise exception 'Every item needs a description, a unit, and an explicit selling price.';
  end if;
end;
$$;

create or replace function private.build_snapshot(p_id uuid, p_revision integer, p_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_preset public.company_presets;
  v_client public.clients;
  v_contact public.client_contacts;
  v_lead public.profiles;
  v_preparer text;
  v_display text;
begin
  select * into v_pi from public.proforma_invoices where id = p_id;
  select * into v_preset from public.company_presets where code = v_pi.preset_code;
  select * into v_client from public.clients where id = v_pi.client_id;
  select * into v_contact from public.client_contacts where id = v_pi.client_contact_id;
  select * into v_lead from public.profiles where id = v_pi.lead_salesperson_id;
  select full_name into v_preparer from public.profiles where id = (select auth.uid());
  v_display := case when p_revision = 0 then p_number else p_number || '-R' || p_revision::text end;

  return jsonb_build_object(
    'layout_version', case when v_preset.layout = 'uae' then 'uae-v1' else 'egypt-v1' end,
    'preset_code', v_preset.code,
    'office', v_preset.office,
    'currency', v_preset.currency,
    'pi_number', p_number,
    'revision', p_revision,
    'revision_label', case when p_revision = 0 then null else 'R' || p_revision::text end,
    'display_number', v_display,
    'pi_date', v_pi.pi_date,
    'expiry_date', v_pi.expiry_date,
    'customer_reference', v_pi.customer_reference,
    'company', jsonb_build_object(
      'name', v_preset.company_name,
      'address', v_preset.address,
      'phone', v_preset.phone,
      'fax', v_preset.fax,
      'email', v_preset.email,
      'website', v_preset.website,
      'tax_registration', v_preset.tax_registration,
      'logo_base64', v_preset.logo_base64,
      'logo_content_type', v_preset.logo_content_type
    ),
    'bank', jsonb_build_object(
      'bank_name', v_preset.bank_name,
      'branch', v_preset.bank_branch,
      'address', v_preset.bank_address,
      'swift', v_preset.bank_swift,
      'account_name', v_preset.account_name,
      'account_number', v_preset.account_number,
      'iban', v_preset.iban,
      'correspondent_bank', v_preset.correspondent_bank,
      'notes', v_preset.bank_notes
    ),
    'client', jsonb_build_object(
      'company_name', coalesce(v_client.company_name, ''),
      'country', coalesce(v_client.country, ''),
      'tax_number', coalesce(v_client.tax_number, ''),
      'contact_name', coalesce(v_contact.name, ''),
      'contact_job_title', coalesce(v_contact.job_title, ''),
      'contact_phone', coalesce(v_contact.phone, ''),
      'contact_email', coalesce(v_contact.email, '')
    ),
    'bill_to', v_pi.bill_to,
    'ship_to', v_pi.ship_to,
    'sales', jsonb_build_object(
      'lead_name', coalesce(v_lead.full_name, ''),
      'lead_phone', coalesce(v_lead.phone, ''),
      'additional', coalesce((
        select jsonb_agg(jsonb_build_object('name', p.full_name) order by p.full_name)
        from public.pi_salespeople s
        join public.profiles p on p.id = s.user_id
        where s.pi_id = p_id and s.user_id <> v_pi.lead_salesperson_id
      ), '[]'::jsonb),
      'prepared_by', coalesce(v_preparer, '')
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'model_code', l.model_code,
        'description', l.description,
        'unit', l.unit,
        'quantity', l.quantity::text,
        'unit_price', l.unit_price::text,
        'line_total', l.line_total::text
      ) order by l.position)
      from public.pi_lines l
      where l.pi_id = p_id
    ), '[]'::jsonb),
    'adjustments', jsonb_build_object(
      'discount_type', v_pi.discount_type,
      'discount_value', v_pi.discount_value::text,
      'discount_amount', v_pi.discount_amount::text,
      'shipping', v_pi.shipping_amount::text,
      'installation', v_pi.installation_amount::text,
      'bank_charge', v_pi.bank_charge_amount::text,
      'tax_enabled', v_pi.tax_enabled,
      'tax_percent', v_pi.tax_percent::text,
      'tax_excludes_shipping', v_pi.tax_excludes_shipping,
      'tax_excludes_installation', v_pi.tax_excludes_installation,
      'tax_excludes_bank_charge', v_pi.tax_excludes_bank_charge,
      'subtotal', v_pi.subtotal::text,
      'net_items', v_pi.net_items::text,
      'taxable_base', v_pi.taxable_base::text,
      'tax_amount', v_pi.tax_amount::text,
      'grand_total', v_pi.grand_total::text
    ),
    'terms', jsonb_build_object(
      'price_basis', v_pi.price_basis,
      'payment_terms', v_pi.payment_terms,
      'delivery_terms', v_pi.delivery_terms,
      'warranty', v_pi.warranty,
      'additional_notes', v_pi.additional_notes
    )
  );
end;
$$;

create or replace function private.create_pi_draft()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_active_member() then
    raise exception 'Your account is disabled or you are not signed in.';
  end if;
  if not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to create drafts.';
  end if;
  insert into public.proforma_invoices (
    created_by, price_basis, payment_terms, delivery_terms, warranty, additional_notes
  )
  select (select auth.uid()), price_basis, payment_terms, delivery_terms, warranty, additional_notes
  from public.default_terms
  where id = 1
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.save_pi_draft(p_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
begin
  perform private.persist_draft(p_id, p_expected_version, p_payload);
  select * into v_pi from public.proforma_invoices where id = p_id;
  return jsonb_build_object(
    'id', v_pi.id,
    'draft_version', v_pi.draft_version,
    'subtotal', v_pi.subtotal::text,
    'discount_amount', v_pi.discount_amount::text,
    'net_items', v_pi.net_items::text,
    'taxable_base', v_pi.taxable_base::text,
    'tax_amount', v_pi.tax_amount::text,
    'grand_total', v_pi.grand_total::text,
    'line_totals', coalesce((
      select jsonb_agg(line_total::text order by position)
      from public.pi_lines where pi_id = p_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.generate_pi(p_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
  v_year integer;
  v_serial integer;
  v_number text;
  v_revision integer;
  v_version_id uuid;
  v_snapshot jsonb;
  v_preset public.company_presets;
begin
  if not private.is_active_member() then
    raise exception 'Your account is disabled or you are not signed in.';
  end if;
  if not private.has_flag('can_generate_pis') then
    raise exception 'You do not have permission to generate PIs.';
  end if;

  select * into v_pi from public.proforma_invoices where id = p_id for update;
  if not found then
    raise exception 'PI not found.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  if not v_pi.draft_open then
    raise exception 'This PI is already issued. Retry the PDF from version history, or create a revision.';
  end if;

  if private.has_flag('can_edit_drafts') then
    perform private.persist_draft(p_id, p_expected_version, p_payload);
  elsif v_pi.draft_version <> p_expected_version then
    raise exception 'This draft was updated by someone else. Reload the draft and try again.'
      using errcode = '40001';
  end if;

  perform private.assert_pi_ready(p_id);
  select * into v_pi from public.proforma_invoices where id = p_id;
  select * into v_preset from public.company_presets where code = v_pi.preset_code;
  v_year := extract(year from v_pi.pi_date)::integer;

  if v_pi.pi_number is null then
    v_serial := private.allocate_serial(v_preset.office, v_year);
    v_number := v_preset.office || '-' || v_year::text || '-' || lpad(v_serial::text, 5, '0');
    v_revision := 0;
    update public.proforma_invoices
    set pi_number = v_number,
        pi_year = v_year,
        serial = v_serial,
        office = v_preset.office,
        currency = v_preset.currency
    where id = p_id;
  else
    if v_year <> v_pi.pi_year or v_preset.office <> v_pi.office or v_preset.currency <> v_pi.currency then
      raise exception 'Office, currency, and PI year are locked on issued documents.';
    end if;
    select coalesce(max(revision), -1) + 1 into v_revision
    from public.pi_versions where pi_id = p_id;
    v_number := v_pi.pi_number;
  end if;

  v_snapshot := private.build_snapshot(p_id, v_revision, v_number);
  insert into public.pi_versions (
    pi_id, revision, pi_number, generated_by, snapshot, pdf_status, pdf_path, layout_version, grand_total
  ) values (
    p_id,
    v_revision,
    v_number,
    (select auth.uid()),
    v_snapshot,
    'pending',
    null,
    v_snapshot ->> 'layout_version',
    (select grand_total from public.proforma_invoices where id = p_id)
  )
  returning id into v_version_id;

  update public.pi_versions
  set pdf_path = v_version_id::text || '.pdf'
  where id = v_version_id;

  update public.proforma_invoices
  set draft_open = false,
      updated_at = now()
  where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'draft_version', (select draft_version from public.proforma_invoices where id = p_id),
    'version_id', v_version_id,
    'revision', v_revision,
    'pi_number', v_number,
    'display_number', v_snapshot ->> 'display_number',
    'pdf_path', v_version_id::text || '.pdf',
    'snapshot', v_snapshot
  );
end;
$$;

create or replace function private.duplicate_pi(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.proforma_invoices;
  v_id uuid;
begin
  if not private.is_active_member() or not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to duplicate PIs.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  select * into v_source from public.proforma_invoices where id = p_id for update;
  insert into public.proforma_invoices (
    preset_code, office, currency, pi_date, expiry_date, client_id, client_contact_id,
    bill_to, ship_to, ship_same_as_billing, customer_reference, lead_salesperson_id, created_by,
    discount_type, discount_value, shipping_amount, installation_amount, bank_charge_amount,
    tax_enabled, tax_percent, tax_excludes_shipping, tax_excludes_installation, tax_excludes_bank_charge,
    price_basis, payment_terms, delivery_terms, warranty, additional_notes,
    subtotal, discount_amount, net_items, taxable_base, tax_amount, grand_total
  ) values (
    v_source.preset_code, v_source.office, v_source.currency, v_source.pi_date, v_source.expiry_date,
    v_source.client_id, v_source.client_contact_id, v_source.bill_to, v_source.ship_to,
    v_source.ship_same_as_billing, v_source.customer_reference, v_source.lead_salesperson_id,
    (select auth.uid()), v_source.discount_type, v_source.discount_value, v_source.shipping_amount,
    v_source.installation_amount, v_source.bank_charge_amount, v_source.tax_enabled, v_source.tax_percent,
    v_source.tax_excludes_shipping, v_source.tax_excludes_installation, v_source.tax_excludes_bank_charge,
    v_source.price_basis, v_source.payment_terms, v_source.delivery_terms, v_source.warranty,
    v_source.additional_notes, v_source.subtotal, v_source.discount_amount, v_source.net_items,
    v_source.taxable_base, v_source.tax_amount, v_source.grand_total
  )
  returning id into v_id;

  insert into public.pi_lines (
    pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total
  )
  select v_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total
  from public.pi_lines where pi_id = p_id;

  insert into public.pi_salespeople (pi_id, user_id)
  select v_id, user_id from public.pi_salespeople where pi_id = p_id;

  return v_id;
end;
$$;

create or replace function private.create_pi_revision(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi public.proforma_invoices;
begin
  if not private.is_active_member() or not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to create a revision.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  select * into v_pi from public.proforma_invoices where id = p_id for update;
  if v_pi.pi_number is null or not exists (select 1 from public.pi_versions where pi_id = p_id) then
    raise exception 'Generate the PI before creating a revision.';
  end if;
  if v_pi.draft_open then
    raise exception 'A revision draft is already open.';
  end if;
  if v_pi.tracking_status = 'cancelled' then
    raise exception 'Cancelled PIs cannot be revised.';
  end if;
  update public.proforma_invoices
  set draft_open = true,
      draft_version = draft_version + 1,
      updated_at = now()
  where id = p_id
  returning draft_version into v_pi.draft_version;
  return v_pi.draft_version;
end;
$$;

create or replace function private.delete_unissued_pi(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_member() or not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to delete drafts.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  if exists (select 1 from public.pi_versions where pi_id = p_id) then
    raise exception 'Issued PIs cannot be deleted. Cancel the PI instead.';
  end if;
  delete from public.proforma_invoices where id = p_id;
end;
$$;

create or replace function private.set_pi_tracking_status(p_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('draft', 'sent', 'accepted', 'cancelled') then
    raise exception 'Unknown status.';
  end if;
  if not private.is_active_member()
    or not (private.has_flag('can_edit_drafts') or private.has_flag('can_generate_pis'))
  then
    raise exception 'You do not have permission to change PI status.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  update public.proforma_invoices
  set tracking_status = p_status, updated_at = now()
  where id = p_id;
  return p_status;
end;
$$;

create or replace function private.prepare_pdf_retry(p_version_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.pi_versions;
  v_path text;
begin
  if not private.is_active_member() or not private.has_flag('can_generate_pis') then
    raise exception 'You do not have permission to store this PDF.';
  end if;
  select * into v_version from public.pi_versions where id = p_version_id for update;
  if not found then
    raise exception 'Issued version not found.';
  end if;
  if not private.can_read_pi(v_version.pi_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  if v_version.pdf_status = 'ready' then
    raise exception 'This PDF is already stored and cannot be replaced.';
  end if;
  v_path := p_version_id::text || '.pdf';
  -- Supabase rejects DELETE on storage.objects from SQL. The client removes a
  -- partial file through the Storage API, which the pending-PDF delete policy allows.
  return v_path;
end;
$$;

create or replace function private.confirm_pi_pdf(p_version_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.pi_versions;
  v_path text;
begin
  if not private.is_active_member() or not private.has_flag('can_generate_pis') then
    raise exception 'You do not have permission to store this PDF.';
  end if;
  select * into v_version from public.pi_versions where id = p_version_id for update;
  if not found then
    raise exception 'Issued version not found.';
  end if;
  if not private.can_read_pi(v_version.pi_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  v_path := p_version_id::text || '.pdf';
  if v_version.pdf_status = 'ready' and v_version.pdf_path = v_path then
    return 'ready';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id = 'pi-pdfs' and name = v_path
  ) then
    raise exception 'The PDF was not saved. Upload failed, so this version is still waiting for a file.';
  end if;
  update public.pi_versions
  set pdf_status = 'ready', pdf_path = v_path
  where id = p_version_id;
  return 'ready';
end;
$$;

create or replace function private.can_write_pending_pdf(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_pi uuid;
begin
  if not private.has_flag('can_generate_pis') then
    return false;
  end if;
  if p_name !~ '^[0-9a-fA-F-]{36}\.pdf$' then
    return false;
  end if;
  v_id := replace(p_name, '.pdf', '')::uuid;
  select pi_id into v_pi
  from public.pi_versions
  where id = v_id and pdf_status = 'pending';
  if not found then
    return false;
  end if;
  return private.can_read_pi(v_pi);
end;
$$;

create or replace function private.can_read_pdf(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pi uuid;
begin
  if not private.is_active_member() then
    return false;
  end if;
  select pi_id into v_pi
  from public.pi_versions
  where pdf_path = p_name or id::text || '.pdf' = p_name
  limit 1;
  if not found then
    return false;
  end if;
  return private.can_read_pi(v_pi);
end;
$$;

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Not allowed.';
  end if;
  delete from auth.refresh_tokens where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

create or replace function public.create_pi_draft()
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_pi_draft(); $$;

create or replace function public.save_pi_draft(p_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.save_pi_draft(p_id, p_expected_version, p_payload); $$;

create or replace function public.generate_pi(p_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.generate_pi(p_id, p_expected_version, p_payload); $$;

create or replace function public.duplicate_pi(p_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.duplicate_pi(p_id); $$;

create or replace function public.create_pi_revision(p_id uuid)
returns integer language sql security invoker set search_path = ''
as $$ select private.create_pi_revision(p_id); $$;

create or replace function public.delete_unissued_pi(p_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_unissued_pi(p_id); $$;

create or replace function public.set_pi_tracking_status(p_id uuid, p_status text)
returns text language sql security invoker set search_path = ''
as $$ select private.set_pi_tracking_status(p_id, p_status); $$;

create or replace function public.prepare_pdf_retry(p_version_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.prepare_pdf_retry(p_version_id); $$;

create or replace function public.confirm_pi_pdf(p_version_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.confirm_pi_pdf(p_version_id); $$;
