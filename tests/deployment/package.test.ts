import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { sealBackup } from "../../scripts/backup-envelope.mjs";
import { expect, it } from "vitest";
import {
  digest,
  inspectContent,
  packagePath,
  verifyPackage,
} from "../../scripts/verify-package.mjs";

it("rejects private paths and credential-bearing content without echoing the credential", () => {
  for (const path of [
    "../outside",
    "C:/outside",
    "/outside",
    "apps/web/.env.local",
    "node_modules/key.txt",
    "game/mz-source/img/test.png",
    "Game.rmmzproject",
    "app.js.map",
  ])
    expect(() => packagePath(path)).toThrow();
  for (const secret of [
    "-----BEGIN " + "PRIVATE KEY-----",
    "sb_secret_" + "x".repeat(40),
    "eyJ" + "x".repeat(30) + "." + "x".repeat(30) + "." + "x".repeat(30),
    'privateKey = "0x' + "a".repeat(64) + '"',
    'LV_BACKUP_RECOVERY_KEY_V1="' + "a".repeat(64) + '"',
    'LV_SIGNER_RECOVERY_KEY_V1="' + "b".repeat(64) + '"',
  ]) {
    expect(() => inspectContent("config.ts", Buffer.from(secret))).toThrow(
      "Potential credential in package file: config.ts",
    );
  }
  expect(() =>
    inspectContent(".env.example", Buffer.from("SERVICE_KEY=not-empty")),
  ).toThrow("empty placeholders");
  expect(() =>
    inspectContent(
      "config.ts",
      Buffer.from("const key = process.env.SUPABASE_SERVICE_ROLE_KEY;"),
    ),
  ).not.toThrow();
});

it("rejects database backups and opaque archives copied into allowed folders", () => {
  for (const path of [
    "docs/database.dump",
    "docs/database.DUMP.DPAPI",
    "apps/web/public/database.backup",
    "docs/account.sqlite3",
    "docs/roles.sql.gz",
    "apps/web/public/backup.zip",
    "docs/database.dump.",
    "apps/web/.env.example",
  ])
    expect(() => packagePath(path), path).toThrow();
  for (const bytes of [
    Buffer.from("PGDMP\x01synthetic fixture"),
    sealBackup(
      Buffer.from("Synthetic account archive"),
      randomBytes(32),
      "fixture/backup",
    ),
    Buffer.from("--\n-- PostgreSQL database dump\n--\n"),
    Buffer.from("--\r\n-- PostgreSQL database cluster dump\r\n--\r\n"),
  ])
    expect(() => inspectContent("docs/renamed.png", bytes)).toThrow(
      "Database backup content is forbidden in a review package",
    );
});

it("checks SQL and configuration files for credentials without rejecting applied migrations", () => {
  const password = "synthetic-only-password";
  for (const path of [
    "docs/roles.sql",
    "docs/settings.toml",
    "docs/config.yaml",
    "docs/setup.ps1",
  ]) {
    for (const text of [
      ["ALTER", "ROLE sample WITH PASSWORD", `'${password}';`].join(" "),
      "DATABASE_URL='postgresql://" + `fixture:${password}@localhost:5432/db'`,
      ["SUPABASE", "DB", "PASSWORD"].join("_") + "=" + JSON.stringify(password),
      "sb_secret_" + "x".repeat(40),
    ])
      expect(() => inspectContent(path, Buffer.from(text))).toThrow(
        `Potential credential in package file: ${path}`,
      );
  }
  const migrations = JSON.parse(
    readFileSync("supabase/applied-migrations.json", "utf8"),
  );
  for (const { file } of migrations.migrations) {
    const path = `supabase/migrations/${file}`;
    expect(() => inspectContent(path, readFileSync(path))).not.toThrow();
  }
});

function fixture() {
  mkdirSync("test-results/package-fixtures", { recursive: true });
  const root = mkdtempSync(resolve("test-results/package-fixtures/review-"));
  const files: Record<string, string> = Object.fromEntries(
    [
      "package.json",
      "package-lock.json",
      "apps/web/next.config.ts",
      "apps/web/src/app/layout.tsx",
      "game/rules/index.ts",
      "apps/web/public/fonts/Cinzel-OFL.txt",
      "apps/web/public/games/mosslight/CREDITS.txt",
      "apps/web/public/games/mosslight/THIRD_PARTY_LICENSES.txt",
      "apps/web/public/games/mosslight/js/libs/effekseer.wasm",
    ].map((path) => [path, "Local verifier fixture"]),
  );
  files["apps/web/src/lib/economy-release.ts"] =
    "export const paidEconomyReady: boolean = false;";
  files["apps/web/public/games/mosslight/js/practice-config.js"] =
    "window.MOSSLIGHT_PRACTICE_ENABLED = false;";
  const entry = (path: string) => ({
    path,
    bytes: Buffer.byteLength(files[path]),
    sha256: digest(Buffer.from(files[path])),
  });
  files["game/export-manifest.json"] = JSON.stringify(
    Object.keys(files)
      .filter((path) => path.startsWith("apps/web/public/games/mosslight/"))
      .sort()
      .map((path) => ({
        ...entry(path),
        path: path.slice("apps/web/public/games/mosslight/".length),
      })),
  );
  files["release-manifest.json"] = JSON.stringify({
    format: 1,
    paidRelease: false,
    files: Object.keys(files).sort().map(entry),
  });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), text);
  }
  return root;
}

it("checks every packaged byte and rejects missing game files or unlisted configuration", () => {
  const root = fixture();
  expect(verifyPackage(root).files).toBeGreaterThan(10);
  const game = resolve(
    root,
    "apps/web/public/games/mosslight/js/libs/effekseer.wasm",
  );
  const before = readFileSync(game);
  writeFileSync(game, "altered");
  expect(() => verifyPackage(root)).toThrow("checksum mismatch");
  writeFileSync(game, before);
  unlinkSync(game);
  expect(() => verifyPackage(root)).toThrow("file list differs");
  writeFileSync(game, before);
  writeFileSync(resolve(root, "unlisted.json"), "{}");
  expect(() => verifyPackage(root)).toThrow("file list differs");
});
