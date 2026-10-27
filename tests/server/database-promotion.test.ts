import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";
import { buildPromotion } from "../../scripts/promote-database.mjs";
import {
  readReviewedMigrations,
  schemaFingerprintSql,
} from "../../scripts/review-database-upgrade.mjs";

let plan: Awaited<ReturnType<typeof buildPromotion>>;
beforeAll(async () => {
  plan = await buildPromotion("migrations-only");
}, 30000);

async function baseline() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create table auth.mfa_factors(user_id uuid references auth.users(id),fixture text);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';
    grant usage on schema public,auth to anon,authenticated,service_role;
    set search_path=pg_catalog,public;`);
  for (const m of readReviewedMigrations().slice(0, 2)) await db.exec(m.sql);
  await db.exec(`insert into auth.users values('00000000-0000-4000-8000-000000000001','fixture@example.invalid');
    insert into auth.mfa_factors values('00000000-0000-4000-8000-000000000001','synthetic-factor');`);
  return db;
}

it("commits reviewed schema and migration history while preserving accounts", async () => {
  const db = await baseline();
  try {
    await db.exec(plan.sql);
    expect((await db.query(schemaFingerprintSql)).rows[0]).toEqual({
      fingerprint: plan.manifest.upgradedSchema,
    });
    expect(
      (
        await db.query(
          "select count(*)::int n from supabase_migrations.schema_migrations",
        )
      ).rows[0],
    ).toEqual({ n: 8 });
    expect(
      (await db.query("select fixture from auth.mfa_factors")).rows[0],
    ).toEqual({ fixture: "synthetic-factor" });
    expect(
      (
        await db.query(
          "select has_table_privilege('authenticated','supabase_migrations.schema_migrations','INSERT') allowed",
        )
      ).rows[0],
    ).toEqual({ allowed: false });
    await expect(db.exec(plan.sql)).rejects.toThrow(
      "Migration history already exists",
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
}, 30000);

it("rejects schema drift without committing a partial upgrade", async () => {
  const db = await baseline();
  try {
    await db.exec("alter table public.profiles add column unexpected text");
    await expect(db.exec(plan.sql)).rejects.toThrow(
      "differs from the reviewed baseline",
    );
    await db.exec("rollback");
    expect(
      (
        await db.query(
          "select to_regclass('public.settlement_payments') new_table",
        )
      ).rows[0],
    ).toEqual({ new_table: null });
  } finally {
    await db.close();
  }
}, 30000);

it("rolls back if existing Auth data is altered before commit", async () => {
  const db = await baseline();
  try {
    const broken = plan.sql.replace(
      "do $preserved$",
      "update auth.mfa_factors set fixture='changed';\ndo $preserved$",
    );
    await expect(db.exec(broken)).rejects.toThrow(
      "Pre-existing account or application rows changed",
    );
    await db.exec("rollback");
    expect(
      (await db.query("select fixture from auth.mfa_factors")).rows[0],
    ).toEqual({ fixture: "synthetic-factor" });
    expect(
      (
        await db.query(
          "select to_regclass('public.settlement_payments') new_table",
        )
      ).rows[0],
    ).toEqual({ new_table: null });
  } finally {
    await db.close();
  }
}, 30000);
