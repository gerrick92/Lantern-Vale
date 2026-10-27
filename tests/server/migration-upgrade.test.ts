import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  buildUpgradeReview,
  readReviewedMigrations,
  readHostedBaseline,
  schemaFingerprintSql,
} from "../../scripts/review-database-upgrade.mjs";

const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const round = (n: number) =>
  `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
// Synthetic local fixture identifiers; these are not chain receipt evidence.
const wallet = "0x" + "1".repeat(40);
let review: Awaited<ReturnType<typeof buildUpgradeReview>>;
let db: PGlite;

beforeAll(async () => {
  review = await buildUpgradeReview();
}, 30000);
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text not null);
    create table auth.mfa_factors(user_id uuid references auth.users(id),fixture_marker text not null);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create function auth.jwt() returns jsonb language sql stable as 'select jsonb_build_object(''aal'',current_setting(''request.jwt.claim.aal'',true))';
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into auth.users values('${user}','upgrade-one@example.invalid'),('${other}','upgrade-two@example.invalid');
    insert into auth.mfa_factors values('${user}','synthetic-factor-not-a-secret');
    set search_path=pg_catalog,public;`);
  for (const migration of readReviewedMigrations().slice(0, 2))
    await db.exec(migration.sql);
  await db.exec(`insert into profiles(user_id,display_name) values('${user}','Existing adventurer'),('${other}','Other adventurer');
    insert into contacts(user_id,label,address,is_favorite) values('${user}','Existing contact','${wallet}',true);
    insert into wallet_links(user_id,address) values('${user}','${wallet}');
    insert into wallet_challenges(user_id,address,message,nonce,expires_at,used_at) values
      ('${user}','${wallet}','Synthetic pending SIWE','pending',now()+interval '5 minutes',null),
      ('${other}','${wallet}','Synthetic used SIWE','used',now()-interval '3 days',now()-interval '4 days');
    insert into rate_limits values('${user}','fixture',now(),4);`);
  for (const [index, phase] of [
    "town",
    "victory",
    "defeat",
    "town",
  ].entries()) {
    await db.query(
      `insert into game_rounds(id,user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state,version)
      values($1,$2,$3,11155111,'synthetic-local-contract',$4,$5,'synthetic-local-block','warrior',$6,3)`,
      [
        round(index + 1),
        index === 2 ? other : user,
        wallet,
        String(index + 1),
        `synthetic-local-payment-${index + 1}`,
        { phase, hp: 120, spent: 2 },
      ],
    );
    await db.query(
      `insert into game_actions(id,round_id,version,intent,result) values($1,$2,3,'{"type":"attack"}',$3)`,
      [round(index + 11), round(index + 1), { phase, hp: 120, spent: 2 }],
    );
  }
  // Preserve a payment even when its original adventure no longer exists.
  await db.query("delete from game_rounds where id=$1", [round(4)]);
  await db.query(
    `insert into reward_claims(round_id,recipient,amount,nonce,deadline)
    values($1,$2,3000000000000000000,900719925474099312345,2000000000)`,
    [round(2), wallet],
  );
}, 30000);
afterEach(async () => {
  await db.close();
});

async function fingerprint() {
  return (await db.query<{ fingerprint: string }>(schemaFingerprintSql)).rows[0]
    .fingerprint;
}

async function snapshot() {
  const rows = await db.query<{
    name: string;
  }>(`select table_schema||'.'||table_name as name from information_schema.tables
    where table_schema in ('public','auth') and table_type='BASE TABLE' order by 1`);
  const result: Record<string, string[]> = {};
  for (const { name } of rows.rows) {
    // Names come only from this isolated fixture catalog. Keep exact JSON text,
    // including 78-digit numerics, rather than converting amounts to JS numbers.
    result[name] = (
      await db.query<{ payload: string }>(
        `select (to_jsonb(r)-'economy_version')::text as payload from ${name} r order by 1`,
      )
    ).rows.map(({ payload }) => payload);
  }
  return result;
}

// Test-only commit in an isolated in-memory instance, never an operational mode.
async function applyLocally() {
  await db.exec(review.sql.split("\nrollback;\n")[0] + "\ncommit;");
}

it("rehearses the whole upgrade and rolls back every schema and data change", async () => {
  const before = await snapshot();
  const results = await db.exec(review.sql);
  expect(results.at(-1)?.rows).toEqual([
    {
      result:
        "PASS: original 001/002 schema restored; no upgrade was committed",
    },
  ]);
  expect(await fingerprint()).toBe(review.manifest.baselineSchema);
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await db.query(
        "select to_regclass('pg_temp.lantern_upgrade_rows') as table_name",
      )
    ).rows,
  ).toEqual([{ table_name: null }]);
});

