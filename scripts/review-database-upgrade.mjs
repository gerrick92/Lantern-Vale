import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const digest = (data) => createHash("sha256").update(data).digest("hex");
const baselineTables = [
  "profiles",
  "contacts",
  "wallet_links",
  "wallet_challenges",
  "game_rounds",
  "game_actions",
  "reward_claims",
  "rate_limits",
  "payment_receipts",
];
const addedTables = [
  "settlement_payments",
  "game_payment_reviews",
  "game_settlement_results",
  "account_deletion_requests",
  "game_recovery_heads",
  "game_recovery_events",
];

// Only schema definitions/effective grants enter this fingerprint, never rows,
// Auth credentials, database passwords or environment configuration.
// PostgreSQL 18 additionally catalogs NOT NULL constraints. Column is_nullable
// already checks their enforcement on both 17 and 18; omit duplicate entries.
export const schemaFingerprintSql = `select encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text collate "C")::text,'[]'),'UTF8')),'hex') as fingerprint from (
  select jsonb_build_object('kind','column','value',to_jsonb(d)) as value from (
    select table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
    from information_schema.columns where table_schema='public'
  ) d union all
  select jsonb_build_object('kind','table','name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') union all
  select jsonb_build_object('kind','constraint','table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))
    from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype<>'n' union all
  select jsonb_build_object('kind','index','value',to_jsonb(d)) from (
    select tablename,indexname,indexdef from pg_indexes where schemaname='public'
  ) d union all
  select jsonb_build_object('kind','policy','value',to_jsonb(d)) from (
    select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public'
  ) d union all
  select jsonb_build_object('kind','function','name',p.proname,'args',pg_get_function_identity_arguments(p.oid),
    'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,
    'strict',p.proisstrict,'config',p.proconfig,'body',replace(p.prosrc,chr(13),''))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prokind='f' union all
  select jsonb_build_object('kind','trigger','table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal union all
  select jsonb_build_object('kind','eventTrigger','name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,
    'tags',e.evttags,'function',p.proname,'owner',r.rolname)
    from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace
    join pg_roles r on r.oid=e.evtowner where n.nspname='public' union all
  select jsonb_build_object('kind','tableGrant','table',c.relname,'role',r.name,'privilege',v.name,'allowed',has_table_privilege(r.name,c.oid,v.name),
    'grantable',has_table_privilege(r.name,c.oid,v.name||' WITH GRANT OPTION'))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('anon'),('authenticated'),('service_role')) r(name)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(name)
    where n.nspname='public' and c.relkind in ('r','p') union all
  select jsonb_build_object('kind','columnGrant','table',c.relname,'column',a.attname,'role',r.name,'privilege',v.name,
    'allowed',has_column_privilege(r.name,c.oid,a.attnum,v.name),
    'grantable',has_column_privilege(r.name,c.oid,a.attnum,v.name||' WITH GRANT OPTION'))
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('anon'),('authenticated'),('service_role')) r(name)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(name)
    where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped union all
  select jsonb_build_object('kind','roleBypass','name',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls)
    from pg_roles where rolname in ('anon','authenticated','service_role') union all
  select jsonb_build_object('kind','functionGrant','function',p.proname,'args',pg_get_function_identity_arguments(p.oid),
    'role',r.name,'allowed',has_function_privilege(r.name,p.oid,'EXECUTE'),
    'grantable',has_function_privilege(r.name,p.oid,'EXECUTE WITH GRANT OPTION'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join (values ('anon'),('authenticated'),('service_role')) r(name)
    where n.nspname='public' and p.prokind='f'
) definitions`;

export const schemaDefinitionsSql = `select coalesce(jsonb_agg(value order by value::text collate "C"),'[]'::jsonb) as definitions ${schemaFingerprintSql.slice(schemaFingerprintSql.indexOf("from ("))}`;

export function readHostedBaseline(root = process.cwd()) {
  const bytes = readFileSync(
    resolve(root, "supabase/review/hosted-baseline.sql"),
  );
  if (
    digest(bytes) !==
    "1798cfdfcb92e33ae20058906d254f0b593032a6879bba1181a72485501144b8"
  )
    throw new Error(
      "Reviewed Supabase helper changed; review the baseline again.",
    );
  return bytes.toString("utf8");
}

export function readReviewedMigrations(root = process.cwd()) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "supabase/applied-migrations.json"), "utf8"),
  );
  const directory = resolve(root, "supabase/migrations");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (
    manifest.format !== 1 ||
    manifest.migrations.length !== 8 ||
    JSON.stringify(files) !==
      JSON.stringify(manifest.migrations.map((item) => item.file))
  )
    throw new Error("Migration set changed; review a new upgrade plan.");
  return manifest.migrations.map((item) => {
    if (!/^\d{12}_[a-z_]+\.sql$/.test(item.file))
      throw new Error("Invalid migration filename.");
    const bytes = readFileSync(resolve(directory, item.file));
    if (digest(bytes) !== item.sha256)
      throw new Error(`Applied migration changed: ${item.file}`);
    return { ...item, sql: bytes.toString("utf8") };
  });
}

