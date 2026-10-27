import {
  encodeFunctionData,
  getContractAddress,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { GameArtifact, SavedGameReview } from "./game-plan.ts";

export type CompiledGameArtifact = GameArtifact & {
  runtime: Hex;
  immutables: Record<string, { start: number; length: number }[]>;
};

export class GameVerificationError extends Error {}
function requireCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GameVerificationError(message);
}
const equal = (left: Address | null | undefined, right: Address) =>
  !!left && isAddressEqual(left, right);
const hashPattern = /^0x[0-9a-fA-F]{64}$/;

const stateAbi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function token() view returns (address)",
  "function recyclingPool() view returns (address)",
  "function signer() view returns (address)",
  "function paused() view returns (bool)",
  "function nextRoundId() view returns (uint256)",
  "function escrowed() view returns (uint256)",
  "function bonusReserved() view returns (uint256)",
  "function availableBonusPool() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function cap() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)",
]);
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

// The exact creation input proves constructor arguments. Runtime comparison
// excludes only compiler-declared immutable slots; getters/domain are checked too.
export function verifyGameRuntime(
  code: Hex | undefined,
  artifact: CompiledGameArtifact,
) {
  requireCheck(
    code &&
      /^0x(?:[0-9a-fA-F]{2})+$/.test(code) &&
      code.length === artifact.runtime.length,
    "Deployed game bytecode is missing or has a different length.",
  );
  const actual = code.toLowerCase().split("");
  const expected = artifact.runtime.toLowerCase().split("");
  const occupied = new Set<number>();
  for (const slots of Object.values(artifact.immutables)) {
    for (const { start, length } of slots) {
      requireCheck(
        Number.isInteger(start) &&
          start >= 0 &&
          length === 32 &&
          2 + (start + length) * 2 <= expected.length,
        "The compiled immutable references are invalid.",
      );
      for (let i = 2 + start * 2; i < 2 + (start + length) * 2; i++) {
        requireCheck(
          !occupied.has(i) && expected[i] === "0",
          "The compiled immutable references overlap or are not placeholders.",
        );
        occupied.add(i);
        actual[i] = "0";
      }
    }
  }
  requireCheck(
    actual.join("") === expected.join(""),
    "Deployed game bytecode differs from the reviewed artifact.",
  );
}

export function gameFundingTransaction(
  plan: SavedGameReview,
  economy: Address,
) {
  requireCheck(
    economy !== zeroAddress &&
      ![plan.owner, plan.token, plan.faucet, plan.signer].some((role) =>
        equal(economy, role),
      ),
    "Funding requires a distinct, verified game contract.",
  );
  return {
    from: plan.owner,
    to: plan.token,
    value: "0",
    data: encodeFunctionData({
      abi: parseAbi(["function mint(address to,uint256 amount)"]),
      functionName: "mint",
      args: [economy, BigInt(plan.reserveUnits)],
    }),
  };
}

