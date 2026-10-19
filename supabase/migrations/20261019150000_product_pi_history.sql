-- Product PI history.
-- New issued snapshots record line_id, product_id, and position. Existing snapshots are not rewritten.
-- History is read through private.product_pi_history, which is security definer and therefore
-- bypasses row level security. It must keep the active-member and can_read_pi checks below.
-- The latest issued revision of each PI is chosen before lines are matched to the product.

create or replace function private.history_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  if btrim(p_value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return btrim(p_value)::uuid;
end;
$$;

create or replace function private.history_numeric(p_value text)
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
    return null;
  end if;
  return btrim(p_value)::numeric;
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
        'line_id', l.id,
        'product_id', l.product_id,
        'position', l.position,
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

comment on function private.build_snapshot(uuid, integer, text) is
  'Issued document snapshot. From this version onward, each line stores line_id, product_id, and position. Older snapshots are not rewritten, and the PDF renderer ignores the extra identifiers.';

create or replace function private.product_pi_history(
  p_product_id uuid,
  p_include_older boolean,
  p_client text,
  p_currency text,
  p_status text,
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
  v_model_key text;
  v_client text;
  v_currency text;
  v_status text;
  v_limit integer;
  v_offset integer;
  v_include_older boolean;
  v_empty jsonb := jsonb_build_object(
    'total', 0,
    'rows', '[]'::jsonb,
    'clients', '[]'::jsonb,
    'currencies', '[]'::jsonb,
    'statuses', '[]'::jsonb
  );
  v_result jsonb;
begin
  if not private.is_active_member() or p_product_id is null then
    return v_empty;
  end if;

  select lower(btrim(model_code)) into v_model_key
  from public.products
  where id = p_product_id;
  if not found or v_model_key is null or v_model_key = '' then
    return v_empty;
  end if;

  v_include_older := coalesce(p_include_older, false);
  v_client := nullif(btrim(coalesce(p_client, '')), '');
  v_currency := nullif(upper(btrim(coalesce(p_currency, ''))), '');
  v_status := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with latest as (
    select v.pi_id, max(v.revision) as revision
    from public.pi_versions v
    where private.can_read_pi(v.pi_id)
    group by v.pi_id
  ),
  issued_lines as (
    select
      v.pi_id,
      v.id as version_id,
      v.revision,
      v.pi_number,
      case when v.revision = latest.revision then 'latest_issued' else 'older_revision' end as source,
      case when v.revision = latest.revision then 0 else 2 end as source_rank,
      coalesce(private.history_uuid(line.value ->> 'line_id')::text, 'line') || ':' || line.ordinality::text as line_key,
      case
        when coalesce(line.value ->> 'position', '') ~ '^[1-9][0-9]*$' then (line.value ->> 'position')::integer
        else line.ordinality::integer
      end as line_position,
      coalesce(line.value ->> 'model_code', '') as model_code,
      coalesce(line.value ->> 'description', '') as description,
      coalesce(line.value ->> 'unit', '') as unit,
      nullif(btrim(line.value ->> 'quantity'), '') as quantity,
      nullif(btrim(line.value ->> 'unit_price'), '') as unit_price,
      upper(btrim(coalesce(v.snapshot ->> 'currency', ''))) as currency,
      nullif(btrim(coalesce(v.snapshot #>> '{client,company_name}', '')), '') as client_name,
      case
        when coalesce(v.snapshot ->> 'pi_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then (v.snapshot ->> 'pi_date')::date
        else null
      end as pi_date,
      case
        when pi.tracking_status = 'cancelled' then 'cancelled'
        when pi.tracking_status = 'accepted' then 'accepted'
        when pi.tracking_status = 'sent' then 'sent'
        else 'issued'
      end as pi_status,
      case
        when nullif(btrim(coalesce(line.value ->> 'product_id', '')), '') is not null then 'product_id'
        else 'legacy_model'
      end as match_kind,
      coalesce(nullif(v.snapshot #>> '{adjustments,discount_type}', ''), 'none') as discount_type,
      nullif(v.snapshot #>> '{adjustments,discount_value}', '') as discount_value,
      nullif(v.snapshot #>> '{adjustments,discount_amount}', '') as discount_amount,
      coalesce(
        nullif(v.snapshot ->> 'display_number', ''),
        case when v.revision = 0 then v.pi_number else v.pi_number || '-R' || v.revision::text end
      ) as display_number,
      coalesce(
        nullif(v.snapshot ->> 'revision_label', ''),
        case when v.revision > 0 then 'R' || v.revision::text else null end
      ) as revision_label
    from public.pi_versions v
    join latest on latest.pi_id = v.pi_id
    join public.proforma_invoices pi on pi.id = v.pi_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(v.snapshot -> 'lines') = 'array' then v.snapshot -> 'lines'
        else '[]'::jsonb
      end
    ) with ordinality as line(value, ordinality)
    where private.can_read_pi(v.pi_id)
      and (v_include_older or v.revision = latest.revision)
      and (
        case
          when nullif(btrim(coalesce(line.value ->> 'product_id', '')), '') is not null
            then private.history_uuid(line.value ->> 'product_id') = p_product_id
          else lower(btrim(coalesce(line.value ->> 'model_code', ''))) = v_model_key
            and v_model_key <> ''
        end
      )
  ),
  draft_lines as (
    select
      pi.id as pi_id,
      null::uuid as version_id,
      null::integer as revision,
      pi.pi_number,
      case
        when exists (select 1 from public.pi_versions issued where issued.pi_id = pi.id)
          then 'revision_draft'
        else 'initial_draft'
      end as source,
      case
        when exists (select 1 from public.pi_versions issued where issued.pi_id = pi.id)
          then 1
        else 3
      end as source_rank,
      l.id::text as line_key,
      l.position as line_position,
      l.model_code,
      l.description,
      l.unit,
      l.quantity::text as quantity,
      l.unit_price::text as unit_price,
      upper(btrim(coalesce(pi.currency, ''))) as currency,
      nullif(btrim(coalesce(c.company_name, '')), '') as client_name,
      pi.pi_date,
      'draft'::text as pi_status,
      case when l.product_id is not null then 'product_id' else 'legacy_model' end as match_kind,
      coalesce(pi.discount_type, 'none') as discount_type,
      pi.discount_value::text as discount_value,
      pi.discount_amount::text as discount_amount,
      null::text as display_number,
      null::text as revision_label
    from public.pi_lines l
    join public.proforma_invoices pi on pi.id = l.pi_id
    left join public.clients c on c.id = pi.client_id
    where pi.draft_open
      and private.can_read_pi(pi.id)
      and (
        case
          when l.product_id is not null then l.product_id = p_product_id
          else lower(btrim(l.model_code)) = v_model_key and v_model_key <> ''
        end
      )
  ),
  matched as (
    select * from issued_lines
    union all
    select * from draft_lines
  ),
  filtered as (
    select *
    from matched
    where private.can_read_pi(pi_id)
      and (v_client is null or client_name = v_client)
      and (v_currency is null or currency = v_currency)
      and (v_status is null or pi_status = v_status)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(
        s.payload
        order by s.sort_date desc nulls last, s.sort_number desc nulls last, s.sort_pi, s.sort_rank, s.sort_revision desc nulls last, s.sort_position, s.sort_line
      )
      from (
        select
          jsonb_build_object(
            'row_id', source || ':' || coalesce(version_id::text, 'draft') || ':' || line_key,
            'pi_id', pi_id,
            'source', source,
            'pi_number', pi_number,
            'revision', revision,
            'revision_label', revision_label,
            'display_number', display_number,
            'client_name', client_name,
            'pi_date', to_char(pi_date, 'YYYY-MM-DD'),
            'quantity', quantity,
            'unit', unit,
            'unit_price', unit_price,
            'currency', nullif(currency, ''),
            'pi_status', pi_status,
            'model_code', model_code,
            'description', description,
            'position', line_position,
            'match_kind', match_kind,
            'discount_on_pi', discount_type in ('percent', 'fixed') and coalesce(private.history_numeric(discount_value), 0) > 0,
            'discount_type', discount_type,
            'discount_value', discount_value,
            'discount_amount', discount_amount
          ) as payload,
          pi_date as sort_date,
          pi_number as sort_number,
          pi_id as sort_pi,
          source_rank as sort_rank,
          revision as sort_revision,
          line_position as sort_position,
          line_key as sort_line
        from filtered
        order by pi_date desc nulls last, pi_number desc nulls last, pi_id, source_rank, revision desc nulls last, line_position, line_key
        limit v_limit
        offset v_offset
      ) s
    ), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(c.client_name order by c.client_name)
      from (select distinct client_name from matched where client_name is not null) c
    ), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(c.currency order by c.currency_order, c.currency)
      from (
        select distinct currency,
          case currency when 'EGP' then 1 when 'USD' then 2 when 'EUR' then 3 else 4 end as currency_order
        from matched
        where currency <> ''
      ) c
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(s.pi_status order by s.status_order, s.pi_status)
      from (
        select distinct pi_status,
          case pi_status
            when 'draft' then 1
            when 'issued' then 2
            when 'sent' then 3
            when 'accepted' then 4
            when 'cancelled' then 5
            else 6
          end as status_order
        from matched
      ) s
    ), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, v_empty);
end;
$$;

comment on function private.product_pi_history(uuid, boolean, text, text, text, integer, integer) is
  'Authorized PI history for one catalogue product. Security definer, so it explicitly requires an active member and private.can_read_pi for every row, count, and filter option. It does not read purchase prices. The latest issued revision is selected before matching lines.';

create or replace function public.product_pi_history(
  p_product_id uuid,
  p_include_older boolean default false,
  p_client text default null,
  p_currency text default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.product_pi_history(
    p_product_id,
    p_include_older,
    p_client,
    p_currency,
    p_status,
    p_limit,
    p_offset
  );
$$;

comment on function public.product_pi_history(uuid, boolean, text, text, text, integer, integer) is
  'Product PI history for the signed-in user. Security invoker wrapper around the private function that enforces PI visibility.';

revoke all on function private.history_uuid(text) from public, anon, authenticated;
revoke all on function private.history_numeric(text) from public, anon, authenticated;
revoke all on function private.product_pi_history(uuid, boolean, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.product_pi_history(uuid, boolean, text, text, text, integer, integer) from public, anon, authenticated;

grant execute on function private.product_pi_history(uuid, boolean, text, text, text, integer, integer) to authenticated;
grant execute on function public.product_pi_history(uuid, boolean, text, text, text, integer, integer) to authenticated;
