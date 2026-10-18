-- Access rules are enforced here. The UI hiding a button is not the control.

create or replace function private.block_issued_pi_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.pi_versions where pi_id = old.id) then
    raise exception 'Issued PIs cannot be deleted. Cancel the PI instead.';
  end if;
  return old;
end;
$$;

create trigger proforma_invoices_no_issued_delete
before delete on public.proforma_invoices
for each row execute function private.block_issued_pi_delete();

create or replace function private.block_reference_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This record cannot be deleted.';
end;
$$;

create trigger company_presets_no_delete
before delete on public.company_presets
for each row execute function private.block_reference_delete();

create trigger default_terms_no_delete
before delete on public.default_terms
for each row execute function private.block_reference_delete();

insert into public.company_presets (
  code, office, currency, layout, company_name, address, phone, fax,
  bank_name, bank_branch, bank_address, bank_swift, account_name, account_number, iban,
  correspondent_bank, bank_notes
) values
(
  'EG-EGP', 'EG', 'EGP', 'egypt',
  'Value Technologies for Import & Agencies S.A.E.',
  E'72 Mosadak St, Dokki\nGiza, 12311 Egypt',
  '+20 2 33380876 /33383657 /33383659',
  '+20 2 33380873',
  'Commercial International Bank (CIB)',
  'Abbaseya',
  '115 Abbaseya st. Abbaseya Cairo Beside Omar Effendi',
  'CIBEEGCX072',
  'Value Technologies for Import& Agencies S.A.E.',
  '100022610548',
  'EG590010007200000100022610548',
  '',
  ''
),
(
  'AE-USD', 'AE', 'USD', 'uae',
  'Value Technologies EMEA FZ-LLC',
  E'SFFO0491\nCompass Building,\nAl Shohada Road,\nAL Hamra Industrial Zone-FZ,\nRas Al Khaimah, United Arab Emirates',
  '',
  '',
  'Arab African International Bank',
  'Dubai',
  'NATIONAL INSURANCE AND REINSURANCE, SHEIKH ZAYED ROAD, AL WASL AREA,DUBAI ,UAE',
  'ARAIAEADXXX',
  'Value Technologies EMEA FZ-LLC',
  '1000081724',
  'AE690070100001000081724',
  'Correspondent Bank is Citibank , its Swift Code is : CITIUS33XXX',
  E'Charges Details:\nOUR: No extra bank fees required\nSHA : Adding 72 USD to the total value of the PI as bank fess is must'
),
(
  'AE-EUR', 'AE', 'EUR', 'uae',
  'Value Technologies EMEA FZ-LLC',
  E'SFFO0491\nCompass Building,\nAl Shohada Road,\nAL Hamra Industrial Zone-FZ,\nRas Al Khaimah, United Arab Emirates',
  '',
  '',
  'Arab African International Bank',
  'Dubai',
  '',
  'ARAIAEAD',
  'Value Technologies EMEA FZ-LLC',
  '1000080086',
  'AE630070100001000080086',
  '',
  E'Charges Details:\nOUR: No extra bank fees required\nSHA : Adding 72 EUR to the total value of the PI as bank fess is must'
);

insert into public.default_terms (id, price_basis, payment_terms, delivery_terms, warranty, additional_notes)
values (1, 'Site Delivery', '100% in advance', 'Available in stock', '', '');

