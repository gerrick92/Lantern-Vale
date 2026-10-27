import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { vercel } from "./retain-hosted-backup.mjs";
import { verifyPackage } from "./verify-package.mjs";

const root = resolve(import.meta.dirname, "..");
const projectId = "prj_e6pw3goMLbaj0PzAfYiTky6DgUib";
const teamId = "team_2p0xKbnDcCI74xl3ZAqmk0aH";

export function checkReviewProject(project, team) {
  if (
    project.id !== projectId ||
    team.id !== teamId ||
    team.billing?.plan !== "hobby" ||
    team.billing?.trial ||
    project.ssoProtection?.deploymentType !== "all" ||
    project.rootDirectory !== "apps/web" ||
    project.installCommand !==
      "npm ci --include=dev --include-workspace-root" ||
    project.buildCommand !==
      "node ../../scripts/verify-hosted-game.mjs && npm run build"
  )
    throw new Error(
      "Review requires the existing free project, all-deployment protection and reviewed build settings. Standard protection can expose an automatic project alias even with --skip-domain.",
    );
}

export function reviewArguments(packageRoot, keys) {
  return [
    resolve(root, ".tools/vercel/node_modules/vercel/dist/index.js"),
    "deploy",
    packageRoot,
    "--prod",
    "--skip-domain",
    "--archive=tgz",
    "--yes",
    "--no-wait",
    "--scope",
    "lantern-vale",
    "--global-config",
    resolve(root, ".tools/private/vercel"),
    ...keys.flatMap((key) => ["--env", key]),
    ...keys
      .filter(
        (key) =>
          key.startsWith("NEXT_PUBLIC_") ||
          [
            "LANTERN_STAGED_REVIEW",
            "LANTERN_GLOW_REVIEW",
            "SEPOLIA_GAME_ECONOMY_ADDRESS",
          ].includes(key),
      )
      .flatMap((key) => ["--build-env", key]),
  ];
}

