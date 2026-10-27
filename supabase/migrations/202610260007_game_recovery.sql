-- Approved game-only journal. Authentication material is never copied.
create table public.game_recovery_heads (
  user_id uuid primary key,
  sequence bigint not null default 0 check(sequence >= 0),
  archived_sequence bigint not null default 0 check(archived_sequence between 0 and sequence),
  hash text not null default repeat('0',64) check(hash ~ '^[0-9a-f]{64}$')
);
create table public.game_recovery_events (
  user_id uuid not null references public.game_recovery_heads(user_id),
  sequence bigint not null check(sequence > 0),
  transaction_id text not null,
  previous_hash text not null,
  hash text not null check(hash ~ '^[0-9a-f]{64}$'),
  payload text not null,
  primary key(user_id,sequence)
);
alter table public.game_recovery_heads enable row level security;
alter table public.game_recovery_events enable row level security;
revoke all on public.game_recovery_heads,public.game_recovery_events from public,anon,authenticated,service_role;

create function public.append_game_recovery(p_user uuid,p_payload text) returns void
language plpgsql security definer set search_path='' as $$
declare h public.game_recovery_heads; next_hash text;
begin
  if p_user is null or octet_length(p_payload)>4194304 then raise exception 'Invalid recovery record'; end if;
  insert into public.game_recovery_heads(user_id) values(p_user) on conflict do nothing;
  select * into h from public.game_recovery_heads where user_id=p_user for update;
  next_hash := encode(sha256(convert_to(p_user::text || ':' || (h.sequence+1)::text || ':' || h.hash || ':' || p_payload,'UTF8')),'hex');
  insert into public.game_recovery_events values(p_user,h.sequence+1,txid_current()::text,h.hash,next_hash,p_payload);
  update public.game_recovery_heads set sequence=h.sequence+1,hash=next_hash where user_id=p_user;
end $$;
create function public.capture_game_recovery() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; row_value jsonb; economy text;
begin
  row_value := to_jsonb(new);
  if tg_table_name in ('game_rounds','game_payment_reviews') then target := (row_value->>'user_id')::uuid;
  else
    select user_id,economy_version into target,economy from public.game_rounds where id=(row_value->>'round_id')::uuid;
    if economy='legacy' then return new; end if;
  end if;
  if target is null then raise exception 'Recovery owner unavailable'; end if;
  perform public.append_game_recovery(target,jsonb_build_object('table',tg_table_name,'operation',tg_op,'row',row_value)::text);
  return new;
end $$;
create trigger recovery_round after insert or update on public.game_rounds
for each row when(new.economy_version='settlement-v1') execute function public.capture_game_recovery();
create trigger recovery_action after insert on public.game_actions for each row execute function public.capture_game_recovery();
create trigger recovery_payment after insert on public.settlement_payments for each row execute function public.capture_game_recovery();
create trigger recovery_review after insert or update on public.game_payment_reviews for each row execute function public.capture_game_recovery();
create trigger recovery_result after insert or update on public.game_settlement_results for each row execute function public.capture_game_recovery();

create function public.read_game_recovery_batch(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.game_recovery_heads; last_tx text; finish bigint;
begin
  select * into h from public.game_recovery_heads where user_id=p_user for share;
  if h.user_id is null or h.sequence=h.archived_sequence then return jsonb_build_object('events','[]'::jsonb); end if;
  select transaction_id into last_tx from public.game_recovery_events where user_id=p_user and sequence>h.archived_sequence order by sequence offset 99 limit 1;
  if last_tx is null then finish:=h.sequence;
  else select max(sequence) into finish from public.game_recovery_events where user_id=p_user and transaction_id=last_tx; end if;
  return jsonb_build_object('events',(
    select jsonb_agg(jsonb_build_object('userId',user_id,'sequence',sequence::text,'transactionId',transaction_id,'previousHash',previous_hash,'hash',hash,'payload',payload) order by sequence)
    from public.game_recovery_events where user_id=p_user and sequence>h.archived_sequence and sequence<=finish));
end $$;
create function public.acknowledge_game_recovery(p_user uuid,p_from bigint,p_to bigint,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare h public.game_recovery_heads; e public.game_recovery_events;
begin
  select * into h from public.game_recovery_heads where user_id=p_user for update;
  select * into e from public.game_recovery_events where user_id=p_user and sequence=p_to;
  if h.user_id is null or e.hash is distinct from p_hash or p_from<1 or p_to<p_from
    or exists(select 1 from public.game_recovery_events where user_id=p_user and sequence=p_to+1 and transaction_id=e.transaction_id)
    then raise exception 'Incomplete recovery acknowledgement'; end if;
  if h.archived_sequence>=p_to then return; end if;
  if h.archived_sequence<p_from-1 then raise exception 'Recovery sequence gap'; end if;
  update public.game_recovery_heads set archived_sequence=p_to where user_id=p_user;
end $$;

-- Add a restriction; preserve every existing ownership/AAL2 policy.
create function public.game_recovery_ready() returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.game_recovery_heads where user_id=auth.uid() and sequence<>archived_sequence)
$$;
create policy rounds_archived on public.game_rounds as restrictive for select to authenticated using((select public.game_recovery_ready()));
create policy actions_archived on public.game_actions as restrictive for select to authenticated using((select public.game_recovery_ready()));
revoke all on function public.append_game_recovery(uuid,text),public.capture_game_recovery(),public.read_game_recovery_batch(uuid),public.acknowledge_game_recovery(uuid,bigint,bigint,text),public.game_recovery_ready() from public,anon,authenticated,service_role;
grant execute on function public.read_game_recovery_batch(uuid),public.acknowledge_game_recovery(uuid,bigint,bigint,text) to service_role;
grant execute on function public.game_recovery_ready() to authenticated;

create function public.game_round_recovery_ready(p_contract text,p_round text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.game_rounds r join public.game_recovery_heads h on h.user_id=r.user_id
    where r.chain_id=11155111 and r.gateway_address=p_contract and r.contract_round_id=p_round
    and r.economy_version='settlement-v1' and h.sequence=h.archived_sequence and h.sequence>0)
$$;
revoke all on function public.game_round_recovery_ready(text,text) from public,anon,authenticated;
grant execute on function public.game_round_recovery_ready(text,text) to service_role;
