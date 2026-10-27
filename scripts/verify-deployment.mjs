import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";
import {
  createPublicClient,
  getAddress,
  http,
  isAddressEqual,
  parseAbi,
  zeroAddress,
  parseEventLogs,
} from "viem";
import { sepolia } from "viem/chains";
import {
  artifactContracts,
  deploymentPlan,
  deploymentStep,
  faucetFunding,
  stepLabels,
  verifyStepReceipt,
} from "../apps/web/src/features/deployment/plan.ts";

const reportPath = process.argv[2];
if (!reportPath || reportPath.startsWith("--"))
  throw new Error(
    "Usage: node scripts/verify-deployment.mjs <public-receipt-report.json> [--apply]",
  );
if (process.argv.slice(3).some((value) => value !== "--apply"))
  throw new Error("Unknown option. Only --apply is supported.");
loadEnvFile("apps/web/.env.local");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const owner = getAddress(report.owner);
if (
  report.chainId !== sepolia.id ||
  report.plan !== deploymentPlan ||
  owner === zeroAddress
)
  throw new Error(
    "Expected the token/faucet Sepolia plan and a nonzero owner.",
  );
const artifacts = Object.fromEntries(
  await Promise.all(
    artifactContracts.map(async ([name, contract]) => {
      const artifact = JSON.parse(
        await readFile(
          `contracts/out/${contract}.sol/${contract}.json`,
          "utf8",
        ),
      );
      return [name, { abi: artifact.abi, bytecode: artifact.bytecode.object }];
    }),
  ),
);
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ plan: deploymentPlan, artifacts }))
  .digest("hex");
if (
  report.fingerprint !== fingerprint ||
  !Array.isArray(report.steps) ||
  report.steps.length !== stepLabels.length
)
  throw new Error(
    "Three receipts matching the current compiled token/faucet artifacts are required.",
  );
const rpc = createPublicClient({
  chain: sepolia,
  transport: http(
    process.env.SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  ),
});
if ((await rpc.getChainId()) !== sepolia.id)
  throw new Error("RPC is not on Ethereum Sepolia.");
const completed = [];
const receipts = [];
for (const [i, step] of report.steps.entries()) {
  if (typeof step.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(step.hash))
    throw new Error("Invalid receipt hash.");
  const expected = deploymentStep(i, artifacts, owner, completed);
  const [receipt, tx, latest] = await Promise.all([
    rpc.getTransactionReceipt({ hash: step.hash }),
    rpc.getTransaction({ hash: step.hash }),
    rpc.getBlockNumber({ cacheTime: 0 }),
  ]);
  const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  const verified = verifyStepReceipt(
    expected,
    owner,
    receipt,
    tx,
    block.hash,
    latest,
  );
  if (verified.address) {
    const code = await rpc.getCode({ address: verified.address });
    if (!code || code === "0x")
      throw new Error(`Step ${i + 1} has no deployed contract.`);
  }
  completed.push(verified);
  receipts.push(receipt);
}
const [token, faucet] = completed.slice(0, 2).map((step) => step.address);
const checks = parseAbi([
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function cap() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function CLAIM_AMOUNT() view returns (uint256)",
  "function COOLDOWN() view returns (uint256)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const read = (address, functionName, extra = {}) =>
  rpc.readContract({ address, abi: checks, functionName, ...extra });
const blockNumber = await rpc.getBlockNumber({ cacheTime: 0 });
const valuesAtBlock = await Promise.all([
  read(token, "owner", { blockNumber }),
  read(faucet, "token", { blockNumber }),
  read(token, "name", { blockNumber }),
  read(token, "symbol", { blockNumber }),
  read(token, "decimals", { blockNumber }),
  read(token, "cap", { blockNumber }),
  read(faucet, "CLAIM_AMOUNT", { blockNumber }),
  read(faucet, "COOLDOWN", { blockNumber }),
  read(token, "totalSupply", { blockNumber }),
  read(token, "balanceOf", { args: [faucet], blockNumber }),
]);
const [
  liveOwner,
  faucetToken,
  name,
  symbol,
  decimals,
  cap,
  claim,
  cooldown,
  supply,
  pool,
] = valuesAtBlock;
if (
  !isAddressEqual(liveOwner, owner) ||
  !isAddressEqual(faucetToken, token) ||
  name !== "Lantern Vale Glow" ||
  symbol !== "GLOW" ||
  decimals !== 18 ||
  cap !== 1_000_000n * 10n ** 18n ||
  claim !== 5n * 10n ** 18n ||
  cooldown !== 86400n ||
  supply > cap
)
  throw new Error(
    "Onchain token/faucet configuration differs from the reviewed plan.",
  );
// Check the mint event itself; later legitimate claims must not invalidate this report.
const funding = parseEventLogs({
  abi: checks,
  eventName: "Transfer",
  logs: receipts[2].logs,
}).filter(
  (log) =>
    isAddressEqual(log.address, token) &&
    isAddressEqual(log.args.from, zeroAddress) &&
    isAddressEqual(log.args.to, faucet) &&
    log.args.value === faucetFunding,
);
if (funding.length !== 1)
  throw new Error(
    "The funding receipt does not contain the exact faucet mint.",
  );
const values = {
  NEXT_PUBLIC_TOKEN_ADDRESS: token,
  NEXT_PUBLIC_FAUCET_ADDRESS: faucet,
  NEXT_PUBLIC_DEPLOYMENT_BLOCK: receipts[0].blockNumber.toString(),
  REWARDS_ENABLED: "false",
};
// Persist only this explicit public schema, never arbitrary report properties.
const verifiedReport = {
  plan: deploymentPlan,
  chainId: sepolia.id,
  owner,
  fingerprint,
  steps: completed,
  verifiedAt: new Date().toISOString(),
  checkedBlock: blockNumber.toString(),
  supply: supply.toString(),
  faucetBalance: pool.toString(),
};
console.log(
  "PASS: three canonical Sepolia receipts, compiled inputs, mint event and live token/faucet configuration verified. Explorer source verification is a separate step.",
);
console.log(
  JSON.stringify(
    {
      ...values,
      checkedBlock: verifiedReport.checkedBlock,
      supply: verifiedReport.supply,
      faucetBalance: verifiedReport.faucetBalance,
    },
    null,
    2,
  ),
);
if (process.argv.includes("--apply")) {
  for (const [key, value] of Object.entries(values)) {
    if (
      key !== "REWARDS_ENABLED" &&
      process.env[key] &&
      process.env[key].toLowerCase() !== value.toLowerCase()
    )
      throw new Error(
        `${key} already points at a different deployment. Reconcile before replacing it.`,
      );
  }
  let contents = await readFile("apps/web/.env.local", "utf8");
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, "gm");
    contents = pattern.test(contents)
      ? contents.replace(pattern, `${key}=${value}`)
      : `${contents.trimEnd()}\n${key}=${value}\n`;
  }
  await mkdir("deployments", { recursive: true });
  await writeFile(
    "deployments/sepolia.json",
    JSON.stringify(verifiedReport, null, 2) + "\n",
  );
  // Atomic replacement avoids a partially written environment if interrupted.
  await writeFile("apps/web/.env.local.pending", contents, { mode: 0o600 });
  await rename("apps/web/.env.local.pending", "apps/web/.env.local");
  console.log(
    "Verified addresses saved. Restart/rebuild the app. Paid play and rewards remain disabled.",
  );
} else {
  console.log(
    "Read-only verification complete. Use --apply to save verified addresses with rewards disabled.",
  );
}
