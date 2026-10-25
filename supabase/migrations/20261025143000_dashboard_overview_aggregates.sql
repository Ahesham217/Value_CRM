-- Dashboard overview aggregates.
-- Additive read-only fields on the existing report functions.
-- Does not add tables, rewrite snapshots, plans, receipts, allocations, or counters.
-- Apply after 20261023213000_owner_dashboard_payments.sql.
-- Do not edit or re-apply older migrations. Do not run this file on Value CRM until rollout.

create or replace function private.active_pi_report(
  p_period text,
  p_from date,
  p_to date,
  p_status text,
  p_preset text,
  p_currency text,
  p_lead uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_set text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.cairo_today();
  v_set text := lower(btrim(coalesce(p_set, 'active')));
  v_window record;
  v_status text;
  v_preset text;
  v_currency text;
  v_search text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  perform private.reporting_require_member();
  if v_set not in ('active', 'untracked') then
    raise exception 'Choose active PIs or untracked issued PIs.';
  end if;
  if v_set = 'untracked' then
    select * into v_window
    from private.reporting_window('all', null, null, v_today, true);
  else
    select * into v_window
    from private.reporting_window(p_period, p_from, p_to, v_today, true);
  end if;
  v_status := private.reporting_pi_status(p_status, false);
  v_preset := private.reporting_preset(p_preset);
  v_currency := private.reporting_currency(p_currency);
  v_search := private.reporting_search(p_search);

  with population as (
    select
      pi.id,
      pi.pi_number,
      pi.pi_date,
      pi.currency,
      pi.preset_code,
      pi.lead_salesperson_id,
      coalesce(lv.grand_total, pi.grand_total) as quoted_amount,
      case when lv.id is not null then 'issued' else 'draft' end as amount_kind,
      private.pi_display_status(pi.tracking_status, lv.id is not null) as display_status,
      (pi.draft_open and lv.id is not null) as revision_draft_open,
      lv.revision as latest_revision,
      case
        when pi.pi_number is null or btrim(pi.pi_number) = '' then 'Draft'
        when coalesce(lv.revision, 0) > 0 then pi.pi_number || '-R' || lv.revision::text
        else pi.pi_number
      end as display_number,
      coalesce(
        nullif(btrim(lv.snapshot #>> '{client,company_name}'), ''),
        nullif(btrim(c.company_name), ''),
        ''
      ) as client_name,
      coalesce(
        nullif(btrim(lead.full_name), ''),
        nullif(btrim(lv.snapshot #>> '{sales,lead_name}'), ''),
        'Unassigned'
      ) as lead_name,
      lead.is_active as lead_active,
      coalesce(preset.display_name, pi.preset_code, '') as preset_display_name,
      coalesce(preset.archived_at is not null, false) as preset_archived
    from public.proforma_invoices pi
    left join public.clients c on c.id = pi.client_id
    left join public.profiles lead on lead.id = pi.lead_salesperson_id
    left join public.company_presets preset on preset.code = pi.preset_code
    left join lateral (
      select v.id, v.revision, v.grand_total, v.snapshot
      from public.pi_versions v
      where v.pi_id = pi.id
      order by v.revision desc
      limit 1
    ) lv on true
    where private.can_read_pi(pi.id)
      and pi.tracking_status <> 'cancelled'
      and (
        (
          v_set = 'active'
          and (
            v_window.unbounded
            or (pi.pi_date is not null and pi.pi_date between v_window.range_start and v_window.range_end)
          )
        )
        or (
          v_set = 'untracked'
          and lv.id is not null
          and not exists (select 1 from public.payment_plans plan where plan.pi_id = pi.id)
        )
      )
  ),
  filtered as (
    select *
    from population
    where (v_status is null or display_status = v_status)
      and (v_preset is null or preset_code = v_preset)
      and (v_currency is null or currency = v_currency)
      and (p_lead is null or lead_salesperson_id = p_lead)
      and (
        v_search is null
        or client_name ilike private.reporting_like(v_search) escape '\'
        or coalesce(pi_number, '') ilike private.reporting_like(v_search) escape '\'
      )
  )
  select jsonb_build_object(
    'count', (select count(*) from filtered),
    'status_counts', (
      select jsonb_build_object(
        'draft', count(*) filter (where display_status = 'draft'),
        'issued', count(*) filter (where display_status = 'issued'),
        'sent', count(*) filter (where display_status = 'sent'),
        'accepted', count(*) filter (where display_status = 'accepted')
      )
      from filtered
    ),
    'set', v_set,
    'period', jsonb_build_object(
      'preset', case when v_set = 'untracked' then 'all' else lower(btrim(coalesce(p_period, ''))) end,
      'unbounded', v_window.unbounded,
      'start', v_window.range_start,
      'end', v_window.range_end,
      'today', v_today
    ),
    'totals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'currency', totals.currency,
          'issued', private.payment_plain_amount(totals.issued_amount),
          'draft', private.payment_plain_amount(totals.draft_amount)
        )
        order by case totals.currency when 'EGP' then 1 when 'USD' then 2 when 'EUR' then 3 else 4 end
      )
      from (
        select
          currency,
          coalesce(sum(quoted_amount) filter (where amount_kind = 'issued'), 0) as issued_amount,
          coalesce(sum(quoted_amount) filter (where amount_kind = 'draft'), 0) as draft_amount
        from filtered
        where currency in ('EGP', 'USD', 'EUR')
        group by currency
      ) totals
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(page.payload order by page.sort_date desc nulls last, page.sort_number desc nulls last, page.sort_id desc)
      from (
        select
          jsonb_build_object(
            'id', id,
            'pi_number', pi_number,
            'display_number', display_number,
            'client_name', client_name,
            'pi_date', pi_date,
            'preset_code', preset_code,
            'preset_display_name', preset_display_name,
            'preset_archived', preset_archived,
            'currency', currency,
            'total', private.payment_plain_amount(quoted_amount),
            'amount_kind', amount_kind,
            'lead_salesperson_id', lead_salesperson_id,
            'lead_name', lead_name,
            'lead_active', lead_active,
            'display_status', display_status,
            'revision_draft_open', revision_draft_open,
            'latest_revision', latest_revision
          ) as payload,
          pi_date as sort_date,
          pi_number as sort_number,
          id as sort_id
        from filtered
        order by pi_date desc nulls last, pi_number desc nulls last, id desc
        limit v_limit
        offset v_offset
      ) page
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', leads.lead_salesperson_id, 'name', leads.lead_name, 'active', leads.lead_active)
        order by leads.lead_name, leads.lead_salesperson_id
      )
      from (
        select distinct lead_salesperson_id, lead_name, lead_active
        from population
        where lead_salesperson_id is not null
      ) leads
    ), '[]'::jsonb),
    'presets', coalesce((
      select jsonb_agg(
        jsonb_build_object('code', presets.preset_code, 'name', presets.preset_display_name, 'archived', presets.preset_archived)
        order by presets.preset_display_name, presets.preset_code
      )
      from (
        select distinct preset_code, preset_display_name, preset_archived
        from population
        where preset_code is not null
      ) presets
    ), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(codes.currency order by codes.ord)
      from (
        select distinct currency,
          case currency when 'EGP' then 1 when 'USD' then 2 when 'EUR' then 3 else 4 end as ord
        from population
        where currency in ('EGP', 'USD', 'EUR')
      ) codes
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(states.display_status order by states.ord)
      from (
        select distinct display_status,
          case display_status
            when 'draft' then 1
            when 'issued' then 2
            when 'sent' then 3
            when 'accepted' then 4
            else 5
          end as ord
        from population
      ) states
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function private.active_pi_report(text, date, date, text, text, text, uuid, text, integer, integer, text) is
  'One row per visible non-cancelled PI. The quoted amount is the latest issued revision, or the saved draft total when nothing is issued. An open revision does not replace or add to that amount. Cancelled PIs are excluded. Untracked lists issued PIs with no payment plan and ignores the PI date. Counts, totals, status counts, and filter choices use the same visibility check and the full filtered set, not one page. Totals are quoted amounts, not revenue, and currencies are not combined.';


create or replace function private.collection_summary(
  p_receipt_period text,
  p_receipt_from date,
  p_receipt_to date,
  p_parent_status text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.cairo_today();
  v_window record;
  v_parent text;
  v_result jsonb;
begin
  perform private.reporting_require_member();
  select * into v_window
  from private.reporting_window(p_receipt_period, p_receipt_from, p_receipt_to, v_today, false);
  v_parent := private.reporting_pi_status(p_parent_status, true);

  with obligations as (
    select *
    from private.visible_tracked_obligations()
    where v_parent is null or parent_status = v_parent
  ),
  buckets as (
    select
      currency,
      coalesce(sum(outstanding_amount) filter (where outstanding_amount > 0), 0) as outstanding,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and due_timing = 'fixed' and due_date < v_today
      ), 0) as overdue,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and due_timing = 'fixed' and due_date = v_today
      ), 0) as due_today,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and due_timing = 'fixed' and due_date > v_today and due_date <= v_today + 7
      ), 0) as next_7,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and due_timing = 'fixed' and due_date > v_today and due_date <= v_today + 30
      ), 0) as next_30,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and (due_timing is distinct from 'fixed' or due_date is null)
      ), 0) as unresolved,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and due_timing = 'fixed' and due_date > v_today and due_date <= v_today + 7
      ), 0) as due_1_7,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and due_timing = 'fixed' and due_date >= v_today + 8 and due_date <= v_today + 30
      ), 0) as due_8_30,
      coalesce(sum(outstanding_amount) filter (
        where outstanding_amount > 0 and due_timing = 'fixed' and due_date > v_today + 30
      ), 0) as due_after_30,
      count(distinct plan_id)::integer as plan_count
    from obligations
    group by currency
  ),
  received as (
    select plan.currency, coalesce(sum(receipt.amount), 0) as received_amount
    from public.payment_receipts receipt
    join public.payment_plans plan on plan.id = receipt.plan_id
    join public.proforma_invoices pi on pi.id = plan.pi_id
    where receipt.reversed_at is null
      and receipt.received_on between v_window.range_start and v_window.range_end
      and private.can_read_pi(pi.id)
      and (
        v_parent is null
        or private.pi_display_status(
          pi.tracking_status,
          exists (select 1 from public.pi_versions version where version.pi_id = pi.id)
        ) = v_parent
      )
    group by plan.currency
  )
  select jsonb_build_object(
    'today', v_today,
    'parent_status', v_parent,
    'receipt_period', jsonb_build_object(
      'preset', lower(btrim(coalesce(p_receipt_period, ''))),
      'start', v_window.range_start,
      'end', v_window.range_end
    ),
    'currencies', (
      select jsonb_agg(
        jsonb_build_object(
          'currency', codes.code,
          'outstanding', private.payment_plain_amount(coalesce(buckets.outstanding, 0)),
          'overdue', private.payment_plain_amount(coalesce(buckets.overdue, 0)),
          'due_today', private.payment_plain_amount(coalesce(buckets.due_today, 0)),
          'next_7', private.payment_plain_amount(coalesce(buckets.next_7, 0)),
          'next_30', private.payment_plain_amount(coalesce(buckets.next_30, 0)),
          'unresolved', private.payment_plain_amount(coalesce(buckets.unresolved, 0)),
          'due_1_7', private.payment_plain_amount(coalesce(buckets.due_1_7, 0)),
          'due_8_30', private.payment_plain_amount(coalesce(buckets.due_8_30, 0)),
          'due_after_30', private.payment_plain_amount(coalesce(buckets.due_after_30, 0)),
          'plan_count', coalesce(buckets.plan_count, 0),
          'received', private.payment_plain_amount(coalesce(received.received_amount, 0))
        )
        order by codes.ord
      )
      from (values ('EGP', 1), ('USD', 2), ('EUR', 3)) as codes(code, ord)
      left join buckets on buckets.currency = codes.code
      left join received on received.currency = codes.code
    ),
    'untracked_count', (
      select count(*)
      from public.proforma_invoices pi
      where private.can_read_pi(pi.id)
        and pi.tracking_status <> 'cancelled'
        and exists (select 1 from public.pi_versions version where version.pi_id = pi.id)
        and not exists (select 1 from public.payment_plans plan where plan.pi_id = pi.id)
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function private.collection_summary(text, date, date, text) is
  'Tracked collection balances for visible payment plans. Outstanding, overdue, due today, and upcoming windows use the remaining balance, not the original obligation. The next 7 days are inside the next 30 days. due_1_7 matches that next-7 window. due_8_30 is the eighth day through the thirtieth day. due_after_30 is later than that. Those three ranges, overdue, due today, and unresolved dates do not overlap. Unresolved dates are not overdue. plan_count is the number of visible plans in that currency, including plans whose remaining balance is zero. Received sums each non-reversed receipt once by received_on. Cancelled parent PIs stay included unless filtered. Untracked issued PIs are counted and are not given an invented balance. This does not follow the active-PI date filter.';

