import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
  zeroAddress,
} from "viem";
import { sepolia } from "viem/chains";

import { gameDeploymentReview } from "../apps/web/src/features/deployment/game-plan.ts";
export { gameDeploymentReview } from "../apps/web/src/features/deployment/game-plan.ts";
const address = (value) => {
  if (!isAddress(value || "", { strict: true }) || value === zeroAddress)
    throw new Error("A valid nonzero checksummed address is required.");
  return getAddress(value);
};

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node scripts/prepare-game-deployment.mjs --signer <public-address> --bonus <whole-GLOW>\nRead-only Sepolia checks and an unsigned review file. No deployment, funding or activation.",
    );
    return;
  }
  if (args.length !== 4 || args[0] !== "--signer" || args[2] !== "--bonus")
    throw new Error("Use --help for the public-address-only command syntax.");
  const signer = address(args[1]);
  loadEnvFile("apps/web/.env.local");
  const deployment = JSON.parse(
    readFileSync("deployments/sepolia.json", "utf8"),
  );
  if (
    deployment.plan !== "lantern-vale-token-faucet-v1" ||
    deployment.chainId !== sepolia.id ||
    deployment.steps?.length !== 3
  )
    throw new Error("Verify the existing token and faucet deployment first.");
  const token = address(deployment.steps[0].address);
  const faucet = address(deployment.steps[1].address);
  if (
    token !== address(process.env.NEXT_PUBLIC_TOKEN_ADDRESS) ||
    faucet !== address(process.env.NEXT_PUBLIC_FAUCET_ADDRESS)
  )
    throw new Error("Environment and verified deployment addresses differ.");
  const rpc = createPublicClient({
    chain: sepolia,
    transport: http(
      process.env.SEPOLIA_RPC_URL ||
        process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      {
        timeout: 15_000,
        retryCount: 1,
      },
    ),
  });
  if ((await rpc.getChainId()) !== sepolia.id)
    throw new Error("Wrong RPC chain.");
  const blockNumber = (await rpc.getBlockNumber({ cacheTime: 0 })) - 1n;
  const block = await rpc.getBlock({ blockNumber });
  const abi = parseAbi([
    "function owner() view returns (address)",
    "function pendingOwner() view returns (address)",
    "function token() view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function cap() view returns (uint256)",
  ]);
  const read = (contract, functionName) =>
    rpc.readContract({ address: contract, abi, functionName, blockNumber });
  const [
    tokenOwner,
    pendingTokenOwner,
    faucetToken,
    supply,
    cap,
    tokenCode,
    faucetCode,
    signerCode,
  ] = await Promise.all([
    read(token, "owner"),
    read(token, "pendingOwner"),
    read(faucet, "token"),
    read(token, "totalSupply"),
    read(token, "cap"),
    rpc.getCode({ address: token, blockNumber }),
    rpc.getCode({ address: faucet, blockNumber }),
    rpc.getCode({ address: signer, blockNumber }),
  ]);
  if (
    !tokenCode ||
    tokenCode === "0x" ||
    !faucetCode ||
    faucetCode === "0x" ||
    (signerCode && signerCode !== "0x")
  )
    throw new Error(
      "Expected deployed token/faucet and a separate EOA signer.",
    );
  const compiled = JSON.parse(
    readFileSync(
      "contracts/out/LanternGameEconomy.sol/LanternGameEconomy.json",
      "utf8",
    ),
  );
  const review = gameDeploymentReview({
    chainId: sepolia.id,
    owner: deployment.owner,
    tokenOwner,
    pendingTokenOwner,
    token,
    faucet,
    faucetToken,
    signer,
    bonusTokens: args[3],
    supply,
    cap,
    artifact: { abi: compiled.abi, bytecode: compiled.bytecode.object },
  });
  if ((await rpc.getBlock({ blockNumber })).hash !== block.hash)
    throw new Error("The inspected block changed; repeat preparation.");
  mkdirSync("test-results/game-deployment", { recursive: true });
  const directory = mkdtempSync(
    resolve("test-results/game-deployment/review-"),
  );
  writeFileSync(
    resolve(directory, "plan.json"),
    JSON.stringify(
      {
        ...review,
        checkedAt: new Date().toISOString(),
        blockNumber: blockNumber.toString(),
        blockHash: block.hash,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: review.status,
      directory,
      fingerprint: review.fingerprint,
      bonusTokens: review.bonusTokens,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "Game deployment preparation failed. Check public arguments, compiled artifacts and Sepolia configuration; no transaction was sent.",
    );
    process.exitCode = 1;
  });
}
