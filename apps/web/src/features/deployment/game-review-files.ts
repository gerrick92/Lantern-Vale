import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAddress } from "viem";
import { validateGameReview } from "./game-plan.ts";
import type { CompiledGameArtifact } from "./game-verification.ts";

// Call only after developer authentication in the app. The CLI uses the same
// fixed public files; no request can choose a filesystem path or contract role.
export async function loadGameReviewFiles(
  root: string,
  configured: { token?: string; faucet?: string },
) {
  const load = async (path: string) =>
    JSON.parse(await readFile(resolve(root, path), "utf8"));
  const [saved, compiled, deployed, custody] = await Promise.all([
    load("deployments/game-economy-plan.json"),
    load("contracts/out/LanternGameEconomy.sol/LanternGameEconomy.json"),
    load("deployments/sepolia.json"),
    load("deployments/signer-custody.json"),
  ]);
  if (
    deployed.plan !== "lantern-vale-token-faucet-v1" ||
    deployed.chainId !== 11155111 ||
    deployed.steps?.length !== 3 ||
    custody.purpose !== "restricted-settlement-signer" ||
    !configured.token ||
    !configured.faucet
  )
    throw new Error("The verified deployment and signer records are required.");
  const known = {
    owner: getAddress(deployed.owner),
    token: getAddress(deployed.steps[0].address),
    faucet: getAddress(deployed.steps[1].address),
    signer: getAddress(custody.address),
  };
  if (
    known.token !== getAddress(configured.token) ||
    known.faucet !== getAddress(configured.faucet)
  )
    throw new Error(
      "Configured token/faucet addresses differ from the existing deployment.",
    );
  const artifact: CompiledGameArtifact = {
    abi: compiled.abi,
    bytecode: compiled.bytecode.object,
    runtime: compiled.deployedBytecode.object,
    immutables: compiled.deployedBytecode.immutableReferences,
  };
  return { plan: validateGameReview(saved, artifact, known), artifact };
}
