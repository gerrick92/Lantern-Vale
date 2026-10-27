import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve(".tools/browsers");
const { chromium } = await import("@playwright/test");
mkdirSync("test-results/lighthouse", { recursive: true });
const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: [
    "--headless",
    "--mute-audio",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});
try {
  for (const mode of ["mobile", "desktop"]) {
    const result = await lighthouse(
      "http://127.0.0.1:3001/",
      {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: [
          "performance",
          "accessibility",
          "best-practices",
          "seo",
        ],
      },
      mode === "desktop" ? desktopConfig : undefined,
    );
    if (!result?.lhr || result.lhr.runtimeError)
      throw new Error(`Lighthouse ${mode} did not finish.`);
    if (result.lhr.configSettings.formFactor !== mode)
      throw new Error(
        `Lighthouse did not use the requested ${mode} configuration.`,
      );
    writeFileSync(`test-results/lighthouse/${mode}.json`, result.report);
    console.log(
      `${mode}: ${Object.values(result.lhr.categories)
        .map((c) => `${c.title} ${Math.round(c.score * 100)}`)
        .join(", ")}`,
    );
  }
} finally {
  await chrome.kill();
}