async function main() {
  const deploy = process.argv.includes("--deploy");
  const glow = process.argv.includes("--glow");
  const publicOrigin = process.argv.includes("--public-origin");
  if (publicOrigin && !glow)
    throw new Error("The public origin requires the working GLOW services.");
  const latest = JSON.parse(
    readFileSync(resolve(root, "test-results/release/latest.json"), "utf8"),
  );
  const packageRoot = resolve(latest.directory);
  const verified = verifyPackage(packageRoot);
  if (verified.paidRelease !== glow)
    throw new Error("Select a package whose GLOW mode matches --glow.");
  const project = await vercel(`/v9/projects/${projectId}`);
  const team = await vercel(`/v2/teams/${teamId}`);
  checkReviewProject(project, team);
  // Select only the service explicitly requested for this protected deployment.
  // Credentials are never copied into the upload directory.
  const staging = parseEnv(
    readFileSync(resolve(root, "apps/web/.env.staging.local"), "utf8"),
  );
  const configured = parseEnv(
    readFileSync(resolve(root, "apps/web/.env.local"), "utf8"),
  );
  if (
    staging.NEXT_PUBLIC_SUPABASE_URL !==
    "https://nisviqoxcfbtwccdjqoz.supabase.co"
  )
    throw new Error("Expected the separate staging database.");
  const service = glow ? configured : staging;
  if (
    glow &&
    configured.NEXT_PUBLIC_SUPABASE_URL !==
      "https://frbbhbkwtgqczdjfhedi.supabase.co"
  )
    throw new Error("Expected the existing working game database.");
  const environment = {
    LANTERN_STAGED_REVIEW: "true",
    ...(glow ? { LANTERN_GLOW_REVIEW: "true" } : {}),
    NEXT_PUBLIC_SUPABASE_URL: service.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      service.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: service.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_TOKEN_ADDRESS: configured.NEXT_PUBLIC_TOKEN_ADDRESS,
    NEXT_PUBLIC_FAUCET_ADDRESS: configured.NEXT_PUBLIC_FAUCET_ADDRESS,
    NEXT_PUBLIC_DEPLOYMENT_BLOCK: configured.NEXT_PUBLIC_DEPLOYMENT_BLOCK,
    NEXT_PUBLIC_SEPOLIA_RPC_URL:
      configured.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
    SEPOLIA_RPC_URL:
      configured.SEPOLIA_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
    REWARDS_ENABLED: "false",
  };
  if (glow) {
    // Only adapters required by the existing game. Never copy owner identity,
    // private signing keys, database passwords or unrelated configuration.
    for (const key of [
      "SEPOLIA_GAME_ECONOMY_ADDRESS",
      "SEPOLIA_GAME_DEPLOYMENT_BLOCK",
      "SETTLEMENT_SIGNER_URL",
      "SETTLEMENT_SIGNER_TOKEN",
      "GAME_RECOVERY_URL",
      "GAME_RECOVERY_SECRET",
      "GAME_RECOVERY_KEY",
      "GAME_RECOVERY_STREAM",
    ])
      environment[key] = configured[key];
    if (
      environment.GAME_RECOVERY_URL !== staging.NEXT_PUBLIC_SUPABASE_URL ||
      environment.SETTLEMENT_SIGNER_URL !==
        `${configured.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/settlement-signer`
    )
      throw new Error("The existing signer/recovery services do not match.");
  }
  if (Object.values(environment).some((value) => !value))
    throw new Error("An approved review connection value is missing.");
  if (publicOrigin) {
    const domains = await vercel(`/v9/projects/${projectId}/domains`);
    if (
      !domains.domains?.some(
        (domain) =>
          domain.name === "lantern-vale.vercel.app" &&
          domain.verified &&
          !domain.redirect,
      )
    )
      throw new Error("The existing free public domain is not verified.");
    environment.APP_ORIGIN = "https://lantern-vale.vercel.app";
  }
  const existing = (await vercel(`/v9/projects/${projectId}/env`)).envs;
  if (existing.some((entry) => entry.target?.includes("production")))
    throw new Error(
      "Review production-target environment before adding deployment-specific staging values.",
    );
  console.log(
    JSON.stringify({
      status: "PASS",
      phase: "preflight",
      files: verified.files,
      freePlan: true,
      policyUnchanged: true,
      publicDomainAssigned: false,
      deploy,
      glowForAllRegisteredPlayers: glow,
      applicationOrigin: environment.APP_ORIGIN || "deployment URL",
    }),
  );
  if (!deploy) return;
  const link = resolve(packageRoot, ".vercel");
  mkdirSync(link);
  writeFileSync(
    resolve(link, "project.json"),
    JSON.stringify({ projectId, orgId: teamId, projectName: "lantern-vale" }),
  );
  // Names alone appear in argv. The official CLI privately reads values from
  // its process environment; no environment file or secret argument is uploaded.
  const output = await new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      reviewArguments(packageRoot, Object.keys(environment)),
      {
        cwd: packageRoot,
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...environment, VERCEL_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", () =>
      reject(new Error("Vercel deployment could not start.")),
    );
    child.on("close", (code) => {
      let safeLog = stderr;
      for (const value of Object.values(environment))
        if (value.length > 15)
          safeLog = safeLog.replaceAll(value, "[configured value]");
      mkdirSync(resolve(root, "test-results/hosting"), { recursive: true });
      writeFileSync(
        resolve(root, "test-results/hosting/review-deploy.log"),
        safeLog,
      );
      if (code !== 0)
        reject(
          new Error(
            "Vercel deployment failed; inspect the redacted review log.",
          ),
        );
      else done(stdout);
    });
  });
  const url = output.match(/https:\/\/[a-z0-9-]+\.vercel\.app\b/)?.[0];
  if (!url)
    throw new Error(
      "No deployment URL returned; inspect existing deployments before retrying.",
    );
  const deployed = await vercel(`/v13/deployments/${new URL(url).hostname}`);
  if (
    deployed.projectId !== projectId ||
    deployed.autoAssignCustomDomains !== false ||
    deployed.alias?.includes("lantern-vale.vercel.app")
  )
    throw new Error(
      "Unexpected deployment identity or domain assignment; do not promote.",
    );
  const report = {
    checkedAt: new Date().toISOString(),
    id: deployed.id,
    url,
    status: deployed.readyState,
    protectedReview: true,
    glowForAllRegisteredPlayers: glow,
    applicationOrigin: environment.APP_ORIGIN || url,
    publicDomainAssigned: false,
    packageManifestSha256: verified.manifestSha256,
  };
  writeFileSync(
    resolve(root, "test-results/hosting/review-deployment.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
