import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:net";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  captureArchive,
  postgresTool,
  verifiedCertificate,
  protectArchive,
  remoteEnvironment,
  runPrivate,
} from "./hosted-backup.mjs";
import {
  buildUpgradeReview,
  readReviewedMigrations,
  schemaDefinitionsSql,
  schemaFingerprintSql,
} from "./review-database-upgrade.mjs";

// Restore only to a newly initialized, loopback-only local cluster. There is
// deliberately no remote restore target or production migration command.
const root = resolve(import.meta.dirname, "..");
const privateRoot = resolve(root, ".tools/private");
const sourceProject = "frbbhbkwtgqczdjfhedi";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let phase = "validate backup";
let folder;
let localEnv;
let started = false;
let archive;
let roles;
let protectedSnapshot;
let evidenceDirectory;
const report = {
  checkedAt: new Date().toISOString(),
  checks: [],
  boundaries: [
    "Restores public and auth schemas with original ownership, grants and roles into local PostgreSQL",
    "Does not restore Supabase platform extensions, Storage files, project settings or encryption root keys",
    "Does not establish a working hosted Auth service, portable disaster recovery or recovery of later writes",
    "Never connects a restore or migration command to the hosted source",
  ],
};
const record = (name, pass) => {
  report.checks.push({ name, status: pass ? "PASS" : "FAIL" });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}`);
};
const query = async (sql, env) =>
  (
    await runPrivate(
      postgresTool("psql"),
      [
        "-X",
        "--no-password",
        "-qAt",
        "-f",
        "-",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=sqlstate",
        "-v",
        "SHOW_CONTEXT=never",
      ],
      { env, input: Buffer.from(sql) },
    )
  )
    .toString()
    .trim();

async function inventory(env) {
  const names = JSON.parse(
    await query(
      `begin read only;
    select coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename) order by schemaname,tablename),'[]'::json)
    from pg_tables where schemaname in ('public','auth','supabase_migrations'); commit;`,
      env,
    ),
  );
  const statements = names.map(({ schema, table }) => {
    if (
      !["public", "auth", "supabase_migrations"].includes(schema) ||
      !/^[a-z_][a-z_0-9]*$/.test(table)
    )
      throw new Error("Unexpected table identifier");
    return `select json_build_object('schema','${schema}','table','${table}','rows',count(*)::text,
      'sha256',encode(sha256(convert_to(coalesce(string_agg(row_hash,'' order by row_hash),''),'UTF8')),'hex'))
      from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') row_hash from ${schema}.${table} t) rows;`;
  });
  const result = await query(
    `begin isolation level repeatable read read only; set local timezone='UTC';
    ${statements.join("\n")} commit;`,
    env,
  );
  return result
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  if (process.platform !== "win32" || process.argv.length !== 3)
    throw new Error("Expected one reviewed backup directory on Windows");
  const directory = realpathSync(resolve(process.argv[2]));
  if (
    dirname(directory) !==
      realpathSync(resolve(root, "test-results/hosted-backup")) ||
    !basename(directory).startsWith("capture-")
  )
    throw new Error("Backup directory outside the reviewed workspace");
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  );
  evidenceDirectory = mkdtempSync(resolve(directory, "rehearsal-"));
  if (
    manifest.format !== 1 ||
    manifest.sourceProject !== sourceProject ||
    manifest.status !== "CAPTURED_NOT_RESTORED"
  )
    throw new Error("Unexpected backup manifest");
  await runPrivate("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-File",
    resolve(root, "scripts/protect-backup.ps1"),
    "-Mode",
    "VerifyPrivateDirectory",
  ]);
  for (const name of ["database.dump.dpapi", "roles.sql.dpapi"]) {
    const bytes = readFileSync(resolve(directory, name));
    if (
      sha256(bytes) !==
      manifest.artifacts.find((item) => item.file === name)?.encryptedSha256
    )
      throw new Error("Backup hash mismatch");
    const plain = await protectArchive(bytes, "Unprotect");
    if (name.startsWith("database")) archive = plain;
    else roles = plain;
  }
  record("encrypted backup hashes and decryption", true);
  phase = "initialize isolated local cluster";
  folder = mkdtempSync(resolve(privateRoot, "restore-"));
  const password = randomBytes(32).toString("hex");
  const passwordFile = resolve(folder, "local-password.txt");
  writeFileSync(passwordFile, password, { flag: "wx" });
  const probe = createServer();
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise((done, reject) =>
    probe.close((err) => (err ? reject(err) : done())),
  );
  localEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.toUpperCase().startsWith("PG"),
      ),
    ),
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGDATABASE: "postgres",
    PGUSER: "supabase_admin",
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
      "supabase_admin",
      "--pwfile",
      passwordFile,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--no-locale",
    ],
    { env: localEnv },
  );
  started = true;
  await runPrivate(
    postgresTool("pg_ctl"),
    [
      "-D",
      resolve(folder, "cluster"),
      "-l",
      resolve(folder, "private-server.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -c log_min_error_statement=panic -c log_error_verbosity=terse`,
      "-w",
      "start",
    ],
    { env: localEnv, quiet: true },
  );
  phase = "restore roles";
  // Preserve the source bootstrap grantor. initdb already created this exact
  // role; replay its attributes and every grant without recreating it.
  const rolesSql = roles.toString("utf8");
  if ((rolesSql.match(/^CREATE ROLE supabase_admin;$/gm) || []).length !== 1)
    throw new Error("Unexpected source bootstrap role");
  await query(
    rolesSql.replace(/^CREATE ROLE supabase_admin;\r?\n/m, ""),
    localEnv,
  );
  // pg_database_owner resolves through the database owner, not the login used
  // by initdb. The inspected source database is owned by postgres.
  await query("alter database postgres owner to postgres;", localEnv);
  phase = "restore public and auth schemas";
  const toc = (
    await runPrivate(postgresTool("pg_restore"), ["--list"], { input: archive })
  ).toString();
  const schemaEntries = toc
    .split(/\r?\n/)
    .filter((line) =>
      /\b(?:SCHEMA - (?:auth|public|supabase_migrations) |(?:ACL|COMMENT|SECURITY LABEL) - SCHEMA (?:auth|public|supabase_migrations) )/.test(
        line,
      ),
    );
  if (!schemaEntries.some((line) => /SCHEMA - auth /.test(line)))
    throw new Error("Auth schema definition missing");
  const schemaList = resolve(folder, "schema-entries.list");
  writeFileSync(schemaList, schemaEntries.join("\n") + "\n", { flag: "wx" });
  const schemaSql = await runPrivate(
    postgresTool("pg_restore"),
    ["--file=-", "--use-list", schemaList],
    { input: archive },
  );
  try {
    await query(schemaSql.toString("utf8"), localEnv);
  } finally {
    schemaSql.fill(0);
  }
  const restoreSql = await runPrivate(
    postgresTool("pg_restore"),
    [
      "--file=-",
      "--schema=public",
      "--schema=auth",
      "--schema=supabase_migrations",
    ],
    { input: archive },
  );
  try {
    await query(`begin;\n${restoreSql.toString("utf8")}\ncommit;`, localEnv);
  } finally {
    restoreSql.fill(0);
  }
  // Schema-filtered pg_restore omits global event triggers. Restore the exact
  // reviewed app trigger from the archive, including its original ownership.
  phase = "restore reviewed RLS event trigger";
  const eventEntries = toc
    .split(/\r?\n/)
    .filter((line) =>
      /\b(?:EVENT TRIGGER - ensure_rls |(?:COMMENT|SECURITY LABEL) - EVENT TRIGGER ensure_rls )/.test(
        line,
      ),
    );
  if (
    eventEntries.filter((line) => /EVENT TRIGGER - ensure_rls /.test(line))
      .length !== 1
  )
    throw new Error("Reviewed RLS event trigger missing from backup");
  const eventList = resolve(folder, "event-entries.list");
  writeFileSync(eventList, eventEntries.join("\n") + "\n", { flag: "wx" });
  const eventSql = await runPrivate(
    postgresTool("pg_restore"),
    ["--file=-", "--use-list", eventList],
    { input: archive },
  );
  // Supabase permits its postgres role to own event triggers without being a
  // native superuser. Native PostgreSQL requires that attribute at assignment.
  // Grant it only inside this isolated transaction and remove it before commit.
  if (!/^ALTER ROLE postgres WITH NOSUPERUSER /m.test(rolesSql))
    throw new Error("Unexpected source postgres role attributes");
  try {
    await query(
      `begin; alter role postgres superuser;\n${eventSql.toString("utf8")}\nalter role postgres nosuperuser; commit;`,
      localEnv,
    );
  } finally {
    eventSql.fill(0);
  }
  record(
    "account and application schemas restored with ownership and grants",
    true,
  );
  phase = "compare source records and permissions";
  const admin = parseEnv(
    readFileSync(resolve(root, ".env.supabase-admin"), "utf8"),
  );
  const remoteEnv = remoteEnvironment(
    admin.SUPABASE_DB_PASSWORD,
    verifiedCertificate(),
  );
  const contextSql = `begin read only; select json_build_object(
    'databaseOwner',(select r.rolname from pg_database d join pg_roles r on r.oid=d.datdba where d.datname=current_database()),
    'publicOwner',(select r.rolname from pg_namespace n join pg_roles r on r.oid=n.nspowner where n.nspname='public'),
    'postgresCanCreate',has_schema_privilege('postgres','public','CREATE'));
    commit;`;
  const localContext = await query(contextSql, localEnv);
  const sourceContext = await query(contextSql, remoteEnv);
  record(
    "restored database ownership and migration-role context match source",
    localContext === sourceContext,
  );
  if (localContext !== sourceContext)
    throw new Error("Migration role context changed");
  const localInventory = await inventory(localEnv);
  const sourceInventory = await inventory(remoteEnv);
  record(
    "restored public/auth rows match current hosted source",
    JSON.stringify(localInventory) === JSON.stringify(sourceInventory),
  );
  // These comparisons contain only schema definitions or one-way digests.
  // Row values, passwords, factors and sessions never leave child memory.
  const schemaCheckSql = `begin read only; set local search_path=pg_catalog,public; ${schemaFingerprintSql}; commit;`;
  const localSchema = await query(schemaCheckSql, localEnv);
  const sourceSchema = await query(schemaCheckSql, remoteEnv);
  record(
    "restored application schema and effective privileges match source",
    localSchema === sourceSchema,
  );
  if (localSchema !== sourceSchema) {
    const definitionsSql = `begin read only; set local search_path=pg_catalog,public;
      select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) ${schemaFingerprintSql.slice(schemaFingerprintSql.indexOf("from ("))}; commit;`;
    const restoredDefinitions = JSON.parse(
      await query(definitionsSql, localEnv),
    );
    const sourceDefinitions = JSON.parse(
      await query(definitionsSql, remoteEnv),
    );
    report.schemaDifferences = {
      sourceOnly: sourceDefinitions.filter(
        (item) =>
          !restoredDefinitions.some(
            (other) => JSON.stringify(other) === JSON.stringify(item),
          ),
      ),
      restoredOnly: restoredDefinitions.filter(
        (item) =>
          !sourceDefinitions.some(
            (other) => JSON.stringify(other) === JSON.stringify(item),
          ),
      ),
    };
    console.log(
      JSON.stringify({
        sourceDifferenceKinds: report.schemaDifferences.sourceOnly.map(
          (item) => ({
            kind: item.kind,
            name: item.name,
            table: item.table,
            role: item.role,
            privilege: item.privilege,
            column: item.column,
          }),
        ),
      }),
    );
  }
  report.tableCount = localInventory.length;
  report.sourceSchema = sourceSchema;
  report.changedTables = localInventory
    .filter(
      (item, index) =>
        JSON.stringify(item) !== JSON.stringify(sourceInventory[index]),
    )
    .map((item) => `${item.schema}.${item.table}`);
  phase = "review migration baseline";
  const review = await buildUpgradeReview(root, "supabase-20261024");
  report.upgradeReview = review.manifest;
  writeFileSync(resolve(evidenceDirectory, "upgrade-review.sql"), review.sql, {
    flag: "wx",
  });
  const baselineMatches = localSchema === review.manifest.baselineSchema;
  const promotedMatches = localSchema === review.manifest.upgradedSchema;
  record(
    "hosted schema matches the reviewed 001/002 baseline or promoted 008 schema",
    baselineMatches || promotedMatches,
  );
  if (!baselineMatches && !promotedMatches) {
    const actual = JSON.parse(
      await query(
        `begin read only;set local search_path=pg_catalog,public;${schemaDefinitionsSql};commit;`,
        localEnv,
      ),
    );
    const expected = review.baselineDefinitions;
    report.baselineDifferences = {
      actualOnly: actual.filter(
        (item) =>
          !expected.some(
            (other) => JSON.stringify(other) === JSON.stringify(item),
          ),
      ),
      expectedOnly: expected.filter(
        (item) =>
          !actual.some(
            (other) => JSON.stringify(other) === JSON.stringify(item),
          ),
      ),
    };
    console.log(
      JSON.stringify({
        baselineDifferenceKinds: report.baselineDifferences.actualOnly.map(
          (item) => ({
            kind: item.kind,
            name: item.name,
            table: item.table,
            role: item.role,
            privilege: item.privilege,
            column: item.column,
            allowed: item.allowed,
            grantable: item.grantable,
            value: item.kind === "index" ? item.value : undefined,
          }),
        ),
      }),
    );
  }
  if (promotedMatches) {
    phase = "verify restored migration history";
    const historySql = `begin read only;
      select coalesce(json_agg(json_build_object('version',version,'name',name,
        'sha256',encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex')) order by version),'[]')
      from supabase_migrations.schema_migrations; commit;`;
    const expectedHistory = readReviewedMigrations(root).map((item) => {
      const [version, ...name] = item.file.replace(/\.sql$/, "").split("_");
      return { version, name: name.join("_"), sha256: item.sha256 };
    });
    const restoredHistory = JSON.parse(await query(historySql, localEnv));
    const sourceHistory = JSON.parse(await query(historySql, remoteEnv));
    record(
      "restored migration history matches all eight immutable sources",
      JSON.stringify(restoredHistory) === JSON.stringify(expectedHistory) &&
        JSON.stringify(restoredHistory) === JSON.stringify(sourceHistory),
    );
  }
  if (
    baselineMatches &&
    localSchema === sourceSchema &&
    report.changedTables.length === 0
  ) {
    phase = "rollback-only upgrade on local clone";
    let result;
    try {
      result = await query(review.sql, localEnv);
    } catch (error) {
      // A failed psql session closes and rolls back. Inspect schema-only drift
      // in a second rollback-only local transaction, never exposing row values.
      const actual = JSON.parse(
        await query(
          review.sql.split("do $verify$")[0] +
            `\n${schemaDefinitionsSql};\nrollback;`,
          localEnv,
        ),
      );
      const expected = review.upgradedDefinitions;
      report.upgradeDifferences = {
        actualOnly: actual.filter(
          (item) =>
            !expected.some(
              (other) => JSON.stringify(other) === JSON.stringify(item),
            ),
        ),
        expectedOnly: expected.filter(
          (item) =>
            !actual.some(
              (other) => JSON.stringify(other) === JSON.stringify(item),
            ),
        ),
      };
      throw error;
    }
    record(
      "001/002 to 008 upgrade and rollback on restored local data",
      result.includes("PASS: original 001/002 schema restored"),
    );
    record(
      "upgrade rollback preserves all restored account/application records",
      JSON.stringify(await inventory(localEnv)) ===
        JSON.stringify(localInventory),
    );
  }
  // Preserve a second independent logical dump only as encrypted evidence.
  phase = "protect restored-clone evidence";
  protectedSnapshot = await captureArchive({
    ...localEnv,
    PGOPTIONS: "-c default_transaction_read_only=on",
  });
  writeFileSync(
    resolve(evidenceDirectory, "restored-account-clone.dump.dpapi"),
    await protectArchive(protectedSnapshot),
    { flag: "wx" },
  );
  if (report.checks.some((item) => item.status !== "PASS"))
    process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  report.checks.push({ name: phase, status: "BLOCKED" });
  console.error(
    `BLOCKED: ${phase}. Raw diagnostics suppressed to protect account data.`,
  );
  if (error.diagnostics) {
    report.diagnostics = error.diagnostics;
    console.log(JSON.stringify(error.diagnostics));
  }
  writeFileSync(
    resolve(root, "test-results/hosted-backup/restore-blocked.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.exitCode = 1;
} finally {
  archive?.fill(0);
  roles?.fill(0);
  protectedSnapshot?.fill(0);
  let stopped = !started;
  if (started) {
    try {
      await runPrivate(
        postgresTool("pg_ctl"),
        ["-D", resolve(folder, "cluster"), "-m", "fast", "-w", "stop"],
        { env: localEnv, quiet: true },
      );
      stopped = true;
    } catch {
      console.error("BLOCKED: local clone shutdown requires review.");
      process.exitCode = 1;
    }
  }
  if (folder && stopped) {
    const target = realpathSync(folder);
    if (
      dirname(target) !== realpathSync(privateRoot) ||
      !basename(target).startsWith("restore-")
    )
      throw new Error("Refused out-of-scope cleanup");
    rmSync(target, { recursive: true, maxRetries: 3, retryDelay: 200 });
    record("temporary local account clone removed after shutdown", true);
  }
  if (evidenceDirectory) {
    report.status = report.checks.some((item) => item.status === "BLOCKED")
      ? "BLOCKED"
      : report.checks.some((item) => item.status === "FAIL") ||
          process.exitCode === 1
        ? "FAIL"
        : "PASS";
    writeFileSync(
      resolve(evidenceDirectory, "restore-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(`Restore report: ${evidenceDirectory}`);
  }
}
