-- Unapplied candidate. Reviews reserve the state being purchased while a wallet
-- confirmation is pending. Only a confirmed payment or verified expiry releases it.
create table public.game_payment_reviews (
  payment_id text primary key check(payment_id ~ '^0x[0-9a-f]{64}$'),
  user_id uuid references auth.users(id) on delete set null,
  round_id uuid references public.game_rounds(id) on delete set null,
  plan jsonb not null,
  deadline numeric(20,0) not null,
  status text not null default 'open' check(status in ('open','completed','expired')),
  created_at timestamptz not null default now()
);
create unique index one_open_payment_review on public.game_payment_reviews(user_id) where status='open';
alter table public.game_payment_reviews enable row level security;
revoke all on public.game_payment_reviews from public,anon,authenticated;
grant all on public.game_payment_reviews to service_role;

create function public.reserve_payment_review(p_user uuid,p_plan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.game_payment_reviews; r public.game_rounds; target uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into previous from public.game_payment_reviews where user_id=p_user and status='open';
  if previous.payment_id is not null then
    if previous.plan->'action' = p_plan->'action' and previous.plan->>'wallet'=p_plan->>'wallet'
      and previous.plan->>'contract'=p_plan->>'contract' then return previous.plan; end if;
    raise exception 'Recover or expire the previous payment review first';
  end if;
  if p_plan->'action'->>'kind' = 'purchase' then
    target := (p_plan->'action'->>'roundId')::uuid;
    select * into r from public.game_rounds where id=target and user_id=p_user for update;
    if r.id is null or r.economy_version<>'settlement-v1' or r.version is distinct from (p_plan->'action'->>'version')::integer
      or r.wallet_address is distinct from lower(p_plan->>'wallet') or r.gateway_address is distinct from lower(p_plan->>'contract')
      or r.contract_round_id is distinct from p_plan->'action'->>'contractRoundId'
      or r.state->>'phase' in ('victory','defeat') then raise exception 'Adventure changed before payment review'; end if;
  elsif p_plan->'action'->>'kind' is distinct from 'entry' then raise exception 'Invalid payment review'; end if;
  if (p_plan->>'chainId')::integer is distinct from 11155111 or (p_plan->>'deadline')::numeric <= 0
    then raise exception 'Invalid payment domain'; end if;
  insert into public.game_payment_reviews(payment_id,user_id,round_id,plan,deadline)
    values(lower(p_plan->>'paymentId'),p_user,target,p_plan,(p_plan->>'deadline')::numeric);
  return p_plan;
end $$;

create function public.guard_reviewed_payment() returns trigger
language plpgsql security definer set search_path='' as $$
declare review public.game_payment_reviews; r public.game_rounds;
begin
  select * into review from public.game_payment_reviews where payment_id=new.payment_id for update;
  select * into r from public.game_rounds where id=new.round_id;
  if review.payment_id is null or review.status<>'open' or review.user_id is distinct from r.user_id
    or review.deadline is distinct from new.payment_deadline
    or lower(review.plan->>'wallet') is distinct from r.wallet_address or lower(review.plan->>'contract') is distinct from new.contract_address
    then raise exception 'Payment has no matching open review'; end if;
  if new.item is null then
    if review.plan->'action'->>'kind' is distinct from 'entry' or review.plan->'action'->>'classId' is distinct from r.class
      then raise exception 'Entry class differs from reviewed payment'; end if;
    update public.game_payment_reviews set status='completed',round_id=r.id where payment_id=review.payment_id;
  elsif review.round_id is distinct from r.id then raise exception 'Purchase differs from reviewed round'; end if;
  return new;
end $$;
create trigger guard_reviewed_payment before insert on public.settlement_payments
for each row execute function public.guard_reviewed_payment();

create function public.guard_pending_game_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare review public.game_payment_reviews;
begin
  select * into review from public.game_payment_reviews where round_id=new.round_id and status='open' for update;
  if review.payment_id is not null then
    if review.plan->'action'->>'requestId' is distinct from new.id::text
      or review.plan->'action'->'intent' is distinct from new.intent
      or not exists(select 1 from public.settlement_payments where round_id=new.round_id and payment_id=review.payment_id)
      then raise exception 'Recover the pending purchase before another action'; end if;
    update public.game_payment_reviews set status='completed' where payment_id=review.payment_id;
  end if;
  return new;
end $$;
create trigger guard_pending_game_review before insert on public.game_actions
for each row execute function public.guard_pending_game_review();

revoke all on function public.reserve_payment_review(uuid,jsonb),public.guard_reviewed_payment(),public.guard_pending_game_review() from public,anon,authenticated;
grant execute on function public.reserve_payment_review(uuid,jsonb) to service_role;