export async function buildUpgradeReview(
  root = process.cwd(),
  profile = "migrations-only",
) {
  if (!["migrations-only", "supabase-20261024"].includes(profile))
    throw new Error("Unreviewed database baseline profile.");
  const migrations = readReviewedMigrations(root);
  const reference = new PGlite();
  let baseline, upgraded, baselineDefinitions, upgradedDefinitions;
  try {
    // Minimal local Auth stand-in, never a connection to Supabase.
    await reference.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select null::uuid';
      create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';
      grant usage on schema public,auth to anon,authenticated,service_role;
      set search_path=pg_catalog,public;`);
    for (const migration of migrations.slice(0, 2))
      await reference.exec(migration.sql);
    if (profile === "supabase-20261024")
      await reference.exec(readHostedBaseline(root));
    baseline = (await reference.query(schemaFingerprintSql)).rows[0]
      .fingerprint;
    baselineDefinitions = (await reference.query(schemaDefinitionsSql)).rows[0]
      .definitions;
    for (const migration of migrations.slice(2))
      await reference.exec(migration.sql);
    upgraded = (await reference.query(schemaFingerprintSql)).rows[0]
      .fingerprint;
    upgradedDefinitions = (await reference.query(schemaDefinitionsSql)).rows[0]
      .definitions;
  } finally {
    await reference.close();
  }
  const baselineArray = `array[${baselineTables.map((table) => `'${table}'`).join(",")}]`;
  const sql = `-- Lantern Vale: migrations 001/002 -> 008 REVIEW ONLY.
-- Run the ENTIRE file only in an approved maintenance window on a clone of the
-- existing database. It takes exclusive table locks and ends with ROLLBACK.
-- After any error, explicitly roll back the session before investigating.
-- This file contains no credentials or account data. It is not a backup,
-- a production approval, or a migration-history repair. Never run selections.
begin;
${profile === "supabase-20261024" ? "set local role postgres;" : "-- Use the isolated fixture owner."}
set local search_path=pg_catalog,public;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('lantern-vale-upgrade-001002-008',0));
lock table ${baselineTables.map((table) => `public.${table}`).join(",")} in access exclusive mode nowait;
do $baseline$ begin
  if (${schemaFingerprintSql}) is distinct from '${baseline}'
    then raise exception 'Baseline schema differs from reviewed migrations 001/002; stop and review drift'; end if;
end $baseline$;

-- Private rows stay inside this database transaction and are never returned.
create temporary table lantern_upgrade_rows(table_name text not null,payload jsonb not null) on commit drop;
revoke all on lantern_upgrade_rows from public,anon,authenticated,service_role;
do $capture$ declare t text; begin
  foreach t in array ${baselineArray} loop
    execute format('insert into pg_temp.lantern_upgrade_rows select %L,to_jsonb(r) from public.%I r',t,t);
  end loop;
end $capture$;

${migrations
  .slice(2)
  .map((item) => `-- ${item.file}; SHA-256 ${item.sha256}\n${item.sql}`)
  .join("\n")}

do $verify$ declare t text; changed boolean; projection text; begin
  if (${schemaFingerprintSql}) is distinct from '${upgraded}'
    then raise exception 'Upgraded schema or permissions differ from reviewed sources'; end if;
  foreach t in array ${baselineArray} loop
    projection := case when t='game_rounds' then 'to_jsonb(r)-''economy_version''' else 'to_jsonb(r)' end;
    execute format('select exists((select payload from pg_temp.lantern_upgrade_rows where table_name=%L except all select %s from public.%I r)
      union all (select %s from public.%I r except all select payload from pg_temp.lantern_upgrade_rows where table_name=%L))',t,projection,t,projection,t,t) into changed;
    if changed then raise exception 'Existing rows changed in %; transaction must roll back',t; end if;
  end loop;
  if exists(select 1 from public.game_rounds where economy_version<>'legacy')
    then raise exception 'Existing adventures must retain legacy classification'; end if;
  ${addedTables.map((table) => `if exists(select 1 from public.${table}) then raise exception 'Unexpected records in ${table}'; end if;`).join("\n  ")}
end $verify$;
select 'PASS: upgrade checks passed; the following ROLLBACK preserves the original database' as review_result;
rollback;
do $rolled_back$ begin
  perform set_config('search_path','pg_catalog,public',true);
  if (${schemaFingerprintSql}) is distinct from '${baseline}'
    or to_regclass('pg_temp.lantern_upgrade_rows') is not null
    then raise exception 'Rollback verification failed'; end if;
end $rolled_back$;
select 'PASS: original 001/002 schema restored; no upgrade was committed' as result;
`;
  return {
    sql,
    baselineDefinitions,
    upgradedDefinitions,
    manifest: {
      purpose: "offline-upgrade-review-only",
      profile,
      migrationRole:
        profile === "supabase-20261024" ? "postgres" : "fixture-owner",
      from: "001/002",
      to: "008",
      defaultOutcome: "ROLLBACK",
      baselineSchema: baseline,
      upgradedSchema: upgraded,
      migrations: migrations.map(({ file, sha256 }) => ({ file, sha256 })),
      sqlSha256: digest(sql),
      limitations: [
        "Requires an approved isolated database clone and maintenance window",
        "Does not back up Auth or prove hosted recovery",
        "Does not register CLI migration history or enable paid play",
      ],
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 2)
    throw new Error(
      "No apply mode exists. Run npm run database:review without arguments.",
    );
  const review = await buildUpgradeReview();
  const base = resolve("test-results/database-upgrade");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(resolve(base, "review-"));
  writeFileSync(resolve(directory, "rehearse.sql"), review.sql, { flag: "wx" });
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify(review.manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(`Prepared rollback-only review: ${directory}`);
  console.log(
    "No environment was loaded and no external database was contacted.",
  );
}
