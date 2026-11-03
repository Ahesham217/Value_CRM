-- Finance review of a receipt that staff have already recorded.
-- Additive: receipts, allocations, balances, subscriptions, snapshots, and numbering stay as they are.
-- A receipt with no review row is awaiting review. This migration does not insert review rows.
-- The internal reference is not the bank or customer reference on payment_receipts.
-- Internal references may repeat. One voucher can cover more than one receipt.
-- Review locks the payment plan, then its obligations by id, then the receipt, then the review row.

alter table public.profiles
  add column if not exists can_review_payments boolean not null default false;

comment on column public.profiles.can_review_payments is
  'Review a recorded receipt and store an internal payment reference. Does not record or reverse a receipt and does not grant purchase-price or PI access. Existing members are not granted this by the migration. Active administrators already pass private.has_flag.';

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
    when 'can_manage_payments' then return v.can_manage_payments;
    when 'can_reverse_payments' then return v.can_reverse_payments;
    when 'can_activate_zero_subscriptions' then return v.can_activate_zero_subscriptions;
    when 'can_review_payments' then return v.can_review_payments;
    else return false;
  end case;
end;
$$;

create table public.payment_receipt_reviews (
  receipt_id uuid primary key references public.payment_receipts (id) on delete restrict,
  status text not null check (status in ('awaiting_review', 'needs_clarification', 'verified')),
  internal_reference text,
  note text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  ever_verified boolean not null default false,
  version integer not null check (version >= 1),
  check (internal_reference is null or char_length(internal_reference) between 1 and 80),
  check (note is null or char_length(note) between 1 and 400),
  check (
    (
      status = 'awaiting_review'
      and internal_reference is null
      and note is null
      and reviewed_by is null
      and reviewed_at is null
    )
    or (
      status = 'needs_clarification'
      and note is not null
      and reviewed_by is not null
      and reviewed_at is not null
    )
    or (
      status = 'verified'
      and internal_reference is not null
      and reviewed_by is not null
      and reviewed_at is not null
    )
  )
);

comment on table public.payment_receipt_reviews is
  'Current finance review of one receipt. No row means awaiting review. Verification does not change the receipt, its allocations, or the outstanding balance. ever_verified stays true after a later reopen.';

comment on column public.payment_receipt_reviews.internal_reference is
  'Finance internal payment reference. At most 80 characters. Not unique, and not the bank or customer reference stored on the receipt.';

comment on column public.payment_receipt_reviews.note is
  'Current clarification reason, or an optional note on a verified review. At most 400 characters. A reopen reason is kept in history, not here.';

comment on column public.payment_receipt_reviews.version is
  'Increments on every saved transition. A submission for an older version is rejected.';

create table public.payment_receipt_review_events (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.payment_receipts (id) on delete restrict,
  action text not null check (action in ('verified', 'needs_clarification', 'reopened')),
  from_status text not null check (from_status in ('awaiting_review', 'needs_clarification', 'verified')),
  to_status text not null check (to_status in ('awaiting_review', 'needs_clarification', 'verified')),
  internal_reference text,
  note text,
  actor_id uuid not null references public.profiles (id),
  acted_at timestamptz not null default now(),
  version integer not null check (version >= 1),
  idempotency_key uuid not null,
  request_action text not null check (request_action in ('verify', 'clarify', 'reopen')),
  request_internal_reference text,
  request_note text,
  unique (receipt_id, idempotency_key),
  check (internal_reference is null or char_length(internal_reference) between 1 and 80),
  check (note is null or char_length(note) between 1 and 400),
  check (request_internal_reference is null or char_length(request_internal_reference) between 1 and 80),
  check (request_note is null or char_length(request_note) between 1 and 400),
  check (
    (
      action = 'verified'
      and to_status = 'verified'
      and from_status in ('awaiting_review', 'needs_clarification')
      and internal_reference is not null
    )
    or (
      action = 'needs_clarification'
      and to_status = 'needs_clarification'
      and from_status in ('awaiting_review', 'needs_clarification')
      and note is not null
    )
    or (
      action = 'reopened'
      and to_status = 'awaiting_review'
      and from_status = 'verified'
      and note is not null
    )
  )
);

