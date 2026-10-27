import { afterEach, expect, it, vi } from "vitest";
import {
  initialState,
  reduceIntent,
  encounterPools,
  intentSchema,
} from "../../game/rules";
vi.mock("server-only", () => ({}));
import {
  verifyBeaconProof,
  paymentBeaconRound,
  beaconChoice,
  fetchVerifiedBeacon,
  quicknet,
} from "../../apps/web/src/server/beacon-randomness";
import {
  paidEncounters,
  verifyRoundRandomness,
} from "../../apps/web/src/server/round-randomness";
import type { SettlementPayment } from "../../apps/web/src/server/settlement-payments";

// Public quicknet round 1, retrieved from the official v2 endpoint. No fixture key.
const beacon = {
  round: 1,
  signature:
    "b55e7cb2d5c613ee0b2e28d6750aabbb78c39dcc96bd9d38c2c2e12198df95571de8e8e402a0cc48871c7089a2b3af4b",
};
const payment: SettlementPayment = {
  chainId: 11155111,
  contract: "0x3333333333333333333333333333333333333333",
  wallet: "0x4444444444444444444444444444444444444444",
  roundId: "7",
  hash: `0x${"ab".repeat(32)}`,
  blockHash: `0x${"cd".repeat(32)}`,
  blockNumber: "100",
  blockTimestamp: String(quicknet.genesis_time - 60),
  transactionIndex: 0,
  item: null,
  amount: "1000000000000000000",
  totalDeposited: "1000000000000000000",
  paymentId: `0x${"ef".repeat(32)}`,
  classId: "warrior",
  deadline: String(quicknet.genesis_time + 300),
};
afterEach(() => vi.unstubAllGlobals());

it("verifies a real historical BLS proof and rejects altered rounds, signatures and trust roots", async () => {
  const proof = await verifyBeaconProof(beacon, 1);
  expect(proof.randomness).toMatch(/^[0-9a-f]{64}$/);
  for (const [input, round] of [
    [beacon, 2],
    [{ ...beacon, signature: "0".repeat(96) }, 1],
    [{ ...proof, chainHash: "untrusted" }, 1],
    [{ ...proof, randomness: "0".repeat(64) }, 1],
  ] as const)
    await expect(verifyBeaconProof(input, round)).rejects.toThrow();
});
it("commits to the first draw at least 60 seconds after the canonical payment", () => {
  for (const offset of [0, 1, 2, 3, 1000]) {
    const timestamp = quicknet.genesis_time + offset;
    const round = paymentBeaconRound(String(timestamp));
    const time = quicknet.genesis_time + (round - 1) * quicknet.period;
    expect(time).toBeGreaterThanOrEqual(timestamp + 60);
    expect(time).toBeLessThan(timestamp + 63);
  }
});
it("reconstructs paid encounters and refuses a changed persisted outcome", async () => {
  const proof = await verifyBeaconProof(beacon, 1);
  const verified = { ...payment, randomnessProof: proof };
  const encounters = paidEncounters(verified, proof);
  encounters.forEach((enemy, index) =>
    expect(encounterPools[index]).toContain(enemy),
  );
  const state = initialState("warrior", false, {
    verifiedEncounters: encounters,
  });
  await verifyRoundRandomness(state, [verified]);
  await expect(
    verifyRoundRandomness(
      { ...state, encounters: [99, ...encounters.slice(1)] },
      [verified],
    ),
  ).rejects.toThrow("committed draw");
  await expect(verifyRoundRandomness(state, [payment])).rejects.toThrow(
    "missing",
  );
  const dancerPayment = {
    ...verified,
    item: 6,
    hash: `0x${"12".repeat(32)}` as const,
  };
  const roll = beaconChoice(proof, dancerPayment, "dancer", 100);
  const visited = reduceIntent(state, { type: "visit", place: "inn" });
  expect(() => reduceIntent(visited, { type: "dancer" }, 6)).toThrow(
    "randomness",
  );
  const danced = reduceIntent(visited, { type: "dancer" }, 6, roll);
  await verifyRoundRandomness(danced, [verified, dancerPayment]);
  await expect(
    verifyRoundRandomness(
      {
        ...danced,
        dancerOutcome:
          danced.dancerOutcome === "inspired" ? "slapped" : "inspired",
      },
      [verified, dancerPayment],
    ),
  ).rejects.toThrow("committed draw");
  expect(() =>
    intentSchema.parse({ type: "dancer", verifiedChance: 0 }),
  ).toThrow();
  expect(beaconChoice(proof, payment, "dancer", 100)).toBe(
    beaconChoice(proof, payment, "dancer", 100),
  );
  expect(
    new Set(
      Array.from({ length: 20 }, (_, n) =>
        beaconChoice(proof, payment, `scope:${n}`, 100),
      ),
    ).size,
  ).toBeGreaterThan(5);
});
it("uses a second fixed relay and keeps an unavailable draw recoverable", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("offline", { status: 503 }))
    .mockResolvedValueOnce(Response.json(beacon));
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchVerifiedBeacon(1)).round).toBe(1);
  expect(fetcher.mock.calls[1][0]).toContain(
    "https://api2.drand.sh/v2/chains/",
  );
  fetcher.mockResolvedValue(new Response("unavailable", { status: 404 }));
  await expect(fetchVerifiedBeacon(2)).rejects.toThrow("do not pay again");
});
