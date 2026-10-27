import { afterEach, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { localDatabase } from "../helpers/local-database";
import { initialState } from "../../game/rules";
import { gameRecoveryReplaySQL } from "../../scripts/game-recovery-replay.mjs";
import {
  retainGameActions,
  readGameRecovery,
  type RecoveryEvent,
  type RecoveryStore,
} from "../../apps/web/src/server/game-recovery-protocol";
const user = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const opened: Awaited<ReturnType<typeof localDatabase>>[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.sql.close();
});
it("keeps the complete empty-staging SQL rehearsal compatible with the current journal schema", async () => {
  const db = await localDatabase([]);
  opened.push(db);
  await db.sql
    .exec(`create or replace function auth.uid() returns uuid language sql stable as 'select (current_setting(''request.jwt.claims'',true)::jsonb->>''sub'')::uuid';
    create or replace function auth.jwt() returns jsonb language sql stable as 'select current_setting(''request.jwt.claims'',true)::jsonb';`);
  await db.sql.exec(readFileSync("tests/hosted/staging.sql", "utf8"));
  expect((await db.sql.query("select * from auth.users")).rows).toHaveLength(0);
  expect(
    (await db.sql.query("select * from game_recovery_events")).rows,
  ).toHaveLength(0);
});
async function fixture() {
  const db = await localDatabase([user, other]);
  opened.push(db);
  const objects = new Map<string, Uint8Array>();
  const store: RecoveryStore = {
    async put(path, bytes) {
      if (!objects.has(path)) objects.set(path, bytes);
    },
    async get(path) {
      const bytes = objects.get(path);
      if (!bytes) throw new Error("Missing recovery object");
      return bytes;
    },
  };
  const options = {
    userId: user,
    project: "abcdefghijklmnopqrst",
    stream: randomUUID(),
    key: randomBytes(32),
    store,
    database: {
      async read() {
        const result = await db.api.rpc("read_game_recovery_batch", {
          p_user: user,
        });
        if (result.error) throw result.error;
        return (result.data as { events: unknown[] }).events;
      },
      async acknowledge(first: RecoveryEvent, last: RecoveryEvent) {
        const result = await db.api.rpc("acknowledge_game_recovery", {
          p_user: user,
          p_from: first.sequence,
          p_to: last.sequence,
          p_hash: last.hash,
        });
        if (result.error) throw result.error;
      },
    },
  };
  const id = randomUUID();
  const state = initialState("warrior", false);
  await db.sql.query(
    `insert into game_rounds(id,user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state,economy_version)
    values($1,$2,$3,11155111,$4,'1',$5,$6,'warrior',$7,'settlement-v1')`,
    [
      id,
      user,
      "0x" + "44".repeat(20),
      "0x" + "33".repeat(20),
      "0x" + "aa".repeat(32),
      "0x" + "bb".repeat(32),
      state,
    ],
  );
  return { db, options, id, state, objects };
}
it("records mutations transactionally, blocks pending reads and preserves owner/AAL2 checks after retention", async () => {
  const f = await fixture();
  await f.db.sql.exec(
    `set role authenticated; set request.jwt.claim.sub='${user}'; set request.jwt.claim.aal='aal2';`,
  );
  expect(
    (await f.db.sql.query("select id from game_rounds")).rows,
  ).toHaveLength(0);
  await expect(
    f.db.sql.query("select * from game_recovery_events"),
  ).rejects.toThrow();
  await expect(
    f.db.sql.query(
      `select acknowledge_game_recovery('${user}',1,1,repeat('0',64))`,
    ),
  ).rejects.toThrow();
  await f.db.sql.exec("reset role;");
  await retainGameActions(f.options);
  await f.db.sql.exec(
    `set role authenticated; set request.jwt.claim.sub='${user}'; set request.jwt.claim.aal='aal2';`,
  );
  expect(
    (await f.db.sql.query("select id from game_rounds")).rows,
  ).toHaveLength(1);
  await f.db.sql.exec("set request.jwt.claim.aal='aal1';");
  expect(
    (await f.db.sql.query("select id from game_rounds")).rows,
  ).toHaveLength(0);
  await f.db.sql.exec(
    `set request.jwt.claim.aal='aal2'; set request.jwt.claim.sub='${other}';`,
  );
  expect(
    (await f.db.sql.query("select id from game_rounds")).rows,
  ).toHaveLength(0);
  await f.db.sql.exec("reset role;");
});
it("rolls journal and game changes back together and rejects partial transaction acknowledgement", async () => {
  const f = await fixture();
  await retainGameActions(f.options);
  await f.db.sql.exec("begin;");
  await f.db.sql.query("update game_rounds set version=1 where id=$1", [f.id]);
  await f.db.sql.exec("rollback;");
  expect(await f.options.database.read()).toEqual([]);
  const result = await f.db.api.rpc("commit_game_action", {
    p_round: f.id,
    p_user: user,
    p_version: 0,
    p_request: randomUUID(),
    p_intent: { type: "explore" },
    p_state: f.state,
  });
  expect(result.error).toBeNull();
  const events = (await f.options.database.read()) as RecoveryEvent[];
  expect(events).toHaveLength(2);
  expect(events[0].transactionId).toBe(events[1].transactionId);
  await expect(
    f.options.database.acknowledge(events[0], events[0]),
  ).rejects.toThrow("Incomplete recovery");
  await retainGameActions(f.options);
  const recovered = await readGameRecovery({
    ...f.options,
    through: events[1].sequence,
  });
  expect(recovered).toHaveLength(3);
  expect(recovered.map((e) => JSON.parse(e.payload).table)).toEqual([
    "game_rounds",
    "game_rounds",
    "game_actions",
  ]);
});
it("fails closed on storage outage, then makes the exact committed action readable after retry", async () => {
  const f = await fixture();
  await retainGameActions(f.options);
  await f.db.api.rpc("commit_game_action", {
    p_round: f.id,
    p_user: user,
    p_version: 0,
    p_request: randomUUID(),
    p_intent: { type: "explore" },
    p_state: f.state,
  });
  const put = f.options.store.put;
  f.options.store.put = async () => {
    throw new Error("Outage");
  };
  await expect(retainGameActions(f.options)).rejects.toThrow("Outage");
  await f.db.sql.exec(
    `set role authenticated; set request.jwt.claim.sub='${user}'; set request.jwt.claim.aal='aal2';`,
  );
  expect(
    (await f.db.sql.query("select * from game_actions")).rows,
  ).toHaveLength(0);
  await f.db.sql.exec("reset role;");
  f.options.store.put = put;
  await retainGameActions(f.options);
  expect(
    (await f.db.sql.query("select version from game_actions")).rows,
  ).toEqual([{ version: 1 }]);
});

