import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { initialState } from "../../game/rules";
import { localDatabase } from "../helpers/local-database";
import { memoryGameRecovery } from "../helpers/game-recovery";
import {
  captureCheckpoint,
  restoreCheckpoint,
  type Checkpoint,
} from "../helpers/recovery";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const wallet = "0x" + "4".repeat(40);
const contract = "0x" + "3".repeat(40);
const hash = "0x" + "ab".repeat(32);
const paymentId = "0x" + "01".repeat(32);
let fixture: Awaited<ReturnType<typeof localDatabase>>;
let checkpoint: Checkpoint;
let round: string;

beforeAll(async () => {
  fixture = await localDatabase([owner, other]);
  const plan = {
    chainId: 11155111,
    wallet,
    contract,
    token: "0x" + "1".repeat(40),
    paymentId,
    deadline: "1900000000",
    action: { kind: "entry", classId: "warrior" },
  };
  await fixture.sql.query("select reserve_payment_review($1,$2)", [
    owner,
    plan,
  ]);
  const entry = await fixture.sql.query<{ id: string }>(
    "select register_settlement_entry($1,'warrior',$2,$3) as id",
    [
      owner,
      initialState("warrior", false),
      {
        chainId: 11155111,
        contract,
        wallet,
        roundId: "7",
        classId: "warrior",
        paymentId,
        deadline: plan.deadline,
        hash,
        blockHash: hash,
        blockNumber: "100",
        blockTimestamp: "1800000000",
        transactionIndex: 0,
        item: null,
        amount: "1000000000000000000",
        totalDeposited: "1000000000000000000",
        // This test exercises SQL recovery; paid-journey tests use real BLS proofs.
        randomnessProof: { fixture: true },
      },
    ],
  );
  round = entry.rows[0].id;
  await fixture.sql.query(
    "insert into contacts(user_id,label,address) values($1,'Fixture friend',$2)",
    [owner, wallet],
  );
  await fixture.sql.query("select reserve_payment_review($1,$2)", [
    owner,
    {
      ...plan,
      paymentId: "0x" + "02".repeat(32),
      action: {
        kind: "purchase",
        roundId: round,
        contractRoundId: "7",
        version: 0,
        requestId: randomUUID(),
        intent: { type: "buy", item: "armor" },
      },
    },
  ]);
  await memoryGameRecovery(() => fixture.api)(owner);
  checkpoint = await captureCheckpoint(fixture.sql, "recovery-baseline");
}, 30000);
afterAll(async () => {
  await fixture.sql.close();
});

function copyCheckpoint() {
  const directory = mkdtempSync("test-results/recovery/modified-");
  for (const file of ["manifest.json", "database.tar.gz"])
    copyFileSync(join(checkpoint.directory, file), join(directory, file));
  return { directory, digest: checkpoint.digest };
}
function rewriteManifest(
  copy: Checkpoint,
  modify: (data: Record<string, unknown>) => void,
) {
  const path = join(copy.directory, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  modify(manifest);
  const bytes = JSON.stringify(manifest);
  writeFileSync(path, bytes);
  copy.digest = createHash("sha256").update(bytes).digest("hex");
}

it("restores exact amounts and reviews, keeps MFA/RLS and privileged RPC denial", async () => {
  const sql = await restoreCheckpoint(checkpoint);
  try {
    expect(
      (
        await sql.query(
          "select amount::text,total_deposited::text from settlement_payments",
        )
      ).rows,
    ).toEqual([
      { amount: "1000000000000000000", total_deposited: "1000000000000000000" },
    ]);
    expect(
      (
        await sql.query(
          "select status from game_payment_reviews order by status",
        )
      ).rows,
    ).toEqual([{ status: "completed" }, { status: "open" }]);
    await expect(
      sql.query("select commit_game_action($1,$2,0,$3,$4,$5)", [
        round,
        owner,
        randomUUID(),
        { type: "move", destination: "clearing" },
        {},
      ]),
    ).rejects.toThrow("Recover the pending purchase before another action");
    await expect(
      sql.transaction(async (tx) => {
        await tx.query(
          "insert into profiles(user_id,display_name) values($1,'Must roll back')",
          [owner],
        );
        await tx.query(
          "insert into payment_receipts values(11155111,$1,'7',$2)",
          [contract, hash],
        );
      }),
    ).rejects.toThrow(/duplicate key/);
    expect((await sql.query("select * from profiles")).rows).toHaveLength(0);
    for (const [user, aal, count] of [
      [owner, "aal2", 1],
      [other, "aal2", 0],
      [owner, "aal1", 0],
    ] as const) {
      await sql.exec(
        `reset role;set request.jwt.claim.sub='${user}';set request.jwt.claim.aal='${aal}';set role authenticated;`,
      );
      expect((await sql.query("select * from contacts")).rows).toHaveLength(
        count,
      );
      expect((await sql.query("select * from game_rounds")).rows).toHaveLength(
        count,
      );
      for (const table of [
        "payment_receipts",
        "settlement_payments",
        "game_payment_reviews",
        "game_settlement_results",
      ])
        await expect(sql.query(`select * from ${table}`)).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        sql.query("select reserve_payment_review($1,$2)", [user, {}]),
      ).rejects.toThrow(/permission denied/);
    }
    await sql.exec("reset role;set role anon;");
    await expect(sql.query("select * from game_rounds")).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await sql.close();
  }
});

