import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const toolDirectory = resolve(
  root,
  ".tools/postgresql-17.11/runtime/pgsql/bin",
);
const maxBytes = 256 * 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Child output can contain Auth records, SQL or connection details. Never
// forward it to the terminal. Passwords travel only in the child environment.
export function runPrivate(
  executable,
  args,
  { env, input, limit = maxBytes, quiet = false } = {},
) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      stdio: quiet ? "ignore" : ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let length = 0;
    let hadStderr = false;
    const sqlStates = new Set();
    const sqlLines = new Set();
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
    }, 180_000);
    child.stdout?.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        failed = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      hadStderr = true;
      for (const match of chunk
        .toString()
        .matchAll(/(?:ERROR|FATAL|WARNING):\s+([0-9A-Z]{5})\b/g))
        sqlStates.add(match[1]);
      for (const match of chunk.toString().matchAll(/psql:<stdin>:(\d+):/g))
        sqlLines.add(Number(match[1]));
    });
    child.on("error", () => {
      failed = true;
    });
    child.stdin?.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0 || hadStderr) {
        for (const chunk of chunks) chunk.fill(0);
        const error = new Error(
          "Private database command failed; output suppressed.",
        );
        error.diagnostics = {
          exitCode: code,
          sqlStates: [...sqlStates],
          sqlLines: [...sqlLines],
          hadStderr,
        };
        reject(error);
      } else resolveResult(Buffer.concat(chunks));
    });
    child.stdin?.end(input);
  });
}

export const postgresTool = (name) => resolve(toolDirectory, `${name}.exe`);

export function verifiedCertificate() {
  const file = resolve(root, ".tools/postgresql-17.11/supabase-ca.crt");
  if (
    sha256(readFileSync(file)) !==
    "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
  )
    throw new Error("The reviewed Supabase CA certificate changed.");
  return file;
}

export async function protectArchive(bytes, mode = "Protect") {
  if (process.platform !== "win32" || !["Protect", "Unprotect"].includes(mode))
    throw new Error("Backup protection requires Windows and an explicit mode.");
  return runPrivate(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      resolve(root, "scripts/protect-backup.ps1"),
      "-Mode",
      mode,
    ],
    { input: bytes },
  );
}

export function remoteEnvironment(password, certificateFile) {
  if (!password || /[\r\n\0]/.test(password))
    throw new Error("The saved database password is empty or invalid.");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith("PG"),
    ),
  );
  return {
    ...env,
    // Observed in Lantern Vale Sepolia's Connect > Session pooler panel.
    PGHOST: "aws-0-eu-west-2.pooler.supabase.com",
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGUSER: "postgres.frbbhbkwtgqczdjfhedi",
    PGPASSWORD: password,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: certificateFile,
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "lantern-vale-readonly-backup",
    PGOPTIONS:
      "-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000",
  };
}

export async function captureArchive(env) {
  const archive = await runPrivate(
    postgresTool("pg_dump"),
    [
      "--no-password",
      "--format=custom",
      "--lock-wait-timeout=5s",
      "--serializable-deferrable",
    ],
    { env },
  );
  if (archive.subarray(0, 5).toString() !== "PGDMP") {
    archive.fill(0);
    throw new Error("PostgreSQL did not return a custom-format archive.");
  }
  return archive;
}

export async function checkArchive(bytes) {
  const toc = await runPrivate(postgresTool("pg_restore"), ["--list"], {
    input: bytes,
  });
  const entries = toc
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith(";"));
  return { entries: entries.length, tocSha256: sha256(toc) };
}

async function main() {
  if (process.argv.length !== 2)
    throw new Error(
      "This command only captures the configured account database; no restore/apply mode exists.",
    );
  const appEnv = parseEnv(
    readFileSync(resolve(root, "apps/web/.env.local"), "utf8"),
  );
  if (
    appEnv.NEXT_PUBLIC_SUPABASE_URL !==
    "https://frbbhbkwtgqczdjfhedi.supabase.co"
  )
    throw new Error(
      "Working account project changed; review the backup target.",
    );
  const adminEnv = parseEnv(
    readFileSync(resolve(root, ".env.supabase-admin"), "utf8"),
  );
  const password = adminEnv.SUPABASE_DB_PASSWORD;
  const base = resolve(root, "test-results/hosted-backup");
  mkdirSync(base, { recursive: true });
  const certificateFile = verifiedCertificate();
  const env = remoteEnvironment(password, certificateFile);
  const version = await runPrivate(
    postgresTool("psql"),
    [
      "-X",
      "--no-password",
      "-qAt",
      "--single-transaction",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "set transaction read only; select current_setting('server_version_num') || '|' || current_setting('transaction_read_only') || '|' || current_database();",
    ],
    { env, limit: 4096 },
  );
  const [serverVersion, readOnly, database] = version
    .toString()
    .trim()
    .split("|");
  if (
    !/^17\d{4}$/.test(serverVersion) ||
    readOnly !== "on" ||
    database !== "postgres"
  )
    throw new Error(
      "Database version or read-only preflight differs from the reviewed target.",
    );
  const directory = mkdtempSync(resolve(base, "capture-"));
  const artifacts = [];
  let archive;
  let roles;
  let decrypted;
  try {
    archive = await captureArchive(env);
    roles = await runPrivate(
      postgresTool("pg_dumpall"),
      ["--roles-only", "--no-role-passwords", "--no-password"],
      { env },
    );
    const archiveInfo = await checkArchive(archive);
    for (const [name, bytes] of [
      ["database.dump.dpapi", archive],
      ["roles.sql.dpapi", roles],
    ]) {
      const encrypted = await protectArchive(bytes);
      writeFileSync(resolve(directory, name), encrypted, { flag: "wx" });
      decrypted = await protectArchive(
        readFileSync(resolve(directory, name)),
        "Unprotect",
      );
      if (sha256(decrypted) !== sha256(bytes))
        throw new Error("Encrypted backup read-back mismatch.");
      if (name.startsWith("database")) await checkArchive(decrypted);
      decrypted.fill(0);
      decrypted = undefined;
      artifacts.push({
        file: name,
        encryptedBytes: encrypted.length,
        encryptedSha256: sha256(encrypted),
      });
    }
    writeFileSync(
      resolve(directory, "manifest.json"),
      JSON.stringify(
        {
          format: 1,
          checkedAt: new Date().toISOString(),
          sourceProject: "frbbhbkwtgqczdjfhedi",
          serverVersion,
          status: "CAPTURED_NOT_RESTORED",
          protection:
            "Windows DPAPI CurrentUser; requires this Windows profile/machine",
          databaseReadOnly: true,
          archiveInfo,
          artifacts,
          limitations: [
            "A readable archive is not a successful database restore",
            "Roles are captured separately and contain no role passwords",
            "No Storage object files, project settings or encryption root keys are included",
            "No off-machine recovery or recovery of later writes is established",
            "No migration, hosted restore, Auth recovery or paid-release approval",
          ],
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(`PASS: encrypted archive captured and read back: ${directory}`);
    console.log(
      "BLOCKED: restore, Auth recovery and off-machine durability remain separate checks.",
    );
  } finally {
    archive?.fill(0);
    roles?.fill(0);
    decrypted?.fill(0);
    env.PGPASSWORD = "";
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "BLOCKED: hosted backup did not complete. Check private credentials, TLS, tools and database access; no raw diagnostics logged.",
    );
    process.exitCode = 1;
  });
}
