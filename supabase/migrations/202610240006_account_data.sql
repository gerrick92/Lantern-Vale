-- Unapplied candidate. Deletion requests require operator review; this migration
-- never deletes an Auth account, adventure, payment review or receipt.
create table public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant all on public.account_deletion_requests to service_role;

create function public.account_data_status(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'requestedAt',(select requested_at from public.account_deletion_requests where user_id=p_user),
    'needsPaymentReview',
      exists(select 1 from public.game_rounds where user_id=p_user)
      or exists(select 1 from public.game_payment_reviews where user_id=p_user and status='open')
  );
$$;

create function public.request_account_deletion(p_user uuid,p_request boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_request is null or not exists(select 1 from auth.users where id=p_user)
    then raise exception 'Invalid account request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if p_request then
    insert into public.account_deletion_requests(user_id) values(p_user) on conflict(user_id) do nothing;
  else
    delete from public.account_deletion_requests where user_id=p_user;
  end if;
  return public.account_data_status(p_user);
end $$;

-- Each export uses a single statement snapshot and explicit fields. It is not
-- a database backup. Large histories fail explicitly instead of being truncated.
create function public.export_account_data(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare payload jsonb; rows_total bigint;
begin
  if not exists(select 1 from auth.users where id=p_user) then raise exception 'Account not found'; end if;
  select
    (select count(*) from public.contacts where user_id=p_user) +
    (select count(*) from public.game_rounds where user_id=p_user) +
    (select count(*) from public.game_actions a join public.game_rounds r on r.id=a.round_id where r.user_id=p_user) +
    (select count(*) from public.settlement_payments p join public.game_rounds r on r.id=p.round_id where r.user_id=p_user) +
    (select count(*) from public.game_payment_reviews where user_id=p_user) +
    (select count(*) from public.reward_claims c join public.game_rounds r on r.id=c.round_id where r.user_id=p_user) +
    (select count(*) from public.game_settlement_results s join public.game_rounds r on r.id=s.round_id where r.user_id=p_user)
    into rows_total;
  if rows_total>10000 then raise exception using errcode='54000',message='Account export requires operator assistance'; end if;
  payload := jsonb_build_object(
    'profile',(select jsonb_build_object('displayName',display_name,'createdAt',created_at) from public.profiles where user_id=p_user),
    'wallet',(select jsonb_build_object('address',address,'chainId',chain_id,'verifiedAt',verified_at) from public.wallet_links where user_id=p_user),
    'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'address',address,'favorite',is_favorite,'createdAt',created_at) order by created_at,id) from public.contacts where user_id=p_user),'[]'::jsonb),
    'adventures',coalesce((select jsonb_agg(jsonb_build_object('id',id,'wallet',wallet_address,'chainId',chain_id,'contract',gateway_address,'contractRoundId',contract_round_id,'entryTransaction',entry_tx_hash,'entryBlockHash',entry_block_hash,'class',class,'state',state,'version',version,'economyVersion',economy_version,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id) from public.game_rounds where user_id=p_user),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'roundId',a.round_id,'version',a.version,'intent',a.intent,'result',a.result,'createdAt',a.created_at) order by a.round_id,a.version) from public.game_actions a join public.game_rounds r on r.id=a.round_id where r.user_id=p_user),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('roundId',p.round_id,'chainId',p.chain_id,'contract',p.contract_address,'transaction',p.transaction_hash,'paymentId',p.payment_id,'item',p.item,'amountBaseUnits',p.amount::text,'totalDepositedBaseUnits',p.total_deposited::text,'blockNumber',p.block_number::text,'blockHash',p.block_hash) order by p.round_id,p.total_deposited) from public.settlement_payments p join public.game_rounds r on r.id=p.round_id where r.user_id=p_user),'[]'::jsonb),
    'paymentReviews',coalesce((select jsonb_agg(jsonb_build_object('paymentId',payment_id,'roundId',round_id,'plan',plan,'deadline',deadline::text,'status',status,'createdAt',created_at) order by created_at,payment_id) from public.game_payment_reviews where user_id=p_user),'[]'::jsonb),
    'legacyClaims',coalesce((select jsonb_agg(jsonb_build_object('roundId',c.round_id,'recipient',c.recipient,'amountBaseUnits',c.amount::text,'nonce',c.nonce::text,'deadline',c.deadline::text,'createdAt',c.created_at) order by c.created_at,c.round_id) from public.reward_claims c join public.game_rounds r on r.id=c.round_id where r.user_id=p_user),'[]'::jsonb),
    'settlementResults',coalesce((select jsonb_agg(jsonb_build_object('roundId',s.round_id,'signer',s.signer,'digest',s.digest,'result',s.result,'updatedAt',s.updated_at) order by s.updated_at,s.round_id) from public.game_settlement_results s join public.game_rounds r on r.id=s.round_id where r.user_id=p_user),'[]'::jsonb),
    'deletionRequest',public.account_data_status(p_user)
  );
  if octet_length(payload::text)>8388608 then raise exception using errcode='54000',message='Account export requires operator assistance'; end if;
  return payload;
end $$;

-- Expiry alone is never sufficient to delete a payment review. Only these two
-- disposable tables are eligible. No scheduler or automatic execution is added.
create index wallet_challenges_expiry on public.wallet_challenges(expires_at,id);
create index rate_limits_expiry on public.rate_limits(minute,user_id,scope);
create function public.cleanup_account_ephemera(p_execute boolean default false,p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path='' as $$
declare challenge_count integer; rate_count integer;
begin
  if p_execute is null or p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'Invalid cleanup options'; end if;
  if not p_execute then
    select count(*) into challenge_count from (select 1 from public.wallet_challenges where expires_at<now()-interval '24 hours' limit p_limit) s;
    select count(*) into rate_count from (select 1 from public.rate_limits where minute<now()-interval '2 days' limit p_limit) s;
  else
    with batch as (
      select id from public.wallet_challenges where expires_at<now()-interval '24 hours'
      order by expires_at,id limit p_limit for update skip locked
    ), removed as (
      delete from public.wallet_challenges c using batch b where c.id=b.id returning c.id
    ) select count(*) into challenge_count from removed;
    with batch as (
      select user_id,scope from public.rate_limits where minute<now()-interval '2 days'
      order by minute,user_id,scope limit p_limit for update skip locked
    ), removed as (
      delete from public.rate_limits r using batch b where r.user_id=b.user_id and r.scope=b.scope returning r.user_id
    ) select count(*) into rate_count from removed;
  end if;
  return jsonb_build_object('executed',p_execute,'walletChallenges',challenge_count,'rateLimits',rate_count,'batchLimit',p_limit);
end $$;

revoke all on function public.account_data_status(uuid),public.request_account_deletion(uuid,boolean),public.export_account_data(uuid),public.cleanup_account_ephemera(boolean,integer) from public,anon,authenticated;
grant execute on function public.account_data_status(uuid),public.request_account_deletion(uuid,boolean),public.export_account_data(uuid),public.cleanup_account_ephemera(boolean,integer) to service_role;