it("reconstructs the database from cloud records after losing post-checkpoint writes", async () => {
  const f = await fixture();
  await retainGameActions(f.options);
  const checkpoint = await f.db.sql.dumpDataDir();
  await f.db.api.rpc("commit_game_action", {
    p_round: f.id,
    p_user: user,
    p_version: 0,
    p_request: randomUUID(),
    p_intent: { type: "explore" },
    p_state: { ...f.state, log: ["Retained after checkpoint"] },
  });
  await retainGameActions(f.options);
  const before = await f.db.sql.query(
    "select row_to_json(r)::text as value from game_rounds r order by id",
  );
  const actions = await f.db.sql.query(
    "select row_to_json(a)::text as value from game_actions a order by id",
  );
  const { PGlite } = await import("@electric-sql/pglite");
  const restored = new PGlite({ loadDataDir: checkpoint });
  try {
    expect(
      (await restored.query("select * from game_actions")).rows,
    ).toHaveLength(0);
    const events = await readGameRecovery({ ...f.options, through: "3" });
    await restored.exec(gameRecoveryReplaySQL(events, user));
    expect(
      (
        await restored.query(
          "select row_to_json(r)::text as value from game_rounds r order by id",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await restored.query(
          "select row_to_json(a)::text as value from game_actions a order by id",
        )
      ).rows,
    ).toEqual(actions.rows);
    await restored.exec(gameRecoveryReplaySQL(events, user));
    expect(
      (await restored.query("select * from game_actions")).rows,
    ).toHaveLength(1);
    await restored.exec(
      `set role authenticated; set request.jwt.claim.sub='${other}'; set request.jwt.claim.aal='aal2';`,
    );
    expect(
      (await restored.query("select * from game_rounds")).rows,
    ).toHaveLength(0);
  } finally {
    await restored.close();
  }
});
