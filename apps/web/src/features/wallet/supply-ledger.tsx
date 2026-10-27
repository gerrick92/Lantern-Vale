"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection, usePublicClient } from "wagmi";
import {
  erc20Abi,
  formatUnits,
  parseAbi,
  isAddressEqual,
  type Address,
} from "viem";
import { CHAIN_ID, contracts } from "@/lib/chain";
import { supplyAccounting, settlementAccounting } from "@/lib/token-supply";
import { settlementAbi } from "@/lib/settlement";

const supplyAbi = parseAbi([
  "function cap() view returns (uint256)",
  "function treasury() view returns (address)",
]);

export function SupplyLedger({
  settlementAddress,
}: {
  settlementAddress?: Address;
}) {
  const { address: walletAddress } = useConnection();
  const rpc = usePublicClient({ chainId: CHAIN_ID });
  const snapshot = useQuery({
    queryKey: [
      "glow-supply-ledger",
      CHAIN_ID,
      contracts,
      settlementAddress,
      walletAddress,
    ],
    enabled: !!rpc && !!contracts.token,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      if (!rpc || !contracts.token || (await rpc.getChainId()) !== CHAIN_ID)
        throw new Error("A Sepolia connection is required.");
      const address = contracts.token;
      const blockNumber = await rpc.getBlockNumber({ cacheTime: 0 });
      const [name, symbol, decimals, cap, minted] = await Promise.all([
        rpc.readContract({
          address,
          abi: erc20Abi,
          functionName: "name",
          blockNumber,
        }),
        rpc.readContract({
          address,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber,
        }),
        rpc.readContract({
          address,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber,
        }),
        rpc.readContract({
          address,
          abi: supplyAbi,
          functionName: "cap",
          blockNumber,
        }),
        rpc.readContract({
          address,
          abi: erc20Abi,
          functionName: "totalSupply",
          blockNumber,
        }),
      ]);
      if (name !== "Lantern Vale Glow" || symbol !== "GLOW" || decimals !== 18)
        throw new Error("Token metadata does not match GLOW.");
      const pools: { address: Address; label: string }[] = walletAddress
        ? [{ address: walletAddress, label: "Your wallet" }]
        : [];
      if (contracts.faucet)
        pools.push({ address: contracts.faucet, label: "Faucet pool" });
      if (contracts.reward)
        pools.push({ address: contracts.reward, label: "Reward pool" });
      if (contracts.gateway) {
        pools.push({ address: contracts.gateway, label: "Game contract" });
        const treasury = await rpc.readContract({
          address: contracts.gateway,
          abi: supplyAbi,
          functionName: "treasury",
          blockNumber,
        });
        pools.push({ address: treasury, label: "Treasury" });
      }
      let settlement;
      if (settlementAddress) {
        const [token, pool, deposits, reserved, available, balance] =
          await Promise.all([
            rpc.readContract({
              address: settlementAddress,
              abi: settlementAbi,
              functionName: "token",
              blockNumber,
            }),
            rpc.readContract({
              address: settlementAddress,
              abi: settlementAbi,
              functionName: "recyclingPool",
              blockNumber,
            }),
            rpc.readContract({
              address: settlementAddress,
              abi: settlementAbi,
              functionName: "escrowed",
              blockNumber,
            }),
            rpc.readContract({
              address: settlementAddress,
              abi: settlementAbi,
              functionName: "bonusReserved",
              blockNumber,
            }),
            rpc.readContract({
              address: settlementAddress,
              abi: settlementAbi,
              functionName: "availableBonusPool",
              blockNumber,
            }),
            rpc.readContract({
              address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [settlementAddress],
              blockNumber,
            }),
          ]);
        if (
          !isAddressEqual(token, address) ||
          !contracts.faucet ||
          !isAddressEqual(pool, contracts.faucet)
        )
          throw new Error("Game escrow configuration does not match GLOW.");
        settlement = settlementAccounting(
          balance,
          deposits,
          reserved,
          available,
        );
        pools.push({
          address: settlementAddress,
          label: "Game escrow and bonus reserve",
        });
      }
      const balances = await Promise.all(
        pools.map(async (pool) => ({
          ...pool,
          balance: await rpc.readContract({
            address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [pool.address],
            blockNumber,
          }),
        })),
      );
      signal.throwIfAborted();
      return {
        ...supplyAccounting(cap, minted, balances),
        blockNumber,
        settlement,
      };
    },
  });
  const data = snapshot.data;
  return (
    <section className="panel" aria-labelledby="glow-supply-heading">
      <h2 id="glow-supply-heading">GLOW supply</h2>
      {!contracts.token ? (
        <p>
          Live supply and pool balances will appear after verified deployment.
        </p>
      ) : snapshot.isError ? (
        <p role="alert">
          Supply could not be verified. No estimated figures are shown.
        </p>
      ) : !data ? (
        <p role="status">Reading Sepolia supply…</p>
      ) : (
        <>
          {!walletAddress && (
            <p>Connect your wallet to see your share of the supply.</p>
          )}
          <dl className="allocation-legend">
            <div>
              <dt>Supply cap</dt>
              <dd>{formatUnits(data.cap, 18)} GLOW</dd>
            </div>
            <div>
              <dt>Minted and not burned</dt>
              <dd>{formatUnits(data.minted, 18)} GLOW</dd>
            </div>
            <div>
              <dt>Remaining mint capacity</dt>
              <dd>{formatUnits(data.unminted, 18)} GLOW</dd>
            </div>
            {data.pools.map((pool) => (
              <div key={pool.address}>
                <dt>{pool.label}</dt>
                <dd>{formatUnits(pool.balance, 18)} GLOW</dd>
              </div>
            ))}
            <div>
              <dt>Other addresses</dt>
              <dd>{formatUnits(data.otherAddresses, 18)} GLOW</dd>
            </div>
          </dl>
          {data.settlement && (
            <details className="disclosure">
              <summary>Inside the game reserve</summary>
              <dl className="allocation-legend">
                <div>
                  <dt>Player deposits held for open adventures</dt>
                  <dd>{formatUnits(data.settlement.deposits, 18)} GLOW</dd>
                </div>
                <div>
                  <dt>Bonuses reserved for open adventures</dt>
                  <dd>{formatUnits(data.settlement.reserved, 18)} GLOW</dd>
                </div>
                <div>
                  <dt>Available for new adventure bonuses</dt>
                  <dd>{formatUnits(data.settlement.available, 18)} GLOW</dd>
                </div>
              </dl>
              <p>
                These are parts of the game contract balance above, counted
                once. Player deposits are never available bonus funding.
              </p>
            </details>
          )}
          <p className="small-note">
            All figures from Sepolia block {data.blockNumber.toString()}. Shared
            pool addresses are counted once.
          </p>
        </>
      )}
      <details className="disclosure">
        <summary>What these figures mean</summary>
        <p>
          Minting creates tokens. A faucet claim moves existing tokens from its
          pool to a wallet. Losing a round moves the tokens used into the
          recycling pool; it does not burn them.
        </p>
        <p>
          Your wallet is the currently connected address. Other addresses
          include all remaining wallets and contracts outside the listed project
          pools. They cannot be identified as individual people. Pool holdings
          are not automatically available rewards: open rounds may reserve
          tokens.
        </p>
        <p>
          GLOW has no USD price or redemption value. The supply cap limits
          existing tokens, not all tokens ever minted: burning creates room to
          mint again.
        </p>
      </details>
    </section>
  );
}
