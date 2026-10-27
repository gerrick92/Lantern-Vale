import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { initialState, reduceIntent } from "../../game/rules";
const db = new PGlite();
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const contract = "0x" + "3".repeat(40);
const wallet = "0x" + "4".repeat(40);
const token = 10n ** 18n;
const receipt = (id: number, item: number | null, total: number) => ({
  chainId: 11155111,
  contract,
  wallet,
  roundId: "7",
  classId: "warrior",
  paymentId: "0x" + id.toString(16).padStart(64, "0"),
  deadline: "10000",
  hash: "0x" + id.toString(16).padStart(64, "0"),
  blockHash: "0x" + "ab".repeat(32),
  blockNumber: "100",
  blockTimestamp: "1800000000",
  // SQL tests exercise persistence, not the separately tested BLS verifier.
  randomnessProof:
    item === null || item === 6 || item === 7 ? { fixture: true } : undefined,
  transactionIndex: id,
  item,
  amount: token.toString(),
  totalDeposited: (BigInt(total) * token).toString(),
});
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';create function auth.jwt() returns jsonb language sql stable as 'select jsonb_build_object(''aal'',current_setting(''request.jwt.claim.aal'',true))';grant usage on schema public,auth to anon,authenticated,service_role;insert into auth.users values('${user}'),('${other}');`,
  );
  for (const path of [
    "202610190001_core.sql",
    "202610190002_payment_receipts.sql",
    "202610220003_settlement_payments.sql",
    "202610230004_payment_reviews.sql",
    "202610230005_settlement_results.sql",
  ])
    await db.exec(readFileSync("supabase/migrations/" + path, "utf8"));
}, 30000);
afterAll(() => db.close());

it("atomically registers entry, consumes purchases once, rolls back conflicts and retains tombstones", async () => {
  let state = initialState("warrior", false);
  const entry = receipt(1, null, 1);
  const entryPlan = {
    chainId: 11155111,
    wallet,
    contract,
    token: "0x" + "1".repeat(40),
    paymentId: entry.paymentId,
    deadline: entry.deadline,
    action: { kind: "entry", classId: "warrior" },
  };
  await db.query("select reserve_payment_review($1,$2)", [user, entryPlan]);
  async function register(owner = user, classId = "warrior") {
    return db.query<{ id: string }>(
      "select register_settlement_entry($1,$2,$3,$4) as id",
      [owner, classId, { ...state, classId }, entry],
    );
  }
  const id = (await register()).rows[0].id;
  expect((await register()).rows[0].id).toBe(id);
  await expect(register(other)).rejects.toThrow("already registered");
  await expect(register(user, "thief")).rejects.toThrow(
    "Invalid settlement entry",
  );
  const visit = { type: "visit", place: "armor" } as const;
  state = reduceIntent(state, visit);
  await db.query("select commit_game_action($1,$2,0,$3,$4,$5)", [
    id,
    user,
    "00000000-0000-4000-8000-000000000010",
    visit,
    state,
  ]);
  const buy = { type: "buy", item: "armor" } as const;
  const bought = reduceIntent(state, buy, 1);
  const purchase = receipt(2, 1, 2);
  const request = "00000000-0000-4000-8000-000000000011";
  const purchasePlan = {
    ...entryPlan,
    paymentId: purchase.paymentId,
    action: {
      kind: "purchase",
      roundId: id,
      contractRoundId: "7",
      version: 1,
      requestId: request,
      intent: buy,
    },
  };
  await db.query("select reserve_payment_review($1,$2)", [user, purchasePlan]);
  await expect(
    db.query("select reserve_payment_review($1,$2)", [
      user,
      { ...purchasePlan, action: { ...purchasePlan.action, version: 2 } },
    ]),
  ).rejects.toThrow("previous payment review");
  await expect(
    db.query("select commit_game_action($1,$2,1,$3,$4,$5)", [
      id,
      user,
      "00000000-0000-4000-8000-000000000099",
      { type: "abandon" },
      reduceIntent(state, { type: "abandon" }),
    ]),
  ).rejects.toThrow("pending purchase");
  expect(
    (
      await db.query<{ version: number }>(
        "select version from game_rounds where id=$1",
        [id],
      )
    ).rows[0].version,
  ).toBe(1);
  const commit = (version = 1, req = request, proof = purchase, owner = user) =>
    db.query<{ result: { state: typeof bought; version: number } }>(
      "select commit_settlement_purchase($1,$2,$3,$4,$5,$6,$7) as result",
      [id, owner, version, req, buy, bought, proof],
    );
  await expect(commit(0)).rejects.toThrow("version conflict");
  expect(
    (await db.query("select * from settlement_payments")).rows,
  ).toHaveLength(1);
  await expect(commit(1, request, purchase, other)).rejects.toThrow(
    "unavailable",
  );
  await expect(
    commit(1, request, {
      ...purchase,
      totalDeposited: (token * 3n).toString(),
    }),
  ).rejects.toThrow("Reconcile");
  const result = (await commit()).rows[0].result;
  expect(result.version).toBe(2);
  expect(result.state.armor).toBe(true);
  expect((await commit()).rows[0].result).toEqual(result);
  await expect(
    commit(1, request, { ...purchase, hash: receipt(3, 1, 2).hash }),
  ).rejects.toThrow("already used");
  await expect(
    commit(2, "00000000-0000-4000-8000-000000000012"),
  ).rejects.toThrow();
  expect(
    (await db.query("select * from settlement_payments")).rows,
  ).toHaveLength(2);
  const lost = reduceIntent(bought, { type: "abandon" });
  await db.query("select commit_game_action($1,$2,2,$3,$4,$5)", [
    id,
    user,
    "00000000-0000-4000-8000-000000000013",
    { type: "abandon" },
    lost,
  ]);
  await expect(
    db.query("select commit_game_action($1,$2,3,$3,$4,$5)", [
      id,
      user,
      "00000000-0000-4000-8000-000000000014",
      visit,
      state,
    ]),
  ).rejects.toThrow("complete");
  await db.exec("set role authenticated");
  await expect(db.query("select * from settlement_payments")).rejects.toThrow();
  await expect(
    db.query("select * from game_settlement_results"),
  ).rejects.toThrow();
  await expect(
    db.query("select * from game_payment_reviews"),
  ).rejects.toThrow();
  await expect(register()).rejects.toThrow("permission denied");
  await expect(commit()).rejects.toThrow("permission denied");
  await db.exec("reset role");
  await db.query("delete from game_rounds where id=$1", [id]);
  expect(
    (
      await db.query<{ round_id: string | null }>(
        "select round_id from settlement_payments",
      )
    ).rows,
  ).toEqual([{ round_id: null }, { round_id: null }]);
  state = initialState("warrior", false);
  await expect(register()).rejects.toThrow();
});
