import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  mkdtempSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  retainGameActions,
  readGameRecovery,
} from "../../apps/web/src/server/game-recovery-protocol.ts";
import { gameRecoveryReplaySQL } from "../../scripts/game-recovery-replay.mjs";
const project = "nisviqoxcfbtwccdjqoz",
  root = resolve(import.meta.dirname, "../..");
const env = parseEnv(readFileSync("apps/web/.env.staging.local", "utf8")),
  recovery = parseEnv(readFileSync("apps/web/.env.local", "utf8"));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`);
assert.equal(recovery.GAME_RECOVERY_URL, env.NEXT_PUBLIC_SUPABASE_URL);
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const bucket = admin.storage.from("game-recovery");
const run = randomUUID(),
  round = randomUUID(),
  contractRound = BigInt(`0x${randomBytes(8).toString("hex")}`).toString(),
  email = `game-recovery-${run}@example.com`;
let user,
  phase = "create fixture";
mkdirSync("test-results/game-recovery", { recursive: true });
const output = mkdtempSync(resolve("test-results/game-recovery/hosted-"));
const report = {
  status: "FAIL",
  project,
  checks: [],
  startedAt: new Date().toISOString(),
};
function checked(result) {
  if (result.error) throw Error("Hosted operation failed");
  return result.data;
}
async function sql(source) {
  const path = resolve(".tools/private", `game-recovery-${randomUUID()}.sql`);
  writeFileSync(path, source, { flag: "wx" });
  try {
    return await new Promise((done, reject) => {
      const child = spawn(
        resolve(
          ".tools/supabase-cli/node_modules/@supabase/cli-windows-x64/bin/supabase.exe",
        ),
        [
          "db",
          "query",
          "--linked",
          "--project-ref",
          project,
          "--file",
          path,
          "--output-format",
          "json",
        ],
        { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      let bytes = "";
      const timer = setTimeout(() => child.kill(), 60000);
      child.stdout.on("data", (b) => {
        bytes += b;
        if (bytes.length > 8000000) child.kill();
      });
      child.on("error", () => reject(Error("CLI unavailable")));
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code) return reject(Error("Private SQL failed"));
        try {
          done(JSON.parse(bytes.slice(bytes.indexOf("{"))).rows);
        } catch {
          reject(Error("Invalid SQL response"));
        }
        bytes = "";
      });
    });
  } finally {
    unlinkSync(path);
  }
}
const store = {
  async put(path, bytes) {
    const result = await bucket.upload(path, bytes, {
      upsert: false,
      contentType: "application/octet-stream",
    });
    if (result.error && String(result.error.statusCode) !== "409")
      throw Error("Upload unavailable");
  },
  async get(path) {
    const blob = checked(await bucket.download(path));
    return new Uint8Array(await blob.arrayBuffer());
  },
};
try {
  user = checked(
    await admin.auth.admin.createUser({
      email,
      password: randomBytes(32).toString("base64url") + "!aA9",
      email_confirm: true,
      user_metadata: { game_recovery_fixture: run },
    }),
  ).user.id;
  phase = "create synthetic game round";
  await sql(`insert into public.game_rounds(id,user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state,economy_version)
 values('${round}','${user}','0x${"44".repeat(20)}',11155111,'0x${"33".repeat(20)}','${contractRound}','0x${randomBytes(32).toString("hex")}','0x${randomBytes(32).toString("hex")}','warrior','{"mode":"paid","phase":"town","classId":"warrior","spent":1,"log":[]}'::jsonb,'settlement-v1'); select true as created;`);
  const options = {
    project,
    stream: recovery.GAME_RECOVERY_STREAM,
    userId: user,
    key: Buffer.from(recovery.GAME_RECOVERY_KEY, "hex"),
    store,
    database: {
      async read() {
        return checked(
          await admin.rpc("read_game_recovery_batch", { p_user: user }),
        ).events;
      },
      async acknowledge(first, last) {
        checked(
          await admin.rpc("acknowledge_game_recovery", {
            p_user: user,
            p_from: first.sequence,
            p_to: last.sequence,
            p_hash: last.hash,
          }),
        );
      },
    },
  };
  phase = "retain initial checkpoint";
  await retainGameActions(options);
  phase = "commit later action";
  checked(
    await admin.rpc("commit_game_action", {
      p_round: round,
      p_user: user,
      p_version: 0,
      p_request: randomUUID(),
      p_intent: { type: "explore" },
      p_state: {
        mode: "paid",
        phase: "town",
        classId: "warrior",
        spent: 1,
        log: ["After checkpoint"],
      },
    }),
  );
  const originalPut = store.put;
  store.put = async () => {
    throw Error("Simulated outage");
  };
  await assert.rejects(retainGameActions(options));
  const pending = await sql(
    `begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; set local request.jwt.claim.aal='aal2'; select count(*)::integer as visible from public.game_rounds where id='${round}'; rollback;`,
  );
  assert.equal(pending[0].visible, 0);
  store.put = originalPut;
  await retainGameActions(options);
  report.checks.push(
    "Storage outage withholds acknowledgement and RLS visibility; retry retains the same action.",
  );
  const digestSQL = `select md5(jsonb_build_object('round',(select to_jsonb(r) from public.game_rounds r where id='${round}'),'actions',(select jsonb_agg(to_jsonb(a) order by version) from public.game_actions a where round_id='${round}'))::text) as digest`;
  const before = (await sql(digestSQL))[0].digest;
  phase = "simulate fixture-only game data loss";
  await sql(
    `begin; delete from public.game_rounds where id='${round}' and user_id='${user}'; delete from public.game_recovery_events where user_id='${user}'; delete from public.game_recovery_heads where user_id='${user}'; commit; select true as fixture_removed;`,
  );
  phase = "recover old checkpoint then later actions";
  const old = await readGameRecovery({ ...options, through: "1" });
  await sql(
    gameRecoveryReplaySQL(old, user) + "\nselect true as checkpoint_restored;",
  );
  assert.equal(
    (await sql(`select version from public.game_rounds where id='${round}'`))[0]
      .version,
    0,
  );
  const latest = await readGameRecovery({ ...options, through: "3" });
  await sql(
    gameRecoveryReplaySQL(latest, user) + "\nselect true as latest_restored;",
  );
  assert.equal((await sql(digestSQL))[0].digest, before);
  await sql(
    gameRecoveryReplaySQL(latest, user) + "\nselect true as idempotent;",
  );
  assert.equal((await sql(digestSQL))[0].digest, before);
  report.checks.push(
    "Cloud-only replay restores the old checkpoint and later committed action exactly; a second replay is idempotent.",
  );
  assert.equal(
    checked(
      await admin.rpc("game_round_recovery_ready", {
        p_contract: "0x" + "33".repeat(20),
        p_round: contractRound,
      }),
    ),
    true,
  );
  report.checks.push(
    "Restricted signer recovery readiness is true only after retained state is restored.",
  );
  options.key.fill(0);
  report.status = "PASS";
} catch {
  report.failedPhase = phase;
  process.exitCode = 1;
} finally {
  if (user) {
    try {
      await sql(
        `begin; delete from public.game_rounds where id='${round}' and user_id='${user}'; delete from public.game_recovery_events where user_id='${user}'; delete from public.game_recovery_heads where user_id='${user}'; commit; select true as cleaned;`,
      );
      checked(await admin.auth.admin.deleteUser(user));
      report.checks.push(
        "Disposable staging game/account removed; no working-project account or chain transaction changed.",
      );
    } catch {
      report.status = "FAIL";
      report.cleanup = "Review required";
      process.exitCode = 1;
    }
  }
  report.completedAt = new Date().toISOString();
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      { ...report, evidence: resolve(output, "result.json") },
      null,
      2,
    ),
  );
}
