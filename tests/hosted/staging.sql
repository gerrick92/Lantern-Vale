-- Staging SQL rehearsal only. Requires migrations 001–008 and an empty database.
-- Run the entire file in one SQL Editor request, never individual selections.
-- Synthetic identities/payment records are rolled back; no Auth login, wallet,
-- canonical receipt, signature, API transport or backup is verified here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $guard$
declare t record; occupied boolean;
begin
  if (select count(*) from pg_catalog.pg_tables where schemaname='public') <> 15
    or exists(select 1 from auth.users)
    then raise exception 'Expected an empty staging database with eight migrations'; end if;
  for t in select tablename from pg_catalog.pg_tables where schemaname='public' loop
    execute format('select exists(select 1 from public.%I)',t.tablename) into occupied;
    if occupied then raise exception 'Staging table % is not empty',t.tablename; end if;
  end loop;
end $guard$;

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
set local role service_role;
insert into public.profiles(user_id,display_name) values
  ('10000000-0000-4000-8000-000000000001','Staging Alice'),
  ('10000000-0000-4000-8000-000000000002','Staging Bob');
insert into public.contacts(user_id,label,address) values
  ('10000000-0000-4000-8000-000000000001','Alice fixture','0x1111111111111111111111111111111111111111'),
  ('10000000-0000-4000-8000-000000000002','Bob fixture','0x2222222222222222222222222222222222222222');
insert into public.wallet_links(user_id,address) values
  ('10000000-0000-4000-8000-000000000001','0x1111111111111111111111111111111111111111');

do $service$
declare
  alice uuid := '10000000-0000-4000-8000-000000000001';
  bob uuid := '10000000-0000-4000-8000-000000000002';
  visit_id uuid := '20000000-0000-4000-8000-000000000001';
  purchase_id uuid := '20000000-0000-4000-8000-000000000002';
  r uuid; plan jsonb; receipt jsonb; state jsonb; result jsonb;
  first_request jsonb; payload jsonb;