create view public.pi_list
with (security_invoker = true) as
select
  pi.id,
  pi.pi_number,
  pi.office,
  pi.currency,
  pi.pi_date,
  pi.tracking_status,
  pi.draft_open,
  pi.draft_version,
  pi.created_at,
  pi.client_id,
  pi.lead_salesperson_id,
  coalesce(lv.snapshot #>> '{client,company_name}', c.company_name) as client_name,
  lv.revision as latest_revision,
  coalesce(lv.grand_total, pi.grand_total) as display_total,
  coalesce(lv.snapshot #>> '{sales,lead_name}', lead.full_name) as lead_name,
  coalesce(lv.snapshot #>> '{sales,prepared_by}', creator.full_name) as prepared_by_name,
  coalesce((
    select array_agg(s.user_id) from public.pi_salespeople s where s.pi_id = pi.id
  ), '{}'::uuid[]) as salesperson_ids,
  case
    when pi.tracking_status = 'cancelled' then 'cancelled'
    when pi.tracking_status = 'accepted' then 'accepted'
    when pi.tracking_status = 'sent' then 'sent'
    when lv.id is not null then 'issued'
    else 'draft'
  end as display_status,
  (pi.draft_open and lv.id is not null) as has_open_revision
from public.proforma_invoices pi
left join public.clients c on c.id = pi.client_id
left join public.profiles creator on creator.id = pi.created_by
left join public.profiles lead on lead.id = pi.lead_salesperson_id
left join lateral (
  select v.id, v.revision, v.grand_total, v.snapshot
  from public.pi_versions v
  where v.pi_id = pi.id
  order by v.revision desc
  limit 1
) lv on true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pi-pdfs', 'pi-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy profiles_select on public.profiles
for select to authenticated
using (private.is_active_member());

create policy clients_select on public.clients
for select to authenticated
using (private.is_active_member());
create policy clients_insert on public.clients
for insert to authenticated
with check (private.has_flag('can_manage_clients'));
create policy clients_update on public.clients
for update to authenticated
using (private.has_flag('can_manage_clients'))
with check (private.has_flag('can_manage_clients'));

create policy client_contacts_select on public.client_contacts
for select to authenticated
using (private.is_active_member());
create policy client_contacts_insert on public.client_contacts
for insert to authenticated
with check (private.has_flag('can_manage_clients'));
create policy client_contacts_update on public.client_contacts
for update to authenticated
using (private.has_flag('can_manage_clients'))
with check (private.has_flag('can_manage_clients'));
create policy client_contacts_delete on public.client_contacts
for delete to authenticated
using (private.has_flag('can_manage_clients'));

create policy vendors_select on public.vendors
for select to authenticated
using (private.is_active_member());
create policy vendors_insert on public.vendors
for insert to authenticated
with check (private.has_flag('can_manage_vendors'));
create policy vendors_update on public.vendors
for update to authenticated
using (private.has_flag('can_manage_vendors'))
with check (private.has_flag('can_manage_vendors'));

create policy vendor_contacts_select on public.vendor_contacts
for select to authenticated
using (private.is_active_member());
create policy vendor_contacts_insert on public.vendor_contacts
for insert to authenticated
with check (private.has_flag('can_manage_vendors'));
create policy vendor_contacts_update on public.vendor_contacts
for update to authenticated
using (private.has_flag('can_manage_vendors'))
with check (private.has_flag('can_manage_vendors'));
create policy vendor_contacts_delete on public.vendor_contacts
for delete to authenticated
using (private.has_flag('can_manage_vendors'));

create policy products_select on public.products
for select to authenticated
using (private.is_active_member());
create policy products_insert on public.products
for insert to authenticated
with check (private.has_flag('can_manage_products'));
create policy products_update on public.products
for update to authenticated
using (private.has_flag('can_manage_products'))
with check (private.has_flag('can_manage_products'));

create policy product_costs_select on public.product_costs
for select to authenticated
using (private.has_flag('can_view_purchase_prices'));
create policy product_costs_insert on public.product_costs
for insert to authenticated
with check (private.has_flag('can_manage_products') and private.has_flag('can_view_purchase_prices'));
create policy product_costs_update on public.product_costs
for update to authenticated
using (private.has_flag('can_manage_products') and private.has_flag('can_view_purchase_prices'))
with check (private.has_flag('can_manage_products') and private.has_flag('can_view_purchase_prices'));
create policy product_costs_delete on public.product_costs
for delete to authenticated
using (private.has_flag('can_manage_products') and private.has_flag('can_view_purchase_prices'));

create policy presets_select on public.company_presets
for select to authenticated
using (private.is_active_member());
create policy presets_update on public.company_presets
for update to authenticated
using (private.is_admin())
with check (private.is_admin());

create policy terms_select on public.default_terms
for select to authenticated
using (private.is_active_member());
create policy terms_update on public.default_terms
for update to authenticated
using (private.is_admin())
with check (private.is_admin());

create policy pi_select on public.proforma_invoices
for select to authenticated
using (private.can_read_pi(id));
create policy pi_lines_select on public.pi_lines
for select to authenticated
using (private.can_read_pi(pi_id));
create policy pi_salespeople_select on public.pi_salespeople
for select to authenticated
using (private.can_read_pi(pi_id));
create policy pi_versions_select on public.pi_versions
for select to authenticated
using (private.can_read_pi(pi_id));

create policy pi_pdfs_select on storage.objects
for select to authenticated
using (bucket_id = 'pi-pdfs' and private.can_read_pdf(name));
create policy pi_pdfs_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'pi-pdfs' and private.can_write_pending_pdf(name));
create policy pi_pdfs_delete on storage.objects
for delete to authenticated
using (bucket_id = 'pi-pdfs' and private.can_write_pending_pdf(name));

revoke all on table
  public.profiles, public.clients, public.client_contacts, public.vendors, public.vendor_contacts,
  public.products, public.product_costs, public.company_presets, public.default_terms,
  public.proforma_invoices, public.pi_lines, public.pi_salespeople, public.pi_versions
from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select, insert, update on table public.clients to authenticated;
grant select, insert, update, delete on table public.client_contacts to authenticated;
grant select, insert, update on table public.vendors to authenticated;
grant select, insert, update, delete on table public.vendor_contacts to authenticated;
grant select, insert, update on table public.products to authenticated;
grant select, insert, update, delete on table public.product_costs to authenticated;
grant select, update on table public.company_presets to authenticated;
grant select, update on table public.default_terms to authenticated;
grant select on table public.proforma_invoices to authenticated;
grant select on table public.pi_lines to authenticated;
grant select on table public.pi_salespeople to authenticated;
grant select on table public.pi_versions to authenticated;
grant select on table public.pi_list to authenticated;
revoke all on table public.pi_list from anon;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function
  public.create_pi_draft(),
  public.save_pi_draft(uuid, integer, jsonb),
  public.generate_pi(uuid, integer, jsonb),
  public.duplicate_pi(uuid),
  public.create_pi_revision(uuid),
  public.delete_unissued_pi(uuid),
  public.set_pi_tracking_status(uuid, text),
  public.prepare_pdf_retry(uuid),
  public.confirm_pi_pdf(uuid),
  public.revoke_user_sessions(uuid),
  public.rls_auto_enable()
from public, anon, authenticated;

grant execute on function private.is_active_member() to authenticated;
grant execute on function private.has_flag(text) to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_read_pi(uuid) to authenticated;
grant execute on function private.can_read_pdf(text) to authenticated;
grant execute on function private.can_write_pending_pdf(text) to authenticated;
grant execute on function private.create_pi_draft() to authenticated;
grant execute on function private.save_pi_draft(uuid, integer, jsonb) to authenticated;
grant execute on function private.generate_pi(uuid, integer, jsonb) to authenticated;
grant execute on function private.duplicate_pi(uuid) to authenticated;
grant execute on function private.create_pi_revision(uuid) to authenticated;
grant execute on function private.delete_unissued_pi(uuid) to authenticated;
grant execute on function private.set_pi_tracking_status(uuid, text) to authenticated;
grant execute on function private.prepare_pdf_retry(uuid) to authenticated;
grant execute on function private.confirm_pi_pdf(uuid) to authenticated;

grant execute on function public.create_pi_draft() to authenticated;
grant execute on function public.save_pi_draft(uuid, integer, jsonb) to authenticated;
grant execute on function public.generate_pi(uuid, integer, jsonb) to authenticated;
grant execute on function public.duplicate_pi(uuid) to authenticated;
grant execute on function public.create_pi_revision(uuid) to authenticated;
grant execute on function public.delete_unissued_pi(uuid) to authenticated;
grant execute on function public.set_pi_tracking_status(uuid, text) to authenticated;
grant execute on function public.prepare_pdf_retry(uuid) to authenticated;
grant execute on function public.confirm_pi_pdf(uuid) to authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- Trigger functions run as the table writer, so that role needs EXECUTE.
grant execute on function private.touch_updated_at() to authenticated, service_role;
grant execute on function private.stamp_creator() to authenticated, service_role;
grant execute on function private.protect_preset_identity() to authenticated, service_role;
grant execute on function private.protect_profiles() to service_role;
grant execute on function private.handle_new_user() to supabase_auth_admin, service_role;
grant execute on function private.block_issued_pi_delete() to service_role;
grant execute on function private.block_reference_delete() to service_role;
