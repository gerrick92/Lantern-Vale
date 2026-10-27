import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { protectArchive } from "../../scripts/hosted-backup.mjs";

// This drill can only create, remove and restore its own disposable staging
// identity. It cannot target an existing user or the working project.
const project = "nisviqoxcfbtwccdjqoz";
const root = resolve(import.meta.dirname, "../..");
const env = parseEnv(
  readFileSync(resolve(root, "apps/web/.env.staging.local"), "utf8"),
);
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`);
if (process.argv.length !== 2)
  throw new Error("This staging-only drill takes no arguments.");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const client = () =>
  createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const marker = randomUUID();
const email = `recovery-${marker}@example.com`;
const password = `${randomBytes(32).toString("base64url")}!aA9`;
const tables = [
  "auth.users",
  "auth.identities",
  "auth.mfa_factors",
  "public.profiles",
];
mkdirSync(resolve(root, "test-results/auth-recovery"), { recursive: true });
const directory = mkdtempSync(
  resolve(root, "test-results/auth-recovery/hosted-"),
);
const privateDirectory = mkdtempSync(
  resolve(root, ".tools/private/auth-recovery-"),
);
let fixtureId;
let phase = "preflight";
const report = {
  status: "FAIL",
  project,
  startedAt: new Date().toISOString(),
  checks: [],
  limits: [
    "Disposable staging identity only; no existing account or factor is restored or changed.",
    "The existing hosted Auth service and provider keys are retained. This does not prove recovery after loss of an entire provider project or its keys.",
    "This fixture checkpoint does not prove durable recovery of later gameplay actions.",
  ],
};
const check = (name) => report.checks.push(name);
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function checked(result) {
  if (result.error) throw new Error("Hosted fixture operation failed.");
  return result.data;
}
async function sql(statement) {
  // Only synthetic Auth data may enter this short-lived ignored file. CLI output
  // is captured privately because it can contain password hashes and TOTP data.
  const file = resolve(privateDirectory, `${randomUUID()}.sql`);
  writeFileSync(file, statement, { flag: "wx", mode: 0o600 });
  try {
    const bytes = await new Promise((resolveOutput, reject) => {
      const child = spawn(
        resolve(
          root,
          ".tools/supabase-cli/node_modules/@supabase/cli-windows-x64/bin/supabase.exe",
        ),
        [
          "db",
          "query",
          "--linked",
          "--project-ref",
          project,
          "--file",
          file,
          "--output-format",
          "json",
        ],
        { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      const chunks = [];
      let length = 0;
      const timer = setTimeout(() => child.kill(), 60_000);
      child.stdout.on("data", (chunk) => {
        length += chunk.length;
        if (length > 2_000_000) child.kill();
        else chunks.push(chunk);
      });
      child.on("error", () =>
        reject(new Error("Private staging SQL could not start.")),
      );
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code || length > 2_000_000) {
          chunks.forEach((chunk) => chunk.fill(0));
          reject(new Error("Private staging SQL failed; output suppressed."));
        } else resolveOutput(Buffer.concat(chunks));
      });
    });
    try {
      const output = bytes.toString();
      const parsed = JSON.parse(output.slice(output.indexOf("{")));
      assert.ok(Array.isArray(parsed.rows));
      return parsed.rows;
    } finally {
      bytes.fill(0);
    }
  } finally {
    unlinkSync(file);
  }
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replaceAll("=", "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  key.fill(0);
  return String(
    (mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}
async function verifyFactor(auth, factorId, secret) {
  const challenge = checked(await auth.mfa.challenge({ factorId }));
  checked(
    await auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: totp(secret),
    }),
  );
  assert.equal(
    checked(await auth.mfa.getAuthenticatorAssuranceLevel()).currentLevel,
    "aal2",
  );
}
const filter = (table) =>
  `${table === "auth.users" ? "id" : "user_id"} = '${fixtureId}'::uuid`;
async function snapshot() {
  return (
    await sql(
      `select jsonb_build_object(${tables.map((table) => `'${table}', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${filter(table)})`).join(",")}) as snapshot`,
    )
  )[0].snapshot;
}
async function unrelatedFingerprint() {
  return (
    await sql(
      `select jsonb_build_object(${tables.map((table) => `'${table}', (select md5(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text),'')) from ${table} t where not (${filter(table)}))`).join(",")}) as hashes`,
    )
  )[0].hashes;
}
let baseline;
try {
  phase = "create disposable identity";
  fixtureId = checked(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { recovery_fixture: marker },
    }),
  ).user.id;
  assert.match(fixtureId, /^[0-9a-f-]{36}$/);
  baseline = await unrelatedFingerprint();
  const first = client();
  checked(await first.auth.signInWithPassword({ email, password }));
  const factor = checked(
    await first.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Disposable recovery drill",
    }),
  );
  const verifiedStep = Math.floor(Date.now() / 30_000);
  await verifyFactor(first.auth, factor.id, factor.totp.secret);
  checked(
    await first
      .from("profiles")
      .insert({ user_id: fixtureId, display_name: "Recovery fixture" }),
  );
  check("Fresh staging email/password and TOTP reach AAL2.");
  phase = "capture encrypted fixture checkpoint";
  let data = await snapshot();
  assert.equal(
    data["auth.users"][0].raw_user_meta_data.recovery_fixture,
    marker,
  );
  assert.equal(data["auth.mfa_factors"][0].id, factor.id);
  const expected = digest(data);
  const plain = Buffer.from(JSON.stringify(data));
  writeFileSync(
    resolve(directory, "fixture.dpapi"),
    await protectArchive(plain),
  );
  plain.fill(0);
  data = undefined;
  const columns = await sql(
    "select table_schema, table_name, column_name from information_schema.columns where (table_schema,table_name) in (('auth','users'),('auth','identities'),('auth','mfa_factors'),('public','profiles')) and is_generated='NEVER' order by table_schema,table_name,ordinal_position",
  );
  phase = "remove disposable identity";
  checked(await first.auth.signOut({ scope: "global" }));
  checked(await admin.auth.admin.deleteUser(fixtureId));
  assert.equal((await snapshot())["auth.users"].length, 0);
  assert.ok(
    (await client().auth.signInWithPassword({ email, password })).error,
  );
  check("Removing only the fixture makes fresh password login fail.");
  phase = "restore fixture checkpoint";
  const restoredBytes = await protectArchive(
    readFileSync(resolve(directory, "fixture.dpapi")),
    "Unprotect",
  );
  data = JSON.parse(restoredBytes.toString());
  restoredBytes.fill(0);
  assert.equal(digest(data), expected);
  assert.equal(data["auth.users"].length, 1);
  assert.equal(data["auth.users"][0].id, fixtureId);
  assert.equal(
    data["auth.users"][0].raw_user_meta_data.recovery_fixture,
    marker,
  );
  for (const table of tables)
    for (const row of data[table])
      assert.equal(row[table === "auth.users" ? "id" : "user_id"], fixtureId);
  const tag = `$fixture_${marker.replaceAll("-", "")}$`;
  const inserts = tables
    .map((table) => {
      const names = columns
        .filter((c) => `${c.table_schema}.${c.table_name}` === table)
        .map((c) => `"${c.column_name}"`)
        .join(",");
      const json = JSON.stringify(data[table]);
      assert.ok(!json.includes(tag));
      return `insert into ${table} (${names}) select ${names} from jsonb_populate_recordset(null::${table}, ${tag}${json}${tag}::jsonb);`;
    })
    .join("\n");
  await sql(
    `begin; set local statement_timeout='15s'; ${inserts} commit; select true as restored;`,
  );
  assert.equal(digest(await snapshot()), expected);
  check(
    "Encrypted checkpoint restores all four fixture tables exactly, including factor identity.",
  );
  phase = "verify restored hosted authentication";
  const recovered = client();
  checked(await recovered.auth.signInWithPassword({ email, password }));
  assert.equal(
    checked(await recovered.auth.mfa.getAuthenticatorAssuranceLevel())
      .currentLevel,
    "aal1",
  );
  assert.deepEqual(
    checked(await recovered.from("profiles").select("display_name")),
    [],
  );
  const factors = checked(await recovered.auth.mfa.listFactors());
  assert.ok(
    factors.totp.some((f) => f.id === factor.id && f.status === "verified"),
  );
  if (Math.floor(Date.now() / 30_000) === verifiedStep)
    await new Promise((done) =>
      setTimeout(done, 30_100 - (Date.now() % 30_000)),
    );
  await verifyFactor(recovered.auth, factor.id, factor.totp.secret);
  assert.deepEqual(
    checked(await recovered.from("profiles").select("display_name")),
    [{ display_name: "Recovery fixture" }],
  );
  checked(await recovered.auth.signOut({ scope: "global" }));
  check(
    "Restored password login requires the original TOTP; AAL1 is denied and AAL2 can read the restored private profile.",
  );
  report.status = "PASS";
} catch {
  report.failedPhase = phase;
  process.exitCode = 1;
} finally {
  if (fixtureId) {
    try {
      const current = await admin.auth.admin.getUserById(fixtureId);
      if (current.data?.user) {
        assert.equal(current.data.user.user_metadata.recovery_fixture, marker);
        checked(await admin.auth.admin.deleteUser(fixtureId));
      }
      assert.equal((await snapshot())["auth.users"].length, 0);
      if (baseline) assert.deepEqual(await unrelatedFingerprint(), baseline);
      check(
        "Fixture removed; unrelated Auth identities, factors and profiles remain byte-equivalent.",
      );
    } catch {
      report.status = "FAIL";
      report.cleanup =
        "Review required; cleanup or unrelated-record comparison failed.";
      process.exitCode = 1;
    }
  }
  report.completedAt = new Date().toISOString();
  writeFileSync(
    resolve(directory, "result.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { ...report, evidence: resolve(directory, "result.json") },
      null,
      2,
    ),
  );
}
