-- Preserve public payment identifiers after private account data is deleted.
-- This prevents replaying a paid round with a new account or character class.
create table public.payment_receipts (
  chain_id integer not null check (chain_id = 11155111),
  gateway_address text not null,
  contract_round_id text not null,
  entry_tx_hash text not null unique,
  primary key (chain_id, gateway_address, contract_round_id)
);
alter table public.payment_receipts enable row level security;
revoke all on public.payment_receipts from anon, authenticated;
grant all on public.payment_receipts to service_role;

insert into public.payment_receipts
  select chain_id, lower(gateway_address), contract_round_id, lower(entry_tx_hash)
  from public.game_rounds;

create function public.reserve_payment_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.payment_receipts values (
    new.chain_id, lower(new.gateway_address), new.contract_round_id, lower(new.entry_tx_hash)
  );
  return new;
end $$;
revoke all on function public.reserve_payment_receipt() from public, anon, authenticated;
create trigger reserve_payment_before_round before insert on public.game_rounds
  for each row execute function public.reserve_payment_receipt();
