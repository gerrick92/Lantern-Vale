import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  type Address,
} from "viem";
import { z } from "zod";
import { canAccessDeveloperTools } from "@/server/developer-access";
import { loadGameDeploymentReview } from "@/server/game-deployment";
import { chainClient } from "@/server/blockchain";
import { checkOrigin, endpoint, json, readBody, ApiError } from "@/server/http";
import {
  verifyGameDeployment,
  verifyGameRuntime,
} from "@/features/deployment/game-verification";

const abi = parseAbi([
  "function owner() view returns(address)",
  "function signer() view returns(address)",
  "function token() view returns(address)",
  "function recyclingPool() view returns(address)",
  "function paused() view returns(bool)",
  "function unpause()",
]);
export async function POST(request: Request) {
  return endpoint(async () => {
    if (!(await canAccessDeveloperTools()))
      return json({ error: "Not found" }, 404);
    checkOrigin(request);
    await readBody(request, z.object({}).strict());
    if (process.env.GLOW_ACCEPTANCE_ENABLED !== "true")
      throw new ApiError(503, "Acceptance testing is not configured.");
    const { plan, artifact } = await loadGameDeploymentReview();
    const rpc = chainClient();
    const saved = JSON.parse(
      await readFile(
        resolve(process.cwd(), "../../deployments/game-economy.json"),
        "utf8",
      ),
    );
    const address = process.env.SEPOLIA_GAME_ECONOMY_ADDRESS as Address;
    if (
      (await rpc.getChainId()) !== 11155111 ||
      !address ||
      !isAddressEqual(saved.economy, address)
    )
      throw new ApiError(409, "Deployment identity changed.");
    verifyGameRuntime(await rpc.getCode({ address }), artifact);
    for (const [functionName, expected] of [
      ["owner", plan.owner],
      ["signer", plan.signer],
      ["token", plan.token],
      ["recyclingPool", plan.faucet],
    ] as const) {
      if (
        !isAddressEqual(
          await rpc.readContract({ address, abi, functionName }),
          expected,
        )
      )
        throw new ApiError(409, "Deployment authority changed.");
    }
    const paused = await rpc.readContract({
      address,
      abi,
      functionName: "paused",
    });
    if (paused)
      await verifyGameDeployment(rpc, plan, artifact, {
        deploymentHash: saved.deploymentHash,
        fundingHash: saved.fundingHash,
      });
    const signer = await fetch(process.env.SETTLEMENT_SIGNER_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SETTLEMENT_SIGNER_TOKEN}`,
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (
      signer.status !== 400 ||
      (await signer.json()).error !== "Invalid settlement result."
    )
      throw new ApiError(503, "The restricted signer is not ready.");
    return json({
      chainId: 11155111,
      owner: plan.owner,
      to: address,
      paused,
      data: encodeFunctionData({ abi, functionName: "unpause" }),
      value: "0",
    });
  });
}
