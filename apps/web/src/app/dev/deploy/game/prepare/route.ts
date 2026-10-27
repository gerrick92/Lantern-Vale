import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { canAccessDeveloperTools } from "@/server/developer-access";
import { loadGameDeploymentReview } from "@/server/game-deployment";
import { chainClient } from "@/server/blockchain";
import { checkOrigin, endpoint, json, readBody } from "@/server/http";
import { GameVerificationError } from "@/features/deployment/game-verification";
import { prepareGameTransaction } from "@/features/deployment/game-transaction";

const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as `0x${string}`);
const schema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    deploymentHash: hash.optional(),
    fundingHash: hash.optional(),
  })
  .strict();

export async function POST(request: Request) {
  return endpoint(async () => {
    if (!(await canAccessDeveloperTools()))
      return json({ error: "Not found" }, 404);
    checkOrigin(request);
    const body = await readBody(request, schema);
    const { plan, artifact } = await loadGameDeploymentReview();
    if (body.fingerprint !== plan.fingerprint)
      return json(
        { error: "The plan changed. Reload and review it again." },
        409,
      );
    try {
      const provisioning = JSON.parse(
        await readFile(
          resolve(process.cwd(), "../../deployments/signer-provisioning.json"),
          "utf8",
        ),
      );
      if (
        provisioning.status !== "PROVISIONED_DISABLED" ||
        provisioning.signer !== plan.signer
      )
        throw new GameVerificationError(
          "Verify the reviewed signer provisioning before deployment.",
        );
      return json(
        await prepareGameTransaction(chainClient(), plan, artifact, body),
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof GameVerificationError
              ? error.message
              : "Deployment preparation is unavailable. No transaction was sent.",
        },
        409,
      );
    }
  });
}
