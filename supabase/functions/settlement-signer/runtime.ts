import {
  createPublicClient,
  http,
  isAddressEqual,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { address, type ChainEvidence, type Policy } from "./policy.ts";
import { createServiceGuard, createSignerHandler } from "./handler.ts";

const abi = parseAbi([
  "function rounds(uint256) view returns (address,uint256,uint16,bool,uint8)",
  "function token() view returns (address)",
  "function recyclingPool() view returns (address)",
  "function owner() view returns (address)",
  "function signer() view returns (address)",
]);
type ReadEnvironment = (name: string) => string | undefined;
// Select only the terminal projection; repeat healing must not make signing
// depend on returning an ever-growing gameplay log or spending ledger.
const stateFields = [
  "rulesVersion",
  "mode",
  "demo",
  "phase",
  "classId",
  "hp",
  "enemyHp",
  "encounter",
  "cleared",
  "spent",
];
function https(value: string | undefined) {
  const url = new URL(value || "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("Invalid service endpoint");
  return url;
}
export function configuredHandler(env: ReadEnvironment) {
  // No key is read and no connection is made while the service is disabled.
  if (env("LV_SIGNING_ENABLED") !== "true") {
    // Verify the caller during provisioning without loading a key or enabling signing.
    const token = env("LV_SIGNER_TOKEN");
    const guard = token ? createServiceGuard(token) : undefined;
    return async (request: Request) =>
      guard?.(request) ??
      Response.json(
        { error: "Signing is disabled." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
  }
  const key = env("LV_SIGNER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key || ""))
    throw new Error("Missing signing configuration");
  const account = privateKeyToAccount(key as Hex);
  const policy: Policy = {
    contract: address.parse(env("LV_ECONOMY_ADDRESS")),
    token: address.parse(env("LV_TOKEN_ADDRESS")),
    pool: address.parse(env("LV_FAUCET_ADDRESS")),
    signer: account.address,
  };
  const database = https(env("SUPABASE_URL"));
  if (
    !/^[a-z]{20}\.supabase\.co$/.test(database.hostname) ||
    database.pathname !== "/"
  )
    throw new Error("Invalid database endpoint");
  const databaseKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!databaseKey) throw new Error("Missing database configuration");
  const client = createPublicClient({
    chain: sepolia,
    transport: http(https(env("LV_SEPOLIA_RPC_URL")).href, {
      timeout: 5000,
      retryCount: 0,
      fetchOptions: { redirect: "error" },
    }),
  });
  return createSignerHandler({
    enabled: true,
    token: env("LV_SIGNER_TOKEN") || "",
    policy,
    now: () => Math.floor(Date.now() / 1000),
    async loadRound(roundId) {
      const url = new URL("/rest/v1/game_rounds", database);
      url.search = new URLSearchParams({
        select: [
          "chain_id",
          "gateway_address",
          "contract_round_id",
          "wallet_address",
          "economy_version",
          "class",
          ...stateFields.map((field) => `${field}:state->${field}`),
        ].join(","),
        chain_id: "eq.11155111",
        gateway_address: `eq.${policy.contract.toLowerCase()}`,
        contract_round_id: `eq.${roundId}`,
        limit: "2",
      }).toString();
      const response = await fetch(url, {
        headers: {
          apikey: databaseKey,
          Authorization: `Bearer ${databaseKey}`,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Database unavailable");
      // State is server-written; bound the response nevertheless.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing state");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 262144) throw new Error("State limit exceeded");
          parts.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      const rows: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (!Array.isArray(rows) || rows.length !== 1)
        throw new Error("Round unavailable");
      const row = rows[0];
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("Invalid state");
      const retained = await fetch(
        new URL("/rest/v1/rpc/game_round_recovery_ready", database),
        {
          method: "POST",
          headers: {
            apikey: databaseKey,
            Authorization: `Bearer ${databaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_contract: policy.contract.toLowerCase(),
            p_round: roundId.toString(),
          }),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!retained.ok || (await retained.text()) !== "true")
        throw new Error("Round recovery is not confirmed");
      return {
        ...row,
        state: Object.fromEntries(
          stateFields.map((field) => [field, row[field]]),
        ),
      };
    },
    async readChain(roundId): Promise<ChainEvidence> {
      const [chainId, head] = await Promise.all([
        client.getChainId(),
        client.getBlockNumber({ cacheTime: 0 }),
      ]);
      if (chainId !== 11155111 || head < 1n) throw new Error("Wrong chain");
      const block = await client.getBlock({ blockNumber: head - 1n });
      const read = { abi, blockNumber: block.number } as const;
      const [round, token, pool, signer, owner, tokenOwner, poolToken] =
        await Promise.all([
          client.readContract({
            ...read,
            address: policy.contract,
            functionName: "rounds",
            args: [roundId],
          }),
          client.readContract({
            ...read,
            address: policy.contract,
            functionName: "token",
          }),
          client.readContract({
            ...read,
            address: policy.contract,
            functionName: "recyclingPool",
          }),
          client.readContract({
            ...read,
            address: policy.contract,
            functionName: "signer",
          }),
          client.readContract({
            ...read,
            address: policy.contract,
            functionName: "owner",
          }),
          client.readContract({
            ...read,
            address: policy.token,
            functionName: "owner",
          }),
          client.readContract({
            ...read,
            address: policy.pool,
            functionName: "token",
          }),
        ]);
      return {
        chainId,
        timestamp: block.timestamp,
        blockHash: block.hash,
        token,
        pool,
        signer,
        owner,
        tokenOwner,
        poolToken,
        player: round[0],
        deposited: round[1],
        settled: round[3],
        classId: round[4],
      };
    },
    async recheck(evidence) {
      const [original, signer, owner, tokenOwner] = await Promise.all([
        client.getBlock({ blockHash: evidence.blockHash }),
        client.readContract({
          abi,
          address: policy.contract,
          functionName: "signer",
        }),
        client.readContract({
          abi,
          address: policy.contract,
          functionName: "owner",
        }),
        client.readContract({
          abi,
          address: policy.token,
          functionName: "owner",
        }),
      ]);
      const canonical = await client.getBlock({ blockNumber: original.number });
      if (
        canonical.hash !== evidence.blockHash ||
        !isAddressEqual(signer, policy.signer) ||
        isAddressEqual(owner, policy.signer) ||
        isAddressEqual(tokenOwner, policy.signer)
      )
        throw new Error("Signing authority changed");
    },
    sign: (result) => account.signTypedData(result),
  });
}
