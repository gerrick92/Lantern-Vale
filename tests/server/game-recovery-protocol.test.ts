import { createHash, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  retainGameActions,
  readGameRecovery,
  openRecovery,
  recoveryPrefix,
  type RecoveryEvent,
  type RecoveryStore,
} from "../../apps/web/src/server/game-recovery-protocol";
const userId = "00000000-0000-4000-8000-000000000001",
  project = "abcdefghijklmnopqrst",
  stream = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const key = randomBytes(32),
    objects = new Map<string, Uint8Array>(),
    events: RecoveryEvent[] = [];
  let archived = 0;
  const store: RecoveryStore = {
    async put(path, bytes) {
      if (!objects.has(path)) objects.set(path, bytes);
    },
    async get(path) {
      const value = objects.get(path);
      if (!value) throw new Error("Missing object");
      return value;
    },
  };
  const database = {
    async read() {
      return events.slice(archived);
    },
    async acknowledge(_first: RecoveryEvent, last: RecoveryEvent) {
      archived = Number(last.sequence);
    },
  };
  const append = (table = "game_actions") => {
    const sequence = String(events.length + 1),
      previousHash = events.at(-1)?.hash || "0".repeat(64);
    const payload = `{"table":"${table}","operation":"INSERT","row":{"id":"fixture","amount":1000000000000000001}}`;
    const hash = createHash("sha256")
      .update(`${userId}:${sequence}:${previousHash}:${payload}`)
      .digest("hex");
    events.push({
      userId,
      sequence,
      previousHash,
      hash,
      transactionId: "1",
      payload,
    });
  };
  return {
    key,
    objects,
    events,
    store,
    database,
    append,
    options: { key, project, stream, userId, store, database },
    archived: () => archived,
  };
}
it("retains exact numeric payloads and recovers actions newer than a checkpoint", async () => {
  const f = fixture();
  f.append();
  await retainGameActions(f.options);
  const checkpoint = f.events.slice();
  f.append();
  f.append("game_settlement_results");
  await retainGameActions(f.options);
  expect(checkpoint).toHaveLength(1);
  expect(await readGameRecovery({ ...f.options, through: "3" })).toEqual(
    f.events,
  );
  expect(f.events[0].payload).toContain("1000000000000000001");
  expect(f.archived()).toBe(3);
  for (const bytes of f.objects.values())
    expect(Buffer.from(bytes).toString()).not.toContain("fixture");
});
it("withholds acknowledgement during storage failure and reuses immutable records", async () => {
  const f = fixture();
  f.append();
  f.append();
  let fail = true;
  const put = f.store.put;
  f.store.put = async (path, bytes) => {
    if (fail && path.includes("commits")) throw new Error("Outage");
    await put(path, bytes);
  };
  await expect(retainGameActions(f.options)).rejects.toThrow("Outage");
  expect(f.archived()).toBe(0);
  expect(f.objects.size).toBe(2);
  fail = false;
  await retainGameActions(f.options);
  expect(f.archived()).toBe(2);
  expect(f.objects.size).toBe(3);
});
it("does not acknowledge invalid read-back", async () => {
  const f = fixture();
  f.append();
  f.store.get = async () => new Uint8Array([1]);
  await expect(retainGameActions(f.options)).rejects.toThrow();
  expect(f.archived()).toBe(0);
});
it("survives database acknowledgement failure without duplicating events", async () => {
  const f = fixture();
  f.append();
  const acknowledge = f.database.acknowledge;
  f.database.acknowledge = async () => {
    throw new Error("Database unavailable");
  };
  await expect(retainGameActions(f.options)).rejects.toThrow();
  const objects = [...f.objects.values()];
  f.database.acknowledge = acknowledge;
  await retainGameActions(f.options);
  expect([...f.objects.values()]).toEqual(objects);
  expect(f.archived()).toBe(1);
});
it("rejects missing, tampered, wrong-context and wrong-key recovery objects", async () => {
  const f = fixture();
  f.append();
  await retainGameActions(f.options);
  await expect(
    readGameRecovery({ ...f.options, through: "2" }),
  ).rejects.toThrow();
  await expect(
    readGameRecovery({ ...f.options, key: randomBytes(32), through: "1" }),
  ).rejects.toThrow();
  const [path, bytes] = [...f.objects.entries()][0];
  expect(() => openRecovery(bytes, f.key, path + "changed")).toThrow();
  const corrupted = Buffer.from(bytes);
  corrupted[40] ^= 1;
  f.objects.set(path, corrupted);
  await expect(
    readGameRecovery({ ...f.options, through: "1" }),
  ).rejects.toThrow();
});
it("rejects another account, broken history and Auth tables before uploading", async () => {
  const f = fixture();
  f.append();
  f.events[0].userId = stream;
  await expect(retainGameActions(f.options)).rejects.toThrow();
  expect(f.objects.size).toBe(0);
  const g = fixture();
  g.append("auth.users");
  await expect(retainGameActions(g.options)).rejects.toThrow();
  expect(g.objects.size).toBe(0);
  const h = fixture();
  h.append();
  h.append();
  h.events[1].previousHash = "1".repeat(64);
  await expect(retainGameActions(h.options)).rejects.toThrow();
  expect(h.objects.size).toBe(0);
  expect(() => recoveryPrefix(project, "../invalid", userId)).toThrow();
});