begin
  plan := jsonb_build_object(
    'chainId',11155111,'wallet','0x1111111111111111111111111111111111111111',
    'contract','0x3333333333333333333333333333333333333333',
    'token','0x4444444444444444444444444444444444444444',
    'paymentId','0x'||repeat('01',32),'deadline','1900000000',
    'action',jsonb_build_object('kind','entry','classId','warrior'));
  state := '{"mode":"paid","phase":"town","classId":"warrior","spent":1}';
  receipt := plan || jsonb_build_object(
    'roundId','7','classId','warrior','hash','0x'||repeat('ab',32),
    'blockHash','0x'||repeat('cd',32),'blockNumber','100',
    'blockTimestamp','1800000000','transactionIndex',0,'item',null,
    'amount','1000000000000000000','totalDeposited','1000000000000000000',
    'randomnessProof',jsonb_build_object('syntheticSqlFixture',true));
  perform public.reserve_payment_review(alice,plan);
  r := public.register_settlement_entry(alice,'warrior',state,receipt);
  if public.register_settlement_entry(alice,'warrior',state,receipt) is distinct from r
    then raise exception 'Entry retry was not idempotent'; end if;
  begin
    perform public.register_settlement_entry(bob,'warrior',state,receipt);
    raise exception 'Cross-account entry unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Payment already registered' then raise; end if;
  end;
  result := public.commit_game_action(r,alice,0,visit_id,'{"type":"visit","place":"weapon"}',state);
  if result->>'version' is distinct from '1' then raise exception 'Action version incorrect'; end if;
  if public.commit_game_action(r,alice,0,visit_id,'{"type":"visit","place":"weapon"}',state) is distinct from result
    then raise exception 'Action retry was not idempotent'; end if;
  begin
    perform public.commit_game_action(r,alice,0,gen_random_uuid(),'{}',state);
    raise exception 'Stale action unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'State version conflict' then raise; end if;
  end;
  begin
    perform public.commit_game_action(r,bob,1,gen_random_uuid(),'{}',state);
    raise exception 'Cross-account action unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Round unavailable' then raise; end if;
  end;

  plan := plan || jsonb_build_object('paymentId','0x'||repeat('02',32),
    'action',jsonb_build_object('kind','purchase','roundId',r,'contractRoundId','7',
      'version',1,'requestId',purchase_id,'intent',jsonb_build_object('type','buy','item','weapon')));
  perform public.reserve_payment_review(alice,plan);
  begin
    perform public.commit_game_action(r,alice,1,gen_random_uuid(),'{}',state);
    raise exception 'Pending payment allowed unrelated action';
  exception when raise_exception then
    if sqlerrm <> 'Recover the pending purchase before another action' then raise; end if;
  end;
  receipt := receipt || jsonb_build_object('paymentId',plan->>'paymentId',
    'hash','0x'||repeat('ef',32),'item',0,'totalDeposited','2000000000000000000');
  state := state || '{"spent":2}';
  result := public.commit_settlement_purchase(r,alice,1,purchase_id,'{"type":"buy","item":"weapon"}',state,receipt);
  if result->>'version' is distinct from '2' then raise exception 'Purchase version incorrect'; end if;
  if public.commit_settlement_purchase(r,alice,1,purchase_id,'{"type":"buy","item":"weapon"}',state,receipt) is distinct from result
    then raise exception 'Purchase retry was not idempotent'; end if;
  if (select count(*) from public.settlement_payments) <> 2
    or (select count(*) from public.game_actions) <> 2
    or (select count(*) from public.game_payment_reviews where status='completed') <> 2
    then raise exception 'Payment/action atomicity or retry counts incorrect'; end if;

  payload := public.export_account_data(alice);
  if payload->'profile'->>'displayName' is distinct from 'Staging Alice'
    or jsonb_array_length(payload->'contacts') <> 1
    or jsonb_array_length(payload->'adventures') <> 1
    or jsonb_array_length(payload->'actions') <> 2
    or jsonb_array_length(payload->'payments') <> 2
    or jsonb_typeof(payload->'payments'->1->'totalDepositedBaseUnits') is distinct from 'string'
    or payload->'payments'->1->>'totalDepositedBaseUnits' is distinct from '2000000000000000000'
    or payload::text like '%Staging Bob%' or payload::text like '%Bob fixture%'
    then raise exception 'Account export ownership or exact amounts incorrect'; end if;
  payload := public.export_account_data(bob);
  if jsonb_array_length(payload->'adventures') <> 0 or jsonb_array_length(payload->'payments') <> 0
    then raise exception 'Other account received private adventure data'; end if;
  first_request := public.request_account_deletion(alice,true);
  if first_request->>'requestedAt' is null or first_request->>'needsPaymentReview' <> 'true'
    or public.request_account_deletion(alice,true) is distinct from first_request
    then raise exception 'Deletion request was not review-gated and idempotent'; end if;
  if public.account_data_status(bob)->>'requestedAt' is not null
    or public.account_data_status(bob)->>'needsPaymentReview' <> 'false'
    then raise exception 'Deletion request crossed accounts'; end if;
  update public.game_rounds g set state=g.state || '{"phase":"defeat"}'::jsonb where id=r;
  if public.account_data_status(alice)->>'needsPaymentReview' <> 'true'
    then raise exception 'Defeat bypassed payment review'; end if;
  if public.request_account_deletion(alice,false)->>'requestedAt' is not null
    then raise exception 'Request cancellation failed'; end if;
  if (select count(*) from public.game_rounds) <> 1
    or (select count(*) from public.payment_receipts) <> 1
    or (select count(*) from public.settlement_payments) <> 2
    then raise exception 'Account request removed payment evidence'; end if;
  if public.cleanup_account_ephemera()->>'executed' <> 'false'
    then raise exception 'Maintenance did not default to dry run'; end if;
