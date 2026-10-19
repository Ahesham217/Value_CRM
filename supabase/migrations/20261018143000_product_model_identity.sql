-- Model is the catalogue identity. Uniqueness ignores case and surrounding spaces
-- and includes archived products. Existing rows are not renamed or merged.
-- Historical PI lines without a product are left in place; save and generate
-- reject new product-less or mismatched lines. Issued snapshots are not updated.

create or replace function private.normalize_product_model()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.model_code := btrim(coalesce(new.model_code, ''));
  if new.model_code = '' then
    raise exception 'Model is required.';
  end if;
  if char_length(new.model_code) > 200 then
    raise exception 'Model must be 200 characters or fewer.';
  end if;
  return new;
end;
$$;

drop trigger if exists products_normalize_model on public.products;
create trigger products_normalize_model
before insert or update of model_code on public.products
for each row execute function private.normalize_product_model();

alter table public.products
  drop constraint if exists products_model_code_trimmed;
alter table public.products
  add constraint products_model_code_trimmed
  check (model_code = btrim(model_code));

create unique index if not exists products_model_key_uidx
  on public.products (lower(btrim(model_code)));

comment on index public.products_model_key_uidx is
  'One catalogue identity per model, ignoring case and surrounding spaces, including archived products.';

revoke all on function private.normalize_product_model() from public, anon, authenticated;
grant execute on function private.normalize_product_model() to authenticated, service_role;

create or replace function public.lookup_product_by_model(p_model text)
returns table (
  id uuid,
  vendor_id uuid,
  brand text,
  model_code text,
  description text,
  unit text,
  sell_price_egp numeric,
  sell_price_usd numeric,
  sell_price_eur numeric,
  archived_at timestamptz,
  vendor_name text,
  vendor_archived_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.vendor_id,
    p.brand,
    p.model_code,
    p.description,
    p.unit,
    p.sell_price_egp,
    p.sell_price_usd,
    p.sell_price_eur,
    p.archived_at,
    v.company_name,
    v.archived_at
  from public.products p
  join public.vendors v on v.id = p.vendor_id
  where lower(btrim(p.model_code)) = lower(btrim(coalesce(p_model, '')))
    and lower(btrim(coalesce(p_model, ''))) <> '';
$$;

revoke all on function public.lookup_product_by_model(text) from public, anon, authenticated;
grant execute on function public.lookup_product_by_model(text) to authenticated;

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
  v_product_vendor uuid;
  v_vendor_name text;
  v_model text;
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
      if v_product is null then
        raise exception 'Every item must be a saved catalogue product. Select or create a model before saving.';
      end if;

      select p.model_code, p.vendor_id, v.company_name
      into v_model, v_product_vendor, v_vendor_name
      from public.products p
      left join public.vendors v on v.id = p.vendor_id
      where p.id = v_product;
      if not found then
        raise exception 'Product not found.';
      end if;
      if v_product_vendor is null or v_vendor_name is null or btrim(v_vendor_name) = '' then
        raise exception 'This product has no usable vendor. Assign a vendor on the product before saving it to a PI.';
      end if;
      if lower(btrim(coalesce(v_line ->> 'model_code', ''))) is distinct from lower(btrim(v_model)) then
        raise exception 'The model does not match the selected product (%). Select the product again before saving.', v_model;
      end if;
      if v_vendor is distinct from v_product_vendor then
        raise exception 'The vendor does not match the selected product. Select the product again before saving.';
      end if;

      insert into public.pi_lines (
        pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price
      ) values (
        p_id,
        v_index,
        v_product,
        v_product_vendor,
        v_vendor_name,
        v_model,
        coalesce(v_line ->> 'description', ''),
        coalesce(nullif(btrim(v_line ->> 'unit'), ''), 'unit'),
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
    select 1
    from public.pi_lines l
    where l.pi_id = p_id
      and (
        l.product_id is null
        or not exists (
          select 1
          from public.products p
          join public.vendors v on v.id = p.vendor_id
          where p.id = l.product_id
            and v.archived_at is null
            and btrim(v.company_name) <> ''
            and l.vendor_id = p.vendor_id
            and lower(btrim(l.model_code)) = lower(btrim(p.model_code))
        )
      )
  ) then
    raise exception 'Every item needs a saved product with a matching model and an active vendor before generating. Resolve the lines in the draft, or assign an active vendor on the product. Issued versions are not changed.';
  end if;
  if exists (
    select 1 from public.pi_lines
    where pi_id = p_id and (unit_price is null or btrim(description) = '' or btrim(unit) = '')
  ) then
    raise exception 'Every item needs a description, a unit, and an explicit selling price.';
  end if;
end;
$$;