it("retains payment tombstones after synthetic account deletion and another restore", async () => {
  const sql = await restoreCheckpoint(checkpoint);
  let deleted: Checkpoint;
  try {
    await sql.query("delete from auth.users where id=$1", [owner]);
    deleted = await captureCheckpoint(sql, "deleted-fixture");
  } finally {
    await sql.close();
  }
  const restored = await restoreCheckpoint(deleted!);
  try {
    expect(
      (await restored.query("select * from game_rounds")).rows,
    ).toHaveLength(0);
    expect(
      (await restored.query("select * from payment_receipts")).rows,
    ).toHaveLength(1);
    expect(
      (
        await restored.query(
          "select round_id,transaction_hash from settlement_payments",
        )
      ).rows,
    ).toEqual([{ round_id: null, transaction_hash: hash }]);
    expect(
      (await restored.query("select user_id from game_payment_reviews")).rows,
    ).toEqual([{ user_id: null }, { user_id: null }]);
    await expect(
      restored.query(
        "insert into game_rounds(user_id,wallet_address,chain_id,gateway_address,contract_round_id,entry_tx_hash,entry_block_hash,class,state) values($1,$2,11155111,$3,'7',$4,$4,'warrior','{}')",
        [other, wallet, contract, hash],
      ),
    ).rejects.toThrow(/duplicate key/);
  } finally {
    await restored.close();
  }
});

it("rejects an older valid snapshot when the expected latest checkpoint differs", async () => {
  await fixture.sql.query(
    "insert into profiles(user_id,display_name) values($1,'New checkpoint')",
    [owner],
  );
  const latest = await captureCheckpoint(fixture.sql, "newer-state");
  await expect(
    restoreCheckpoint({ ...checkpoint, digest: latest.digest }),
  ).rejects.toThrow(/expected digest/);
  const sql = await restoreCheckpoint(latest);
  try {
    expect((await sql.query("select display_name from profiles")).rows).toEqual(
      [{ display_name: "New checkpoint" }],
    );
  } finally {
    await sql.close();
  }
});

it("rejects corrupt and missing archives before opening a database", async () => {
  const corrupt = copyCheckpoint();
  writeFileSync(
    join(corrupt.directory, "database.tar.gz"),
    "truncated archive",
  );
  await expect(restoreCheckpoint(corrupt)).rejects.toThrow(/integrity/);
  const missing = {
    ...checkpoint,
    directory: mkdtempSync("test-results/recovery/missing-"),
  };
  copyFileSync(
    join(checkpoint.directory, "manifest.json"),
    join(missing.directory, "manifest.json"),
  );
  await expect(restoreCheckpoint(missing)).rejects.toThrow(/ENOENT/);
});

it("rejects changed source fingerprints and incomplete security inventories", async () => {
  const staleSource = copyCheckpoint();
  rewriteManifest(staleSource, (m) => {
    m.source = "0".repeat(64);
  });
  await expect(restoreCheckpoint(staleSource)).rejects.toThrow(
    /source fingerprint/,
  );
  const incomplete = copyCheckpoint();
  rewriteManifest(incomplete, (m) => {
    m.inventory = {};
  });
  await expect(restoreCheckpoint(incomplete)).rejects.toThrow(
    /security definitions/,
  );
});

it("refuses capture with active writes or a credential-bearing Auth schema", async () => {
  const dump = fixture.sql.dumpDataDir.bind(fixture.sql);
  const spy = vi
    .spyOn(fixture.sql, "dumpDataDir")
    .mockImplementation(async (compression) => {
      const blob = await dump(compression);
      await fixture.sql.query(
        "insert into profiles(user_id,display_name) values($1,'Changed during snapshot') on conflict(user_id) do update set display_name=excluded.display_name",
        [owner],
      );
      return blob;
    });
  try {
    await expect(
      captureCheckpoint(fixture.sql, "concurrent-write"),
    ).rejects.toThrow(/changed during capture/);
  } finally {
    spy.mockRestore();
  }
  await fixture.sql.exec(
    "alter table auth.users add column encrypted_password text",
  );
  await expect(
    captureCheckpoint(fixture.sql, "real-auth-denied"),
  ).rejects.toThrow(/synthetic Auth schema/);
});

it("rejects destinations outside the rehearsal directory", async () => {
  await expect(
    restoreCheckpoint({ ...checkpoint, directory: process.cwd() }),
  ).rejects.toThrow(/only local rehearsal/);
  await expect(captureCheckpoint(fixture.sql, "../unsafe")).rejects.toThrow(
    /Invalid checkpoint label/,
  );
});
