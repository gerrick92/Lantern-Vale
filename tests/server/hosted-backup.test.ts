import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  captureArchive,
  checkArchive,
  postgresTool,
  protectArchive,
  remoteEnvironment,
  runPrivate,
} from "../../scripts/hosted-backup.mjs";
import {
  readReviewedMigrations,
  schemaFingerprintSql,
} from "../../scripts/review-database-upgrade.mjs";
import { inspectContent } from "../../scripts/verify-package.mjs";

it("pins the remote target, verified TLS and read-only backup options", () => {
  const env = remoteEnvironment("synthetic-password", "fixture-ca.pem");
  expect(env.PGHOST).toBe("aws-0-eu-west-2.pooler.supabase.com");
  expect(env.PGUSER).toBe("postgres.frbbhbkwtgqczdjfhedi");
  expect(env.PGSSLMODE).toBe("verify-full");
  expect(env.PGOPTIONS).toContain("default_transaction_read_only=on");
  for (const invalid of ["", "line\nbreak", "nul\0byte"])
    expect(() => remoteEnvironment(invalid, "fixture-ca.pem")).toThrow();
});

it("suppresses child diagnostics and rejects oversized results", async () => {
  await expect(
    runPrivate(process.execPath, [
      "-e",
      "process.stderr.write('synthetic-secret'); process.exit(1)",
    ]),
  ).rejects.toThrow("Private database command failed; output suppressed.");
  await expect(
    runPrivate(process.execPath, ["-e", "process.stdout.write('too large')"], {
      limit: 2,
    }),
  ).rejects.toThrow("Private database command failed; output suppressed.");
});

describe.runIf(
  process.platform === "win32" && existsSync(postgresTool("initdb")),
)("native local backup rehearsal", () => {
  let folder: string;
  let env: NodeJS.ProcessEnv;
  let started = false;
  let archive: Buffer;
  const query = async (sql: string, database = "postgres") =>
    (
      await runPrivate(
        postgresTool("psql"),
        [
          "-X",
          "--no-password",
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
          "--dbname",
          database,
        ],
        { env, input: Buffer.from(sql) },
      )
    )
      .toString()
      .trim();

  beforeAll(async () => {
    mkdirSync("test-results/native-backup", { recursive: true });
    folder = mkdtempSync(resolve("test-results/native-backup/fixture-"));
    const password = randomBytes(24).toString("hex");
    const passwordFile = resolve(folder, "fixture-password.txt");
    writeFileSync(passwordFile, password, { flag: "wx" });
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((done, reject) =>
      probe.close((err) => (err ? reject(err) : done())),
    );
    env = {
      ...process.env,
      PGHOST: "127.0.0.1",
      PGPORT: String(port),
      PGDATABASE: "postgres",
      PGUSER: "fixture_admin",
      PGPASSWORD: password,
      PGSSLMODE: "disable",
      PGOPTIONS: "",
    };
    await runPrivate(
      postgresTool("initdb"),
      [
        "-D",
        resolve(folder, "cluster"),
        "-U",
        "fixture_admin",
        "--pwfile",
        passwordFile,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--no-locale",
      ],
      { env },
    );
    started = true;
    await runPrivate(
      postgresTool("pg_ctl"),
      [
        "-D",
        resolve(folder, "cluster"),
        "-l",
        resolve(folder, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port}`,
        "-w",
        "-t",
        "20",
        "start",
      ],
      { env, quiet: true },
    );
    await query(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select null::uuid';
      create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const migration of readReviewedMigrations().slice(0, 2))
      await query(migration.sql);
    await query(`insert into auth.users values('00000000-0000-4000-8000-000000000001');
      insert into public.profiles(user_id,display_name) values('00000000-0000-4000-8000-000000000001','Restore fixture');`);
    archive = await captureArchive({
      ...env,
      PGOPTIONS: "-c default_transaction_read_only=on",
    });
  }, 60000);

  afterAll(async () => {
    archive?.fill(0);
    if (started)
      await runPrivate(
        postgresTool("pg_ctl"),
        ["-D", resolve(folder, "cluster"), "-m", "fast", "-w", "stop"],
        { env, quiet: true },
      );
  }, 30000);

  it("encrypts a native dump, rejects package inclusion and rejects tampering", async () => {
    const protectedBytes = await protectArchive(archive);
    expect(protectedBytes.includes(Buffer.from("Restore fixture"))).toBe(false);
    for (const bytes of [archive, protectedBytes])
      expect(() => inspectContent("docs/renamed.png", bytes)).toThrow(
        "Database backup content is forbidden in a review package",
      );
    const saved = resolve(folder, "synthetic.dump.dpapi");
    writeFileSync(saved, protectedBytes, { flag: "wx" });
    const restored = await protectArchive(readFileSync(saved), "Unprotect");
    expect(restored.equals(archive)).toBe(true);
    expect((await checkArchive(restored)).entries).toBeGreaterThan(20);
    restored.fill(0);
    protectedBytes[protectedBytes.length - 10] ^= 1;
    await expect(protectArchive(protectedBytes, "Unprotect")).rejects.toThrow();
  }, 15000);

  it("restores a fresh local database with matching data and security definitions", async () => {
    await query("create database restored");
    await runPrivate(
      postgresTool("pg_restore"),
      [
        "--no-password",
        "--exit-on-error",
        "--single-transaction",
        "--dbname=restored",
      ],
      { env, input: archive },
    );
    expect(
      await query("select display_name from public.profiles", "restored"),
    ).toBe("Restore fixture");
    expect(
      await query(
        "set search_path=pg_catalog,public;" + schemaFingerprintSql,
        "restored",
      ),
    ).toBe(
      await query("set search_path=pg_catalog,public;" + schemaFingerprintSql),
    );
    await expect(
      query("set role anon; select * from public.profiles;", "restored"),
    ).rejects.toThrow();
    await expect(
      query("create table public.forbidden(id int)", "missing_database"),
    ).rejects.toThrow();
  }, 20000);
});
