import { expect, it } from "vitest";
import {
  checkReviewProject,
  reviewArguments,
} from "../../scripts/deploy-review.mjs";

const project = {
  id: "prj_e6pw3goMLbaj0PzAfYiTky6DgUib",
  ssoProtection: { deploymentType: "all" },
  rootDirectory: "apps/web",
  installCommand: "npm ci --include=dev --include-workspace-root",
  buildCommand: "node ../../scripts/verify-hosted-game.mjs && npm run build",
};
const team = {
  id: "team_2p0xKbnDcCI74xl3ZAqmk0aH",
  billing: { plan: "hobby", trial: null },
};

it("requires the existing free plan and protection before upload", () => {
  expect(() => checkReviewProject(project, team)).not.toThrow();
  expect(() =>
    checkReviewProject({ ...project, ssoProtection: null }, team),
  ).toThrow();
  expect(() =>
    checkReviewProject(
      {
        ...project,
        ssoProtection: {
          deploymentType: "prod_deployment_urls_and_all_previews",
        },
      },
      team,
    ),
  ).toThrow();
  expect(() =>
    checkReviewProject(project, { ...team, billing: { plan: "pro" } }),
  ).toThrow();
  expect(() =>
    checkReviewProject(project, {
      ...team,
      billing: { plan: "hobby", trial: true },
    }),
  ).toThrow();
});

it("requests no custom-domain assignment and keeps secrets out of command arguments", () => {
  const args = reviewArguments("synthetic-package", [
    "SUPABASE_SECRET_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "LANTERN_STAGED_REVIEW",
    "LANTERN_GLOW_REVIEW",
    "SEPOLIA_GAME_ECONOMY_ADDRESS",
    "SETTLEMENT_SIGNER_TOKEN",
    "GAME_RECOVERY_SECRET",
    "GAME_RECOVERY_KEY",
  ]);
  expect(args).toContain("--skip-domain");
  expect(args).toContain("--prod");
  const buildKeys = args.flatMap((value, index) =>
    value === "--build-env" ? [args[index + 1]] : [],
  );
  expect(buildKeys).toEqual([
    "NEXT_PUBLIC_SUPABASE_URL",
    "LANTERN_STAGED_REVIEW",
    "LANTERN_GLOW_REVIEW",
    "SEPOLIA_GAME_ECONOMY_ADDRESS",
  ]);
  expect(buildKeys).not.toContain("SUPABASE_SECRET_KEY");
  expect(buildKeys).not.toContain("SETTLEMENT_SIGNER_TOKEN");
  expect(buildKeys).not.toContain("GAME_RECOVERY_SECRET");
  expect(buildKeys).not.toContain("GAME_RECOVERY_KEY");
});