comment on table public.payment_receipt_review_events is
  'Append-only history of finance review transitions. Rows are not edited or deleted. The actor and time come from the database session, not from the submitted payload. request_action, request_internal_reference, and request_note are the normalized submission that idempotency_key identifies.';

create index payment_receipt_reviews_status_idx
  on public.payment_receipt_reviews (status, receipt_id);

create index payment_receipt_review_events_receipt_idx
  on public.payment_receipt_review_events (receipt_id, acted_at, id);

create index payment_receipts_received_recorded_idx
  on public.payment_receipts (received_on, recorded_at, id);

comment on index public.payment_receipts_received_recorded_idx is
  'Received-payment register filters and pages by received date without loading every receipt into the client.';

create or replace function private.receipt_review_display_status(
  p_reversed boolean,
  p_status text,
  p_ever_verified boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_reversed and (coalesce(p_ever_verified, false) or p_status = 'verified') then 'reversed_previously_verified'
    when p_reversed then 'reversed'
    when p_status = 'needs_clarification' then 'needs_clarification'
    when p_status = 'verified' then 'verified'
    else 'awaiting_review'
  end;
$$;

comment on function private.receipt_review_display_status(boolean, text, boolean) is
  'Review label for one receipt. A reversed receipt is never currently verified. No stored status means awaiting review.';

create or replace function private.payment_receipt_reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Receipt reviews can only be changed through the review actions.';
  end if;
  if coalesce(current_setting('value_crm.receipt_review_write', true), '') is distinct from 'on' then
    raise exception 'Receipt reviews can only be changed through the review actions.';
  end if;
  if tg_op = 'UPDATE' and new.receipt_id is distinct from old.receipt_id then
    raise exception 'A review stays with its receipt.';
  end if;
  if tg_op = 'UPDATE' and old.ever_verified and not new.ever_verified then
    raise exception 'Verification history cannot be cleared.';
  end if;
  if tg_op = 'INSERT' and new.version <> 1 then
    raise exception 'Review history cannot skip a version.';
  end if;
  if tg_op = 'UPDATE' and new.version is distinct from old.version + 1 then
    raise exception 'Review history cannot skip a version.';
  end if;
  return new;
end;
$$;

create trigger payment_receipt_reviews_guard
before insert or update or delete on public.payment_receipt_reviews
for each row execute function private.payment_receipt_reviews_guard();

create or replace function private.payment_receipt_review_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'Review history cannot be edited or deleted.';
  end if;
  if coalesce(current_setting('value_crm.receipt_review_write', true), '') is distinct from 'on' then
    raise exception 'Receipt reviews can only be changed through the review actions.';
  end if;
  if not exists (
    select 1
    from public.payment_receipt_reviews review
    where review.receipt_id = new.receipt_id
      and review.version = new.version
  ) then
    raise exception 'Review history must match the current review.';
  end if;
  return new;
end;
$$;

create trigger payment_receipt_review_events_guard
before insert or update or delete on public.payment_receipt_review_events
for each row execute function private.payment_receipt_review_events_guard();

create or replace function private.require_payment_reviewer()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_active_member() then
    raise exception 'Sign in required.';
  end if;
  if not private.has_flag('can_review_payments') then
    raise exception 'You do not have permission to review received payments.';
  end if;
end;
$$;

create or replace function private.receipt_review_payload(p_receipt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_receipt public.payment_receipts;
  v_plan public.payment_plans;
  v_pi public.proforma_invoices;
  v_source public.pi_versions;
  v_review public.payment_receipt_reviews;
  v_has_review boolean := false;
  v_client text;
  v_display text;
  v_allocations jsonb;
  v_history jsonb;
begin
  if (select auth.uid()) is null or not private.is_active_member() then
    raise exception 'Sign in required.';
  end if;
  select * into v_receipt from public.payment_receipts where id = p_receipt_id;
  if not found then
    raise exception 'This receipt was not found, or you do not have access to it.';
  end if;
  select * into v_plan from public.payment_plans where id = v_receipt.plan_id;
  if not found or not private.can_read_pi(v_plan.pi_id) then
    raise exception 'This receipt was not found, or you do not have access to it.';
  end if;
  select * into v_pi from public.proforma_invoices where id = v_plan.pi_id;
  select * into v_source from public.pi_versions where id = v_plan.source_version_id;
  select * into v_review from public.payment_receipt_reviews where receipt_id = v_receipt.id;
  v_has_review := found;
  select coalesce(
    nullif(btrim(v_source.snapshot #>> '{client,company_name}'), ''),
    nullif(btrim(c.company_name), ''),
    ''
  )
  into v_client
  from public.proforma_invoices pi
  left join public.clients c on c.id = pi.client_id
  where pi.id = v_pi.id;
  v_display := case
    when v_pi.pi_number is null or btrim(v_pi.pi_number) = '' then 'Draft'
    when coalesce(v_source.revision, 0) > 0 then v_pi.pi_number || '-R' || v_source.revision::text
    else v_pi.pi_number
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'obligation_id', obligation.id,
      'label', obligation.label,
      'amount', private.payment_plain_amount(allocation.amount)
    )
    order by obligation.position, obligation.id
  ), '[]'::jsonb)
  into v_allocations
  from public.payment_allocations allocation
  join public.payment_obligations obligation on obligation.id = allocation.obligation_id
  where allocation.receipt_id = v_receipt.id;

  select coalesce(jsonb_agg(item.payload order by item.version, item.acted_at, item.id), '[]'::jsonb)
  into v_history
  from (
    select
      event.version,
      event.acted_at,
      event.id,
      jsonb_build_object(
        'id', event.id,
        'action', event.action,
        'from_status', event.from_status,
        'to_status', event.to_status,
        'internal_reference', event.internal_reference,
        'note', event.note,
        'actor_id', event.actor_id,
        'actor_name', coalesce(nullif(btrim(actor.full_name), ''), 'Staff'),
        'acted_at', event.acted_at,
        'version', event.version
      ) as payload
    from public.payment_receipt_review_events event
    left join public.profiles actor on actor.id = event.actor_id
    where event.receipt_id = v_receipt.id
  ) item;

  return jsonb_build_object(
    'receipt', jsonb_build_object(
      'id', v_receipt.id,
      'plan_id', v_receipt.plan_id,
      'received_on', v_receipt.received_on,
      'amount', private.payment_plain_amount(v_receipt.amount),
      'currency', v_receipt.currency,
      'method', v_receipt.method,
      'reference', v_receipt.reference,
      'note', v_receipt.note,
      'recorded_by', v_receipt.recorded_by,
      'recorded_by_name', coalesce((
        select nullif(btrim(full_name), '') from public.profiles where id = v_receipt.recorded_by
      ), 'Staff'),
      'recorded_at', v_receipt.recorded_at,
      'reversed_at', v_receipt.reversed_at,
      'reversed_by', v_receipt.reversed_by,
      'reversed_by_name', case
        when v_receipt.reversed_by is null then null
        else coalesce((
          select nullif(btrim(full_name), '') from public.profiles where id = v_receipt.reversed_by
        ), 'Staff')
      end,
      'reversal_reason', v_receipt.reversal_reason
    ),
    'allocations', v_allocations,
    'source', jsonb_build_object(
      'pi_id', v_pi.id,
      'pi_number', v_pi.pi_number,
      'tracked_revision', v_source.revision,
      'tracked_display_number', v_display,
      'source_version_id', v_plan.source_version_id,
      'client_name', v_client,
      'currency', v_plan.currency,
      'agreed_total', private.payment_plain_amount(v_plan.agreed_total)
    ),
    'review', jsonb_build_object(
      'status', case when v_has_review then v_review.status else 'awaiting_review' end,
      'display_status', private.receipt_review_display_status(
        v_receipt.reversed_at is not null,
        case when v_has_review then v_review.status else null end,
        case when v_has_review then v_review.ever_verified else false end
      ),
      'internal_reference', case when v_has_review then v_review.internal_reference else null end,
      'note', case when v_has_review then v_review.note else null end,
      'reviewed_by', case when v_has_review then v_review.reviewed_by else null end,
      'reviewed_by_name', case
        when v_has_review and v_review.reviewed_by is not null then coalesce((
          select nullif(btrim(full_name), '') from public.profiles where id = v_review.reviewed_by
        ), 'Staff')
        else null
      end,
      'reviewed_at', case when v_has_review then v_review.reviewed_at else null end,
      'version', case when v_has_review then v_review.version else 0 end,
      'ever_verified', case when v_has_review then v_review.ever_verified else false end
    ),
    'history', v_history,
    'can_review', private.has_flag('can_review_payments')
  );
end;
$$;

create or replace function private.received_payment_detail(p_receipt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.receipt_review_payload(p_receipt_id);
end;
$$;

comment on function private.received_payment_detail(uuid) is
  'One receipt, its allocations, current finance review, and review history. Visibility is the source PI. A missing review is awaiting review. Reading does not change the receipt.';

create or replace function private.review_payment_receipt(
  p_receipt_id uuid,
  p_action text,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_plan_id uuid;
  v_plan public.payment_plans;
  v_receipt public.payment_receipts;
  v_review public.payment_receipt_reviews;
  v_has_review boolean := false;
  v_key uuid;
  v_reference text;
  v_note text;
  v_from text;
  v_to text;
  v_event_reference text;
  v_event_note text;
  v_status text;
  v_current_reference text;
  v_current_note text;
  v_version integer;
  v_ever boolean;
  v_request_reference text;
  v_request_note text;
  v_saved_action text;
  v_saved_reference text;
  v_saved_note text;
  v_saved_found boolean := false;
  v_now timestamptz := pg_catalog.now();
  v_actor uuid := (select auth.uid());
  v_new_version integer;
begin
  perform private.require_payment_reviewer();
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The review could not be read.';
  end if;
  if v_action not in ('verify', 'clarify', 'reopen') then
    raise exception 'Choose a review action.';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'This review could not be read. Reload the receipt before saving again.';
  end if;
  begin
    v_key := private.as_uuid(p_payload ->> 'idempotency_key');
  exception when others then
    v_key := null;
  end;
  if v_key is null then
    raise exception 'This review is missing its submission id. Reload the receipt and try again.';
  end if;
  v_reference := nullif(btrim(coalesce(p_payload ->> 'internal_reference', '')), '');
  v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  v_request_reference := v_reference;
  v_request_note := v_note;
  if v_reference is not null and char_length(v_reference) > 80 then
    raise exception 'The internal payment reference must be 80 characters or fewer.';
  end if;
  if v_note is not null and char_length(v_note) > 400 then
    if v_action = 'verify' then
      raise exception 'The finance note must be 400 characters or fewer.';
    end if;
    raise exception 'The reason must be 400 characters or fewer.';
  end if;
  if v_action = 'verify' and v_reference is null then
    raise exception 'Enter the internal payment reference.';
  end if;
  if v_action = 'clarify' and v_note is null then
    raise exception 'Enter a reason for the clarification.';
  end if;
  if v_action = 'reopen' and v_note is null then
    raise exception 'Enter a reason for reopening this review.';
  end if;

  select plan_id into v_plan_id from public.payment_receipts where id = p_receipt_id;
  if v_plan_id is null then
    raise exception 'This receipt was not found, or you do not have access to it.';
  end if;
  v_plan := private.lock_payment_plan(v_plan_id);
  select * into v_receipt from public.payment_receipts where id = p_receipt_id for update;
  if v_plan.id is null or not found or not private.can_read_pi(v_plan.pi_id) then
    raise exception 'This receipt was not found, or you do not have access to it.';
  end if;

  select * into v_review
  from public.payment_receipt_reviews
  where receipt_id = v_receipt.id
  for update;
  v_has_review := found;
  v_status := case when v_has_review then v_review.status else 'awaiting_review' end;
  v_current_reference := case when v_has_review then v_review.internal_reference else null end;
  v_current_note := case when v_has_review then v_review.note else null end;
  v_version := case when v_has_review then v_review.version else 0 end;
  v_ever := case when v_has_review then v_review.ever_verified else false end;

  select event.request_action, event.request_internal_reference, event.request_note
  into v_saved_action, v_saved_reference, v_saved_note
  from public.payment_receipt_review_events event
  where event.receipt_id = v_receipt.id
    and event.idempotency_key = v_key;
  v_saved_found := found;
  if v_saved_found then
    if v_saved_action is distinct from v_action
      or v_saved_reference is distinct from v_request_reference
      or v_saved_note is distinct from v_request_note
    then
      raise exception 'This submission id was already used for a different review. Reload the receipt and submit it again.';
    end if;
    return private.receipt_review_payload(v_receipt.id) || jsonb_build_object(
      'already_applied', true,
      'action', v_action
    );
  end if;

  if v_receipt.reversed_at is not null then
    raise exception 'This receipt has been reversed. Reload it. A reversed receipt cannot be reviewed.';
  end if;

  if v_action = 'verify'
    and v_status = 'verified'
    and v_current_reference is not distinct from v_reference
    and v_current_note is not distinct from v_note
  then
    return private.receipt_review_payload(v_receipt.id) || jsonb_build_object(
      'already_applied', true,
      'action', v_action
    );
  end if;
  if v_action = 'clarify'
    and v_status = 'needs_clarification'
    and v_current_reference is not distinct from v_reference
    and v_current_note is not distinct from v_note
  then
    return private.receipt_review_payload(v_receipt.id) || jsonb_build_object(
      'already_applied', true,
      'action', v_action
    );
  end if;

  if v_version is distinct from p_expected_version then
    raise exception 'This review was updated by someone else. Reload the receipt before saving again.';
  end if;

  if v_action = 'reopen' and v_status is distinct from 'verified' then
    raise exception 'Only a verified review can be reopened.';
  end if;
  if v_action = 'verify' and v_status = 'verified' then
    raise exception 'Reopen the review before changing a verified payment.';
  end if;
  if v_action = 'clarify' and v_status = 'verified' then
    raise exception 'Reopen the review before asking for clarification.';
  end if;

  v_from := v_status;
  if v_action = 'verify' then
    v_to := 'verified';
    v_ever := true;
    v_event_reference := v_reference;
    v_event_note := v_note;
  elsif v_action = 'clarify' then
    v_to := 'needs_clarification';
    v_event_reference := v_reference;
    v_event_note := v_note;
  else
    v_to := 'awaiting_review';
    v_reference := null;
    v_note := null;
    v_event_reference := v_current_reference;
    v_event_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  end if;
  v_new_version := v_version + 1;

  perform set_config('value_crm.receipt_review_write', 'on', true);
  if v_has_review then
    update public.payment_receipt_reviews
    set status = v_to,
        internal_reference = v_reference,
        note = v_note,
        reviewed_by = case when v_to = 'awaiting_review' then null else v_actor end,
        reviewed_at = case when v_to = 'awaiting_review' then null else v_now end,
        ever_verified = v_ever,
        version = v_new_version
    where receipt_id = v_receipt.id
      and version = v_version;
    if not found then
      raise exception 'This review was updated by someone else. Reload the receipt before saving again.';
    end if;
  else
    insert into public.payment_receipt_reviews (
      receipt_id, status, internal_reference, note, reviewed_by, reviewed_at, ever_verified, version
    ) values (
      v_receipt.id,
      v_to,
      v_reference,
      v_note,
      case when v_to = 'awaiting_review' then null else v_actor end,
      case when v_to = 'awaiting_review' then null else v_now end,
      v_ever,
      v_new_version
    );
  end if;

  insert into public.payment_receipt_review_events (
    receipt_id, action, from_status, to_status, internal_reference, note,
    actor_id, acted_at, version, idempotency_key,
    request_action, request_internal_reference, request_note
  ) values (
    v_receipt.id,
    case v_action when 'verify' then 'verified' when 'clarify' then 'needs_clarification' else 'reopened' end,
    v_from,
    v_to,
    v_event_reference,
    v_event_note,
    v_actor,
    v_now,
    v_new_version,
    v_key,
    v_action,
    v_request_reference,
    v_request_note
  );
  perform set_config('value_crm.receipt_review_write', 'off', true);

  return private.receipt_review_payload(v_receipt.id) || jsonb_build_object(
    'already_applied', false,
    'action', v_action
  );
end;
$$;

comment on function private.review_payment_receipt(uuid, text, integer, jsonb) is
  'Verify, ask for clarification, or reopen a receipt review. The receipt amount, reference, allocations, balances, and subscriptions are not changed. The reviewer and time are the signed-in user and the database clock. A stale version is rejected. A submission id identifies one normalized action, reference, and note. Repeating that request does not append another history row. Reusing the id for a different request is rejected.';

create or replace function private.received_payment_register(
  p_status text,
  p_search text,
  p_currency text,
  p_received_from date,
  p_received_to date,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_search text;
  v_currency text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  perform private.reporting_require_member();
  if v_status not in ('awaiting', 'clarification', 'verified', 'open', 'reversed') then
    raise exception 'Choose a review status.';
  end if;
  if p_received_from is not null and p_received_to is not null and p_received_from > p_received_to then
    raise exception 'The start date must be on or before the end date.';
  end if;
  v_search := private.reporting_search(p_search);
  v_currency := private.reporting_currency(p_currency);

  with visible as (
    select
      receipt.id as receipt_id,
      receipt.received_on,
      receipt.recorded_at,
      receipt.amount,
      receipt.currency,
      receipt.method,
      receipt.reference,
      receipt.recorded_by,
      coalesce(nullif(btrim(recorder.full_name), ''), 'Staff') as recorded_by_name,
      plan.pi_id,
      pi.pi_number,
      source.revision as tracked_revision,
      case
        when pi.pi_number is null or btrim(pi.pi_number) = '' then 'Draft'
        when coalesce(source.revision, 0) > 0 then pi.pi_number || '-R' || source.revision::text
        else pi.pi_number
      end as tracked_display_number,
      coalesce(
        nullif(btrim(source.snapshot #>> '{client,company_name}'), ''),
        nullif(btrim(client.company_name), ''),
        ''
      ) as client_name,
      review.internal_reference,
      review.status as review_status,
      review.reviewed_by,
      review.reviewed_at,
      coalesce(review.ever_verified, false) as ever_verified,
      coalesce(review.version, 0) as review_version,
      receipt.reversed_at is not null as reversed,
      private.receipt_review_display_status(
        receipt.reversed_at is not null,
        review.status,
        coalesce(review.ever_verified, false)
      ) as display_status
    from public.payment_receipts receipt
    join public.payment_plans plan on plan.id = receipt.plan_id
    join public.proforma_invoices pi on pi.id = plan.pi_id
    join public.pi_versions source on source.id = plan.source_version_id
    left join public.clients client on client.id = pi.client_id
    left join public.profiles recorder on recorder.id = receipt.recorded_by
    left join public.payment_receipt_reviews review on review.receipt_id = receipt.id
    where private.can_read_pi(pi.id)
  ),
  filtered as (
    select *
    from visible
    where (v_currency is null or currency = v_currency)
      and (p_received_from is null or received_on >= p_received_from)
      and (p_received_to is null or received_on <= p_received_to)
      and (
        v_search is null
        or client_name ilike private.reporting_like(v_search) escape '\'
        or coalesce(pi_number, '') ilike private.reporting_like(v_search) escape '\'
        or coalesce(reference, '') ilike private.reporting_like(v_search) escape '\'
        or coalesce(internal_reference, '') ilike private.reporting_like(v_search) escape '\'
      )
      and (
        case v_status
          when 'awaiting' then (not reversed and display_status = 'awaiting_review')
          when 'clarification' then (not reversed and display_status = 'needs_clarification')
          when 'verified' then (not reversed and display_status = 'verified')
          when 'open' then not reversed
          else reversed
        end
      )
  )
  select jsonb_build_object(
    'status', v_status,
    'count', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(page.payload order by page.received_on, page.recorded_at, page.receipt_id)
      from (
        select
          jsonb_build_object(
            'id', receipt_id,
            'received_on', received_on,
            'client_name', client_name,
            'pi_id', pi_id,
            'pi_number', pi_number,
            'tracked_revision', tracked_revision,
            'tracked_display_number', tracked_display_number,
            'amount', private.payment_plain_amount(amount),
            'currency', currency,
            'method', method,
            'reference', reference,
            'internal_reference', internal_reference,
            'recorded_by', recorded_by,
            'recorded_by_name', recorded_by_name,
            'review_status', display_status,
            'reviewed_by', case when display_status = 'verified' then reviewed_by else null end,
            'reviewed_at', case when display_status = 'verified' then reviewed_at else null end,
            'version', review_version
          ) as payload,
          received_on,
          recorded_at,
          receipt_id
        from filtered
        order by received_on, recorded_at, receipt_id
        limit v_limit
        offset v_offset
      ) page
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function private.received_payment_register(text, text, text, date, date, integer, integer) is
  'One row per receipt the caller can already read. Reversed receipts stay out of the active review filters. Currencies are not added together. The count is the full filter, not the page. Reading this does not review or change a receipt.';

create or replace function public.received_payment_register(
  p_status text default 'open',
  p_search text default null,
  p_currency text default null,
  p_received_from date default null,
  p_received_to date default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.received_payment_register(
    p_status, p_search, p_currency, p_received_from, p_received_to, p_limit, p_offset
  );
$$;

create or replace function public.received_payment_detail(p_receipt_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.received_payment_detail(p_receipt_id);
$$;

create or replace function public.review_payment_receipt(
  p_receipt_id uuid,
  p_action text,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.review_payment_receipt(p_receipt_id, p_action, p_expected_version, p_payload);
$$;

comment on function public.received_payment_register(text, text, text, date, date, integer, integer) is
  'Received-payment register for the signed-in user. Security invoker wrapper. The private function enforces an active profile and source-PI visibility.';

comment on function public.received_payment_detail(uuid) is
  'Receipt and finance-review detail for the signed-in user. Security invoker wrapper.';

comment on function public.review_payment_receipt(uuid, text, integer, jsonb) is
  'Finance review action for the signed-in user. Security invoker wrapper. It does not record or reverse a receipt.';

alter table public.payment_receipt_reviews enable row level security;
alter table public.payment_receipt_review_events enable row level security;

create policy payment_receipt_reviews_select on public.payment_receipt_reviews
for select to authenticated
using (
  exists (
    select 1
    from public.payment_receipts receipt
    join public.payment_plans plan on plan.id = receipt.plan_id
    where receipt.id = receipt_id
      and private.can_read_pi(plan.pi_id)
  )
);

create policy payment_receipt_review_events_select on public.payment_receipt_review_events
for select to authenticated
using (
  exists (
    select 1
    from public.payment_receipts receipt
    join public.payment_plans plan on plan.id = receipt.plan_id
    where receipt.id = receipt_id
      and private.can_read_pi(plan.pi_id)
  )
);

revoke all on table public.payment_receipt_reviews, public.payment_receipt_review_events
  from public, anon, authenticated;
grant select on table public.payment_receipt_reviews, public.payment_receipt_review_events to authenticated;

revoke all on function private.receipt_review_display_status(boolean, text, boolean) from public, anon, authenticated;
revoke all on function private.payment_receipt_reviews_guard() from public, anon, authenticated;
revoke all on function private.payment_receipt_review_events_guard() from public, anon, authenticated;
revoke all on function private.require_payment_reviewer() from public, anon, authenticated;
revoke all on function private.receipt_review_payload(uuid) from public, anon, authenticated;
revoke all on function private.received_payment_detail(uuid) from public, anon, authenticated;
revoke all on function private.review_payment_receipt(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function private.received_payment_register(text, text, text, date, date, integer, integer) from public, anon, authenticated;

revoke all on function public.received_payment_register(text, text, text, date, date, integer, integer) from public, anon, authenticated;
revoke all on function public.received_payment_detail(uuid) from public, anon, authenticated;
revoke all on function public.review_payment_receipt(uuid, text, integer, jsonb) from public, anon, authenticated;

grant execute on function private.received_payment_register(text, text, text, date, date, integer, integer) to authenticated;
grant execute on function private.received_payment_detail(uuid) to authenticated;
grant execute on function private.review_payment_receipt(uuid, text, integer, jsonb) to authenticated;
grant execute on function public.received_payment_register(text, text, text, date, date, integer, integer) to authenticated;
grant execute on function public.received_payment_detail(uuid) to authenticated;
grant execute on function public.review_payment_receipt(uuid, text, integer, jsonb) to authenticated;