end $service$;
-- SQL-only acknowledgement fixture. The independent hosted game-recovery.mjs
-- drill proves encrypted storage/read-back; this block tests database access.
do $archive_fixture$
declare events jsonb; first_event jsonb; last_event jsonb;
begin
  events:=public.read_game_recovery_batch('10000000-0000-4000-8000-000000000001')->'events';
  first_event:=events->0; last_event:=events->-1;
  if jsonb_array_length(events)<1 then raise exception 'Recovery journal missing'; end if;
  perform public.acknowledge_game_recovery('10000000-0000-4000-8000-000000000001',
    (first_event->>'sequence')::bigint,(last_event->>'sequence')::bigint,last_event->>'hash');
end $archive_fixture$;
reset role;

-- Real PostgreSQL roles and Supabase auth.uid()/auth.jwt() policies. Claims below
-- are deliberately injected SQL fixtures, not evidence of Auth token issuance.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
set local role authenticated;
do $aal1$ begin
  if exists(select 1 from public.profiles) or exists(select 1 from public.contacts)
    or exists(select 1 from public.wallet_links) or exists(select 1 from public.game_rounds)
    then raise exception 'AAL1 read private records'; end if;
  begin
    insert into public.contacts(user_id,label,address)
      values('10000000-0000-4000-8000-000000000001','Denied','0x1111111111111111111111111111111111111111');
    raise exception 'AAL1 write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $aal1$;
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
set local role authenticated;
do $bob$ begin
  if (select count(*) from public.profiles) <> 1
    or (select display_name from public.profiles) is distinct from 'Staging Bob'
    or (select count(*) from public.contacts) <> 1
    or exists(select 1 from public.wallet_links) or exists(select 1 from public.game_rounds)
    or exists(select 1 from public.game_actions)
    then raise exception 'RLS exposed another account'; end if;
  update public.profiles set display_name='Unauthorized' where user_id='10000000-0000-4000-8000-000000000001';
  if found then raise exception 'Cross-account profile update succeeded'; end if;
  begin
    insert into public.contacts(user_id,label,address)
      values('10000000-0000-4000-8000-000000000001','Denied','0x1111111111111111111111111111111111111111');
    raise exception 'Cross-account contact insert succeeded';
  exception when insufficient_privilege then null; end;
end $bob$;
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
set local role authenticated;
do $alice$ begin
  if (select count(*) from public.profiles) <> 1
    or (select display_name from public.profiles) is distinct from 'Staging Alice'
    or (select count(*) from public.contacts) <> 1
    or (select count(*) from public.wallet_links) <> 1
    or (select count(*) from public.game_rounds) <> 1
    or (select count(*) from public.game_actions) <> 2
    then raise exception 'Verified owner access failed'; end if;
  begin
    perform public.export_account_data('10000000-0000-4000-8000-000000000002');
    raise exception 'Browser role invoked privileged export';
  exception when insufficient_privilege then null; end;
  begin
    perform public.request_account_deletion('10000000-0000-4000-8000-000000000002',true);
    raise exception 'Browser role invoked privileged deletion request';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.settlement_payments;
    raise exception 'Browser role read service-only ledger';
  exception when insufficient_privilege then null; end;
end $alice$;
reset role;
set local role anon;
do $anonymous$ begin
  begin perform * from public.profiles; raise exception 'Anonymous private read succeeded';
  exception when insufficient_privilege then null; end;
  begin perform public.cleanup_account_ephemera(); raise exception 'Anonymous maintenance succeeded';
  exception when insufficient_privilege then null; end;
  begin perform public.export_account_data('10000000-0000-4000-8000-000000000001');
    raise exception 'Anonymous export succeeded';
  exception when insufficient_privilege then null; end;
end $anonymous$;
reset role;
rollback;

do $clean$
declare t record; occupied boolean;
begin
  if exists(select 1 from auth.users) then raise exception 'Auth fixtures remained after rollback'; end if;
  for t in select tablename from pg_catalog.pg_tables where schemaname='public' loop
    execute format('select exists(select 1 from public.%I)',t.tablename) into occupied;
    if occupied then raise exception 'Fixture data remained in %',t.tablename; end if;
  end loop;
end $clean$;
select 'PASS: staging RLS, account isolation, payment retries/review locks, exact export and request cancellation; all fixtures rolled back' as result;
