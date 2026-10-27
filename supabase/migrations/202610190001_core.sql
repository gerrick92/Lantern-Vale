create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  created_at timestamptz not null default now()
);
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  address text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now()
);
create index contacts_user on public.contacts(user_id);
create table public.wallet_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null default 11155111 check (chain_id = 11155111),
  verified_at timestamptz not null default now()
);
create table public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  message text not null,
  nonce text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index challenge_user on public.wallet_challenges(user_id);
create table public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null check (chain_id = 11155111),
  gateway_address text not null,
  contract_round_id text not null check (contract_round_id ~ '^[1-9][0-9]{0,77}$'),
  entry_tx_hash text not null unique,
  entry_block_hash text not null,
  class text not null,
  state jsonb not null,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chain_id,gateway_address,contract_round_id)
);
create index rounds_user on public.game_rounds(user_id);
create table public.game_actions (
  id uuid primary key,
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  version integer not null,
  intent jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(round_id,version)
);
create table public.reward_claims (
  round_id uuid primary key references public.game_rounds(id) on delete cascade,
  recipient text not null,
  amount numeric(78,0) not null check(amount = 3000000000000000000),
  nonce numeric(78,0) not null unique,
  deadline numeric(78,0) not null,
  created_at timestamptz not null default now()
);
create table public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  minute timestamptz not null,
  count integer not null default 0,
  primary key(user_id,scope)
);

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.wallet_links enable row level security;
alter table public.wallet_challenges enable row level security;
alter table public.game_rounds enable row level security;
alter table public.game_actions enable row level security;
alter table public.reward_claims enable row level security;
alter table public.rate_limits enable row level security;

create policy profiles_owner on public.profiles for all to authenticated
  using(user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2')
  with check(user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy contacts_owner on public.contacts for all to authenticated
  using(user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2')
  with check(user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy wallet_read on public.wallet_links for select to authenticated
  using(user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy rounds_read on public.game_rounds for select to authenticated
  using(user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy actions_read on public.game_actions for select to authenticated
  using(exists(select 1 from public.game_rounds r where r.id=round_id and r.user_id=(select auth.uid())) and (select auth.jwt()->>'aal') = 'aal2');
create policy claims_read on public.reward_claims for select to authenticated
  using(exists(select 1 from public.game_rounds r where r.id=round_id and r.user_id=(select auth.uid())) and (select auth.jwt()->>'aal') = 'aal2');

revoke all on public.profiles,public.contacts,public.wallet_links,public.wallet_challenges,public.game_rounds,public.game_actions,public.reward_claims,public.rate_limits from anon,authenticated;
grant select,insert,update,delete on public.profiles,public.contacts to authenticated;
grant select on public.wallet_links,public.game_rounds,public.game_actions,public.reward_claims to authenticated;
grant all on public.profiles,public.contacts,public.wallet_links,public.wallet_challenges,public.game_rounds,public.game_actions,public.reward_claims,public.rate_limits to service_role;

create function public.consume_wallet_challenge(p_id uuid,p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare challenge public.wallet_challenges;
begin
  select * into challenge from public.wallet_challenges where id=p_id and user_id=p_user for update;
  if challenge.id is null or challenge.used_at is not null or challenge.expires_at <= now() then raise exception 'Challenge expired or already used'; end if;
  insert into public.wallet_links(user_id,address) values(p_user,lower(challenge.address))
    on conflict(user_id) do update set address=excluded.address,verified_at=now();
  update public.wallet_challenges set used_at=now() where id=p_id;
end $$;

create function public.take_rate_limit(p_user uuid,p_scope text,p_max integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  insert into public.rate_limits(user_id,scope,minute,count) values(p_user,p_scope,date_trunc('minute',now()),1)
  on conflict(user_id,scope) do update set
    count=case when rate_limits.minute=date_trunc('minute',now()) then rate_limits.count+1 else 1 end,
    minute=date_trunc('minute',now()) returning count into used;
  return used <= p_max;
end $$;

create function public.commit_game_action(p_round uuid,p_user uuid,p_version integer,p_request uuid,p_intent jsonb,p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_round public.game_rounds; previous public.game_actions;
begin
  select * into current_round from public.game_rounds where id=p_round and user_id=p_user for update;
  if current_round.id is null then raise exception 'Round unavailable'; end if;
  select * into previous from public.game_actions where id=p_request and round_id=p_round;
  if previous.id is not null then
    if previous.intent <> p_intent then raise exception 'Request ID reused with different intent'; end if;
    return jsonb_build_object('state',previous.result,'version',previous.version);
  end if;
  if current_round.version <> p_version then raise exception 'State version conflict'; end if;
  if current_round.state->>'phase' in ('victory','defeat') then raise exception 'Round already complete'; end if;
  update public.game_rounds set state=p_state,version=version+1,updated_at=now() where id=p_round;
  insert into public.game_actions(id,round_id,version,intent,result) values(p_request,p_round,p_version+1,p_intent,p_state);
  return jsonb_build_object('state',p_state,'version',p_version+1);
end $$;

create function public.reserve_reward(p_round uuid,p_user uuid,p_nonce numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rounds; claim public.reward_claims;
begin
  select * into r from public.game_rounds where id=p_round and user_id=p_user for update;
  if r.id is null or r.state->>'phase' <> 'victory' then raise exception 'No verified victory'; end if;
  insert into public.reward_claims(round_id,recipient,amount,nonce,deadline)
    values(r.id,r.wallet_address,3000000000000000000,p_nonce,floor(extract(epoch from now()))+86400)
    on conflict(round_id) do nothing;
  select * into claim from public.reward_claims where round_id=p_round;
  return jsonb_build_object('roundId',r.contract_round_id::text,'recipient',claim.recipient,'amount',claim.amount::text,'nonce',claim.nonce::text,'deadline',claim.deadline::text);
end $$;

revoke all on function public.consume_wallet_challenge(uuid,uuid),public.take_rate_limit(uuid,text,integer),public.commit_game_action(uuid,uuid,integer,uuid,jsonb,jsonb),public.reserve_reward(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.consume_wallet_challenge(uuid,uuid),public.take_rate_limit(uuid,text,integer),public.commit_game_action(uuid,uuid,integer,uuid,jsonb,jsonb),public.reserve_reward(uuid,uuid,numeric) to service_role;
