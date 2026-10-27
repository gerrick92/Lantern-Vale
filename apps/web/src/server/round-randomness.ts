import "server-only";
import { encounterPools, type GameState } from "@game/rules";
import {
  beaconChoice,
  paymentBeaconRound,
  verifyBeaconProof,
  type BeaconProof,
} from "./beacon-randomness";
import type { SettlementPayment } from "./settlement-payments";

export function paidEncounters(payment: SettlementPayment, proof: BeaconProof) {
  return encounterPools.map(
    (pool, index) =>
      pool[beaconChoice(proof, payment, `encounter:${index}`, pool.length)],
  );
}

// Reconcile persisted outcomes against public proofs before authorizing settlement.
export async function verifyRoundRandomness(
  state: GameState,
  payments: SettlementPayment[],
) {
  const entry = payments.find((payment) => payment.item === null);
  if (!entry?.randomnessProof)
    throw new Error("The entry randomness proof is missing.");
  const entryProof = await verifyBeaconProof(
    entry.randomnessProof,
    paymentBeaconRound(entry.blockTimestamp),
  );
  if (
    JSON.stringify(paidEncounters(entry, entryProof)) !==
    JSON.stringify(state.encounters)
  )
    throw new Error(
      "The encounter selection does not match its committed draw.",
    );
  for (const [item, label] of [
    [6, "dancer"],
    [7, "fairy"],
  ] as const) {
    const matches = payments.filter((payment) => payment.item === item);
    if (
      matches.length !==
      (label === "dancer" ? Number(state.dancerDone) : Number(state.fairyDone))
    )
      throw new Error("The chance encounter does not match its payment.");
    if (!matches.length) continue;
    const payment = matches[0];
    if (!payment.randomnessProof)
      throw new Error("The chance encounter proof is missing.");
    const proof = await verifyBeaconProof(
      payment.randomnessProof,
      paymentBeaconRound(payment.blockTimestamp),
    );
    const roll = beaconChoice(proof, payment, label, 100);
    const outcome =
      label === "dancer"
        ? roll < 25
          ? "inspired"
          : roll < 50
            ? "drained"
            : "slapped"
        : roll < 25
          ? "wild"
          : "toad";
    if (
      outcome !==
      (label === "dancer" ? state.dancerOutcome : state.fairyOutcome)
    )
      throw new Error(
        "The chance encounter outcome does not match its committed draw.",
      );
  }
}
