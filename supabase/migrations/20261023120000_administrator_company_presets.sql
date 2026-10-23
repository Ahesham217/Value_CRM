-- Administrator-managed company presets and numbering sequences.
-- Additive. Does not rewrite issued snapshots, reset counters, or delete invoices,
-- versions, lines, receipts, payment plans, subscriptions, users, or products.
-- The original EG-EGP, AE-USD, and AE-EUR presets keep their codes, bank details,
-- logos, office identities, and sequence associations. EG and AE counters are not reseeded.
-- Apply only to Value CRM (idhqrvrpzlkpyyqlkozl), and do not re-run older migrations.

create or replace function private.canonical_sequence_prefix(p_prefix text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
begin
  if v_prefix !~ '^[A-Z][A-Z0-9]{0,7}$' then
    raise exception 'A numbering prefix must be 1 to 8 letters or digits, starting with a letter, with no spaces or punctuation.';
  end if;
  return v_prefix;
end;
$$;

create or replace function private.format_pi_number(p_prefix text, p_year integer, p_serial integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_prefix || '-' || lpad(p_year::text, 4, '0') || '-' || lpad(p_serial::text, 5, '0');
$$;

comment on function private.format_pi_number(text, integer, integer) is
  'Canonical PI number: PREFIX-YYYY-SERIAL. SERIAL is at least five digits. A prefix cannot contain a hyphen, so two sequences cannot format the same number.';

revoke all on function private.canonical_sequence_prefix(text) from public, anon, authenticated;
revoke all on function private.format_pi_number(text, integer, integer) from public, anon, authenticated;
grant execute on function private.canonical_sequence_prefix(text) to authenticated, service_role;

create table public.numbering_sequences (
  code text primary key,
  prefix text not null,
  created_at timestamptz not null default now(),
  constraint numbering_sequences_code_format_check check (code ~ '^[A-Z][A-Z0-9]{0,11}$'),
  constraint numbering_sequences_prefix_format_check check (prefix ~ '^[A-Z][A-Z0-9]{0,7}$'),
  constraint numbering_sequences_prefix_key unique (prefix)
);

alter table public.numbering_sequences enable row level security;

comment on table public.numbering_sequences is
  'One numbering sequence shared by one or more company presets. code is stable. prefix is the start of the PI number.';
comment on column public.numbering_sequences.prefix is
  'Canonical prefix, such as EG or AE. A used prefix, and the original EG and AE prefixes, cannot be changed.';
comment on table private.pi_counters is
  'Annual counters keyed by numbering sequence code. The office column stores that code, which is EG or AE for the original sequences.';
comment on function private.allocate_serial(text, integer) is
  'Allocates the next serial for a numbering sequence and year inside the current transaction. The first argument is the sequence code.';

insert into public.numbering_sequences (code, prefix)
values ('EG', 'EG'), ('AE', 'AE');

create or replace function private.protect_numbering_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Numbering sequences cannot be deleted.';
  end if;

  new.prefix := private.canonical_sequence_prefix(new.prefix);
  if tg_op = 'INSERT' then
    if new.code is null or btrim(new.code) = '' then
      new.code := new.prefix;
    else
      new.code := upper(btrim(new.code));
    end if;
  elsif new.code is distinct from old.code then
    raise exception 'A numbering sequence identifier cannot be changed.';
  end if;

  if new.code !~ '^[A-Z][A-Z0-9]{0,11}$' then
    raise exception 'A numbering sequence identifier must be 1 to 12 letters or digits, starting with a letter.';
  end if;

  if tg_op = 'UPDATE' and new.prefix is distinct from old.prefix then
    if old.code in ('EG', 'AE') then
      raise exception 'The original EG and AE numbering prefixes cannot be changed.';
    end if;
    if exists (
      select 1
      from public.proforma_invoices
      where sequence_code = old.code
        and serial is not null
    ) then
      raise exception 'This numbering sequence has already been used. Its prefix cannot be changed.';
    end if;
  end if;

  if tg_op = 'INSERT' and exists (
    select 1
    from public.numbering_sequences
    where code = new.code or prefix = new.prefix
  ) then
    raise exception 'The prefix % is already used by another numbering sequence. Choose a different prefix so PI numbers stay unique.', new.prefix;
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.numbering_sequences
    where prefix = new.prefix
      and code is distinct from new.code
  ) then
    raise exception 'The prefix % is already used by another numbering sequence. Choose a different prefix so PI numbers stay unique.', new.prefix;
  end if;

  if exists (
    select 1
    from public.proforma_invoices
    where pi_number ~ ('^' || new.prefix || '-[0-9]{4}-[0-9]{5,}$')
      and sequence_code is distinct from new.code
  ) then
    raise exception 'The prefix % would repeat an existing PI number. Choose a different prefix.', new.prefix;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_numbering_sequence() from public, anon, authenticated;
grant execute on function private.protect_numbering_sequence() to authenticated, service_role;

create trigger numbering_sequences_guard
before insert or update or delete on public.numbering_sequences
for each row execute function private.protect_numbering_sequence();

create policy numbering_sequences_select on public.numbering_sequences
for select to authenticated
using (private.is_active_member());

create policy numbering_sequences_insert on public.numbering_sequences
for insert to authenticated
with check (private.is_admin());

create policy numbering_sequences_update on public.numbering_sequences
for update to authenticated
using (private.is_admin())
with check (private.is_admin());

revoke all on table public.numbering_sequences from public, anon, authenticated;
grant select, insert, update on table public.numbering_sequences to authenticated;

alter table public.company_presets
  add column display_name text,
  add column sequence_code text,
  add column archived_at timestamptz;

comment on column public.company_presets.code is
  'Stable preset identifier. It is not the display name and it is not changed after insert.';
comment on column public.company_presets.display_name is
  'Mutable label shown in Settings and the PI office list.';
comment on column public.company_presets.office is
  'Office identity shared by presets that use the same code. It is not necessarily the numbering prefix.';
comment on column public.company_presets.sequence_code is
  'Numbering sequence assigned to this preset. Locked after the preset has issued a PI.';
comment on column public.company_presets.archived_at is
  'When set, the preset cannot be selected for a new issue. An issued revision can still use it.';
comment on column public.company_presets.account_number is
  'Stored as text so leading zeroes are preserved.';

create or replace function private.protect_preset_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_used boolean;
begin
  if tg_op = 'INSERT' then
    if new.code is null or btrim(new.code) = '' then
      new.code := 'P-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 12));
    end if;
    new.code := upper(btrim(new.code));
    if new.code !~ '^[A-Z0-9][A-Z0-9-]{0,31}$' then
      raise exception 'A preset identifier must be 1 to 32 letters, digits, or hyphens.';
    end if;
  elsif new.code is distinct from old.code then
    raise exception 'A preset identifier cannot be changed.';
  end if;

  new.display_name := btrim(coalesce(new.display_name, ''));
  if char_length(new.display_name) < 1 or char_length(new.display_name) > 120 then
    raise exception 'Enter a display name of up to 120 characters. The display name is not the preset identifier.';
  end if;

  if new.office is null or btrim(new.office) = '' then
    raise exception 'Enter an office identifier. It is not the display name.';
  end if;
  new.office := upper(btrim(new.office));
  if new.office !~ '^[A-Z][A-Z0-9]{0,11}$' then
    raise exception 'An office identifier must be 1 to 12 letters or digits, starting with a letter.';
  end if;

  if new.currency is null or btrim(new.currency) = '' then
    raise exception 'Choose EGP, USD, or EUR. There is no currency conversion.';
  end if;
  new.currency := upper(btrim(new.currency));
  if new.currency not in ('EGP', 'USD', 'EUR') then
    raise exception 'Only EGP, USD, and EUR are supported. There is no currency conversion.';
  end if;

  if new.layout is null or btrim(new.layout) = '' then
    raise exception 'Choose the Egypt or UAE PDF layout.';
  end if;
  new.layout := lower(btrim(new.layout));
  if new.layout not in ('egypt', 'uae') then
    raise exception 'Choose the Egypt or UAE PDF layout.';
  end if;

  if new.sequence_code is null or btrim(new.sequence_code) = '' then
    raise exception 'Choose a numbering sequence, or create one with a new prefix.';
  end if;
  new.sequence_code := upper(btrim(new.sequence_code));
  if not exists (select 1 from public.numbering_sequences where code = new.sequence_code) then
    raise exception 'The numbering sequence does not exist.';
  end if;

  if tg_op = 'UPDATE' then
    select exists (
      select 1
      from public.proforma_invoices
      where preset_code = old.code
        and pi_number is not null
    ) into v_used;
    if v_used and (
      new.office is distinct from old.office
      or new.currency is distinct from old.currency
      or (
        old.sequence_code is not null
        and new.sequence_code is distinct from old.sequence_code
      )
    ) then
      raise exception 'This preset has already been used to issue a PI. Its currency, office, and numbering sequence stay as they were. Create a new preset to change them.';
    end if;
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

drop trigger if exists presets_prepare on public.company_presets;
create trigger presets_prepare
before insert on public.company_presets
for each row execute function private.protect_preset_identity();

update public.company_presets
set
  display_name = case code
    when 'EG-EGP' then 'Egypt — EGP'
    when 'AE-USD' then 'UAE — USD'
    when 'AE-EUR' then 'UAE — EUR'
    else coalesce(nullif(btrim(display_name), ''), code)
  end,
  sequence_code = coalesce(sequence_code, office)
where display_name is null
   or sequence_code is null;

alter table public.company_presets
  alter column display_name set not null,
  alter column sequence_code set not null;

alter table public.company_presets
  add constraint company_presets_sequence_code_fkey
  foreign key (sequence_code) references public.numbering_sequences (code);

create index company_presets_sequence_idx on public.company_presets (sequence_code);

alter table public.company_presets drop constraint if exists company_presets_code_check;
alter table public.company_presets drop constraint if exists company_presets_office_check;

do $drop_preset_checks$
declare
  v_name text;
  v_def text;
begin
  for v_name, v_def in
    select con.conname, pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'company_presets'
      and con.contype = 'c'
  loop
    if v_def ilike '%EG-EGP%'
      or (
        v_def ~ 'office' and v_def like '%''EG''%' and v_def like '%''AE''%' and v_def not like '%EGP%'
      )
    then
      execute format('alter table public.company_presets drop constraint %I', v_name);
    end if;
  end loop;
end
$drop_preset_checks$;

alter table public.company_presets
  add constraint company_presets_code_format_check
  check (code ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  add constraint company_presets_office_format_check
  check (office ~ '^[A-Z][A-Z0-9]{0,11}$'),
  add constraint company_presets_display_name_check
  check (char_length(btrim(display_name)) between 1 and 120);

alter table public.company_presets
  alter column code set default ('P-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 12)));

create policy presets_insert on public.company_presets
for insert to authenticated
with check (private.is_admin());

grant insert on table public.company_presets to authenticated;

alter table public.proforma_invoices
  add column sequence_code text;

update public.proforma_invoices as pi
set sequence_code = cp.sequence_code
from public.company_presets as cp
where pi.sequence_code is null
  and pi.preset_code = cp.code;

update public.proforma_invoices
set sequence_code = office
where sequence_code is null
  and office in (select code from public.numbering_sequences);

alter table public.proforma_invoices
  add constraint proforma_invoices_sequence_code_fkey
  foreign key (sequence_code) references public.numbering_sequences (code);

comment on column public.proforma_invoices.office is
  'Office identity copied from the preset. It is not the numbering prefix when a preset shares another sequence.';
comment on column public.proforma_invoices.sequence_code is
  'Numbering sequence used when this PI is issued. Null until a preset is saved.';

alter table public.proforma_invoices drop constraint if exists proforma_invoices_office_check;

do $drop_invoice_checks$
declare
  v_name text;
  v_def text;
begin
  for v_name, v_def in
    select con.conname, pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'proforma_invoices'
      and con.contype = 'c'
  loop
    if v_def ~ 'office' and v_def like '%''EG''%' and v_def like '%''AE''%' and v_def not like '%EGP%' then
      execute format('alter table public.proforma_invoices drop constraint %I', v_name);
    end if;
  end loop;

  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'proforma_invoices'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) ilike '%office%'
      and pg_get_constraintdef(con.oid) ilike '%pi_year%'
      and pg_get_constraintdef(con.oid) ilike '%serial%'
  loop
    execute format('alter table public.proforma_invoices drop constraint %I', v_name);
  end loop;
end
$drop_invoice_checks$;

alter table public.proforma_invoices
  add constraint proforma_invoices_office_format_check
  check (office is null or office ~ '^[A-Z][A-Z0-9]{0,11}$');

create unique index proforma_invoices_sequence_year_serial_key
  on public.proforma_invoices (sequence_code, pi_year, serial)
  where sequence_code is not null and pi_year is not null and serial is not null;

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
  v_sequence text;
  v_archived timestamptz;
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
  v_payment_terms text;
  v_schedule jsonb;
  v_schedule_state text;
  v_billing text;
  v_agreement jsonb;
  v_previous jsonb;
  v_stored jsonb := '[]'::jsonb;
  v_had_agreement boolean := false;
  v_mentions boolean := false;
  v_has_subscription boolean := false;
  v_price_to_save numeric;
  v_seen_obligations text[] := '{}';
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
    select office, currency, sequence_code, archived_at
    into v_office, v_currency, v_sequence, v_archived
    from public.company_presets where code = v_preset_code;
    if not found then
      raise exception 'Unknown office preset.';
    end if;
    if v_archived is not null and v_preset_code is distinct from v_pi.preset_code then
      raise exception 'This preset is archived and cannot be selected. Choose an active preset. A draft that already uses it can keep that selection, but it cannot be newly issued.';
    end if;
    if v_pi.pi_number is not null and (
      v_office is distinct from v_pi.office
      or v_currency is distinct from v_pi.currency
      or (v_pi.sequence_code is not null and v_sequence is distinct from v_pi.sequence_code)
    ) then
      raise exception 'Office, currency, and numbering are locked on issued documents.';
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


  if p_payload ? 'payment_schedule' then
    if jsonb_typeof(p_payload -> 'payment_schedule') = 'null' then
      if v_pi.payment_schedule is not null then
        raise exception 'A structured payment schedule cannot be replaced by the legacy payment paragraph.';
      end if;
      v_schedule := null;
      v_schedule_state := 'null';
      v_payment_terms := coalesce(p_payload ->> 'payment_terms', '');
    elsif jsonb_typeof(p_payload -> 'payment_schedule') = 'object' then
      if coalesce(p_payload -> 'payment_schedule' ->> 'schema_version', '') = '2' then
        v_schedule := private.sanitize_allocated_schedule(p_payload -> 'payment_schedule');
        v_schedule_state := 'v2';
      else
        v_schedule := private.sanitize_payment_schedule(p_payload -> 'payment_schedule');
        v_schedule_state := 'v1';
      end if;
      v_payment_terms := '';
    else
      raise exception 'The payment schedule could not be read.';
    end if;
  else
    if v_pi.payment_schedule is not null then
      raise exception 'This draft has a structured payment schedule. Close this editor and open the PI again before saving.';
    end if;
    v_schedule := null;
    v_schedule_state := 'omitted';
    v_payment_terms := coalesce(p_payload ->> 'payment_terms', '');
  end if;

  update public.proforma_invoices
  set preset_code = v_preset_code,
      office = v_office,
      currency = v_currency,
      sequence_code = v_sequence,
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
      payment_terms = v_payment_terms,
      payment_schedule = v_schedule,
      delivery_terms = coalesce(p_payload ->> 'delivery_terms', ''),
      warranty = coalesce(p_payload ->> 'warranty', ''),
      additional_notes = coalesce(p_payload ->> 'additional_notes', ''),
      draft_version = draft_version + 1,
      updated_at = now()
  where id = p_id;

  if (select discount_type from public.proforma_invoices where id = p_id) not in ('none', 'fixed', 'percent') then
    raise exception 'Invalid discount type.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'obligation_id', subscription_agreement ->> 'obligation_id',
    'agreement', subscription_agreement
  )), '[]'::jsonb)
  into v_stored
  from public.pi_lines
  where pi_id = p_id and subscription_agreement is not null;
  v_had_agreement := v_stored <> '[]'::jsonb;

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

      select p.model_code, p.vendor_id, v.company_name, p.billing_type
      into v_model, v_product_vendor, v_vendor_name, v_billing
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

      if v_billing = 'subscription' then
        v_has_subscription := true;
      end if;
      if v_line ? 'subscription' then
        v_mentions := true;
      end if;
      v_previous := null;
      if jsonb_typeof(v_line -> 'subscription') = 'object' then
        select elem -> 'agreement'
        into v_previous
        from jsonb_array_elements(v_stored) elem
        where elem ->> 'obligation_id' = v_line -> 'subscription' ->> 'obligation_id'
        limit 1;
      end if;
      v_agreement := private.resolve_subscription_agreement(
        v_product,
        v_model,
        v_billing,
        v_currency,
        v_price,
        case when v_line ? 'subscription' then v_line -> 'subscription' else 'null'::jsonb end,
        v_previous
      );
      v_price_to_save := case
        when v_agreement is null then v_price
        else (v_agreement ->> 'negotiated_first_year_unit_price')::numeric
      end;
      if v_agreement is not null and nullif(v_agreement ->> 'obligation_id', '') is not null then
        if lower(v_agreement ->> 'obligation_id') = any(v_seen_obligations) then
          raise exception 'Each subscription line needs its own obligation identifier. Another line on this PI already uses it, so nothing was saved.';
        end if;
        v_seen_obligations := array_append(v_seen_obligations, lower(v_agreement ->> 'obligation_id'));
      end if;

      insert into public.pi_lines (
        pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, subscription_agreement
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
        v_price_to_save,
        v_agreement
      );
    end loop;
  end if;

  if v_had_agreement and not v_mentions then
    raise exception 'This draft has a saved subscription commitment. Close this editor and open the PI again before saving.';
  end if;
  if v_has_subscription then
    if v_schedule_state = 'omitted' then
      raise exception 'This draft includes a subscription. Close this editor and open the PI again, then update the payment allocation. The current payment agreement was left unchanged.';
    elsif v_schedule_state = 'null' then
      raise exception 'A subscription needs an allocation-aware payment schedule. The legacy payment paragraph was left unchanged.';
    elsif v_schedule_state = 'v1' then
      raise exception 'This draft uses a payment schedule based on the whole PI total. A subscription is payable 100%% in advance and cannot be included in those instalments. Update the payment allocation, then save. The current schedule was left unchanged.';
    end if;
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
  if v_preset.archived_at is not null and v_pi.pi_number is null then
    raise exception 'This preset is archived. Choose an active preset before issuing. A revision of an issued PI can still use this preset.';
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
  if exists (
    select 1
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = p_id and p.billing_type = 'one_time' and l.subscription_agreement is not null
  ) then
    raise exception 'A one-time item cannot carry a subscription commitment.';
  end if;
  if exists (
    select 1
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = p_id
      and p.billing_type = 'subscription'
      and (
        l.subscription_agreement is null
        or coalesce(l.subscription_agreement ->> 'schema_version', '') <> '1'
        or coalesce(l.subscription_agreement ->> 'current_year', '') <> '1'
        or l.subscription_agreement ->> 'currency' is distinct from v_preset.currency
        or nullif(l.subscription_agreement ->> 'obligation_id', '') is null
        or l.unit_price is distinct from (l.subscription_agreement ->> 'negotiated_first_year_unit_price')::numeric
        or coalesce(l.subscription_agreement ->> 'commitment_years', '') !~ '^[1-9][0-9]*$'
        or not exists (
          select 1 from public.product_commitment_options o
          where o.id = private.as_uuid(l.subscription_agreement ->> 'option_id')
            and o.product_id = l.product_id
        )
      )
  ) then
    raise exception 'Select a current commitment for every subscription, priced in this PI currency, before generating. Saved terms are not replaced from the catalogue.';
  end if;
  if exists (
    select 1
    from public.pi_lines
    where pi_id = p_id
      and subscription_agreement is not null
      and nullif(subscription_agreement ->> 'obligation_id', '') is not null
    group by lower(subscription_agreement ->> 'obligation_id')
    having count(*) > 1
  ) then
    raise exception 'Each subscription line needs its own obligation identifier.';
  end if;
  if exists (
    select 1
    from public.pi_lines l
    join public.products p on p.id = l.product_id
    where l.pi_id = p_id and p.billing_type = 'subscription'
  ) and (
    v_pi.payment_schedule is null
    or coalesce(v_pi.payment_schedule ->> 'schema_version', '') <> '2'
  ) then
    raise exception 'A PI with a subscription must use an allocation-aware payment schedule before it can be issued.';
  end if;
  if v_pi.payment_schedule is not null and coalesce(v_pi.payment_schedule ->> 'schema_version', '') = '2' then
    perform private.canonical_allocated_payment(p_id);
  elsif v_pi.payment_schedule is not null then
    perform private.canonical_payment(v_pi.payment_schedule, v_preset.currency, v_pi.grand_total);
  end if;
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
  v_prefix text;
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
    raise exception 'This PI is already issued. Download it from version history, or create a revision.';
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
  select prefix into v_prefix from public.numbering_sequences where code = v_preset.sequence_code;
  if v_prefix is null then
    raise exception 'This preset has no numbering sequence.';
  end if;
  v_year := extract(year from v_pi.pi_date)::integer;

  if v_pi.pi_number is null then
    v_serial := private.allocate_serial(v_preset.sequence_code, v_year);
    v_number := private.format_pi_number(v_prefix, v_year, v_serial);
    v_revision := 0;
    update public.proforma_invoices
    set pi_number = v_number,
        pi_year = v_year,
        serial = v_serial,
        office = v_preset.office,
        currency = v_preset.currency,
        sequence_code = v_preset.sequence_code
    where id = p_id;
  else
    if v_pi.sequence_code is null
      or v_year <> v_pi.pi_year
      or v_preset.office is distinct from v_pi.office
      or v_preset.currency is distinct from v_pi.currency
      or v_preset.sequence_code is distinct from v_pi.sequence_code
    then
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
    'issued',
    null,
    v_snapshot ->> 'layout_version',
    (select grand_total from public.proforma_invoices where id = p_id)
  )
  returning id into v_version_id;

  update public.proforma_invoices
  set draft_open = false,
      payment_terms = case
        when v_snapshot ? 'payment' then coalesce(v_snapshot #>> '{terms,payment_terms}', '')
        else payment_terms
      end,
      updated_at = now()
  where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'draft_version', (select draft_version from public.proforma_invoices where id = p_id),
    'version_id', v_version_id,
    'revision', v_revision,
    'pi_number', v_number,
    'display_number', v_snapshot ->> 'display_number',
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
    preset_code, office, currency, sequence_code, pi_date, expiry_date, client_id, client_contact_id,
    bill_to, ship_to, ship_same_as_billing, customer_reference, lead_salesperson_id, created_by,
    discount_type, discount_value, shipping_amount, installation_amount, bank_charge_amount,
    tax_enabled, tax_percent, tax_excludes_shipping, tax_excludes_installation, tax_excludes_bank_charge,
    price_basis, payment_terms, delivery_terms, warranty, additional_notes, payment_schedule,
    subtotal, discount_amount, net_items, taxable_base, tax_amount, grand_total
  ) values (
    v_source.preset_code, v_source.office, v_source.currency, v_source.sequence_code, v_date, v_expiry,
    v_source.client_id, v_source.client_contact_id, v_source.bill_to, v_source.ship_to,
    v_source.ship_same_as_billing, v_source.customer_reference, v_source.lead_salesperson_id,
    (select auth.uid()), v_source.discount_type, v_source.discount_value, v_source.shipping_amount,
    v_source.installation_amount, v_source.bank_charge_amount, v_source.tax_enabled, v_source.tax_percent,
    v_source.tax_excludes_shipping, v_source.tax_excludes_installation, v_source.tax_excludes_bank_charge,
    v_source.price_basis,
    case when v_source.payment_schedule is null then v_source.payment_terms else '' end,
    v_source.delivery_terms, v_source.warranty,
    v_source.additional_notes,
    case when v_source.payment_schedule is null then null else private.copy_payment_schedule_for_duplicate(v_source.payment_schedule) end,
    v_source.subtotal, v_source.discount_amount, v_source.net_items,
    v_source.taxable_base, v_source.tax_amount, v_source.grand_total
  )
  returning id into v_id;

  insert into public.pi_lines (
    pi_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total, subscription_agreement
  )
  select v_id, position, product_id, vendor_id, vendor_name, model_code, description, unit, quantity, unit_price, line_total,
    private.remap_subscription_agreement(subscription_agreement)
  from public.pi_lines where pi_id = p_id;

  insert into public.pi_salespeople (pi_id, user_id)
  select v_id, user_id from public.pi_salespeople where pi_id = p_id;

  return v_id;
