import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

// Exercise the real exported MZ runtime without hosted accounts or the user's browser.
export const test = base.extend({
  page: async ({ page }, provide) => {
    const root = resolve("apps/web/public/games/mosslight");
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const file = resolve(root, "." + decodeURIComponent(url.pathname));
      if (
        url.origin !== "http://127.0.0.1:3198" ||
        (!file.startsWith(root + "/") && !file.startsWith(root + "\\"))
      )
        return route.abort();
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".wasm": "application/wasm",
        ".png": "image/png",
        ".ogg": "audio/ogg",
        ".ttf": "font/ttf",
      };
      await route.fulfill({
        body: await readFile(file),
        contentType: types[extname(file)] || "application/octet-stream",
      });
    });
    await page.goto("http://127.0.0.1:3198/index.html?practice=1");
    await page.waitForFunction(
      "window.SceneManager?._scene?.constructor.name==='Scene_Title' && SceneManager._scene.isStarted()",
    );
    await page.evaluate(
      "AudioManager.bgmVolume=0; AudioManager.meVolume=0; AudioManager.seVolume=0",
    );
    await provide(page);
  },
});
export { expect };
