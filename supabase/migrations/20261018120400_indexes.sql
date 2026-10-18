create index clients_created_by_idx on public.clients (created_by);
create index vendors_created_by_idx on public.vendors (created_by);
create index products_created_by_idx on public.products (created_by);
create index pi_lines_product_idx on public.pi_lines (product_id);
create index pi_lines_vendor_idx on public.pi_lines (vendor_id);
create index proforma_invoices_contact_idx on public.proforma_invoices (client_contact_id);
create index proforma_invoices_preset_idx on public.proforma_invoices (preset_code);

create policy pi_counters_deny on private.pi_counters
for all to authenticated
using (false)
with check (false);
