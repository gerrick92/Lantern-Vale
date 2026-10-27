import { createHash } from "node:crypto";
import {
  encodeDeployData,
  getAddress,
  isAddress,
  parseUnits,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
export type GameArtifact = { abi: Abi; bytecode: Hex };
export type GameDeploymentInput = {
  chainId: number;
  owner: string;
  tokenOwner: string;
  pendingTokenOwner: string;
  token: string;
  faucet: string;
  faucetToken: string;
  signer: string;
  bonusTokens: string;
  supply: bigint;
  cap: bigint;
  artifact: GameArtifact;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const address = (value: string) => {
  if (!isAddress(value || "", { strict: true }) || value === zeroAddress)
    throw new Error("A valid nonzero checksummed address is required.");
  return getAddress(value);
};

// Public unsigned review only. This module has no wallet client, key input,
// broadcast, unpause, environment-writing or release-enabling operation.
export function gameDeploymentReview(input: GameDeploymentInput) {
  if (input.chainId !== sepolia.id)
    throw new Error("Only Ethereum Sepolia is allowed.");
  const owner = address(input.owner);
  const token = address(input.token);
  const faucet = address(input.faucet);
  const signer = address(input.signer);
  if (
    new Set([owner, token, faucet, signer]).size !== 4 ||
    owner !== address(input.tokenOwner) ||
    token !== address(input.faucetToken) ||
    (input.pendingTokenOwner !== zeroAddress &&
      signer === address(input.pendingTokenOwner))
  )
    throw new Error("Token, faucet or separate signing-role checks failed.");
  if (!/^[1-9][0-9]{0,6}$/.test(input.bonusTokens || ""))
    throw new Error("Specify a whole-token bonus reserve, without decimals.");
  const reserve = parseUnits(input.bonusTokens, 18);
  if (
    typeof input.supply !== "bigint" ||
    typeof input.cap !== "bigint" ||
    input.cap !== parseUnits("1000000", 18) ||
    input.supply < 0n ||
    input.supply > input.cap ||
    reserve < parseUnits("2", 18) ||
    reserve > input.cap - input.supply
  )
    throw new Error(
      "The reserve must fit the remaining cap and fund a victory.",
    );
  const constructor = input.artifact?.abi?.find(
    (item) => item.type === "constructor",
  );
  if (
    constructor?.inputs?.map((item) => item.type).join() !==
      "address,address,address,address" ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(input.artifact?.bytecode || "")
  )
    throw new Error("Build the reviewed economy contract before preparation.");
  const data = encodeDeployData({
    abi: input.artifact.abi,
    bytecode: input.artifact.bytecode,
    args: [token, faucet, signer, owner],
  });
  const review = {
    plan: "lantern-vale-paused-economy-v1",
    status: "REVIEW_ONLY",
    chainId: sepolia.id,
    owner,
    token,
    faucet,
    signer,
    bonusTokens: input.bonusTokens,
    reserveUnits: reserve.toString(),
    artifactSha256: hash(
      JSON.stringify({
        abi: input.artifact.abi,
        bytecode: input.artifact.bytecode,
      }),
    ),
    deployment: { from: owner, to: null, value: "0", data },
    funding: {
      method: "mint(address,uint256)",
      token,
      recipient: "The independently verified new economy contract only",
      amount: reserve.toString(),
      state: "Requires a confirmed deployment before transaction preparation",
    },
    gates: [
      "Reviewed signer provisioning and recovery",
      "Durable game/account recovery and reviewed database promotion",
      "Explicit deployment and funding authorization with user MetaMask confirmations",
      "Canonical receipt, deployed-code, paused-state and source verification",
      "Separate reviewed activation after real paid lifecycle and nonowner checks",
    ],
  };
  return { ...review, fingerprint: hash(JSON.stringify(review)) };
}

export type GameDeploymentReview = ReturnType<typeof gameDeploymentReview>;
export type SavedGameReview = GameDeploymentReview & {
  checkedAt: string;
  blockNumber: string;
  blockHash: Hex;
};

// A saved plan is review material, never authorization or current chain evidence.
export function validateGameReview(
  input: SavedGameReview,
  artifact: GameArtifact,
  known: { owner: Address; token: Address; faucet: Address; signer: Address },
): SavedGameReview {
  const expected = gameDeploymentReview({
    ...known,
    chainId: sepolia.id,
    tokenOwner: known.owner,
    pendingTokenOwner: zeroAddress,
    faucetToken: known.token,
    bonusTokens: input.bonusTokens,
    supply: 0n,
    cap: parseUnits("1000000", 18),
    artifact,
  });
  const { checkedAt, blockNumber, blockHash, fingerprint, ...core } = input;
  if (
    fingerprint !== expected.fingerprint ||
    hash(JSON.stringify(core)) !== expected.fingerprint ||
    !Number.isFinite(Date.parse(checkedAt)) ||
    !/^[0-9]{1,20}$/.test(blockNumber) ||
    !/^0x[0-9a-fA-F]{64}$/.test(blockHash)
  )
    throw new Error(
      "The saved review differs from the compiled contract or verified roles. Prepare and review it again.",
    );
  return { ...expected, checkedAt, blockNumber, blockHash };
}
