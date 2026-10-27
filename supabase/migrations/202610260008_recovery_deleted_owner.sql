-- Keep receipt tombstones when an independently reviewed account erasure
-- clears a review's nullable owner. Never recreate an erased Auth identity.
create or replace function public.capture_game_recovery() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; row_value jsonb; economy text;
begin
  row_value := to_jsonb(new);
  if tg_table_name in ('game_rounds','game_payment_reviews') then
    target := (row_value->>'user_id')::uuid;
    if target is null and tg_table_name='game_payment_reviews' and tg_op='UPDATE' then
      target := (to_jsonb(old)->>'user_id')::uuid;
      -- A second FK cascade can clear round_id after the owner was erased.
      -- The first owner-removal event is retained; an orphan has no account
      -- history to restore and its public receipt tombstone remains intact.
      if target is null then return new; end if;
    end if;
  else
    select user_id,economy_version into target,economy from public.game_rounds where id=(row_value->>'round_id')::uuid;
    if economy='legacy' then return new; end if;
  end if;
  if target is null then raise exception 'Recovery owner unavailable'; end if;
  perform public.append_game_recovery(target,jsonb_build_object('table',tg_table_name,'operation',tg_op,'row',row_value)::text);
  return new;
end $$;
