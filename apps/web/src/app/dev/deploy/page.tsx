import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import Link from "next/link";
import { requireDeveloperPage } from "@/server/developer-access";
import { DeploymentPanel } from "@/features/deployment/panel";
import {
  artifactContracts,
  deploymentPlan,
  type Artifacts,
} from "@/features/deployment/plan";

export default async function DeploymentPage() {
  await requireDeveloperPage();
  const entries = await Promise.all(
    artifactContracts.map(async ([name, contract]) => {
      const output = JSON.parse(
        await readFile(
          resolve(
            process.cwd(),
            `../../contracts/out/${contract}.sol/${contract}.json`,
          ),
          "utf8",
        ),
      );
      return [
        name,
        { abi: output.abi, bytecode: output.bytecode.object },
      ] as const;
    }),
  );
  const artifacts = Object.fromEntries(entries) as Artifacts;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ plan: deploymentPlan, artifacts }))
    .digest("hex");
  return (
    <>
      <DeploymentPanel artifacts={artifacts} fingerprint={fingerprint} />
      <p className="small-note">
        <Link href="/dev/deploy/game">Open game contract review</Link> to manage
        the existing game deployment. Keep the current token and faucet.
      </p>
    </>
  );
}
