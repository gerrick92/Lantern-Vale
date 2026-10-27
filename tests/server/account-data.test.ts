import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { localDatabase } from "../helpers/local-database";
import { memoryGameRecovery } from "../helpers/game-recovery";
import { initialState } from "../../game/rules";
import { ApiError } from "../../apps/web/src/server/http";

const f = vi.hoisted(() => ({
  user: "00000000-0000-4000-8000-000000000001",
  denied: 0,
  database: undefined as unknown,
  retain: undefined as unknown as (userId: string) => Promise<void>,
  rateLimit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/game-recovery", () => ({
  retainGameplay: (userId: string) => f.retain(userId),
}));
vi.mock("@/server/auth", () => ({
  adminDb: () => f.database,
  requireUser: async () => {
    if (f.denied) throw new ApiError(f.denied, "Verified sign-in required.");
    return {
      user: {
        id: f.user,
        email: "fixture@example.test",
        created_at: "2026-10-01",
        user_metadata: { secret: "must-not-export" },
        factors: [{ secret: "must-not-export" }],
      },
    };
  },
  rateLimit: f.rateLimit,
}));
import { GET as download } from "../../apps/web/src/app/api/account/data/route";
import {
  GET as status,
  POST as requestDeletion,
} from "../../apps/web/src/app/api/account/deletion/route";

const alice = f.user;
const bob = "00000000-0000-4000-8000-000000000002";
const wallet = "0x" + "4".repeat(40);
const contract = "0x" + "3".repeat(40);
let db: Awaited<ReturnType<typeof localDatabase>>;
let round: string;
const request = (body: unknown, origin = "http://127.0.0.1:3000") =>
  new Request(`${origin}/api/account/deletion`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = await localDatabase([alice, bob]);
  f.retain = memoryGameRecovery(() => f.database as typeof db.api);
  for (const [user, name] of [
    [alice, "Alice"],
    [bob, "Bob"],
  ]) {
    await db.sql.query(
      "insert into profiles(user_id,display_name) values($1,$2)",
      [user, name],
    );
    await db.sql.query(
      "insert into contacts(user_id,label,address) values($1,$2,$3)",
      [user, `${name}'s friend`, wallet],
    );
  }
  const plan = {
    chainId: 11155111,
    wallet,
    contract,
    token: "0x" + "1".repeat(40),
    paymentId: "0x" + "01".repeat(32),
    deadline: "1900000000",
    action: { kind: "entry", classId: "warrior" },
  };
  await db.sql.query("select reserve_payment_review($1,$2)", [alice, plan]);
  round = (
    await db.sql.query<{ id: string }>(
      "select register_settlement_entry($1,'warrior',$2,$3) as id",
      [
        alice,
        initialState("warrior", false),
        {
          ...plan,
          roundId: "7",
          classId: "warrior",
          hash: "0x" + "ab".repeat(32),
          blockHash: "0x" + "cd".repeat(32),
          blockNumber: "100",
          blockTimestamp: "1800000000",
          transactionIndex: 0,
          item: null,
          amount: "1000000000000000000",
          totalDeposited: "1000000000000000000",
          randomnessProof: { fixture: true },
        },
      ],
    )
  ).rows[0].id;
  // SQL fixture only: the export must retain action history and exact base-unit strings.
  await db.sql.query("select commit_game_action($1,$2,0,$3,$4,$5)", [
    round,
    alice,
    randomUUID(),
    { type: "visit", place: "armor" },
    { ...initialState("warrior", false), place: "armor" },
  ]);
}, 30000);
beforeEach(() => {
  f.database = db.api;
  f.user = alice;
  f.denied = 0;
  f.rateLimit.mockReset();
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
});
afterAll(async () => {
  await db.sql.close();
  vi.unstubAllEnvs();
});

it("downloads only the verified account's explicit data with safe headers and exact amounts", async () => {
  const response = await download();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const text = await response.text();
  expect(text).not.toContain(bob);
  expect(text).not.toContain("Bob's friend");
  expect(text).not.toContain("must-not-export");
  const data = JSON.parse(text);
  expect(data.account).toEqual({
    id: alice,
    email: "fixture@example.test",
    createdAt: "2026-10-01",
  });
  expect(data.data.contacts).toHaveLength(1);
  expect(data.data.adventures).toHaveLength(1);
  expect(data.data.actions).toHaveLength(1);
  expect(data.data.payments[0].amountBaseUnits).toBe("1000000000000000000");
  f.user = bob;
  const other = await (await download()).json();
  expect(other.data.profile.displayName).toBe("Bob");
  expect(other.data.adventures).toEqual([]);
  expect(other.data.payments).toEqual([]);
});

