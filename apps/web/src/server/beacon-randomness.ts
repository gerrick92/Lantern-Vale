import "server-only";
import { createHash } from "node:crypto";
import {
  fetchBeacon,
  type ChainInfo,
  type RandomnessBeacon,
} from "drand-client";
import { z } from "zod";
import type { SettlementPayment } from "./settlement-payments";
import { ApiError } from "./http";

// Public trust root from drand-client 1.4.2 and the official quicknet chain info.
// Never replace these with relay-supplied parameters or client input.
export const quicknet: ChainInfo = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};
const beaconSchema = z.object({
  round: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  signature: z.string().regex(/^[0-9a-f]{96}$/i),
});
export type BeaconProof = {
  chainHash: string;
  round: number;
  signature: string;
  randomness: string;
};
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export function paymentBeaconRound(blockTimestamp: string) {
  const delta = BigInt(blockTimestamp) + 60n - BigInt(quicknet.genesis_time);
  if (delta < 0n)
    throw new Error("The payment predates the randomness network.");
  const round = (delta + 2n) / 3n + 1n;
  if (round > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Randomness round is out of range.");
  return Number(round);
}

export async function verifyBeaconProof(
  input: unknown,
  expectedRound: number,
): Promise<BeaconProof> {
  const raw = beaconSchema.parse(input);
  const proof = {
    chainHash: quicknet.hash,
    ...raw,
    signature: raw.signature.toLowerCase(),
    randomness: sha256(Buffer.from(raw.signature, "hex")),
  };
  // Use the official client's signature verifier with a fixed local trust root.
  // The relay has no way to provide an alternative key, scheme or genesis time.
  const beacon: RandomnessBeacon = proof;
  await fetchBeacon(
    {
      options: { disableBeaconVerification: false, noCache: false },
      chain: () => ({ baseUrl: "", info: async () => quicknet }),
      get: async () => beacon,
      latest: async () => beacon,
    },
    expectedRound,
  );
  if (typeof input === "object" && input !== null) {
    const saved = input as Partial<BeaconProof>;
    if (
      (saved.chainHash !== undefined && saved.chainHash !== proof.chainHash) ||
      (saved.randomness !== undefined && saved.randomness !== proof.randomness)
    )
      throw new Error("Randomness proof does not match the pinned chain.");
  }
  return proof;
}

export async function fetchVerifiedBeacon(round: number): Promise<BeaconProof> {
  for (const host of ["api.drand.sh", "api2.drand.sh"]) {
    try {
      const response = await fetch(
        `https://${host}/v2/chains/${quicknet.hash}/rounds/${round}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        },
      );
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      let raw = "",
        size = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2048) {
            await reader.cancel();
            throw new Error();
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      return await verifyBeaconProof(JSON.parse(raw), round);
    } catch {
      /* A second fixed relay can supply the same verifiable proof. */
    }
  }
  throw new ApiError(
    503,
    "The committed randomness draw is not available yet. Your payment remains recoverable; do not pay again.",
    "DRAW_PENDING",
  );
}

export async function paymentRandomness(payment: SettlementPayment) {
  return fetchVerifiedBeacon(paymentBeaconRound(payment.blockTimestamp));
}

export function beaconChoice(
  proof: BeaconProof,
  payment: SettlementPayment,
  label: string,
  count: number,
) {
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new Error("Invalid outcome count.");
  const bound = BigInt(count),
    size = 1n << 256n,
    limit = size - (size % bound);
  // Domain separation prevents reusing a draw across players, rounds or actions.
  for (let counter = 0; ; counter++) {
    const value = BigInt(
      "0x" +
        sha256(
          JSON.stringify([
            "LanternValeRandomness-v1",
            payment.chainId,
            payment.contract.toLowerCase(),
            payment.roundId,
            payment.wallet.toLowerCase(),
            payment.hash.toLowerCase(),
            proof.chainHash,
            proof.round,
            proof.randomness,
            label,
            counter,
          ]),
        ),
    );
    if (value < limit) return Number(value % bound);
  }
}
