import { validateRecoveryEvent } from "../apps/web/src/server/game-recovery-protocol.ts";

// Produces an operator-reviewed transaction for an isolated restore destination.
// It never connects to a database and never reads or recreates Auth records.
export function gameRecoveryReplaySQL(values, userId) {
  const events = values.map((value) => validateRecoveryEvent(value, userId));
  if (!events.length) throw new Error("No recovery records supplied.");
  let previous = "0".repeat(64);
  for (let i = 0; i < events.length; i++) {
    if (
      events[i].sequence !== String(i + 1) ||
      events[i].previousHash !== previous
    )
      throw new Error("Incomplete recovery history.");
    previous = events[i].hash;
  }
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const serialized = literal(JSON.stringify(events));
  return `begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
alter table public.game_rounds disable trigger user;
alter table public.game_actions disable trigger user;
alter table public.game_payment_reviews disable trigger user;
alter table public.settlement_payments disable trigger user;
alter table public.game_settlement_results disable trigger user;
do $recovery$
declare records jsonb := ${serialized}::jsonb; event jsonb; payload jsonb; record jsonb;
  target uuid := '${userId}'; head public.game_recovery_heads; target_table text;
  columns_sql text; updates_sql text; keys text; key_values jsonb; existing jsonb; affected bigint; final_sequence bigint; final_hash text;
begin
  if not exists(select 1 from auth.users where id=target) then raise exception 'Restore the verified account checkpoint first'; end if;
  select * into head from public.game_recovery_heads where user_id=target for update;
  if head.user_id is not null and head.sequence>0 and
    ((records->(head.sequence::integer-1)->>'hash') is distinct from head.hash or head.sequence>jsonb_array_length(records)) then
    raise exception 'Destination differs from the trusted checkpoint'; end if;
  insert into public.game_recovery_heads(user_id) values(target) on conflict do nothing;
  for event in select value from jsonb_array_elements(records) loop
    if (event->>'sequence')::bigint<=coalesce(head.sequence,0) then continue; end if;
    payload:=(event->>'payload')::jsonb; record:=payload->'row'; target_table:=payload->>'table';
    keys:=case target_table when 'game_rounds' then 'id' when 'game_actions' then 'id'
      when 'game_payment_reviews' then 'payment_id' when 'game_settlement_results' then 'round_id'
      when 'settlement_payments' then 'chain_id,contract_address,transaction_hash' end;
    if keys is null or payload->>'operation' not in ('INSERT','UPDATE') then raise exception 'Unapproved recovery table'; end if;
    if target_table in ('game_rounds','game_payment_reviews') then
      if (record->>'user_id')::uuid is distinct from target then raise exception 'Recovery account mismatch'; end if;
    elsif not exists(select 1 from public.game_rounds where id=(record->>'round_id')::uuid and user_id=target) then
      raise exception 'Recovery round ownership mismatch';
    end if;
    select jsonb_object_agg(k,record->k) into key_values from unnest(string_to_array(keys,',')) k;
    execute format('select to_jsonb(t) from public.%I t where to_jsonb(t) @> $1',target_table) into existing using key_values;
    if payload->>'operation'='INSERT' and existing is not null then raise exception 'Recovery insertion conflicts with existing data'; end if;
    if payload->>'operation'='UPDATE' then
      if existing is null then raise exception 'Recovery update has no checkpoint row'; end if;
      if target_table in ('game_rounds','game_payment_reviews') then
        if existing->>'user_id' is distinct from target::text then raise exception 'Recovery update ownership mismatch'; end if;
      elsif existing->>'round_id' is distinct from record->>'round_id' then
        raise exception 'Recovery update round mismatch';
      end if;
    end if;
    select string_agg(format('%I',c.column_name),',' order by c.ordinal_position),
      string_agg(format('%I=r.%I',c.column_name,c.column_name),',' order by c.ordinal_position)
      into columns_sql,updates_sql from information_schema.columns c
      where c.table_schema='public' and c.table_name=target_table and c.is_generated='NEVER';
    if payload->>'operation'='INSERT' then
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1)',
        target_table,columns_sql,columns_sql,target_table) using record;
    else
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where to_jsonb(t) @> $2',
        target_table,updates_sql,target_table) using record,key_values;
    end if;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'Recovery row count mismatch'; end if;
    insert into public.game_recovery_events(user_id,sequence,transaction_id,previous_hash,hash,payload)
      values(target,(event->>'sequence')::bigint,event->>'transactionId',event->>'previousHash',event->>'hash',event->>'payload');
  end loop;
  final_sequence:=(records->-1->>'sequence')::bigint; final_hash:=records->-1->>'hash';
  update public.game_recovery_heads set sequence=final_sequence,archived_sequence=final_sequence,hash=final_hash where user_id=target;
end $recovery$;
alter table public.game_rounds enable trigger user;
alter table public.game_actions enable trigger user;
alter table public.game_payment_reviews enable trigger user;
alter table public.settlement_payments enable trigger user;
alter table public.game_settlement_results enable trigger user;
commit;`;
}