it("requires authentication/MFA, exact confirmation and origin; rejects supplied account IDs", async () => {
  for (const code of [401, 403]) {
    f.denied = code;
    expect((await download()).status).toBe(code);
    expect((await status()).status).toBe(code);
    expect(
      (
        await requestDeletion(
          request({ action: "request", confirmation: "DELETE" }),
        )
      ).status,
    ).toBe(code);
  }
  f.denied = 0;
  expect(
    (
      await requestDeletion(
        request(
          { action: "request", confirmation: "DELETE" },
          "https://wrong.example",
        ),
      )
    ).status,
  ).toBe(403);
  for (const body of [
    { action: "request", confirmation: "delete" },
    { action: "request" },
    { action: "cancel", userId: bob },
    { action: "request", confirmation: "DELETE", userId: bob },
  ])
    expect((await requestDeletion(request(body))).status).toBe(400);
  f.rateLimit.mockRejectedValueOnce(new ApiError(429, "Please wait."));
  expect((await download()).status).toBe(429);
});

it("records an idempotent cancellable request without deleting accounts or payment records", async () => {
  const first = await (
    await requestDeletion(
      request({ action: "request", confirmation: "DELETE" }),
    )
  ).json();
  expect(first.needsPaymentReview).toBe(true);
  expect(first.requestedAt).toBeTruthy();
  expect(
    await (
      await requestDeletion(
        request({ action: "request", confirmation: "DELETE" }),
      )
    ).json(),
  ).toEqual(first);
  f.user = bob;
  expect((await (await status()).json()).requestedAt).toBeNull();
  expect((await (await status()).json()).needsPaymentReview).toBe(false);
  await requestDeletion(request({ action: "cancel" }));
  f.user = alice;
  expect((await (await status()).json()).requestedAt).toBe(first.requestedAt);
  for (const table of [
    "game_rounds",
    "settlement_payments",
    "payment_receipts",
    "game_actions",
  ])
    expect(
      (await db.sql.query(`select count(*)::int as count from ${table}`))
        .rows[0],
    ).toEqual({ count: 1 });
  expect((await db.sql.query("select * from auth.users")).rows).toHaveLength(2);
  const cancelled = await (
    await requestDeletion(request({ action: "cancel" }))
  ).json();
  expect(cancelled.requestedAt).toBeNull();
});

it("requires payment review even after a win or loss, and for an expired but unreconciled entry", async () => {
  for (const phase of ["victory", "defeat"]) {
    await db.sql.query(
      "update game_rounds set state=jsonb_set(state,'{phase}',$1) where id=$2",
      [JSON.stringify(phase), round],
    );
    expect((await (await status()).json()).needsPaymentReview).toBe(true);
  }
  await db.sql.query(
    "insert into game_payment_reviews(payment_id,user_id,plan,deadline) values($1,$2,'{}',1)",
    ["0x" + "02".repeat(32), bob],
  );
  f.user = bob;
  expect((await (await status()).json()).needsPaymentReview).toBe(true);
});

it("denies direct access to deletion requests, export and maintenance RPCs", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.sql.exec(`set role ${role};`);
    try {
      await expect(
        db.sql.query("select * from account_deletion_requests"),
      ).rejects.toThrow(/permission denied/);
      for (const sql of [
        "select export_account_data($1)",
        "select account_data_status($1)",
        "select request_account_deletion($1,true)",
      ])
        await expect(db.sql.query(sql, [alice])).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        db.sql.query("select cleanup_account_ephemera(true)"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.sql.exec("reset role");
    }
  }
});

it("fails closed on unavailable migrations or oversized exports without exposing provider errors", async () => {
  f.database = {
    rpc: async () => ({
      error: { code: "PGRST202", message: "provider details" },
    }),
  };
  expect(await (await status()).json()).toEqual({
    available: false,
    requestedAt: null,
    needsPaymentReview: false,
  });
  const response = await download();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("provider details");
  f.database = { rpc: async () => ({ error: { code: "54000" } }) };
  expect((await download()).status).toBe(413);
});

