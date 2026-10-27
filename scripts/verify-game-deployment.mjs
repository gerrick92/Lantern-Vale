import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { loadGameReviewFiles } from "../apps/web/src/features/deployment/game-review-files.ts";
import {
  GameVerificationError,
  verifyGameDeployment,
} from "../apps/web/src/features/deployment/game-verification.ts";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node scripts/verify-game-deployment.mjs <deployment-hash> [funding-hash]\nRead-only Sepolia verification against deployments/game-economy-plan.json. No signing, broadcast, activation or environment changes.",
    );
    return;
  }
  if (
    args.length < 1 ||
    args.length > 2 ||
    args.some((arg) => !/^0x[0-9a-fA-F]{64}$/.test(arg))
  )
    throw new GameVerificationError(
      "Use --help for the public transaction hash syntax.",
    );
  loadEnvFile("apps/web/.env.local");
  const { plan, artifact } = await loadGameReviewFiles(resolve("."), {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS,
    faucet: process.env.NEXT_PUBLIC_FAUCET_ADDRESS,
  });
  const rpc = createPublicClient({
    chain: sepolia,
    transport: http(
      process.env.SEPOLIA_RPC_URL ||
        process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      { timeout: 15_000, retryCount: 1 },
    ),
  });
  const result = await verifyGameDeployment(rpc, plan, artifact, {
    deploymentHash: args[0],
    fundingHash: args[1],
  });
  await mkdir("test-results/game-deployment", { recursive: true });
  const directory = await mkdtemp(
    resolve("test-results/game-deployment/verified-"),
  );
  await writeFile(
    resolve(directory, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: result.status,
      stage: result.stage,
      economy: result.economy,
      directory,
    }),
  );
}
main().catch((error) => {
  console.error(
    error instanceof GameVerificationError
      ? error.message
      : "Verification failed. Check the saved review, compiled artifact, configured Sepolia RPC and confirmed receipts. No state was changed.",
  );
  process.exitCode = 1;
});
