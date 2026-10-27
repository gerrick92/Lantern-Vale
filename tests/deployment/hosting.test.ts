import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { digest } from "../../scripts/verify-package.mjs";
import { verifyHostedGame } from "../../scripts/verify-hosted-game.mjs";

function fixture(practice = false) {
  mkdirSync("test-results/hosting-fixtures", { recursive: true });
  const root = mkdtempSync(resolve("test-results/hosting-fixtures/build-"));
  const game = resolve(root, "apps/web/public/games/mosslight");
  const files = new Map([
    ["index.html", "Synthetic game entry"],
    ["js/rmmz_core.js", "Synthetic runtime"],
    ["js/libs/effekseer.wasm", "Synthetic effect dependency"],
    ["CREDITS.txt", "Synthetic notice"],
    ["THIRD_PARTY_LICENSES.txt", "Synthetic license"],
    [
      "js/practice-config.js",
      `window.MOSSLIGHT_PRACTICE_ENABLED = ${practice};`,
    ],
  ]);
  for (const [path, text] of files) {
    mkdirSync(dirname(resolve(game, path)), { recursive: true });
    writeFileSync(resolve(game, path), text);
  }
  mkdirSync(resolve(root, "game"), { recursive: true });
  writeFileSync(
    resolve(root, "game/export-manifest.json"),
    JSON.stringify(
      [...files].map(([path, text]) => ({
        path,
        bytes: Buffer.byteLength(text),
        sha256: digest(Buffer.from(text)),
      })),
    ),
  );
  mkdirSync(resolve(root, "apps/web/src/lib"), { recursive: true });
  writeFileSync(
    resolve(root, "apps/web/src/lib/economy-release.ts"),
    "export const paidEconomyReady: boolean = false;",
  );
  return { root, game };
}

it("checks hosted game assets even after dependency installation has added files", () => {
  const { root, game } = fixture();
  mkdirSync(resolve(root, "node_modules"));
  writeFileSync(
    resolve(root, "node_modules/build-only.txt"),
    "Synthetic installed dependency",
  );
  expect(verifyHostedGame(root)).toEqual({ files: 6 });
  const effect = resolve(game, "js/libs/effekseer.wasm");
  const original = readFileSync(effect);
  writeFileSync(effect, "changed");
  expect(() => verifyHostedGame(root)).toThrow("checksum mismatch");
  writeFileSync(effect, original);
  unlinkSync(effect);
  expect(() => verifyHostedGame(root)).toThrow("complete verified game export");
});

it("refuses a practice-enabled export or an unreviewed paid rollout", () => {
  expect(() => verifyHostedGame(fixture(true).root)).toThrow("Local practice");
  const { root } = fixture();
  writeFileSync(
    resolve(root, "apps/web/src/lib/economy-release.ts"),
    "export const paidEconomyReady: boolean = true;",
  );
  expect(() => verifyHostedGame(root)).toThrow("separate reviewed rollout");
});

it("blocks an unexpected production target before the hosted app can build", () => {
  const { root } = fixture();
  expect(() => verifyHostedGame(root, { VERCEL_ENV: "production" })).toThrow(
    "protected, unaliased review",
  );
  expect(verifyHostedGame(root, { VERCEL_ENV: "preview" })).toEqual({
    files: 6,
  });
  expect(
    verifyHostedGame(root, {
      VERCEL_ENV: "production",
      LANTERN_STAGED_REVIEW: "true",
    }),
  ).toEqual({ files: 6 });
  expect(() =>
    verifyHostedGame(fixture(true).root, {
      VERCEL_ENV: "production",
      LANTERN_STAGED_REVIEW: "true",
    }),
  ).toThrow("Local practice");
});
