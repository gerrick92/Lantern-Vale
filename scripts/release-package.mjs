import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyGame } from "../game/scripts/verify.mjs";
import {
  digest,
  inspectContent,
  packageFiles,
  packagePath,
  verifyPackage,
} from "./verify-package.mjs";

verifyGame(); // Refuse missing, stale or altered runtime assets before copying.
const source = resolve(".");
const output = resolve("test-results/release");
mkdirSync(output, { recursive: true });
const target = mkdtempSync(resolve(output, "lantern-vale-review-"));
const write = (path, data) => {
  inspectContent(path, Buffer.from(data));
  const file = resolve(target, packagePath(path));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data, { flag: "wx" });
};
const copy = (path) => {
  if (path === "apps/web/public/games/mosslight/.gitkeep") return;
  packagePath(path);
  const file = resolve(source, path);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink())
    throw new Error("Source symlinks and junctions cannot enter a package.");
  if (stat.isDirectory())
    for (const entry of readdirSync(file).sort()) copy(`${path}/${entry}`);
  else if (path.endsWith("/js/practice-config.js"))
    write(path, "window.MOSSLIGHT_PRACTICE_ENABLED = false;\n");
  else write(path, readFileSync(file));
};
// Explicit application allowlist; no editor source libraries, sessions, build caches or local configuration.
for (const path of [
  ".env.example",
  "package-lock.json",
  "apps/web/package.json",
  "apps/web/next.config.ts",
  "apps/web/next-env.d.ts",
  "apps/web/tsconfig.json",
  "apps/web/postcss.config.mjs",
  "apps/web/vercel.json",
  "apps/web/src",
  "apps/web/public",
  "game/rules",
  "game/asset-provenance.json",
  "contracts/src",
  "supabase/migrations",
  "supabase/functions",
  "supabase/config.toml",
  "deployments",
  "docs",
  "PROJECT_SUMMARY.md",
  "scripts/verify-package.mjs",
  "scripts/verify-hosted-game.mjs",
])
  copy(path);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.scripts = Object.fromEntries(
  Object.entries(pkg.scripts).filter(([name]) =>
    ["dev", "build", "start", "typecheck"].includes(name),
  ),
);
pkg.scripts["package:verify"] = "node scripts/verify-package.mjs";
write("package.json", JSON.stringify(pkg, null, 2) + "\n");
const gameRoot = "apps/web/public/games/mosslight/";
write(
  "game/export-manifest.json",
  JSON.stringify(
    packageFiles(target)
      .filter((path) => path.startsWith(gameRoot))
      .map((path) => {
        const data = readFileSync(resolve(target, path));
        return {
          path: path.slice(gameRoot.length),
          bytes: data.length,
          sha256: digest(data),
        };
      }),
    null,
    2,
  ) + "\n",
);
write(
  "README.md",
  `# Lantern Vale — private application review bundle

This bundle contains the Next.js application source and the complete finished RPG Maker MZ game. It is not a public deployment approval or an editor asset library. Paid play and packaged practice remain disabled. Existing local practice in the authoring repository is unchanged.

Verify with Node 24: \`node scripts/verify-package.mjs\`. Install pinned dependencies with \`npm ci\`, then use \`npm run build\` and \`npm start\` for the application. Dependencies must be downloaded or available in your npm cache; this is not an offline Node dependency installer. Copy the empty environment example to \`apps/web/.env.local\` and configure approved services as described in docs/SETUP.md. No accounts, credentials, owner ID or signer are included. No migrations run automatically. Production developer routes remain unavailable.

The package exposes only application build/start/typecheck and verification commands. Tests, the MZ authoring project and generator tools remain in the original repository. The bundled game needs neither Steam nor an RPG Maker installation to load; opening its HTML directly is not a supported authenticated play flow. The current release guards deliberately prevent an unauthenticated or unapproved game session.

Review docs/SECURITY.md before changing any gate, and docs/ASSETS.md before distribution. Preserve the game's CREDITS.txt and THIRD_PARTY_LICENSES.txt and the font license. The owner's full-clear settlement and direct email/password registration with TOTP are verified. The approved demo needs no email sender; inbox ownership is unverified and email password reset is unavailable. Broader live acceptance, distribution review, manual accessibility checks and a separate-wallet public journey remain outstanding. The manifest checks integrity and selected credential formats; it is not a cryptographic signature or a guarantee against every possible secret format.
`,
);
const files = packageFiles(target).map((path) => {
  const data = readFileSync(resolve(target, path));
  return { path, bytes: data.length, sha256: digest(data) };
});
write(
  "release-manifest.json",
  JSON.stringify({ format: 1, paidRelease: false, files }, null, 2) + "\n",
);
const verified = verifyPackage(target);
if (process.platform !== "win32")
  throw new Error(
    "The directory is verified; the deterministic ZIP wrapper currently requires Windows PowerShell.",
  );
const archive = target + ".zip";
const result = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    resolve("scripts/package-archive.ps1"),
    "-Source",
    target,
    "-Destination",
    archive,
  ],
  { encoding: "utf8", windowsHide: true },
);
if (result.status !== 0)
  throw new Error(
    "ZIP creation failed; the verified directory has been preserved.",
  );
const report = {
  status: "PASS",
  kind: "private-application-review",
  directory: target,
  archive,
  archiveSha256: digest(readFileSync(archive)),
  ...verified,
};
writeFileSync(
  resolve(output, "latest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
