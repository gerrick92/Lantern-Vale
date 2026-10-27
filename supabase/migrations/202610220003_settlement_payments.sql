-- Candidate settlement integration. Apply only with the reviewed paid release;
-- migrations 001 and 002 and the existing hosted accounts remain unchanged.
alter table public.game_rounds add column economy_version text not null default 'legacy'
  check (economy_version in ('legacy','settlement-v1'));

-- Public receipt tombstones survive deletion of private rounds/accounts.
create table public.settlement_payments (
  chain_id integer not null check (chain_id = 11155111),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  payment_id text not null check (payment_id ~ '^0x[0-9a-f]{64}$' and payment_id <> '0x' || repeat('0',64)),
  payment_deadline numeric(20,0) not null check(payment_deadline > 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78,0) not null check (block_number > 0),
  block_timestamp numeric(20,0) not null check(block_timestamp > 0),
  transaction_index integer not null check (transaction_index >= 0),
  contract_round_id text not null check (contract_round_id ~ '^[1-9][0-9]{0,77}$'),
  round_id uuid references public.game_rounds(id) on delete set null,
  item smallint check (item between 0 and 8),
  amount numeric(78,0) not null check (amount = 1000000000000000000),
  total_deposited numeric(78,0) not null check (total_deposited >= amount and mod(total_deposited,amount)=0),
  randomness_proof jsonb,
  check ((item is not null and item not in (6,7)) or randomness_proof is not null),
  primary key(chain_id,contract_address,transaction_hash),
  unique(chain_id,contract_address,contract_round_id,total_deposited)
);
create unique index settlement_payment_once on public.settlement_payments(chain_id,contract_address,contract_round_id,payment_id);
create unique index settlement_stock_once on public.settlement_payments(chain_id,contract_address,contract_round_id,item) where item < 8;
alter table public.settlement_payments enable row level security;
revoke all on public.settlement_payments from anon,authenticated;
grant all on public.settlement_payments to service_role;

create function public.register_settlement_entry(p_user uuid,p_class text,p_state jsonb,p_receipt jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.game_rounds; new_id uuid;
begin
  if p_receipt->>'item' is not null or (p_receipt->>'totalDeposited')::numeric is distinct from 1000000000000000000
    or p_receipt->>'classId' is distinct from p_class
    or p_state->>'mode' is distinct from 'paid' or p_state->>'phase' is distinct from 'town' or p_state->>'classId' is distinct from p_class
    or (p_state->>'spent')::integer is distinct from 1 then raise exception 'Invalid settlement entry'; end if;
  -- Serialize retries of the same transaction, including concurrent tab requests.
  perform pg_advisory_xact_lock(hashtextextended(p_receipt->>'hash',0));
  select * into r from public.game_rounds where entry_tx_hash=p_receipt->>'hash';
  if r.id is not null then
    if r.user_id<>p_user or r.class<>p_class or r.wallet_address<>p_receipt->>'wallet' or r.economy_version<>'settlement-v1'
      then raise exception 'Payment already registered'; end if;
    return r.id;
  end if;
  insert into public.game_rounds(user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state,economy_version)
  values(p_user,p_receipt->>'wallet',(p_receipt->>'chainId')::integer,p_receipt->>'contract',p_receipt->>'roundId',p_receipt->>'hash',p_receipt->>'blockHash',p_class,p_state,'settlement-v1') returning id into new_id;
  insert into public.settlement_payments values(
    (p_receipt->>'chainId')::integer,p_receipt->>'contract',p_receipt->>'hash',p_receipt->>'paymentId',(p_receipt->>'deadline')::numeric,p_receipt->>'blockHash',
    (p_receipt->>'blockNumber')::numeric,(p_receipt->>'blockTimestamp')::numeric,(p_receipt->>'transactionIndex')::integer,p_receipt->>'roundId',new_id,null,
    (p_receipt->>'amount')::numeric,(p_receipt->>'totalDeposited')::numeric,p_receipt->'randomnessProof');
  return new_id;
end $$;

create function public.commit_settlement_purchase(p_round uuid,p_user uuid,p_version integer,p_request uuid,p_intent jsonb,p_state jsonb,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rounds; previous public.game_actions; expected_item integer; total numeric;
begin
  select * into r from public.game_rounds where id=p_round and user_id=p_user for update;
  if r.id is null or r.economy_version<>'settlement-v1' then raise exception 'Settlement round unavailable'; end if;
  expected_item := case p_intent->>'type' when 'buy' then case p_intent->>'item'
    when 'weapon' then 0 when 'armor' then 1 when 'potion' then 2 when 'ether' then 3 when 'spark' then 4 when 'mend' then 5 end
    when 'dancer' then 6 when 'fairy' then 7 when 'rest' then 8 end;
  if expected_item is null or (p_receipt->>'item')::integer is distinct from expected_item
    or p_receipt->>'wallet' is distinct from r.wallet_address or p_receipt->>'contract' is distinct from r.gateway_address
    or p_receipt->>'roundId' is distinct from r.contract_round_id or (p_receipt->>'chainId')::integer is distinct from r.chain_id
    or p_receipt->>'classId' is distinct from r.class
    then raise exception 'Receipt does not match this purchase'; end if;
  select * into previous from public.game_actions where id=p_request and round_id=p_round;
  if previous.id is not null then
    if previous.intent<>p_intent or not exists(select 1 from public.settlement_payments where round_id=p_round
      and transaction_hash=p_receipt->>'hash' and total_deposited=(previous.result->>'spent')::numeric*1000000000000000000)
      then raise exception 'Request already used'; end if;
    return jsonb_build_object('state',previous.result,'version',previous.version);
  end if;
  select coalesce(sum(amount),0) into total from public.settlement_payments where round_id=p_round;
  if (p_receipt->>'totalDeposited')::numeric is distinct from total+1000000000000000000
    or (p_state->>'spent')::numeric*1000000000000000000 is distinct from total+1000000000000000000
    or (r.state->>'spent')::numeric*1000000000000000000 is distinct from total
    then raise exception 'Reconcile earlier deposits before this purchase'; end if;
  insert into public.settlement_payments values(
    r.chain_id,r.gateway_address,p_receipt->>'hash',p_receipt->>'paymentId',(p_receipt->>'deadline')::numeric,p_receipt->>'blockHash',(p_receipt->>'blockNumber')::numeric,
    (p_receipt->>'blockTimestamp')::numeric,(p_receipt->>'transactionIndex')::integer,r.contract_round_id,r.id,expected_item,
    (p_receipt->>'amount')::numeric,(p_receipt->>'totalDeposited')::numeric,p_receipt->'randomnessProof');
  -- Both the entitlement and its payment commit or roll back together.
  return public.commit_game_action(p_round,p_user,p_version,p_request,p_intent,p_state);
end $$;

revoke all on function public.register_settlement_entry(uuid,text,jsonb,jsonb),public.commit_settlement_purchase(uuid,uuid,integer,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.register_settlement_entry(uuid,text,jsonb,jsonb),public.commit_settlement_purchase(uuid,uuid,integer,uuid,jsonb,jsonb,jsonb) to service_role;
