import { isAddressEqual, parseAbi, type Hex, type PublicClient } from "viem";
import type { SavedGameReview } from "./game-plan";
import { gameDeploymentReview } from "./game-plan";
import {
  GameVerificationError,
  verifyGameDeployment,
  type CompiledGameArtifact,
} from "./game-verification";

export type GameReceiptHashes = { deploymentHash?: Hex; fundingHash?: Hex };

// Server-only preparation: recheck current roles/cap before offering creation,
// and independently verify the deployment before preparing its exact reserve.
export async function prepareGameTransaction(
  rpc: PublicClient,
  plan: SavedGameReview,
  artifact: CompiledGameArtifact,
  hashes: GameReceiptHashes,
) {
  if (hashes.fundingHash && !hashes.deploymentHash)
    throw new GameVerificationError("Verify the deployment before funding.");
  if (hashes.deploymentHash) {
    const verified = await verifyGameDeployment(rpc, plan, artifact, {
      deploymentHash: hashes.deploymentHash,
      ...(hashes.fundingHash ? { fundingHash: hashes.fundingHash } : {}),
    });
    return {
      fingerprint: plan.fingerprint,
      step: verified.fundingTransaction ? ("fund" as const) : ("done" as const),
      transaction: verified.fundingTransaction,
      verified,
    };
  }
  if ((await rpc.getChainId()) !== 11155111)
    throw new GameVerificationError("Connect to Ethereum Sepolia.");
  const blockNumber = (await rpc.getBlockNumber({ cacheTime: 0 })) - 1n;
  const checkpoint = await rpc.getBlock({ blockNumber });
  const abi = parseAbi([
    "function owner() view returns (address)",
    "function pendingOwner() view returns (address)",
    "function token() view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function cap() view returns (uint256)",
  ]);
  const [owner, pendingOwner, token, supply, cap, ...code] = await Promise.all([
    rpc.readContract({
      address: plan.token,
      abi,
      functionName: "owner",
      blockNumber,
    }),
    rpc.readContract({
      address: plan.token,
      abi,
      functionName: "pendingOwner",
      blockNumber,
    }),
    rpc.readContract({
      address: plan.faucet,
      abi,
      functionName: "token",
      blockNumber,
    }),
    rpc.readContract({
      address: plan.token,
      abi,
      functionName: "totalSupply",
      blockNumber,
    }),
    rpc.readContract({
      address: plan.token,
      abi,
      functionName: "cap",
      blockNumber,
    }),
    ...[plan.token, plan.faucet, plan.signer].map((address) =>
      rpc.getCode({ address, blockNumber }),
    ),
  ]);
  if (
    !code[0] ||
    code[0] === "0x" ||
    !code[1] ||
    code[1] === "0x" ||
    (code[2] && code[2] !== "0x")
  )
    throw new GameVerificationError(
      "Expected existing token/faucet and a separate EOA signer.",
    );
  let current;
  try {
    current = gameDeploymentReview({
      ...plan,
      tokenOwner: owner,
      pendingTokenOwner: pendingOwner,
      faucetToken: token,
      supply,
      cap,
      artifact,
    });
  } catch {
    throw new GameVerificationError(
      "Current roles or mint capacity differ from the reviewed plan.",
    );
  }
  if (
    !isAddressEqual(owner, plan.owner) ||
    current.fingerprint !== plan.fingerprint ||
    (await rpc.getBlock({ blockNumber })).hash !== checkpoint.hash ||
    (await rpc.getChainId()) !== 11155111
  )
    throw new GameVerificationError(
      "The plan or confirmed chain snapshot changed. Review it again.",
    );
  return {
    fingerprint: plan.fingerprint,
    step: "deploy" as const,
    transaction: plan.deployment,
    verified: null,
  };
}

export type PreparedGameTransaction = Awaited<
  ReturnType<typeof prepareGameTransaction>
>;
