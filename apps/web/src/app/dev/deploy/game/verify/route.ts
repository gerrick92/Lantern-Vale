import { z } from "zod";
import { canAccessDeveloperTools } from "@/server/developer-access";
import { loadGameDeploymentReview } from "@/server/game-deployment";
import { chainClient } from "@/server/blockchain";
import { checkOrigin, endpoint, json, readBody } from "@/server/http";
import {
  GameVerificationError,
  verifyGameDeployment,
} from "@/features/deployment/game-verification";

const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value as `0x${string}`);
const schema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    deploymentHash: hash,
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
        {
          error:
            "The review changed. Reload the page before verifying receipts.",
        },
        409,
      );
    try {
      return json(
        await verifyGameDeployment(chainClient(), plan, artifact, body),
      );
    } catch (error) {
      // Do not expose transport errors, private RPC URLs or provider headers.
      return json(
        {
          error:
            error instanceof GameVerificationError
              ? error.message
              : "The receipt or chain snapshot is unavailable. Check the hash and retry after two confirmations.",
        },
        409,
      );
    }
  });
}
