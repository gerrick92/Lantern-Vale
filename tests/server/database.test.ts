import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const round = "00000000-0000-4000-8000-000000000003";
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';create function auth.jwt() returns jsonb language sql stable as 'select jsonb_build_object(''aal'',current_setting(''request.jwt.claim.aal'',true))';grant usage on schema public,auth to anon,authenticated,service_role;grant execute on all functions in schema auth to authenticated;insert into auth.users values('${alice}'),('${bob}');`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610190001_core.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202610190002_payment_receipts.sql",
      "utf8",
    ),
  );
}, 30000);
afterAll(async () => db.close());
it("keeps payments spent after deleting a round and denies receipt access to users", async () => {
  await db.exec("reset role;");
  const id = "00000000-0000-4000-8000-000000000099";
  const insert = (user: string) =>
    db.query(
      "insert into game_rounds(id,user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state) values($1,$2,$3,11155111,'gateway','99','payment-99','block','warrior',$4)",
      [id, user, "0x" + "1".repeat(40), { phase: "town" }],
    );
  await insert(alice);
  await db.query("delete from game_rounds where id=$1", [id]);
  await expect(insert(bob)).rejects.toThrow();
  await asUser(bob);
  await expect(db.query("select * from payment_receipts")).rejects.toThrow();
  await expect(db.query("delete from payment_receipts")).rejects.toThrow();
});
async function asUser(user: string, aal = "aal2") {
  await db.exec(
    `reset role;set request.jwt.claim.sub='${user}';set request.jwt.claim.aal='${aal}';set role authenticated;`,
  );
}
it("isolates contacts, rejects forged ownership and enforces MFA in RLS", async () => {
  await asUser(alice);
  await db.query(
    "insert into contacts(user_id,label,address) values($1,$2,$3)",
    [alice, "Private friend", "0x" + "1".repeat(40)],
  );
  expect((await db.query("select * from contacts")).rows.length).toBe(1);
  await expect(
    db.query("insert into contacts(user_id,label,address) values($1,$2,$3)", [
      bob,
      "Forged",
      "0x" + "2".repeat(40),
    ]),
  ).rejects.toThrow();
  await asUser(bob);
  expect((await db.query("select * from contacts")).rows).toHaveLength(0);
  await asUser(alice, "aal1");
  expect((await db.query("select * from contacts")).rows).toHaveLength(0);
  await expect(
    db.query("insert into contacts(user_id,label,address) values($1,$2,$3)", [
      alice,
      "Bypass",
      "0x" + "2".repeat(40),
    ]),
  ).rejects.toThrow();
});
it("blocks direct client state writes and privileged RPC execution", async () => {
  await asUser(alice);
  await expect(db.query("select * from wallet_challenges")).rejects.toThrow();
  await expect(
    db.query("select take_rate_limit($1,$2,$3)", [alice, "attack", 999]),
  ).rejects.toThrow();
  await expect(
    db.query("insert into wallet_links(user_id,address) values($1,$2)", [
      alice,
      "0x" + "1".repeat(40),
    ]),
  ).rejects.toThrow();
});
it("consumes SIWE challenges once and prevents cross-account wallet takeover", async () => {
  await db.exec("reset role;");
  const id = "00000000-0000-4000-8000-000000000004";
  await db.query(
    "insert into wallet_challenges(id,user_id,address,message,nonce,expires_at) values($1,$2,$3,'test message','unique',now()+interval '5 minutes')",
    [id, alice, "0x" + "1".repeat(40)],
  );
  await db.query("select consume_wallet_challenge($1,$2)", [id, alice]);
  await expect(
    db.query("select consume_wallet_challenge($1,$2)", [id, alice]),
  ).rejects.toThrow();
  await expect(
    db.query("insert into wallet_links(user_id,address) values($1,$2)", [
      bob,
      "0x" + "1".repeat(40),
    ]),
  ).rejects.toThrow();
});
it("serializes action versions and idempotency, and refuses reward before victory", async () => {
  await db.exec("reset role;");
  await db.query(
    "insert into game_rounds(id,user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state) values($1,$2,$3,11155111,'gateway','1','payment','block','warrior',$4)",
    [round, alice, "0x" + "1".repeat(40), { phase: "town" }],
  );
  const id = "00000000-0000-4000-8000-000000000005";
  const intent = { type: "travel" };
  const state = { phase: "combat" };
  const action = () =>
    db.query("select commit_game_action($1,$2,$3,$4,$5,$6) as result", [
      round,
      alice,
      0,
      id,
      intent,
      state,
    ]);
  expect((await action()).rows).toEqual((await action()).rows);
  await expect(
    db.query("select commit_game_action($1,$2,$3,$4,$5,$6)", [
      round,
      alice,
      0,
      "00000000-0000-4000-8000-000000000006",
      intent,
      state,
    ]),
  ).rejects.toThrow();
  await expect(
    db.query("select reserve_reward($1,$2,$3)", [round, alice, "123"]),
  ).rejects.toThrow();
  await db.query("select commit_game_action($1,$2,$3,$4,$5,$6)", [
    round,
    alice,
    1,
    "00000000-0000-4000-8000-000000000006",
    { type: "attack" },
    { phase: "victory" },
  ]);
  const first = await db.query("select reserve_reward($1,$2,$3) as claim", [
    round,
    alice,
    "123",
  ]);
  const retry = await db.query("select reserve_reward($1,$2,$3) as claim", [
    round,
    alice,
    "456",
  ]);
  expect(first.rows).toEqual(retry.rows);
  await expect(
    db.query("select reserve_reward($1,$2,$3)", [round, bob, "999"]),
  ).rejects.toThrow();
});
