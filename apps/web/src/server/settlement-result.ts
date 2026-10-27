import "server-only";
import { isAddressEqual, type Address } from "viem";
import { BOSS_ENCOUNTER, isPaidVictory, type GameState } from "@game/rules";
import { GLOW_PRICE, settlementResultTypes } from "@/lib/settlement";
import type { SettlementPayment } from "./settlement-payments";

// Inputs must be server-owned state and freshly reverified canonical receipts.
// This prepares typed data only; no signer or payout is enabled here.
export function settlementResult(
  state: GameState,
  wallet: Address,
  contract: Address,
  roundId: bigint,
  payments: SettlementPayment[],
  deadline: bigint,
) {
  if (
    state.mode !== "paid" ||
    state.demo ||
    !["victory", "defeat"].includes(state.phase) ||
    deadline <= 0n
  )
    throw new Error("A terminal server-owned paid round is required.");
  const won = isPaidVictory(state);
  if (
    (state.phase === "victory" && !won) ||
    (state.phase === "defeat" && state.hp !== 0)
  )
    throw new Error("The terminal result is inconsistent.");
  const ordered = [...payments].sort((a, b) =>
    BigInt(a.totalDeposited) < BigInt(b.totalDeposited) ? -1 : 1,
  );
  const seen = new Set<string>();
  let deposited = 0n;
  for (const [index, payment] of ordered.entries()) {
    if (
      payment.chainId !== 11155111 ||
      !isAddressEqual(payment.contract, contract) ||
      !isAddressEqual(payment.wallet, wallet) ||
      payment.roundId !== roundId.toString() ||
      payment.classId !== state.classId ||
      BigInt(payment.amount) !== GLOW_PRICE ||
      (index === 0) !== (payment.item === null) ||
      seen.has(payment.hash.toLowerCase())
    )
      throw new Error(
        "The deposit ledger contains an invalid or duplicate payment.",
      );
    deposited += GLOW_PRICE;
    if (BigInt(payment.totalDeposited) !== deposited)
      throw new Error("The deposit ledger has a gap.");
    seen.add(payment.hash.toLowerCase());
  }
  if (
    deposited === 0n ||
    !Number.isSafeInteger(state.spent) ||
    deposited !== BigInt(state.spent) * GLOW_PRICE ||
    state.ledger.some((entry) => entry.amount !== 1) ||
    state.ledger.length !== state.spent
  )
    throw new Error(
      "Deposits and server spending must agree before settlement.",
    );
  return {
    domain: {
      name: "LanternValeSettlement",
      version: "1",
      chainId: 11155111,
      verifyingContract: contract,
    } as const,
    types: settlementResultTypes,
    primaryType: "Result" as const,
    message: {
      roundId,
      player: wallet,
      deposited,
      won,
      fullClear:
        won &&
        Array.from({ length: BOSS_ENCOUNTER + 1 }, (_, i) => i).every((slot) =>
          state.cleared.includes(slot),
        ),
      deadline,
    },
  };
}
