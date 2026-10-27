export type PoolBalance = { address: string; label: string; balance: bigint };

export function settlementAccounting(
  balance: bigint,
  deposits: bigint,
  reserved: bigint,
  available: bigint,
) {
  if (
    [balance, deposits, reserved, available].some((value) => value < 0n) ||
    balance !== deposits + reserved + available
  )
    throw new Error(
      "Settlement balances do not conserve deposits and reserves.",
    );
  return { balance, deposits, reserved, available };
}

export function supplyAccounting(
  cap: bigint,
  minted: bigint,
  pools: PoolBalance[],
) {
  if (cap < 0n || minted < 0n || minted > cap)
    throw new Error("Invalid token supply.");
  const unique = new Map<string, PoolBalance>();
  for (const pool of pools) {
    if (pool.balance < 0n) throw new Error("Invalid pool balance.");
    const key = pool.address.toLowerCase();
    const previous = unique.get(key);
    if (previous && previous.balance !== pool.balance)
      throw new Error("Pool balances must come from the same block.");
    unique.set(
      key,
      previous
        ? { ...previous, label: `${previous.label} / ${pool.label}` }
        : pool,
    );
  }
  const balances = [...unique.values()];
  const held = balances.reduce((total, pool) => total + pool.balance, 0n);
  if (held > minted) throw new Error("Pool balances exceed total supply.");
  return {
    cap,
    minted,
    unminted: cap - minted,
    pools: balances,
    otherAddresses: minted - held,
  };
}
