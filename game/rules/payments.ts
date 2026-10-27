import type { Intent } from "./intent";

// Indices must match LanternGameEconomy.purchase. Prices are always one GLOW.
export const purchaseIds = {
  weapon: 0,
  armor: 1,
  potion: 2,
  ether: 3,
  spark: 4,
  mend: 5,
} as const;
export function paymentItem(intent: Intent): number | undefined {
  if (intent.type === "buy") return purchaseIds[intent.item];
  if (intent.type === "dancer") return 6;
  if (intent.type === "fairy") return 7;
  if (intent.type === "rest") return 8;
  return undefined;
}
