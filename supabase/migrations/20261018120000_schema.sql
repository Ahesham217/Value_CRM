-- Value CRM schema.
-- The ensure_rls event trigger matches the automatic RLS trigger used on Value Technologies projects.
-- Explicit ENABLE ROW LEVEL SECURITY statements below keep the migration correct if it is replayed
-- somewhere that trigger is not installed yet.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
      and cmd.schema_name in ('public')
      and cmd.schema_name not in ('pg_catalog', 'information_schema')
      and cmd.schema_name not like 'pg_toast%'
      and cmd.schema_name not like 'pg_temp%'
    then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$function$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;

do $do$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end;
$do$;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null default '',
  phone text not null default '',
  is_active boolean not null default false,
  is_admin boolean not null default false,
  is_salesperson boolean not null default false,
  pi_visibility text not null default 'associated' check (pi_visibility in ('all', 'associated')),
  can_edit_drafts boolean not null default false,
  can_generate_pis boolean not null default false,
  can_manage_clients boolean not null default false,
  can_manage_vendors boolean not null default false,
  can_manage_products boolean not null default false,
  can_view_purchase_prices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 200),
  country text not null default '',
  billing_address text not null default '',
  shipping_address text,
  tax_number text,
  notes text not null default '',
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;
create index clients_company_name_idx on public.clients (company_name);
create index clients_active_idx on public.clients (company_name) where archived_at is null;

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  job_title text not null default '',
  phone text not null default '',
  email text not null default '',
  is_primary boolean not null default false,
  position integer not null default 0
);
alter table public.client_contacts enable row level security;
create index client_contacts_client_idx on public.client_contacts (client_id, position);
create unique index client_contacts_one_primary_idx on public.client_contacts (client_id) where is_primary;

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 200),
  country text not null default '',
  address text not null default '',
  notes text not null default '',
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vendors enable row level security;
create index vendors_company_name_idx on public.vendors (company_name);

create table public.vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  job_title text not null default '',
  phone text not null default '',
  email text not null default '',
  position integer not null default 0
);
alter table public.vendor_contacts enable row level security;
create index vendor_contacts_vendor_idx on public.vendor_contacts (vendor_id, position);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  brand text not null default '',
  model_code text not null check (char_length(model_code) between 1 and 200),
  description text not null default '',
  unit text not null default 'unit' check (char_length(unit) between 1 and 40),
  sell_price_egp numeric,
  sell_price_usd numeric,
  sell_price_eur numeric,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sell_price_egp is null or sell_price_egp >= 0),
  check (sell_price_usd is null or sell_price_usd >= 0),
  check (sell_price_eur is null or sell_price_eur >= 0)
);
alter table public.products enable row level security;
create index products_vendor_idx on public.products (vendor_id);
create index products_model_idx on public.products (model_code);

create table public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  purchase_price numeric,
  purchase_currency text check (purchase_currency in ('EGP', 'USD', 'EUR')),
  updated_at timestamptz not null default now(),
  check (purchase_price is null or purchase_price >= 0),
  check (purchase_price is null or purchase_currency is not null)
);
alter table public.product_costs enable row level security;

