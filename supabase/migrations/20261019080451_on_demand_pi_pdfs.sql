-- Issued PIs are complete when the snapshot is stored. The browser renders the PDF
-- from that snapshot. pdf_status and pdf_path stay as legacy metadata and are not
-- rewritten on existing rows. New versions use pdf_status 'issued' and a null
-- pdf_path, so they are not left pending for a file that will not be uploaded.

alter table public.pi_versions drop constraint pi_versions_pdf_status_check;

alter table public.pi_versions
  add constraint pi_versions_pdf_status_check
  check (pdf_status in ('pending', 'ready', 'issued'));

alter table public.pi_versions alter column pdf_status set default 'issued';

comment on column public.pi_versions.pdf_status is
  'Legacy storage metadata. pending and ready describe the old upload workflow. issued means the snapshot is the document and no PDF file is required. New versions use issued. Existing rows are not updated by this change.';

comment on column public.pi_versions.pdf_path is
  'Legacy object name in the private pi-pdfs bucket. Null when no file was stored. Downloads do not read this column.';

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
  if old.pdf_status in ('ready', 'issued')
    and (
      new.pdf_status is distinct from old.pdf_status
      or new.pdf_path is distinct from old.pdf_path
    )
  then
    raise exception 'Issued version storage metadata cannot be changed.';
  end if;
  return new;
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
    'issued',
    null,
    v_snapshot ->> 'layout_version',
    (select grand_total from public.proforma_invoices where id = p_id)
  )
  returning id into v_version_id;

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
    'snapshot', v_snapshot
  );
end;
$$;

drop policy if exists pi_pdfs_insert on storage.objects;
drop policy if exists pi_pdfs_delete on storage.objects;

drop function if exists public.prepare_pdf_retry(uuid);
drop function if exists public.confirm_pi_pdf(uuid);
drop function if exists private.prepare_pdf_retry(uuid);
drop function if exists private.confirm_pi_pdf(uuid);
drop function if exists private.can_write_pending_pdf(text);
