import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digest, packageFiles, packagePath } from "./verify-package.mjs";

export function verifyHostedGame(root, environment = process.env) {
  const stagedReview =
    environment.VERCEL_ENV === "production" &&
    environment.LANTERN_STAGED_REVIEW === "true";
  if (
    environment.VERCEL_ENV &&
    environment.VERCEL_ENV !== "preview" &&
    !stagedReview
  )
    throw new Error(
      "Use a Vercel preview or the protected, unaliased review deployment workflow.",
    );
  const gameRoot = resolve(root, "apps/web/public/games/mosslight");
  const manifest = JSON.parse(
    readFileSync(resolve(root, "game/export-manifest.json"), "utf8"),
  );
  const paths = packageFiles(gameRoot);
  if (
    !Array.isArray(manifest) ||
    JSON.stringify(paths) !==
      JSON.stringify(manifest.map((entry) => entry.path).sort())
  )
    throw new Error(
      "The hosted build needs the complete verified game export.",
    );
  for (const entry of manifest) {
    const data = readFileSync(resolve(gameRoot, packagePath(entry.path)));
    if (data.length !== entry.bytes || digest(data) !== entry.sha256)
      throw new Error(`Game export checksum mismatch: ${entry.path}`);
  }
  for (const required of [
    "index.html",
    "js/rmmz_core.js",
    "js/libs/effekseer.wasm",
    "CREDITS.txt",
    "THIRD_PARTY_LICENSES.txt",
  ])
    if (!paths.includes(required))
      throw new Error(`Missing game runtime or notice: ${required}`);
  if (
    readFileSync(resolve(gameRoot, "js/practice-config.js"), "utf8").trim() !==
    "window.MOSSLIGHT_PRACTICE_ENABLED = false;"
  )
    throw new Error("Local practice cannot be enabled in a hosted build.");
  if (
    !/paidEconomyReady: boolean = false/.test(
      readFileSync(
        resolve(root, "apps/web/src/lib/economy-release.ts"),
        "utf8",
      ),
    )
  ) {
    if (!stagedReview || environment.LANTERN_GLOW_REVIEW !== "true")
      throw new Error(
        "GLOW hosting requires the protected working-service review workflow.",
      );
    const review = JSON.parse(
      readFileSync(resolve(root, "release-manifest.json"), "utf8"),
    );
    if (
      review.paidRelease !== true ||
      review.purpose !== "protected-glow-review" ||
      environment.NEXT_PUBLIC_SUPABASE_URL !==
        "https://frbbhbkwtgqczdjfhedi.supabase.co"
    )
      throw new Error(
        "GLOW hosting requires the protected working-service review workflow.",
      );
  }
  return { files: paths.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify({ status: "PASS", ...verifyHostedGame(root) }));
}
