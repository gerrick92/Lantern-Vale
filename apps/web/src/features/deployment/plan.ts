import {
  encodeDeployData,
  encodeFunctionData,
  isAddress,
  parseAbi,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type Transaction,
  type TransactionReceipt,
} from "viem";
export const deploymentPlan = "lantern-vale-token-faucet-v1";
export const deploymentChainId = 11155111;
export const faucetFunding = 5_000n * 10n ** 18n;
export const artifactContracts = [
  ["token", "SLMSToken"],
  ["faucet", "SLMSFaucet"],
] as const;
export type Artifact = { abi: Abi; bytecode: Hex };
export type Artifacts = Record<"token" | "faucet", Artifact>;
export type CompletedStep = { hash: Hex; address?: Address };
export const stepLabels = [
  "Deploy Lantern Vale Glow token",
  "Deploy the 24-hour faucet",
  "Fund faucet with 5,000 GLOW",
] as const;
export function deploymentStep(
  index: number,
  artifacts: Artifacts,
  owner: Address,
  completed: CompletedStep[],
) {
  if (!isAddress(owner) || owner.toLowerCase() === zeroAddress)
    throw new Error("A valid nonzero owner address is required.");
  if (!Number.isInteger(index) || index < 0 || index >= stepLabels.length)
    throw new Error("Invalid deployment step.");
  const deployed = (step: number) => {
    const address = completed[step]?.address;
    if (
      !address ||
      !isAddress(address) ||
      address.toLowerCase() === zeroAddress
    )
      throw new Error("Verify the earlier deployment receipts first.");
    return address;
  };
  if (index < artifactContracts.length) {
    const key = artifactContracts[index][0];
    const args = [index === 0 ? owner : deployed(0)];
    return {
      to: undefined,
      data: encodeDeployData({ ...artifacts[key], args }),
      value: 0n,
    };
  }
  return {
    to: deployed(0),
    data: encodeFunctionData({
      abi: parseAbi(["function mint(address to,uint256 amount)"]),
      functionName: "mint",
      args: [deployed(1), faucetFunding],
    }),
    value: 0n,
  };
}

// The browser and independent CLI verifier apply the same receipt checks.
export function verifyStepReceipt(
  expected: ReturnType<typeof deploymentStep>,
  owner: Address,
  receipt: Pick<
    TransactionReceipt,
    | "status"
    | "blockHash"
    | "blockNumber"
    | "transactionHash"
    | "contractAddress"
  >,
  tx: Pick<
    Transaction,
    "hash" | "chainId" | "from" | "input" | "value" | "to" | "blockHash"
  >,
  canonicalHash: Hex | null,
  latestBlock: bigint,
): CompletedStep {
  if (
    receipt.status !== "success" ||
    latestBlock < receipt.blockNumber + 1n ||
    canonicalHash !== receipt.blockHash ||
    tx.blockHash !== receipt.blockHash ||
    tx.hash !== receipt.transactionHash ||
    tx.chainId !== deploymentChainId ||
    tx.from.toLowerCase() !== owner.toLowerCase() ||
    tx.input.toLowerCase() !== expected.data.toLowerCase() ||
    tx.value !== expected.value ||
    tx.to?.toLowerCase() !== expected.to?.toLowerCase()
  )
    throw new Error(
      "Receipt does not match the confirmed Sepolia deployment plan.",
    );
  if (
    !expected.to &&
    (!receipt.contractAddress || receipt.contractAddress === zeroAddress)
  )
    throw new Error("Deployment receipt has no contract address.");
  return {
    hash: receipt.transactionHash,
    ...(!expected.to ? { address: receipt.contractAddress! } : {}),
  };
}
