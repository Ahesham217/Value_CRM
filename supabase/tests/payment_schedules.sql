-- Rolled-back checks for structured PI payment schedules.
-- Run with a privileged session after 20261021180000_payment_schedules.sql.
-- The block always raises, including on success, so none of its rows are committed.

do $test$
declare
  v_fail text := '';
  v_result jsonb;
  v_text text;
  v_instance uuid;
  v_editor uuid := gen_random_uuid();
  v_issuer uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_client uuid;
  v_vendor uuid;
  v_product uuid;
  v_pi uuid;
  v_duplicate uuid;
  v_version uuid;
  v_snapshot jsonb;
  v_original jsonb;
  v_expected integer;
  v_count integer;
  v_model text := 'zz-pay-' || left(gen_random_uuid()::text, 8);
  v_payload jsonb;
  v_schedule jsonb;
  v_before jsonb;
  v_legacy uuid;
begin
  if private.add_calendar_months(date '2026-01-31', 1) <> date '2026-02-28'
    or private.add_calendar_months(date '2024-01-31', 1) <> date '2024-02-29'
    or private.add_calendar_months(date '2026-01-31', 2) <> date '2026-03-31'
    or private.add_calendar_months(date '2026-01-31', 3) <> date '2026-04-30'
    or private.add_calendar_months(date '2024-02-29', 12) <> date '2025-02-28'
    or private.add_calendar_months(date '2024-02-29', 48) <> date '2028-02-29'
  then
    v_fail := v_fail || 'calendar months drifted; ';
  end if;

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000001', 'label', 'advance payment',
      'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
      'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
      'instalments', null
    ))
  );
  v_result := private.canonical_payment(v_schedule, 'USD', 100000);
  if v_result ->> 'customer_text' <> '100% advance payment upon order confirmation.'
    or v_result #>> '{rows,0,amount}' <> '100000.00'
  then
    v_fail := v_fail || '100 percent ' || coalesce(v_result ->> 'customer_text', '') || '; ';
  end if;
  if private.canonical_payment(v_schedule, 'EGP', 100000) ->> 'customer_text' <> '100% advance payment upon order confirmation.'
    or private.canonical_payment(v_schedule, 'EUR', 100000) #>> '{rows,0,amount}' <> '100000.00'
  then
    v_fail := v_fail || 'currency conversion leaked; ';
  end if;

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'label', 'advance payment', 'amount', jsonb_build_object('type', 'percent', 'percent', '30'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000002', 'label', 'before shipment', 'amount', jsonb_build_object('type', 'percent', 'percent', '15'), 'due', jsonb_build_object('type', 'before_shipment', 'deadline', null), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000003', 'label', 'Remaining balance', 'amount', jsonb_build_object('type', 'remainder'), 'due', jsonb_build_object('type', 'unset'), 'instalments', jsonb_build_object('count', 10, 'frequency', 'monthly', 'first', jsonb_build_object('type', 'after_event', 'event', jsonb_build_object('type', 'standard', 'code', 'delivery'), 'offset', 1, 'unit', 'months')))
    )
  );
  v_result := private.canonical_payment(v_schedule, 'USD', 100000);
  v_text := '30% advance payment upon order confirmation, 15% before shipment, and the remaining 55% payable in 10 monthly instalments, with the first instalment due one calendar month after delivery.';
  if v_result ->> 'customer_text' is distinct from v_text
    or v_result #>> '{rows,0,amount}' <> '30000.00'
    or v_result #>> '{rows,1,amount}' <> '15000.00'
    or v_result #>> '{rows,2,amount}' <> '55000.00'
    or v_result #>> '{rows,2,instalments,0,amount}' <> '5500.00'
    or v_result #>> '{rows,2,instalments,0,due_date}' is not null
    or v_result #>> '{rows,2,instalments,1,due_formula}' <> 'two calendar months after delivery'
    or v_result ->> 'customer_text' like '%00000000%'
    or v_result ->> 'customer_text' like '%Awaiting%'
  then
    v_fail := v_fail || '30/15/10 ' || coalesce(v_result ->> 'customer_text', '') || '; ';
  end if;

  v_schedule := jsonb_set(v_schedule, '{rows,0,resolved_amount}', '"1.00"');
  v_result := private.canonical_payment(private.sanitize_payment_schedule(v_schedule), 'USD', 100000);
  if v_result #>> '{rows,0,amount}' <> '30000.00' or v_result::text like '%resolved_amount%' then
    v_fail := v_fail || 'tampered amount was kept; ';
  end if;

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000011', 'label', 'advance payment', 'amount', jsonb_build_object('type', 'fixed', 'amount', '10000.00'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000012', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '20'), 'due', jsonb_build_object('type', 'before_shipment', 'deadline', null), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000013', 'label', '', 'amount', jsonb_build_object('type', 'remainder'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'delivery')), 'instalments', null)
    )
  );
  v_result := private.canonical_payment(v_schedule, 'USD', 100000);
  if v_result ->> 'customer_text' <> 'USD 10,000.00 advance payment upon order confirmation, 20% before shipment, and the remaining 70% upon delivery.'
    or (private.canonical_payment(v_schedule, 'USD', 80000) #>> '{rows,0,amount}') <> '10000.00'
    or (private.canonical_payment(v_schedule, 'USD', 80000) #>> '{rows,1,amount}') <> '16000.00'
    or (private.canonical_payment(v_schedule, 'USD', 80000) #>> '{rows,2,amount}') <> '54000.00'
  then
    v_fail := v_fail || 'mixed or changed total; ';
  end if;

  begin
    perform private.canonical_payment(jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(
        jsonb_build_object('id', '00000000-0000-4000-8000-000000000021', 'label', 'Advance', 'amount', jsonb_build_object('type', 'percent', 'percent', null), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-01'), 'instalments', null)
      )
    ), 'USD', 100);
    v_fail := v_fail || 'blank percent issued; ';
  exception when others then
    if sqlerrm not like '%enter the percentage%' then
      v_fail := v_fail || 'blank message ' || sqlerrm || '; ';
    end if;
  end;

  begin
    perform private.canonical_payment(jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(
        jsonb_build_object('id', '00000000-0000-4000-8000-000000000022', 'label', 'Advance', 'amount', jsonb_build_object('type', 'fixed', 'amount', '0.00'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-01'), 'instalments', null)
      )
    ), 'USD', 100);
    v_fail := v_fail || 'explicit zero issued; ';
  exception when others then
    if sqlerrm not like '%greater than zero%' then
      v_fail := v_fail || 'zero message ' || sqlerrm || '; ';
    end if;
  end;

  begin
    perform private.sanitize_payment_schedule(jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(
        jsonb_build_object('id', '00000000-0000-4000-8000-000000000031', 'label', '', 'amount', jsonb_build_object('type', 'remainder'), 'due', jsonb_build_object('type', 'unset'), 'instalments', null),
        jsonb_build_object('id', '00000000-0000-4000-8000-000000000032', 'label', '', 'amount', jsonb_build_object('type', 'remainder'), 'due', jsonb_build_object('type', 'unset'), 'instalments', null)
      )
    ));
    v_fail := v_fail || 'two remainders saved; ';
  exception when others then
    if sqlerrm not like '%Only one payment%' then
      v_fail := v_fail || 'remainder message ' || sqlerrm || '; ';
    end if;
  end;

  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000041', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '50'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000042', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '50'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'delivery')), 'instalments', null)
    )
  ), 'USD', 99.99);
  if v_result #>> '{rows,0,amount}' <> '50.00' or v_result #>> '{rows,1,amount}' <> '49.99'
    or v_result ->> 'customer_text' <> '50% upon order confirmation, and 50% (USD 49.99) upon delivery.'
  then
    v_fail := v_fail || 'rounding ' || coalesce(v_result ->> 'customer_text', '') || '; ';
  end if;

  begin
    perform private.canonical_payment(jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(
        jsonb_build_object('id', '00000000-0000-4000-8000-000000000101', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '60'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-01'), 'instalments', null),
        jsonb_build_object('id', '00000000-0000-4000-8000-000000000102', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '50'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-02'), 'instalments', null)
      )
    ), 'USD', 0.02);
    v_fail := v_fail || '60 plus 50 of 0.02 issued; ';
  exception when others then
    if sqlerrm not like '%exactly 100%' then
      v_fail := v_fail || 'percent total ' || sqlerrm || '; ';
    end if;
  end;

  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000103', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '50'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-01'), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000104', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '50'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-02'), 'instalments', null)
    )
  ), 'USD', 0.03);
  if v_result #>> '{rows,0,amount}' <> '0.02' or v_result #>> '{rows,1,amount}' <> '0.01' then
    v_fail := v_fail || 'small 100 percent rounding ' || coalesce(v_result #>> '{rows,0,amount}', '') || '/' || coalesce(v_result #>> '{rows,1,amount}', '') || '; ';
  end if;

  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000105', 'label', '', 'amount', jsonb_build_object('type', 'fixed', 'amount', '0.01'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-01'), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000106', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '50'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-02'), 'instalments', null)
    )
  ), 'USD', 0.02);
  if v_result #>> '{rows,0,amount}' <> '0.01' or v_result #>> '{rows,1,amount}' <> '0.01' then
    v_fail := v_fail || 'mixed fixed percent ' || coalesce(v_result::text, '') || '; ';
  end if;

  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000107', 'label', '', 'amount', jsonb_build_object('type', 'percent', 'percent', '60'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-01'), 'instalments', null),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000108', 'label', '', 'amount', jsonb_build_object('type', 'remainder'), 'due', jsonb_build_object('type', 'date', 'date', '2026-12-02'), 'instalments', null)
    )
  ), 'USD', 0.02);
  if v_result #>> '{rows,0,amount}' <> '0.01' or v_result #>> '{rows,1,amount}' <> '0.01' then
    v_fail := v_fail || 'mixed remainder ' || coalesce(v_result::text, '') || '; ';
  end if;

  begin
    perform private.sanitize_payment_event(jsonb_build_object('type', 'standard', 'code', null), 'Advance');
    v_fail := v_fail || 'null standard code saved; ';
  exception when others then
    if sqlerrm not like '%supported milestone%' then
      v_fail := v_fail || 'null code ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform private.sanitize_payment_event(jsonb_build_object('type', 'standard'), 'Advance');
    v_fail := v_fail || 'missing standard code saved; ';
  exception when others then
    if sqlerrm not like '%supported milestone%' then
      v_fail := v_fail || 'missing code ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform private.sanitize_payment_event(jsonb_build_object('type', 'standard', 'code', 'inspection'), 'Advance');
    v_fail := v_fail || 'unsupported standard code saved; ';
  exception when others then
    if sqlerrm not like '%supported milestone%' then
      v_fail := v_fail || 'unsupported code ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform private.canonical_payment(jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-4000-8000-000000000111', 'label', 'advance payment',
        'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
        'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', null)),
        'instalments', null
      ))
    ), 'USD', 100);
    v_fail := v_fail || 'null milestone issued; ';
  exception when others then
    if sqlerrm not like '%supported milestone%' then
      v_fail := v_fail || 'null milestone ' || sqlerrm || '; ';
    end if;
  end;
  begin
    perform private.canonical_payment(jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-4000-8000-000000000112', 'label', 'Balance',
        'amount', jsonb_build_object('type', 'fixed', 'amount', '100.00'),
        'due', jsonb_build_object('type', 'unset'),
        'instalments', jsonb_build_object(
          'count', 2, 'frequency', 'monthly',
          'first', jsonb_build_object('type', 'after_event', 'event', jsonb_build_object('type', 'standard'), 'offset', 1, 'unit', 'months')
        )
      ))
    ), 'USD', 100);
    v_fail := v_fail || 'instalment milestone issued; ';
  exception when others then
    if sqlerrm not like '%supported milestone%' then
      v_fail := v_fail || 'instalment milestone ' || sqlerrm || '; ';
    end if;
  end;

  foreach v_text in array ARRAY['0', '2.5', '-3', '1000000000'] loop
    begin
      perform private.canonical_payment(jsonb_build_object(
        'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
        'rows', jsonb_build_array(jsonb_build_object(
          'id', '00000000-0000-4000-8000-000000000121', 'label', 'Balance',
          'amount', jsonb_build_object('type', 'fixed', 'amount', '100.00'),
          'due', jsonb_build_object('type', 'unset'),
          'instalments', jsonb_build_object('count', v_text::numeric, 'frequency', 'monthly', 'first', jsonb_build_object('type', 'date', 'date', '2026-12-01'))
        ))
      ), 'USD', 100);
      v_fail := v_fail || 'instalment count ' || v_text || ' issued; ';
    exception when others then
      if sqlerrm not like '%whole number from 2 to 120%' or sqlerrm like '%division by zero%' then
        v_fail := v_fail || 'instalment count ' || v_text || ' ' || sqlerrm || '; ';
      end if;
    end;
  end loop;
  begin
    perform private.canonical_payment(jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-4000-8000-000000000122', 'label', 'Balance',
        'amount', jsonb_build_object('type', 'fixed', 'amount', '100.00'),
        'due', jsonb_build_object('type', 'unset'),
        'instalments', jsonb_build_object('count', null, 'frequency', 'monthly', 'first', jsonb_build_object('type', 'date', 'date', '2026-12-01'))
      ))
    ), 'USD', 100);
    v_fail := v_fail || 'blank instalment count issued; ';
  exception when others then
    if sqlerrm not like '%enter the number of instalments%' then
      v_fail := v_fail || 'blank instalments ' || sqlerrm || '; ';
    end if;
  end;
  v_result := private.payment_expand_instalments(
    '00000000-0000-4000-8000-000000000123', 100,
    jsonb_build_object('count', 0, 'frequency', 'monthly', 'first', jsonb_build_object('type', 'date', 'date', '2026-12-01')),
    'USD'
  );
  if coalesce(v_result ->> 'error', '') not like '%whole number from 2 to 120%' then
    v_fail := v_fail || 'expand zero ' || coalesce(v_result::text, 'null') || '; ';
  end if;
  v_result := private.payment_expand_instalments(
    '00000000-0000-4000-8000-000000000123', 100,
    jsonb_build_object('count', 1000000000, 'frequency', 'monthly', 'first', jsonb_build_object('type', 'date', 'date', '2026-12-01')),
    'USD'
  );
  if coalesce(v_result ->> 'error', '') not like '%whole number from 2 to 120%' then
    v_fail := v_fail || 'expand excessive ' || coalesce(v_result::text, 'null') || '; ';
  end if;

  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000051', 'label', '',
      'amount', jsonb_build_object('type', 'fixed', 'amount', '100.00'),
      'due', jsonb_build_object('type', 'unset'),
      'instalments', jsonb_build_object('count', 4, 'frequency', 'monthly', 'first', jsonb_build_object('type', 'date', 'date', '2026-01-31'))
    ))
  ), 'EGP', 100);
  if v_result #>> '{rows,0,instalments,0,due_date}' <> '2026-01-31'
    or v_result #>> '{rows,0,instalments,1,due_date}' <> '2026-02-28'
    or v_result #>> '{rows,0,instalments,2,due_date}' <> '2026-03-31'
    or v_result #>> '{rows,0,instalments,3,due_date}' <> '2026-04-30'
  then
    v_fail := v_fail || 'month-end instalments; ';
  end if;

  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000061', 'label', '',
      'amount', jsonb_build_object('type', 'fixed', 'amount', '100.00'),
      'due', jsonb_build_object('type', 'unset'),
      'instalments', jsonb_build_object('count', 3, 'frequency', 'monthly', 'first', jsonb_build_object('type', 'date', 'date', '2026-12-01'))
    ))
  ), 'USD', 100);
  if v_result ->> 'customer_text' <> 'USD 100.00 payable in 3 monthly instalments of USD 33.33, with a final instalment of USD 33.34, the first instalment due on 1 December 2026.'
    or v_result #>> '{rows,0,instalments,2,amount}' <> '33.34'
  then
    v_fail := v_fail || 'final instalment ' || coalesce(v_result ->> 'customer_text', '') || '; ';
  end if;

  v_result := private.canonical_payment(jsonb_build_object(
    'schema_version', 1, 'no_payment_due', true, 'dates_need_review', false, 'rows', '[]'::jsonb
  ), 'EUR', 0);
  if v_result ->> 'customer_text' <> 'No payment due.' or jsonb_array_length(v_result -> 'rows') <> 0 then
    v_fail := v_fail || 'zero total; ';
  end if;

  if pg_get_functiondef('private.canonical_payment(jsonb,text,numeric)'::regprocedure) ilike '%product_costs%'
    or pg_get_functiondef('private.sanitize_payment_schedule(jsonb)'::regprocedure) ilike '%product_costs%'
  then
    v_fail := v_fail || 'payment functions read purchase prices; ';
  end if;

  select instance_id into v_instance from auth.users limit 1;
  if v_instance is null then
    v_instance := '00000000-0000-0000-0000-000000000000';
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values
    (v_instance, v_editor, 'authenticated', 'authenticated', 'pay-editor-' || v_editor::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_editor::text, 'r-' || v_editor::text, 'n-' || v_editor::text, ''),
    (v_instance, v_issuer, 'authenticated', 'authenticated', 'pay-issuer-' || v_issuer::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_issuer::text, 'r-' || v_issuer::text, 'n-' || v_issuer::text, ''),
    (v_instance, v_reader, 'authenticated', 'authenticated', 'pay-reader-' || v_reader::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_reader::text, 'r-' || v_reader::text, 'n-' || v_reader::text, ''),
    (v_instance, v_stranger, 'authenticated', 'authenticated', 'pay-stranger-' || v_stranger::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_stranger::text, 'r-' || v_stranger::text, 'n-' || v_stranger::text, ''),
    (v_instance, v_inactive, 'authenticated', 'authenticated', 'pay-inactive-' || v_inactive::text || '@example.invalid', 'not-a-password', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), 'c-' || v_inactive::text, 'r-' || v_inactive::text, 'n-' || v_inactive::text, '');
  update public.profiles set is_active = true, is_salesperson = true, pi_visibility = 'associated', can_edit_drafts = true, can_generate_pis = false where id = v_editor;
  update public.profiles set is_active = true, is_salesperson = true, pi_visibility = 'associated', can_edit_drafts = true, can_generate_pis = true where id = v_issuer;
  update public.profiles set is_active = true, is_salesperson = false, pi_visibility = 'all', can_edit_drafts = false, can_generate_pis = false where id = v_reader;
  update public.profiles set is_active = true, is_salesperson = false, pi_visibility = 'associated', can_edit_drafts = false, can_generate_pis = false where id = v_stranger;
  update public.profiles set is_active = false, is_salesperson = true, pi_visibility = 'all', can_edit_drafts = true, can_generate_pis = true where id = v_inactive;

  perform set_config('request.jwt.claims', json_build_object('sub', v_issuer::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_issuer::text, true);
  insert into public.clients (company_name, country, billing_address) values ('Pay Client', 'Egypt', 'Pay billing') returning id into v_client;
  insert into public.vendors (company_name, country) values ('Pay Vendor', 'Egypt') returning id into v_vendor;
  insert into public.products (vendor_id, model_code, description, unit, sell_price_egp) values (v_vendor, v_model, 'Pay item', 'unit', 10) returning id into v_product;

  v_pi := public.create_pi_draft();
  select payment_schedule, payment_terms into v_result, v_text from public.proforma_invoices where id = v_pi;
  if v_result ->> 'schema_version' <> '1' or jsonb_array_length(v_result -> 'rows') <> 0 or v_text <> '' then
    v_fail := v_fail || 'new draft did not start structured and empty; ';
  end if;

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000071', 'label', 'Advance',
      'amount', jsonb_build_object('type', 'percent', 'percent', null),
      'due', jsonb_build_object('type', 'unset'), 'instalments', null
    ))
  );
  v_payload := jsonb_build_object(
    'preset_code', 'EG-EGP', 'pi_date', '2026-10-21', 'expiry_date', '2026-11-21',
    'client_id', v_client, 'client_contact_id', null, 'bill_to', 'Pay billing', 'ship_to', 'Pay billing',
    'ship_same_as_billing', true, 'customer_reference', 'PAY', 'lead_salesperson_id', v_issuer,
    'salesperson_ids', jsonb_build_array(v_issuer), 'discount_type', 'none', 'discount_value', null,
    'shipping_amount', null, 'installation_amount', null, 'bank_charge_amount', null,
    'tax_enabled', false, 'tax_percent', null, 'tax_excludes_shipping', false, 'tax_excludes_installation', false,
    'tax_excludes_bank_charge', false, 'price_basis', 'Site Delivery', 'payment_terms', 'SHOULD NOT WIN',
    'payment_schedule', v_schedule, 'delivery_terms', 'Stock', 'warranty', '', 'additional_notes', '',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Pay pump', 'unit', 'unit', 'quantity', '1', 'unit_price', '100000.00'
    ))
  );
  perform public.save_pi_draft(v_pi, 1, v_payload);
  select payment_schedule, payment_terms, draft_version into v_result, v_text, v_expected from public.proforma_invoices where id = v_pi;
  if v_result #>> '{rows,0,amount,percent}' is not null or v_text <> '' or v_expected <> 2 then
    v_fail := v_fail || 'incomplete draft was not preserved; ';
  end if;
  v_before := v_result;

  begin
    perform public.save_pi_draft(v_pi, 1, v_payload || jsonb_build_object('payment_schedule', jsonb_build_object(
      'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
      'rows', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-4000-8000-000000000072', 'label', 'Replaced',
        'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
        'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')),
        'instalments', null
      ))
    )));
    v_fail := v_fail || 'stale save succeeded; ';
  exception when others then
    if sqlerrm not like '%someone else%' then
      v_fail := v_fail || 'stale ' || sqlerrm || '; ';
    end if;
  end;
  if (select payment_schedule from public.proforma_invoices where id = v_pi) is distinct from v_before then
    v_fail := v_fail || 'stale save changed the schedule; ';
  end if;

  begin
    perform public.save_pi_draft(v_pi, v_expected, v_payload || jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object('product_id', null, 'model_code', 'missing', 'description', 'x', 'unit', 'unit', 'quantity', '1', 'unit_price', '1')),
      'payment_schedule', jsonb_build_object(
        'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
        'rows', jsonb_build_array(jsonb_build_object(
          'id', '00000000-0000-4000-8000-000000000073', 'label', 'Partial',
          'amount', jsonb_build_object('type', 'percent', 'percent', '100'),
          'due', jsonb_build_object('type', 'date', 'date', '2026-12-01'), 'instalments', null
        ))
      )
    ));
    v_fail := v_fail || 'invalid line save succeeded; ';
  exception when others then
    null;
  end;
  if (select payment_schedule from public.proforma_invoices where id = v_pi) is distinct from v_before
    or (select draft_version from public.proforma_invoices where id = v_pi) <> v_expected
  then
    v_fail := v_fail || 'failed save partially updated the schedule; ';
  end if;

  begin
    perform public.save_pi_draft(v_pi, v_expected, v_payload || jsonb_build_object('payment_schedule', 'null'::jsonb, 'payment_terms', '100% in advance'));
    v_fail := v_fail || 'structured draft accepted a legacy downgrade; ';
  exception when others then
    if sqlerrm not like '%cannot be replaced%' then
      v_fail := v_fail || 'downgrade save ' || sqlerrm || '; ';
    end if;
  end;
  if (select payment_schedule from public.proforma_invoices where id = v_pi) is distinct from v_before
    or (select draft_version from public.proforma_invoices where id = v_pi) <> v_expected
  then
    v_fail := v_fail || 'downgrade save changed the schedule; ';
  end if;

  begin
    perform public.generate_pi(v_pi, v_expected, v_payload || jsonb_build_object('payment_schedule', 'null'::jsonb, 'payment_terms', '100% in advance'));
    v_fail := v_fail || 'generate downgraded a structured draft; ';
  exception when others then
    if sqlerrm not like '%cannot be replaced%' then
      v_fail := v_fail || 'downgrade generate ' || sqlerrm || '; ';
    end if;
  end;
  if (select draft_open from public.proforma_invoices where id = v_pi) is distinct from true
    or (select count(*) from public.pi_versions where pi_id = v_pi) <> 0
    or (select payment_schedule from public.proforma_invoices where id = v_pi) is distinct from v_before
  then
    v_fail := v_fail || 'downgrade generate issued or cleared the schedule; ';
  end if;

  begin
    perform public.save_pi_draft(v_pi, v_expected, v_payload - 'payment_schedule');
    v_fail := v_fail || 'old session saved over a structured draft; ';
  exception when others then
    if sqlerrm not like '%open the PI again%' then
      v_fail := v_fail || 'old session ' || sqlerrm || '; ';
    end if;
  end;
  if (select payment_schedule from public.proforma_invoices where id = v_pi) is distinct from v_before then
    v_fail := v_fail || 'old session changed the schedule; ';
  end if;

  v_legacy := public.create_pi_draft();
  update public.proforma_invoices
  set payment_schedule = null, payment_terms = '100% in advance'
  where id = v_legacy;
  perform public.save_pi_draft(
    v_legacy,
    1,
    (v_payload - 'payment_schedule') || jsonb_build_object('payment_terms', 'Net 30 days')
  );
  if (select payment_schedule from public.proforma_invoices where id = v_legacy) is not null
    or (select payment_terms from public.proforma_invoices where id = v_legacy) <> 'Net 30 days'
  then
    v_fail := v_fail || 'legacy omit did not keep the paragraph; ';
  end if;
  v_result := public.generate_pi(
    v_legacy,
    2,
    v_payload || jsonb_build_object('payment_schedule', 'null'::jsonb, 'payment_terms', 'Net 30 days')
  );
  if v_result #>> '{snapshot,layout_version}' <> 'egypt-v1'
    or v_result -> 'snapshot' ? 'payment'
    or v_result #>> '{snapshot,terms,payment_terms}' <> 'Net 30 days'
  then
    v_fail := v_fail || 'legacy issue ' || coalesce(v_result #>> '{snapshot,layout_version}', '') || '; ';
  end if;

  v_schedule := jsonb_build_object(
    'schema_version', 1, 'no_payment_due', false, 'dates_need_review', false,
    'rows', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000081', 'label', 'advance payment', 'amount', jsonb_build_object('type', 'percent', 'percent', '30'), 'due', jsonb_build_object('type', 'on_event', 'event', jsonb_build_object('type', 'standard', 'code', 'order_confirmation')), 'instalments', null, 'resolved_amount', '1.00'),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000082', 'label', 'before shipment', 'amount', jsonb_build_object('type', 'percent', 'percent', '70'), 'due', jsonb_build_object('type', 'before_shipment', 'deadline', '2026-12-15'), 'instalments', null)
    )
  );
  v_payload := v_payload || jsonb_build_object('payment_terms', 'browser wording', 'payment_schedule', v_schedule);
  v_result := public.generate_pi(v_pi, v_expected, v_payload);
  v_snapshot := v_result -> 'snapshot';
  v_original := v_snapshot;
  if v_snapshot ->> 'layout_version' <> 'egypt-v2'
    or v_snapshot #>> '{payment,rows,0,amount}' <> '30000.00'
    or v_snapshot #>> '{payment,rows,1,amount}' <> '70000.00'
    or v_snapshot #>> '{payment,customer_text}' not like '30% advance payment upon order confirmation%'
    or v_snapshot #>> '{terms,payment_terms}' is distinct from (v_snapshot #>> '{payment,customer_text}')
    or v_snapshot::text like '%resolved_amount%'
    or v_snapshot::text like '%browser wording%'
    or v_snapshot::text like '%purchase_price%'
  then
    v_fail := v_fail || 'issued snapshot ' || coalesce(v_snapshot #>> '{payment,customer_text}', '') || '; ';
  end if;
  select count(*) into v_count from public.pi_versions where pi_id = v_pi;
  if v_count <> 1 then
    v_fail := v_fail || 'version count ' || v_count::text || '; ';
  end if;
  begin
    perform public.generate_pi(v_pi, (select draft_version from public.proforma_invoices where id = v_pi), v_payload);
    v_fail := v_fail || 'second issue succeeded; ';
  exception when others then
    if sqlerrm not like '%already issued%' then
      v_fail := v_fail || 'second issue ' || sqlerrm || '; ';
    end if;
  end;
  if (select count(*) from public.pi_versions where pi_id = v_pi) <> 1 then
    v_fail := v_fail || 'second issue created a version; ';
  end if;

  update public.products set sell_price_egp = 1 where id = v_product;
  update public.default_terms set payment_terms = 'changed default' where id = 1;
  if (select snapshot from public.pi_versions where pi_id = v_pi) is distinct from v_original then
    v_fail := v_fail || 'catalogue edit changed the snapshot; ';
  end if;

  v_expected := public.create_pi_revision(v_pi);
  perform public.generate_pi(v_pi, v_expected, v_payload || jsonb_build_object(
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'vendor_id', v_vendor, 'model_code', v_model,
      'description', 'Pay pump', 'unit', 'unit', 'quantity', '2', 'unit_price', '100000.00'
    ))
  ));
  if (select snapshot from public.pi_versions where pi_id = v_pi and revision = 0) is distinct from v_original then
    v_fail := v_fail || 'revision changed the original snapshot; ';
  end if;
  if (select snapshot #>> '{payment,rows,0,amount}' from public.pi_versions where pi_id = v_pi and revision = 1) <> '60000.00'
    or (select snapshot #>> '{payment,rows,1,due,deadline}' from public.pi_versions where pi_id = v_pi and revision = 1) <> '2026-12-15'
  then
    v_fail := v_fail || 'revision did not recalculate while keeping the deadline; ';
  end if;

  v_duplicate := public.duplicate_pi(v_pi);
  select payment_schedule into v_result from public.proforma_invoices where id = v_duplicate;
  if v_result ->> 'dates_need_review' <> 'true'
    or v_result #>> '{rows,0,amount,percent}' <> '30'
    or v_result #>> '{rows,1,due,deadline}' is not null
    or v_result #>> '{rows,0,id}' = '00000000-0000-4000-8000-000000000081'
  then
    v_fail := v_fail || 'duplicate did not copy rules and clear the deadline; ';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_editor::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  begin
    perform public.generate_pi(v_duplicate, 1, v_payload || jsonb_build_object('lead_salesperson_id', v_editor, 'salesperson_ids', jsonb_build_array(v_editor)));
    v_fail := v_fail || 'editor without generate issued a PI; ';
  exception when others then
    if sqlerrm not like '%permission to generate%' then
      v_fail := v_fail || 'editor generate ' || sqlerrm || '; ';
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_reader::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  begin
    execute 'set local role authenticated';
    if (select snapshot #>> '{payment,customer_text}' from public.pi_versions where pi_id = v_pi and revision = 0) is null then
      v_fail := v_fail || 'reader could not read the issued agreement; ';
    end if;
  exception when others then
    v_fail := v_fail || 'reader read ' || sqlerrm || '; ';
  end;
  execute 'reset role';
  begin
    perform public.save_pi_draft(v_duplicate, 1, v_payload);
    v_fail := v_fail || 'reader saved a schedule; ';
  exception when others then
    if sqlerrm not like '%permission to edit%' and sqlerrm not like '%access%' then
      v_fail := v_fail || 'reader save ' || sqlerrm || '; ';
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  begin
    execute 'set local role authenticated';
    if (select count(*) from public.pi_versions where pi_id = v_pi) <> 0 then
      v_fail := v_fail || 'unrelated user read the issued agreement; ';
    end if;
  exception when others then
    v_fail := v_fail || 'stranger read ' || sqlerrm || '; ';
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', v_inactive::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  begin
    perform public.save_pi_draft(v_duplicate, 1, v_payload);
    v_fail := v_fail || 'inactive user saved; ';
  exception when others then
    if sqlerrm not like '%disabled%' and sqlerrm not like '%not signed in%' then
      v_fail := v_fail || 'inactive ' || sqlerrm || '; ';
    end if;
  end;

  begin
    execute 'set local role anon';
    perform public.generate_pi(v_duplicate, 1, v_payload);
    v_fail := v_fail || 'anonymous issue succeeded; ';
  exception when insufficient_privilege then
    null;
  when others then
    if sqlerrm not like '%not signed in%' and sqlerrm not like '%permission denied%' then
      v_fail := v_fail || 'anonymous ' || sqlerrm || '; ';
    end if;
  end;
  execute 'reset role';

  if v_fail <> '' then
    raise exception 'Payment schedule checks failed: %', v_fail;
  end if;
  raise exception 'Payment schedule checks passed and were rolled back.';
end;
$test$;
