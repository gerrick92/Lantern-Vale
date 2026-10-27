import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import {
  buildUpgradeReview,
  readReviewedMigrations,
  schemaFingerprintSql,
} from "./review-database-upgrade.mjs";
import {
  postgresTool,
  remoteEnvironment,
  runPrivate,
  verifiedCertificate,
} from "./hosted-backup.mjs";

const root = resolve(import.meta.dirname, "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

// This is an explicitly authorized promotion operation, separate from the
// clone-only rollback rehearsal. Every check remains inside one transaction.
export async function buildPromotion(profile = "supabase-20261024") {
  const review = await buildUpgradeReview(root, profile);
  const migrations = readReviewedMigrations(root);
  const sql = `begin isolation level repeatable read;
set local search_path=pg_catalog,public;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('lantern-vale-upgrade-001002-008',0));
-- Keep current accounts and all pre-existing application rows unchanged.
create temporary table lantern_preserved_rows(schema_name text,table_name text,payload jsonb) on commit drop;
revoke all on lantern_preserved_rows from public,anon,authenticated,service_role;
create temporary table lantern_preserved_tables on commit drop as select schemaname,tablename from pg_tables where schemaname in ('public','auth');
revoke all on lantern_preserved_tables from public,anon,authenticated,service_role;
do $snapshot$ declare saved_table record; begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    raise exception 'Migration history already exists; review before changing it';
  end if;
  for saved_table in select schemaname,tablename from pg_temp.lantern_preserved_tables order by schemaname,tablename loop
    -- The provider owns Auth tables. Read them consistently without requesting
    -- write locks or changing provider privileges; migrations only alter public.
    execute format('lock table %I.%I in %s mode nowait',saved_table.schemaname,saved_table.tablename,
      case when saved_table.schemaname='auth' then 'access share' else 'share row exclusive' end);
    execute format('insert into pg_temp.lantern_preserved_rows select %L,%L,to_jsonb(r) from %I.%I r',saved_table.schemaname,saved_table.tablename,saved_table.schemaname,saved_table.tablename);
  end loop;
  if (${schemaFingerprintSql}) is distinct from '${review.manifest.baselineSchema}' then
    raise exception 'Working schema differs from the reviewed baseline';
  end if;
end $snapshot$;
${migrations
  .slice(2)
  .map((m) => `-- ${m.file}: ${m.sha256}\n${m.sql}`)
  .join("\n")}
do $preserved$ declare saved_table record; changed boolean; projection text; begin
  if (${schemaFingerprintSql}) is distinct from '${review.manifest.upgradedSchema}' then
    raise exception 'Upgraded schema or permissions differ from review';
  end if;
  for saved_table in select schemaname as schema_name,tablename as table_name from pg_temp.lantern_preserved_tables loop
    projection := case when saved_table.schema_name='public' and saved_table.table_name='game_rounds' then 'to_jsonb(r)-''economy_version''' else 'to_jsonb(r)' end;
    execute format('select exists((select payload from pg_temp.lantern_preserved_rows where schema_name=%L and table_name=%L except all select %s from %I.%I r) union all (select %s from %I.%I r except all select payload from pg_temp.lantern_preserved_rows where schema_name=%L and table_name=%L))',saved_table.schema_name,saved_table.table_name,projection,saved_table.schema_name,saved_table.table_name,projection,saved_table.schema_name,saved_table.table_name,saved_table.schema_name,saved_table.table_name) into changed;
    if changed then raise exception 'Pre-existing account or application rows changed'; end if;
  end loop;
  if exists(select 1 from public.game_rounds where economy_version<>'legacy') then
    raise exception 'Existing rounds changed economy classification';
  end if;
end $preserved$;
-- The first two were applied previously through the dashboard. The exact
-- baseline was verified above; register all eight reviewed sources atomically.
create schema if not exists supabase_migrations;
revoke all on schema supabase_migrations from public,anon,authenticated;
create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
revoke all on supabase_migrations.schema_migrations from public,anon,authenticated;
${migrations
  .map((m) => {
    const [version, ...name] = m.file.replace(/\.sql$/, "").split("_");
    return `insert into supabase_migrations.schema_migrations(version,statements,name) values(${literal(version)},array[${literal(m.sql)}],${literal(name.join("_"))});`;
  })
  .join("\n")}
commit;
select json_build_object('schema',(${schemaFingerprintSql}),'migrations',(select count(*) from supabase_migrations.schema_migrations),'status','COMMITTED');
`;
  return {
    sql,
    manifest: {
      ...review.manifest,
      purpose: "authorized-working-database-promotion",
      defaultOutcome: "COMMIT_AFTER_ALL_CHECKS",
      sqlSha256: hash(sql),
    },
  };
}

async function main() {
  const [mode, checkpointArgument] = process.argv.slice(2);
  if (
    !["--review", "--apply"].includes(mode) ||
    !checkpointArgument ||
    process.argv.length !== 4
  )
    throw new Error(
      "Expected --review or --apply followed by a verified checkpoint directory.",
    );
  const checkpoint = realpathSync(resolve(checkpointArgument));
  if (
    dirname(checkpoint) !==
    realpathSync(resolve(root, "test-results/hosted-backup"))
  )
    throw new Error("Unexpected checkpoint directory.");
  const backup = JSON.parse(
    readFileSync(resolve(checkpoint, "manifest.json"), "utf8"),
  );
  const retained = JSON.parse(
    readFileSync(resolve(checkpoint, "offsite.json"), "utf8"),
  );
  if (
    backup.sourceProject !== "frbbhbkwtgqczdjfhedi" ||
    retained.status !== "PASS" ||
    retained.sourceProject !== backup.sourceProject ||
    Date.now() - Date.parse(backup.checkedAt) > 3_600_000
  )
    throw new Error("A fresh verified off-host checkpoint is required.");
  const rehearsals = readdirSync(checkpoint).filter((n) =>
    n.startsWith("rehearsal-"),
  );
  const restorePassed = rehearsals.some((name) => {
    try {
      return (
        JSON.parse(
          readFileSync(
            resolve(checkpoint, name, "restore-report.json"),
            "utf8",
          ),
        ).status === "PASS"
      );
    } catch {
      return false;
    }
  });
  if (!restorePassed)
    throw new Error(
      "The checkpoint must pass the native restore/upgrade rehearsal.",
    );
  const promotion = await buildPromotion();
  const base = resolve(root, "test-results/database-upgrade");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(resolve(base, "promotion-"));
  writeFileSync(resolve(directory, "promotion.sql"), promotion.sql, {
    flag: "wx",
  });
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify(promotion.manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  if (mode === "--review") {
    console.log(`Prepared guarded promotion: ${directory}`);
    return;
  }
  const app = parseEnv(
    readFileSync(resolve(root, "apps/web/.env.local"), "utf8"),
  );
  if (
    app.NEXT_PUBLIC_SUPABASE_URL !==
      "https://frbbhbkwtgqczdjfhedi.supabase.co" ||
    app.REWARDS_ENABLED === "true"
  )
    throw new Error("Unexpected working service or rewards enabled.");
  const settings = parseEnv(
    readFileSync(resolve(root, ".env.supabase-admin"), "utf8"),
  );
  const env = remoteEnvironment(
    settings.SUPABASE_DB_PASSWORD,
    verifiedCertificate(),
  );
  env.PGAPPNAME = "lantern-vale-authorized-schema-promotion";
  env.PGOPTIONS = "-c statement_timeout=120000 -c lock_timeout=3000";
  try {
    const result = await runPrivate(
      postgresTool("psql"),
      [
        "-X",
        "--no-password",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=sqlstate",
        "-v",
        "SHOW_CONTEXT=never",
        "-f",
        "-",
      ],
      { env, input: Buffer.from(promotion.sql) },
    );
    const lines = result.toString().trim().split(/\r?\n/).filter(Boolean);
    const verified = JSON.parse(lines.at(-1));
    if (
      verified.status !== "COMMITTED" ||
      verified.migrations !== 8 ||
      verified.schema !== promotion.manifest.upgradedSchema
    )
      throw new Error("Promotion result uncertain; inspect before retrying.");
    writeFileSync(
      resolve(directory, "result.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          sourceProject: backup.sourceProject,
          checkpoint,
          ...verified,
          status: "PASS",
          databaseOutcome: verified.status,
          limits: "No paid-play activation or Auth disaster-recovery claim",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(
      `PASS: working migrations 001-008 registered; existing account and application rows preserved. ${directory}`,
    );
  } finally {
    env.PGPASSWORD = "";
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      "BLOCKED: promotion stopped; verify database state before retrying. Private details suppressed.",
    );
    if (error.diagnostics) console.error(JSON.stringify(error.diagnostics));
    process.exitCode = 1;
  });