end;
$$;

create or replace function public.create_company_preset(p_preset jsonb)
returns public.company_presets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sequence text;
  v_prefix text;
  v_row public.company_presets;
begin
  if not private.is_admin() then
    raise exception 'Only an active administrator can add a company preset.';
  end if;

  v_sequence := nullif(btrim(coalesce(p_preset ->> 'sequence_code', '')), '');
  v_prefix := nullif(btrim(coalesce(p_preset ->> 'new_prefix', '')), '');
  if v_sequence is not null and v_prefix is not null then
    raise exception 'Choose an existing numbering sequence or a new prefix, not both.';
  end if;
  if v_sequence is null and v_prefix is null then
    raise exception 'Choose a numbering sequence, or create one with a new prefix.';
  end if;
  if v_prefix is not null then
    insert into public.numbering_sequences (prefix)
    values (v_prefix)
    returning code into v_sequence;
  end if;

  insert into public.company_presets (
    display_name, office, currency, layout, sequence_code,
    company_name, address, phone, fax, email, website, tax_registration,
    logo_base64, logo_content_type,
    bank_name, bank_branch, bank_address, bank_swift,
    account_name, account_number, iban, correspondent_bank, bank_notes,
    archived_at
  ) values (
    p_preset ->> 'display_name',
    p_preset ->> 'office',
    p_preset ->> 'currency',
    p_preset ->> 'layout',
    v_sequence,
    coalesce(p_preset ->> 'company_name', ''),
    coalesce(p_preset ->> 'address', ''),
    coalesce(p_preset ->> 'phone', ''),
    coalesce(p_preset ->> 'fax', ''),
    coalesce(p_preset ->> 'email', ''),
    coalesce(p_preset ->> 'website', ''),
    coalesce(p_preset ->> 'tax_registration', ''),
    nullif(p_preset ->> 'logo_base64', ''),
    nullif(p_preset ->> 'logo_content_type', ''),
    coalesce(p_preset ->> 'bank_name', ''),
    coalesce(p_preset ->> 'bank_branch', ''),
    coalesce(p_preset ->> 'bank_address', ''),
    coalesce(p_preset ->> 'bank_swift', ''),
    coalesce(p_preset ->> 'account_name', ''),
    coalesce(p_preset ->> 'account_number', ''),
    coalesce(p_preset ->> 'iban', ''),
    coalesce(p_preset ->> 'correspondent_bank', ''),
    coalesce(p_preset ->> 'bank_notes', ''),
    case when coalesce((p_preset ->> 'archived')::boolean, false) then now() else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_company_preset(jsonb) from public, anon, authenticated;
grant execute on function public.create_company_preset(jsonb) to authenticated;

create or replace view public.pi_list
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
  (pi.draft_open and lv.id is not null) as has_open_revision,
  pi.preset_code,
  preset.display_name as preset_display_name
from public.proforma_invoices pi
left join public.clients c on c.id = pi.client_id
left join public.profiles creator on creator.id = pi.created_by
left join public.profiles lead on lead.id = pi.lead_salesperson_id
left join public.company_presets preset on preset.code = pi.preset_code
left join lateral (
  select v.id, v.revision, v.grand_total, v.snapshot
  from public.pi_versions v
  where v.pi_id = pi.id
  order by v.revision desc
  limit 1
) lv on true;

create view public.preset_issue_keys
with (security_invoker = true) as
select distinct preset_code, sequence_code
from public.proforma_invoices
where pi_number is not null
  and preset_code is not null;

revoke all on table public.preset_issue_keys from public, anon, authenticated;
grant select on table public.preset_issue_keys to authenticated;
