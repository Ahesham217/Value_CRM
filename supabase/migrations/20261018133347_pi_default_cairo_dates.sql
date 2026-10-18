-- Default dates for new proforma invoices and duplicates.
-- PI date is the Africa/Cairo calendar day. Expiry is one calendar month later,
-- clamped to the last valid day of that month. Existing invoices, snapshots, and PDFs are not updated.

create or replace function private.cairo_date(p_instant timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_instant at time zone 'Africa/Cairo')::date;
$$;

create or replace function private.add_calendar_month(p_date date)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select (p_date + interval '1 month')::date;
$$;

create or replace function private.default_pi_dates(p_instant timestamptz default null)
returns table (pi_date date, expiry_date date)
language sql
stable
set search_path = ''
as $$
  select v.cairo_day, private.add_calendar_month(v.cairo_day)
  from (select private.cairo_date(coalesce(p_instant, now())) as cairo_day) as v;
$$;

revoke all on function private.cairo_date(timestamptz) from public, anon, authenticated;
revoke all on function private.add_calendar_month(date) from public, anon, authenticated;
revoke all on function private.default_pi_dates(timestamptz) from public, anon, authenticated;

create or replace function private.create_pi_draft()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_date date;
  v_expiry date;
begin
  if not private.is_active_member() then
    raise exception 'Your account is disabled or you are not signed in.';
  end if;
  if not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to create drafts.';
  end if;

  select dates.pi_date, dates.expiry_date
  into v_date, v_expiry
  from private.default_pi_dates() as dates;

  insert into public.proforma_invoices (
    created_by, pi_date, expiry_date, price_basis, payment_terms, delivery_terms, warranty, additional_notes
  )
  select (select auth.uid()), v_date, v_expiry, price_basis, payment_terms, delivery_terms, warranty, additional_notes
  from public.default_terms
  where id = 1
  returning id into v_id;
  return v_id;
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
  v_date date;
  v_expiry date;
begin
  if not private.is_active_member() or not private.has_flag('can_edit_drafts') then
    raise exception 'You do not have permission to duplicate PIs.';
  end if;
  if not private.can_read_pi(p_id) then
    raise exception 'You do not have access to this PI.';
  end if;
  select * into v_source from public.proforma_invoices where id = p_id for update;

  select dates.pi_date, dates.expiry_date
  into v_date, v_expiry
  from private.default_pi_dates() as dates;

  insert into public.proforma_invoices (
    preset_code, office, currency, pi_date, expiry_date, client_id, client_contact_id,
    bill_to, ship_to, ship_same_as_billing, customer_reference, lead_salesperson_id, created_by,
    discount_type, discount_value, shipping_amount, installation_amount, bank_charge_amount,
    tax_enabled, tax_percent, tax_excludes_shipping, tax_excludes_installation, tax_excludes_bank_charge,
    price_basis, payment_terms, delivery_terms, warranty, additional_notes,
    subtotal, discount_amount, net_items, taxable_base, tax_amount, grand_total
  ) values (
    v_source.preset_code, v_source.office, v_source.currency, v_date, v_expiry,
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
