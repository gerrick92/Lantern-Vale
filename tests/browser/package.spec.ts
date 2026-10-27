import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { verifyPackage, packagePath } from "../../scripts/verify-package.mjs";
const latest = resolve("test-results/release/latest.json");

test("packaged MZ runtime loads with both release guards closed and no editor dependency", async ({
  page,
}) => {
  const { directory } = JSON.parse(readFileSync(latest, "utf8"));
  expect(verifyPackage(directory).files).toBeGreaterThan(220);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3199")
      throw new Error("Packaged game tried an external request.");
    const path = packagePath(decodeURIComponent(url.pathname.slice(1)));
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".json": "application/json",
      ".css": "text/css",
      ".wasm": "application/wasm",
      ".png": "image/png",
      ".ogg": "audio/ogg",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
    };
    try {
      await route.fulfill({
        body: readFileSync(resolve(directory, "apps/web/public", path)),
        contentType: types[extname(path)] || "application/octet-stream",
      });
    } catch {
      errors.push(`Missing packaged resource: ${path}`);
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto(
    "http://127.0.0.1:3199/games/mosslight/index.html?practice=1",
  );
  await page.waitForFunction(
    "window.SceneManager?._scene?.constructor.name === 'Scene_Title' && SceneManager._scene.isStarted()",
  );
  expect(await page.evaluate("MosslightBridge.practice")).toBe(false);
  expect(
    await page.evaluate(
      "SceneManager._scene._commandWindow.isCommandEnabled(0)",
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