it("preserves legacy accounts, exact claim amounts, action history and replay protection after a local upgrade", async () => {
  const before = await snapshot();
  await applyLocally();
  expect(await fingerprint()).toBe(review.manifest.upgradedSchema);
  const after = await snapshot();
  for (const [table, rows] of Object.entries(before))
    expect(after[table], table).toEqual(rows);
  expect(
    (await db.query("select economy_version from game_rounds")).rows,
  ).toEqual(Array(3).fill({ economy_version: "legacy" }));
  const exported = (
    await db.query<{
      payload: {
        legacyClaims: { amountBaseUnits: string; nonce: string }[];
        adventures: { economyVersion: string }[];
      };
    }>("select export_account_data($1) as payload", [user])
  ).rows[0].payload;
  expect(exported.legacyClaims[0]).toMatchObject({
    amountBaseUnits: "3000000000000000000",
    nonce: "900719925474099312345",
  });
  expect(exported.adventures).toHaveLength(2);
  expect(
    exported.adventures.every((item) => item.economyVersion === "legacy"),
  ).toBe(true);
  await expect(
    db.query(
      `insert into game_rounds(user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state)
    values($1,$2,11155111,'synthetic-local-contract','4','synthetic-local-payment-4','fixture','warrior','{}')`,
      [other, wallet],
    ),
  ).rejects.toThrow(/duplicate key/);

  await db.exec(
    `set request.jwt.claim.sub='${user}'; set request.jwt.claim.aal='aal2'; set role authenticated;`,
  );
  expect((await db.query("select display_name from profiles")).rows).toEqual([
    { display_name: "Existing adventurer" },
  ]);
  expect((await db.query("select id from game_rounds")).rows).toHaveLength(2);
  await expect(
    db.query("select export_account_data($1)", [other]),
  ).rejects.toThrow(/permission denied/);
  await expect(db.query("select * from payment_receipts")).rejects.toThrow(
    /permission denied/,
  );
  await db.exec(
    "reset role; set request.jwt.claim.aal='aal1'; set role authenticated;",
  );
  expect((await db.query("select * from profiles")).rows).toEqual([]);
  expect((await db.query("select * from game_rounds")).rows).toEqual([]);
  await db.exec(
    `reset role; set request.jwt.claim.sub='${other}'; set request.jwt.claim.aal='aal2'; set role authenticated;`,
  );
  expect((await db.query("select * from wallet_links")).rows).toEqual([]);
  expect((await db.query("select id from game_rounds")).rows).toEqual([
    { id: round(3) },
  ]);
});

it("detects data loss during an upgrade and restores the original database on rollback", async () => {
  const before = await snapshot();
  const broken = review.sql.replace(
    "do $verify$",
    "delete from public.contacts;\ndo $verify$",
  );
  await expect(db.exec(broken)).rejects.toThrow(
    /Existing rows changed in contacts/,
  );
  await db.exec("rollback;");
  expect(await snapshot()).toEqual(before);
  expect(await fingerprint()).toBe(review.manifest.baselineSchema);
});

it.each([
  "alter table public.contacts add column unexpected text",
  "grant select(message) on public.wallet_challenges to authenticated",
  "grant select on public.wallet_links to authenticated with grant option",
  "alter role authenticated bypassrls",
  "drop policy profiles_owner on public.profiles",
  "alter table public.contacts alter column label drop not null",
])(
  "refuses a drifted baseline before applying migrations: %s",
  async (drift) => {
    await db.exec(drift);
    const before = await snapshot();
    const schema = await fingerprint();
    await expect(db.exec(review.sql)).rejects.toThrow(
      /Baseline schema differs/,
    );
    await db.exec("rollback;");
    expect(await fingerprint()).toBe(schema);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.query(
          "select to_regclass('public.settlement_payments') as table_name",
        )
      ).rows,
    ).toEqual([{ table_name: null }]);
  },
);

it("preserves the reviewed Supabase RLS helper and rejects helper or trigger drift", async () => {
  const hosted = await buildUpgradeReview(process.cwd(), "supabase-20261024");
  await db.exec(readHostedBaseline());
  const before = await snapshot();
  expect(await fingerprint()).toBe(hosted.manifest.baselineSchema);
  await db.exec(hosted.sql);
  expect(await snapshot()).toEqual(before);
  expect(await fingerprint()).toBe(hosted.manifest.baselineSchema);
  for (const drift of [
    "alter event trigger ensure_rls disable",
    "alter function public.rls_auto_enable() security invoker",
    "grant execute on function public.rls_auto_enable() to authenticated with grant option",
  ]) {
    await db.exec("begin;" + drift);
    expect(await fingerprint()).not.toBe(hosted.manifest.baselineSchema);
    await db.exec("rollback;");
  }
  await db.exec("set role authenticated");
  await expect(db.query("select public.rls_auto_enable()")).rejects.toThrow(
    /only be called as triggers/,
  );
  await db.exec("reset role");
}, 30000);

it("refuses partially applied or already applied upgrades without touching existing data", async () => {
  await db.exec(readReviewedMigrations()[2].sql);
  const before = await snapshot();
  await expect(db.exec(review.sql)).rejects.toThrow(/Baseline schema differs/);
  await db.exec("rollback;");
  expect(await snapshot()).toEqual(before);
  for (const migration of readReviewedMigrations().slice(3))
    await db.exec(migration.sql);
  const upgraded = await snapshot();
  await expect(db.exec(review.sql)).rejects.toThrow(/Baseline schema differs/);
  await db.exec("rollback;");
  expect(await snapshot()).toEqual(upgraded);
});

it("rejects changed applied SQL and an unreviewed migration set", () => {
  const base = resolve("test-results/database-upgrade");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(resolve(base, "source-guard-"));
  const directory = resolve(root, "supabase/migrations");
  mkdirSync(directory, { recursive: true });
  copyFileSync(
    "supabase/applied-migrations.json",
    resolve(root, "supabase/applied-migrations.json"),
  );
  const migrations = readReviewedMigrations();
  for (const item of migrations)
    writeFileSync(resolve(directory, item.file), item.sql);
  expect(readReviewedMigrations(root)).toHaveLength(8);
  const file = resolve(directory, migrations[2].file);
  writeFileSync(file, readFileSync(file, "utf8") + "\n-- Unreviewed edit\n");
  expect(() => readReviewedMigrations(root)).toThrow(
    /Applied migration changed/,
  );
  writeFileSync(file, migrations[2].sql);
  writeFileSync(resolve(directory, "202610250007_unreviewed.sql"), "select 1;");
  expect(() => readReviewedMigrations(root)).toThrow(/Migration set changed/);
});