it("refuses oversized histories instead of silently truncating them", async () => {
  await db.sql.query(
    "insert into contacts(user_id,label,address) select $1,'Bulk fixture',$2 from generate_series(1,10001)",
    [bob, wallet],
  );
  try {
    f.user = bob;
    expect((await download()).status).toBe(413);
  } finally {
    await db.sql.query(
      "delete from contacts where user_id=$1 and label='Bulk fixture'",
      [bob],
    );
  }
});

it("previews bounded cleanup, deletes only expired ephemera, and preserves payment evidence", async () => {
  await db.sql.query("select request_account_deletion($1,true)", [alice]);
  await db.sql.query(
    "insert into wallet_links(user_id,address) values($1,$2)",
    [alice, wallet],
  );
  await db.sql.query(
    "insert into game_settlement_results(round_id,signer,digest,result,signature) values($1,$2,$3,'{}',$4)",
    [round, wallet, "0x" + "aa".repeat(32), "0x" + "bb".repeat(65)],
  );
  await db.sql.query(
    "insert into wallet_challenges(user_id,address,message,nonce,expires_at) select $1,$2,'fixture',gen_random_uuid()::text,now()-interval '2 days' from generate_series(1,3)",
    [alice, wallet],
  );
  await db.sql.query(
    "insert into wallet_challenges(user_id,address,message,nonce,expires_at) values($1,$2,'fixture','recent',now()-interval '1 hour'),($1,$2,'fixture','active',now()+interval '1 hour')",
    [alice, wallet],
  );
  await db.sql.query(
    "insert into rate_limits(user_id,scope,minute,count) values($1,'old-a',now()-interval '3 days',5),($1,'old-b',now()-interval '3 days',5),($1,'recent',now()-interval '1 hour',5),($1,'active',now(),5)",
    [alice],
  );
  const protectedTables = [
    "auth.users",
    "profiles",
    "contacts",
    "wallet_links",
    "game_rounds",
    "game_actions",
    "reward_claims",
    "payment_receipts",
    "settlement_payments",
    "game_payment_reviews",
    "game_settlement_results",
    "account_deletion_requests",
  ];
  async function protectedRows() {
    const data = [];
    for (const table of protectedTables)
      data.push(
        (
          await db.sql.query(
            `select to_jsonb(t)::text as row from ${table} t order by to_jsonb(t)::text`,
          )
        ).rows,
      );
    return data;
  }
  const before = await protectedRows();
  const preview = (
    await db.sql.query<{ result: object }>(
      "select cleanup_account_ephemera(false,2) as result",
    )
  ).rows[0].result;
  expect(preview).toEqual({
    executed: false,
    walletChallenges: 2,
    rateLimits: 2,
    batchLimit: 2,
  });
  expect(
    (await db.sql.query("select * from wallet_challenges")).rows,
  ).toHaveLength(5);
  for (const bad of [0, 1001, null])
    await expect(
      db.sql.query("select cleanup_account_ephemera(true,$1)", [bad]),
    ).rejects.toThrow(/Invalid cleanup options/);
  const applied = (
    await db.sql.query<{ result: object }>(
      "select cleanup_account_ephemera(true,2) as result",
    )
  ).rows[0].result;
  expect(applied).toEqual({
    executed: true,
    walletChallenges: 2,
    rateLimits: 2,
    batchLimit: 2,
  });
  await db.sql.query("select cleanup_account_ephemera(true,2)");
  expect(
    (await db.sql.query("select nonce from wallet_challenges order by nonce"))
      .rows,
  ).toEqual([{ nonce: "active" }, { nonce: "recent" }]);
  expect(
    (await db.sql.query("select scope from rate_limits order by scope")).rows,
  ).toEqual([{ scope: "active" }, { scope: "recent" }]);
  expect(await protectedRows()).toEqual(before);
  expect(
    (
      await db.sql.query<{ result: object }>(
        "select cleanup_account_ephemera() as result",
      )
    ).rows[0].result,
  ).toMatchObject({ executed: false, walletChallenges: 0, rateLimits: 0 });
});

it("rejects an export that exceeds the payload bound even with few records", async () => {
  const previous = (
    await db.sql.query<{ state: object }>(
      "select state from game_rounds where id=$1",
      [round],
    )
  ).rows[0].state;
  await db.sql.query(
    "update game_rounds set economy_version='legacy',state=jsonb_build_object('log',repeat('x',8388609)) where id=$1",
    [round],
  );
  try {
    expect((await download()).status).toBe(413);
  } finally {
    await db.sql.query("update game_rounds set state=$1 where id=$2", [
      previous,
      round,
    ]);
  }
});