// Read-only and usable by both the authenticated local route and an independent
// CLI process. No key, sendTransaction, unpause or environment mutation exists.
export async function verifyGameDeployment(
  rpc: PublicClient,
  plan: SavedGameReview,
  artifact: CompiledGameArtifact,
  hashes: { deploymentHash: Hex; fundingHash?: Hex },
) {
  requireCheck(
    plan.chainId === 11155111 && (await rpc.getChainId()) === 11155111,
    "Verification requires Ethereum Sepolia.",
  );
  requireCheck(
    hashPattern.test(hashes.deploymentHash) &&
      (!hashes.fundingHash || hashPattern.test(hashes.fundingHash)),
    "Enter valid transaction hashes.",
  );
  const head = await rpc.getBlockNumber({ cacheTime: 0 });
  requireCheck(head > 1n, "A confirmed chain snapshot is unavailable.");
  const blockNumber = head - 1n;
  const snapshot = await rpc.getBlock({ blockNumber });
  const receipts: TransactionReceipt[] = [];
  async function receipt(
    hash: Hex,
    expected: { to: Address | null; data: Hex },
  ) {
    const mined = await rpc.getTransactionReceipt({ hash });
    const [tx, block] = await Promise.all([
      rpc.getTransaction({ hash }),
      rpc.getBlock({ blockNumber: mined.blockNumber }),
    ]);
    requireCheck(
      mined.transactionHash === hash &&
        tx.hash === hash &&
        mined.status === "success" &&
        mined.blockNumber <= blockNumber &&
        block.hash === mined.blockHash &&
        tx.blockHash === mined.blockHash &&
        tx.blockNumber === mined.blockNumber &&
        tx.transactionIndex === mined.transactionIndex &&
        tx.chainId === 11155111 &&
        equal(tx.from, plan.owner) &&
        equal(mined.from, plan.owner) &&
        tx.value === 0n &&
        tx.input.toLowerCase() === expected.data.toLowerCase() &&
        (expected.to
          ? equal(tx.to, expected.to) &&
            equal(mined.to, expected.to) &&
            !mined.contractAddress
          : tx.to === null && mined.to === null && !!mined.contractAddress),
      "Receipt does not match the exact successful, twice-confirmed Sepolia transaction.",
    );
    receipts.push(mined);
    return { mined, tx };
  }
  const deployed = await receipt(hashes.deploymentHash, {
    to: null,
    data: plan.deployment.data,
  });
  const economy = deployed.mined.contractAddress!;
  requireCheck(
    equal(
      economy,
      getContractAddress({
        from: plan.owner,
        nonce: BigInt(deployed.tx.nonce),
      }),
    ),
    "The created contract address does not match the deployment sender and nonce.",
  );
  const funding = gameFundingTransaction(plan, economy);
  if (hashes.fundingHash) {
    const funded = await receipt(hashes.fundingHash, funding);
    requireCheck(
      funded.mined.blockNumber > deployed.mined.blockNumber ||
        (funded.mined.blockNumber === deployed.mined.blockNumber &&
          funded.mined.transactionIndex > deployed.mined.transactionIndex),
      "Funding must follow the verified deployment.",
    );
    const events = parseEventLogs({
      abi: transferAbi,
      eventName: "Transfer",
      strict: true,
      logs: funded.mined.logs.filter((log) => equal(log.address, plan.token)),
    });
    requireCheck(
      events.length === 1 &&
        equal(events[0].args.from, zeroAddress) &&
        equal(events[0].args.to, economy) &&
        events[0].args.value === BigInt(plan.reserveUnits) &&
        !events[0].removed &&
        events[0].blockHash === funded.mined.blockHash &&
        events[0].transactionHash === hashes.fundingHash,
      "The funding receipt must mint exactly the reviewed reserve to this game contract.",
    );
  }
  const read = (
    address: Address,
    functionName: Exclude<(typeof stateAbi)[number]["name"], "balanceOf">,
  ) => rpc.readContract({ address, abi: stateAbi, functionName, blockNumber });
  const [
    code,
    tokenCode,
    faucetCode,
    signerCode,
    token,
    pool,
    signer,
    owner,
    pendingOwner,
    paused,
    nextRoundId,
    escrowed,
    bonusReserved,
    available,
    tokenOwner,
    pendingTokenOwner,
    faucetToken,
    supply,
    cap,
    balance,
    domain,
  ] = await Promise.all([
    rpc.getCode({ address: economy, blockNumber }),
    rpc.getCode({ address: plan.token, blockNumber }),
    rpc.getCode({ address: plan.faucet, blockNumber }),
    rpc.getCode({ address: plan.signer, blockNumber }),
    read(economy, "token"),
    read(economy, "recyclingPool"),
    read(economy, "signer"),
    read(economy, "owner"),
    read(economy, "pendingOwner"),
    read(economy, "paused"),
    read(economy, "nextRoundId"),
    read(economy, "escrowed"),
    read(economy, "bonusReserved"),
    read(economy, "availableBonusPool"),
    read(plan.token, "owner"),
    read(plan.token, "pendingOwner"),
    read(plan.faucet, "token"),
    read(plan.token, "totalSupply"),
    read(plan.token, "cap"),
    rpc.readContract({
      address: plan.token,
      abi: stateAbi,
      functionName: "balanceOf",
      args: [economy],
      blockNumber,
    }),
    rpc.readContract({
      address: economy,
      abi: stateAbi,
      functionName: "eip712Domain",
      blockNumber,
    }),
  ]);
  verifyGameRuntime(code, artifact);
  requireCheck(
    tokenCode &&
      tokenCode !== "0x" &&
      faucetCode &&
      faucetCode !== "0x" &&
      (!signerCode || signerCode === "0x"),
    "Token/faucet code or separate EOA signer checks failed.",
  );
  requireCheck(
    token === plan.token &&
      pool === plan.faucet &&
      signer === plan.signer &&
      owner === plan.owner &&
      pendingOwner === zeroAddress &&
      tokenOwner === plan.owner &&
      pendingTokenOwner === zeroAddress &&
      faucetToken === plan.token,
    "Current token, faucet, signing or ownership roles differ from the reviewed plan.",
  );
  requireCheck(
    paused === true &&
      nextRoundId === 1n &&
      escrowed === 0n &&
      bonusReserved === 0n,
    "The game must still be paused, with no played rounds or player deposits.",
  );
  requireCheck(
    domain[0] === "0x0f" &&
      domain[1] === "LanternValeSettlement" &&
      domain[2] === "1" &&
      domain[3] === 11155111n &&
      equal(domain[4], economy) &&
      domain[6].length === 0,
    "The deployed EIP-712 signing domain differs from the reviewed protocol.",
  );
  const reserve = BigInt(plan.reserveUnits);
  requireCheck(
    typeof supply === "bigint" &&
      cap === parseUnits("1000000", 18) &&
      supply >= 0n &&
      supply <= cap &&
      (hashes.fundingHash
        ? balance === reserve && available === reserve
        : balance === 0n && available === 0n && reserve <= cap - supply),
    "The bonus balance or mint capacity differs from this initial funding plan. Reconcile existing funds before continuing.",
  );
  // Re-fetch every checkpoint after all reads so a reorg during verification fails.
  for (const checkpoint of [...receipts, snapshot]) {
    const number =
      "blockNumber" in checkpoint ? checkpoint.blockNumber : checkpoint.number;
    const hash =
      "blockHash" in checkpoint ? checkpoint.blockHash : checkpoint.hash;
    requireCheck(
      (await rpc.getBlock({ blockNumber: number })).hash === hash,
      "A canonical block changed during verification. Retry after reconciliation.",
    );
  }
  requireCheck(
    (await rpc.getChainId()) === 11155111,
    "The RPC chain changed during verification.",
  );
  return {
    status: "PASS" as const,
    stage: hashes.fundingHash
      ? ("PAUSED_AND_FUNDED" as const)
      : ("PAUSED_DEPLOYMENT" as const),
    plan: plan.plan,
    fingerprint: plan.fingerprint,
    chainId: 11155111,
    owner: plan.owner,
    token: plan.token,
    faucet: plan.faucet,
    signer: plan.signer,
    economy,
    deploymentHash: hashes.deploymentHash,
    fundingHash: hashes.fundingHash ?? null,
    reserveUnits: plan.reserveUnits,
    balance: balance.toString(),
    paused: true,
    blockNumber: blockNumber.toString(),
    blockHash: snapshot.hash,
    verifiedAt: new Date().toISOString(),
    fundingTransaction: hashes.fundingHash ? null : funding,
    paidPlayEnabled: false,
    limits: [
      "This is a confirmed-block snapshot, not finality or activation approval.",
      "Source publication, signer provisioning/recovery and real paid/player journeys remain separate checks.",
    ],
  };
}
export type GameDeploymentVerification = Awaited<
  ReturnType<typeof verifyGameDeployment>
>;
