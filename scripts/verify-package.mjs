import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const digest = (data) => createHash("sha256").update(data).digest("hex");
export function packagePath(path) {
  if (
    !path ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === ".." ||
          part.includes(":") ||
          /[. ]$|[\x00-\x1f\x7f]/.test(part) ||
          (part.startsWith(".") && path !== ".env.example"),
      ) ||
    /(?:^|\/)(?:node_modules|test-results|mz-source|out|cache|broadcast)(?:\/|$)/i.test(
      path,
    ) ||
    /\.(?:rmmzproject|exe|dll|log|map|tsbuildinfo|dump|backup|dpapi|bak|db|sqlite3?|pfx|p12|pgpass|key|zip|gz|tgz|tar|7z|bz2|xz)$/i.test(
      path,
    )
  )
    throw new Error(`Forbidden package path: ${path}`);
  return path;
}
export function inspectContent(path, bytes) {
  packagePath(path);
  // Check archive signatures before extension filtering so renaming a raw or
  // encrypted backup cannot turn operational data into a website asset.
  const prefix = bytes.subarray(0, 512).toString("utf8");
  if (
    prefix.startsWith("PGDMP") ||
    prefix.startsWith("LVBK0001") ||
    bytes
      .subarray(0, 20)
      .equals(Buffer.from("01000000d08c9ddf0115d1118c7a00c04fc297eb", "hex")) ||
    /^-- PostgreSQL database (?:cluster )?dump\r?$/m.test(prefix)
  )
    throw new Error(
      "Database backup content is forbidden in a review package.",
    );
  if (
    !/\.(?:ts|tsx|js|mjs|css|html|json|md|txt|example|sql|toml|ya?ml|ini|conf|ps1|sh)$/i.test(
      path,
    )
  )
    return;
  const text = bytes.toString("utf8");
  const patterns = [
    /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /\bsb_secret_[A-Za-z0-9_-]{15,}\b/,
    /(?:private[_-]?key|service[_-]?role[_-]?key|signer[_-]?token)\s*[=:]\s*["'][A-Za-z0-9_+\/-]{24,}["']/i,
    /\b(?:SUPABASE_DB_PASSWORD|PGPASSWORD|DATABASE_PASSWORD)\s*[=:]\s*["'][^"'\r\n]+["']/i,
    /\bLV_(?:BACKUP|SIGNER)_RECOVERY_KEY_V\d+\s*[=:]\s*["']?[a-f0-9]{64}\b/i,
    /\bpostgres(?:ql)?:\/\/[^\s/:@]+:[^\s@]+@/i,
    /\b(?:CREATE|ALTER)\s+(?:ROLE|USER)\b[^;]*\bPASSWORD\s+(?:E)?'[^']+'/i,
  ];
  if (patterns.some((pattern) => pattern.test(text)))
    throw new Error(`Potential credential in package file: ${path}`);
  if (
    path === ".env.example" &&
    text
      .split(/\r?\n/)
      .some(
        (line) =>
          line.trim() &&
          !line.trim().startsWith("#") &&
          !/^[A-Z0-9_]+=$/.test(line.trim()),
      )
  )
    throw new Error(
      "Environment example must contain empty placeholders only.",
    );
}
export function packageFiles(root) {
  const files = [];
  const walk = (folder, prefix = "") => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink())
        throw new Error("Package symlinks and junctions are forbidden.");
      packagePath(path);
      if (entry.isDirectory()) walk(resolve(folder, entry.name), path + "/");
      else if (entry.isFile()) files.push(path);
      else throw new Error("Unexpected package filesystem entry.");
    }
  };
  walk(root);
  return files.sort();
}
export function verifyPackage(root) {
  root = resolve(root);
  if (lstatSync(root).isSymbolicLink())
    throw new Error("Package root must not be a link.");
  const manifest = JSON.parse(
    readFileSync(resolve(root, "release-manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    manifest.paidRelease !== false ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Invalid review manifest.");
  const actual = packageFiles(root).filter(
    (path) => path !== "release-manifest.json",
  );
  if (
    JSON.stringify(actual) !==
    JSON.stringify(manifest.files.map((item) => item.path))
  )
    throw new Error("Package file list differs from the manifest.");
  for (const item of manifest.files) {
    const data = readFileSync(resolve(root, packagePath(item.path)));
    if (data.length !== item.bytes || digest(data) !== item.sha256)
      throw new Error(`Package checksum mismatch: ${item.path}`);
    inspectContent(item.path, data);
  }
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  for (const required of [
    "package.json",
    "package-lock.json",
    "apps/web/next.config.ts",
    "apps/web/src/app/layout.tsx",
    "game/rules/index.ts",
    "apps/web/public/fonts/Cinzel-OFL.txt",
    "apps/web/public/games/mosslight/CREDITS.txt",
    "apps/web/public/games/mosslight/THIRD_PARTY_LICENSES.txt",
    "apps/web/public/games/mosslight/js/libs/effekseer.wasm",
  ])
    if (!actual.includes(required))
      throw new Error(`Missing package dependency or notice: ${required}`);
  if (
    !/paidEconomyReady: boolean = false/.test(
      read("apps/web/src/lib/economy-release.ts"),
    )
  )
    throw new Error(
      "Paid release must remain disabled in this review package.",
    );
  if (
    read("apps/web/public/games/mosslight/js/practice-config.js").trim() !==
    "window.MOSSLIGHT_PRACTICE_ENABLED = false;"
  )
    throw new Error("Review package practice release guard is missing.");
  const game = JSON.parse(read("game/export-manifest.json"));
  const gamePaths = actual
    .filter((path) => path.startsWith("apps/web/public/games/mosslight/"))
    .map((path) => path.slice("apps/web/public/games/mosslight/".length));
  if (
    JSON.stringify(gamePaths) !==
    JSON.stringify(game.map((item) => item.path).sort())
  )
    throw new Error("Finished game is incomplete.");
  for (const item of game) {
    const data = readFileSync(
      resolve(root, "apps/web/public/games/mosslight", packagePath(item.path)),
    );
    if (data.length !== item.bytes || digest(data) !== item.sha256)
      throw new Error(`Finished game checksum mismatch: ${item.path}`);
  }
  return {
    files: actual.length,
    bytes: manifest.files.reduce((sum, item) => sum + item.bytes, 0),
    manifestSha256: digest(
      readFileSync(resolve(root, "release-manifest.json")),
    ),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(
    JSON.stringify({
      status: "PASS",
      ...verifyPackage(process.argv[2] || "."),
    }),
  );
}
