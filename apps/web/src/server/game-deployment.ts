import "server-only";
import { resolve } from "node:path";
import { loadGameReviewFiles } from "@/features/deployment/game-review-files";

export function loadGameDeploymentReview() {
  return loadGameReviewFiles(resolve(process.cwd(), "../.."), {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS,
    faucet: process.env.NEXT_PUBLIC_FAUCET_ADDRESS,
  });
}