create table public.company_presets (
  code text primary key check (code in ('EG-EGP', 'AE-USD', 'AE-EUR')),
  office text not null check (office in ('EG', 'AE')),
  currency text not null check (currency in ('EGP', 'USD', 'EUR')),
  layout text not null check (layout in ('egypt', 'uae')),
  company_name text not null default '',
  address text not null default '',
  phone text not null default '',
  fax text not null default '',
  email text not null default '',
  website text not null default '',
  tax_registration text not null default '',
  logo_base64 text,
  logo_content_type text,
  bank_name text not null default '',
  bank_branch text not null default '',
  bank_address text not null default '',
  bank_swift text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  iban text not null default '',
  correspondent_bank text not null default '',
  bank_notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.company_presets enable row level security;

create table public.default_terms (
  id integer primary key default 1 check (id = 1),
  price_basis text not null default '',
  payment_terms text not null default '',
  delivery_terms text not null default '',
  warranty text not null default '',
  additional_notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.default_terms enable row level security;

create table private.pi_counters (
  office text not null,
  pi_year integer not null,
  last_value integer not null,
  primary key (office, pi_year)
);
alter table private.pi_counters enable row level security;
revoke all on private.pi_counters from public, anon, authenticated;

create table public.proforma_invoices (
  id uuid primary key default gen_random_uuid(),
  preset_code text references public.company_presets (code),
  office text check (office in ('EG', 'AE')),
  currency text check (currency in ('EGP', 'USD', 'EUR')),
  pi_year integer,
  serial integer,
  pi_number text unique,
  pi_date date,
  expiry_date date,
  client_id uuid references public.clients (id) on delete restrict,
  client_contact_id uuid references public.client_contacts (id) on delete set null,
  bill_to text not null default '',
  ship_to text not null default '',
  ship_same_as_billing boolean not null default true,
  customer_reference text not null default '',
  lead_salesperson_id uuid references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  tracking_status text not null default 'draft' check (tracking_status in ('draft', 'sent', 'accepted', 'cancelled')),
  draft_open boolean not null default true,
  draft_version integer not null default 1,
  discount_type text not null default 'none' check (discount_type in ('none', 'fixed', 'percent')),
  discount_value numeric,
  shipping_amount numeric,
  installation_amount numeric,
  bank_charge_amount numeric,
  tax_enabled boolean not null default false,
  tax_percent numeric,
  tax_excludes_shipping boolean not null default false,
  tax_excludes_installation boolean not null default false,
  tax_excludes_bank_charge boolean not null default false,
  price_basis text not null default '',
  payment_terms text not null default '',
  delivery_terms text not null default '',
  warranty text not null default '',
  additional_notes text not null default '',
  subtotal numeric(14, 2) not null default 0,
  discount_amount numeric(14, 2) not null default 0,
  net_items numeric(14, 2) not null default 0,
  taxable_base numeric(14, 2),
  tax_amount numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (serial is null or serial > 0),
  check (discount_value is null or discount_value >= 0),
  check (shipping_amount is null or shipping_amount >= 0),
  check (installation_amount is null or installation_amount >= 0),
  check (bank_charge_amount is null or bank_charge_amount >= 0),
  check (tax_percent is null or (tax_percent >= 0 and tax_percent <= 100)),
  unique (office, pi_year, serial)
);
alter table public.proforma_invoices enable row level security;
create index proforma_invoices_client_idx on public.proforma_invoices (client_id);
create index proforma_invoices_created_by_idx on public.proforma_invoices (created_by);
create index proforma_invoices_lead_idx on public.proforma_invoices (lead_salesperson_id);
create index proforma_invoices_date_idx on public.proforma_invoices (pi_date);
create index proforma_invoices_status_idx on public.proforma_invoices (tracking_status);

create table public.pi_salespeople (
  pi_id uuid not null references public.proforma_invoices (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  primary key (pi_id, user_id)
);
alter table public.pi_salespeople enable row level security;
create index pi_salespeople_user_idx on public.pi_salespeople (user_id, pi_id);

create table public.pi_lines (
  id uuid primary key default gen_random_uuid(),
  pi_id uuid not null references public.proforma_invoices (id) on delete cascade,
  position integer not null check (position > 0),
  product_id uuid references public.products (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  vendor_name text not null default '',
  model_code text not null default '',
  description text not null default '',
  unit text not null default 'unit',
  quantity numeric not null check (quantity > 0),
  unit_price numeric check (unit_price is null or unit_price >= 0),
  line_total numeric(14, 2),
  unique (pi_id, position)
);
alter table public.pi_lines enable row level security;
create index pi_lines_pi_idx on public.pi_lines (pi_id, position);

create table public.pi_versions (
  id uuid primary key default gen_random_uuid(),
  pi_id uuid not null references public.proforma_invoices (id) on delete restrict,
  revision integer not null check (revision >= 0),
  pi_number text not null,
  generated_by uuid not null references public.profiles (id) on delete restrict,
  generated_at timestamptz not null default now(),
  snapshot jsonb not null,
  pdf_status text not null default 'pending' check (pdf_status in ('pending', 'ready')),
  pdf_path text unique,
  layout_version text not null,
  grand_total numeric(14, 2) not null,
  unique (pi_id, revision)
);
alter table public.pi_versions enable row level security;
create index pi_versions_pi_idx on public.pi_versions (pi_id, revision);
create index pi_versions_preparer_idx on public.pi_versions (generated_by, pi_id);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger clients_touch before update on public.clients
for each row execute function private.touch_updated_at();
create trigger vendors_touch before update on public.vendors
for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products
for each row execute function private.touch_updated_at();
create trigger presets_touch before update on public.company_presets
for each row execute function private.touch_updated_at();
create trigger terms_touch before update on public.default_terms
for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_updated_at();

create or replace function private.stamp_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger clients_creator before insert or update on public.clients
for each row execute function private.stamp_creator();
create trigger vendors_creator before insert or update on public.vendors
for each row execute function private.stamp_creator();
create trigger products_creator before insert or update on public.products
for each row execute function private.stamp_creator();

create or replace function private.protect_profiles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin') or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  raise exception 'Only an administrator can change user permissions.';
end;
$$;

create trigger profiles_protect before update on public.profiles
for each row execute function private.protect_profiles();

create or replace function private.protect_preset_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code <> old.code or new.office <> old.office or new.currency <> old.currency or new.layout <> old.layout then
    raise exception 'Office and currency presets are fixed.';
  end if;
  if new.logo_base64 is not null and octet_length(new.logo_base64) > 600000 then
    raise exception 'Logo must be smaller than 400 KB.';
  end if;
  if new.logo_content_type is not null and new.logo_content_type not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'Logo must be a PNG, JPEG, or WebP image.';
  end if;
  return new;
end;
$$;

create trigger presets_identity before update on public.company_presets
for each row execute function private.protect_preset_identity();

create or replace function private.protect_issued_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Issued versions cannot be deleted.';
  end if;
  if new.snapshot is distinct from old.snapshot
    or new.pi_id <> old.pi_id
    or new.revision <> old.revision
    or new.pi_number <> old.pi_number
    or new.generated_by <> old.generated_by
    or new.generated_at <> old.generated_at
    or new.grand_total <> old.grand_total
    or new.layout_version <> old.layout_version
  then
    raise exception 'Issued versions are immutable.';
  end if;
  if old.pdf_status = 'ready' and (new.pdf_status is distinct from old.pdf_status or new.pdf_path is distinct from old.pdf_path) then
    raise exception 'Stored PDFs cannot be replaced.';
  end if;
  return new;
end;
$$;

create trigger pi_versions_immutable before update or delete on public.pi_versions
for each row execute function private.protect_issued_version();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();
