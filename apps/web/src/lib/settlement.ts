import { parseAbi } from "viem";
import type { ClassId } from "@game/rules";

// Persisted protocol ordering; never derive this from display sorting.
export const settlementClasses = [
  "warrior",
  "dark_knight",
  "white_mage",
  "black_mage",
  "ranger",
  "thief",
] as const satisfies readonly ClassId[];

export const GLOW_PRICE = 10n ** 18n;
export const settlementAbi = parseAbi([
  "function token() view returns (address)",
  "function recyclingPool() view returns (address)",
  "function signer() view returns (address)",
  "function paused() view returns (bool)",
  "function enter(uint8 classId,bytes32 paymentId,uint256 deadline) returns (uint256)",
  "function purchase(uint256 id,uint8 item,bytes32 paymentId,uint256 deadline)",
  "function paymentRound(address player,bytes32 paymentId) view returns (uint256)",
  "function rounds(uint256) view returns (address player,uint256 deposited,uint16 purchases,bool settled,uint8 classId)",
  "function escrowed() view returns (uint256)",
  "function bonusReserved() view returns (uint256)",
  "function availableBonusPool() view returns (uint256)",
  "function bonusAllowance(address player) view returns (uint256)",
  "function settle((uint256 roundId,address player,uint256 deposited,bool won,bool fullClear,uint256 deadline) result,bytes signature)",
  "event Entered(uint256 indexed roundId,address indexed player,bytes32 indexed paymentId,uint8 classId,uint256 amount)",
  "event Purchased(uint256 indexed roundId,uint8 indexed item,bytes32 indexed paymentId,uint256 amount,uint256 totalDeposited)",
  "event Settled(uint256 indexed roundId,address indexed player,bool won,uint256 returned,uint256 bonus,uint256 recycled)",
]);
export const settlementResultTypes = {
  Result: [
    { name: "roundId", type: "uint256" },
    { name: "player", type: "address" },
    { name: "deposited", type: "uint256" },
    { name: "won", type: "bool" },
    { name: "fullClear", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
