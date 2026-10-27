-- Unapplied candidate. Persist public, verified result signatures for retry.
create table public.game_settlement_results (
  round_id uuid primary key references public.game_rounds(id) on delete cascade,
  signer text not null check(signer ~ '^0x[0-9a-f]{40}$'),
  digest text not null check(digest ~ '^0x[0-9a-f]{64}$'),
  result jsonb not null,
  signature text not null check(signature ~ '^0x[0-9a-f]{130}$'),
  updated_at timestamptz not null default now()
);
alter table public.game_settlement_results enable row level security;
revoke all on public.game_settlement_results from public,anon,authenticated;
grant all on public.game_settlement_results to service_role;
