import { vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getContractAddress,
  parseAbi,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  gameDeploymentReview,
  type SavedGameReview,
} from "../../apps/web/src/features/deployment/game-plan";
import {
  gameFundingTransaction,
  type CompiledGameArtifact,
} from "../../apps/web/src/features/deployment/game-verification";

export const fixtureHash = (byte: string) => `0x${byte.repeat(64)}` as Hex;
export function gameDeploymentFixture(funded = false) {
  const owner: Address = "0x1000000000000000000000000000000000000001";
  const token: Address = "0x2000000000000000000000000000000000000002";
  const faucet: Address = "0x3000000000000000000000000000000000000003";
  const signer: Address = "0x4000000000000000000000000000000000000004";
  const economy = getContractAddress({ from: owner, nonce: 3n });
  const artifact: CompiledGameArtifact = {
    abi: [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: ["token", "pool", "signer", "owner"].map((name) => ({
          name,
          type: "address",
        })),
      },
    ],
    bytecode: "0x60016000",
    runtime: `0x6000${"0".repeat(64)}6001`,
    immutables: { "1": [{ start: 2, length: 32 }] },
  };
  const plan: SavedGameReview = {
    ...gameDeploymentReview({
      chainId: 11155111,
      owner,
      tokenOwner: owner,
      pendingTokenOwner: zeroAddress,
      token,
      faucet,
      faucetToken: token,
      signer,
      bonusTokens: "100",
      supply: parseUnits("5000", 18),
      cap: parseUnits("1000000", 18),
      artifact: { abi: artifact.abi, bytecode: artifact.bytecode },
    }),
    checkedAt: "2026-10-25T12:00:00Z",
    blockNumber: "90",
    blockHash: fixtureHash("9"),
  };
  const hashes = {
    deploymentHash: fixtureHash("1"),
    ...(funded ? { fundingHash: fixtureHash("2") } : {}),
  };
  const deployment = {
    transactionHash: hashes.deploymentHash,
    blockHash: fixtureHash("a"),
    blockNumber: 100n,
    transactionIndex: 0,
    from: owner,
    to: null as Address | null,
    contractAddress: economy as Address | null,
    status: "success",
    logs: [] as unknown[],
  };
  const funding = {
    ...deployment,
    transactionHash: fixtureHash("2"),
    blockNumber: 101n,
    blockHash: fixtureHash("b"),
    to: token,
    contractAddress: null,
    logs: [
      {
        address: token,
        data: encodeAbiParameters(
          [{ type: "uint256" }],
          [BigInt(plan.reserveUnits)],
        ),
        topics: encodeEventTopics({
          abi: parseAbi([
            "event Transfer(address indexed from,address indexed to,uint256 value)",
          ]),
          eventName: "Transfer",
          args: { from: zeroAddress, to: economy },
        }),
        transactionHash: fixtureHash("2"),
        blockHash: fixtureHash("b"),
        blockNumber: 101n,
        transactionIndex: 0,
        logIndex: 0,
        removed: false,
      },
    ],
  };
  const tx = {
    hash: hashes.deploymentHash,
    chainId: 11155111,
    from: owner,
    to: null as Address | null,
    value: 0n,
    input: plan.deployment.data,
    nonce: 3,
    blockHash: deployment.blockHash,
    blockNumber: 100n,
    transactionIndex: 0,
  };
  const fundingTx = {
    ...tx,
    hash: fixtureHash("2"),
    to: token,
    input: gameFundingTransaction(plan, economy).data,
    blockHash: funding.blockHash,
    blockNumber: 101n,
    nonce: 4,
  };
  const states: Record<string, unknown> = {
    token,
    recyclingPool: faucet,
    signer,
    owner,
    pendingOwner: zeroAddress,
    paused: true,
    nextRoundId: 1n,
    escrowed: 0n,
    bonusReserved: 0n,
    availableBonusPool: funded ? BigInt(plan.reserveUnits) : 0n,
    balanceOf: funded ? BigInt(plan.reserveUnits) : 0n,
    totalSupply: parseUnits(funded ? "5100" : "5000", 18),
    cap: parseUnits("1000000", 18),
    eip712Domain: [
      "0x0f",
      "LanternValeSettlement",
      "1",
      11155111n,
      economy,
      fixtureHash("0"),
      [],
    ],
  };
  const mock = {
    getChainId: vi.fn(async () => 11155111),
    getBlockNumber: vi.fn(async () => 104n),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash:
        blockNumber === 100n
          ? fixtureHash("a")
          : blockNumber === 101n
            ? fixtureHash("b")
            : fixtureHash("c"),
    })),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) =>
      hash === hashes.deploymentHash ? deployment : funding,
    ),
    getTransaction: vi.fn(async ({ hash }: { hash: Hex }) =>
      hash === hashes.deploymentHash ? tx : fundingTx,
    ),
    getCode: vi.fn(async ({ address }: { address: Address }) =>
      address === economy
        ? artifact.runtime.replace(
            "0".repeat(64),
            token.slice(2).padStart(64, "0"),
          )
        : address === signer
          ? "0x"
          : "0x6001",
    ),
    readContract: vi.fn(
      async ({ functionName }: { functionName: string }) =>
        states[functionName],
    ),
  };
  return {
    plan,
    artifact,
    hashes,
    economy,
    deployment,
    funding,
    tx,
    fundingTx,
    states,
    mock,
    rpc: mock as unknown as PublicClient,
  };
}
