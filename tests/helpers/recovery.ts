import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// Local synthetic-data rehearsal only. This is not a Supabase backup client.
const root = resolve("test-results/recovery");
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export type Checkpoint = { directory: string; digest: string };

function sourceDigest() {
  const files: string[] = ["package-lock.json"];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(sql|ts)$/.test(path)) files.push(path);
    }
  }
  for (const directory of [
    "supabase/migrations",
    "game/rules",
    "apps/web/src/server",
    "apps/web/src/lib",
    "apps/web/src/app/api",
  ])
    visit(directory);
  return hash(
    JSON.stringify(
      files.sort().map((file) => [file, hash(readFileSync(file))]),
    ),
  );
}

async function inventory(sql: PGlite) {
  return sql.transaction(async (tx) => {
    await tx.exec("set transaction isolation level repeatable read, read only");
    const auth = await tx.query<{ table_name: string; column_name: string }>(
      "select table_name,column_name from information_schema.columns where table_schema='auth' order by table_name,ordinal_position",
    );
    if (
      JSON.stringify(auth.rows) !==
      JSON.stringify([{ table_name: "users", column_name: "id" }])
    )
      throw new Error(
        "Recovery rehearsal accepts only the synthetic Auth schema.",
      );
    const passwords = await tx.query(
      "select 1 from pg_authid where rolpassword is not null",
    );
    if (passwords.rows.length)
      throw new Error(
        "Credential-bearing databases are not rehearsal fixtures.",
      );

    const tables = await tx.query<{ schemaname: string; tablename: string }>(
      "select schemaname,tablename from pg_tables where schemaname in ('auth','public') order by schemaname,tablename",
    );
    const contents: Record<string, { count: number; sha256: string }> = {};
    for (const { schemaname, tablename } of tables.rows) {
      if (!/^[a-z_]+$/.test(schemaname) || !/^[a-z_]+$/.test(tablename))
        throw new Error("Unexpected fixture SQL identifier.");
      // Keep numeric values as PostgreSQL text: deposits exceed JS safe integers.
      const { rows } = await tx.query<{ row: string }>(
        `select to_jsonb(t)::text as row from "${schemaname}"."${tablename}" t order by to_jsonb(t)::text`,
      );
      contents[`${schemaname}.${tablename}`] = {
        count: rows.length,
        sha256: hash(JSON.stringify(rows.map(({ row }) => row))),
      };
    }
    const definitions = [
      "select table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema in ('auth','public')",
      "select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public')",
      "select n.nspname,c.conname,pg_get_constraintdef(c.oid) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('auth','public')",
      "select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('auth','public')",
      "select * from pg_policies where schemaname in ('auth','public')",
      "select n.nspname,p.proname,pg_get_functiondef(p.oid),p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public') and p.prokind='f'",
      "select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public')",
      "select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls from pg_roles",
    ];
    const schema: string[][] = [];
    for (const query of definitions) {
      const { rows } = await tx.query<{ row: string }>(
        `select to_jsonb(d)::text as row from (${query}) d order by to_jsonb(d)::text`,
      );
      schema.push(rows.map(({ row }) => row));
    }
    return { contents, schema: hash(JSON.stringify(schema)) };
  });
}

export async function captureCheckpoint(sql: PGlite, label: string) {
  // The caller must pause writes. Before/after inventories detect changes but are not a write lock.
  if (!/^[a-z0-9-]{1,80}$/.test(label))
    throw new Error("Invalid checkpoint label.");
  const source = sourceDigest();
  const before = await inventory(sql);
  const archive = Buffer.from(
    await (await sql.dumpDataDir("gzip")).arrayBuffer(),
  );
  if (
    JSON.stringify(await inventory(sql)) !== JSON.stringify(before) ||
    sourceDigest() !== source
  )
    throw new Error("Fixture changed during capture; pause writes and retry.");
  const manifest = JSON.stringify({
    format: 1,
    purpose: "synthetic-local-recovery",
    createdAt: new Date().toISOString(),
    source,
    archiveSha256: hash(archive),
    inventory: before,
  });
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, `${label}-`));
  writeFileSync(join(directory, "database.tar.gz"), archive, { flag: "wx" });
  writeFileSync(join(directory, "manifest.json"), manifest, { flag: "wx" });
  // Keep this expected digest separately. A manifest cannot establish its own freshness.
  return { directory, digest: hash(manifest) } satisfies Checkpoint;
}

function readBounded(directory: string, file: string, limit: number) {
  const path = join(directory, file);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw new Error("Invalid recovery artifact.");
  return readFileSync(path);
}

export async function restoreCheckpoint(checkpoint: Checkpoint) {
  const directory = realpathSync(checkpoint.directory);
  const within = relative(realpathSync(root), directory);
  if (!within || within.startsWith("..") || isAbsolute(within))
    throw new Error("Restore accepts only local rehearsal artifacts.");
  const bytes = readBounded(directory, "manifest.json", 2 * 1024 * 1024);
  if (
    !/^[0-9a-f]{64}$/.test(checkpoint.digest) ||
    hash(bytes) !== checkpoint.digest
  )
    throw new Error(
      "Checkpoint does not match the independently expected digest.",
    );
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (
    manifest.format !== 1 ||
    manifest.purpose !== "synthetic-local-recovery" ||
    manifest.source !== sourceDigest()
  )
    throw new Error("Recovery format or source fingerprint mismatch.");
  const archive = readBounded(directory, "database.tar.gz", 64 * 1024 * 1024);
  if (hash(archive) !== manifest.archiveSha256)
    throw new Error("Recovery archive integrity check failed.");
  // Always open a fresh in-memory instance. No live destination or overwrite option exists.
  const sql = new PGlite({ loadDataDir: new Blob([new Uint8Array(archive)]) });
  try {
    if (
      JSON.stringify(await inventory(sql)) !==
      JSON.stringify(manifest.inventory)
    )
      throw new Error(
        "Restored records or security definitions differ from the checkpoint.",
      );
    return sql;
  } catch (error) {
    await sql.close();
    throw error;
  }
}
