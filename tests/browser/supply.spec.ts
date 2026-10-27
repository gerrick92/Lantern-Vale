import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import type {} from "./fixtures/wallet-rpc";

let script: string;
test.beforeAll(async () => {
  script = (
    await build({
      entryPoints: ["tests/browser/fixtures/supply.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      tsconfig: "apps/web/tsconfig.json",
      alias: { wagmi: resolve("tests/browser/fixtures/wallet-rpc.ts") },
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.NEXT_PUBLIC_TOKEN_ADDRESS":
          '"0x0000000000000000000000000000000000000003"',
        "process.env.NEXT_PUBLIC_FAUCET_ADDRESS":
          '"0x0000000000000000000000000000000000000004"',
        "process.env.NEXT_PUBLIC_GAME_GATEWAY_ADDRESS": "undefined",
        "process.env.NEXT_PUBLIC_REWARD_ADDRESS": "undefined",
        "process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL": "undefined",
      },
    })
  ).outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3197") return route.abort();
    return url.pathname === "/fixture.js"
      ? route.fulfill({ contentType: "application/javascript", body: script })
      : route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="en"><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
        });
  });
  await page.goto("http://127.0.0.1:3197/");
});
function figure(page: Page, name: string) {
  return page
    .getByRole("region", { name: "GLOW supply" })
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${name}$`) }) })
    .locator("dd");
}
test("claim confirmation refreshes the mounted supply and balance without reloading", async ({
  page,
}) => {
  await expect(figure(page, "Your wallet")).toHaveText("5 GLOW");
  await page.getByRole("button", { name: "Claim 5 GLOW" }).click();
  await page.waitForFunction(() => window.walletFixture.pending);
  await expect(figure(page, "Faucet pool")).toHaveText("4995 GLOW");
  await expect(figure(page, "Your wallet")).toHaveText("5 GLOW");
  await page.evaluate(() => window.walletFixture.confirm(true));
  await expect(figure(page, "Faucet pool")).toHaveText("4990 GLOW", {
    timeout: 5000,
  });
  await expect(figure(page, "Your wallet")).toHaveText("10 GLOW");
  await expect(
    page.getByText("Your balance: 10 GLOW", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Claim 5 GLOW" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.walletFixture.confirmations)).toBe(2);
  await page.evaluate(() => window.walletFixture.switchWallet("second"));
  await expect(figure(page, "Your wallet")).toHaveText("0 GLOW");
  await expect(figure(page, "Other addresses")).toHaveText("10 GLOW");
  await page.evaluate(() => window.walletFixture.switchWallet("none"));
  await expect(figure(page, "Your wallet")).toHaveCount(0);
  await expect(figure(page, "Other addresses")).toHaveText("10 GLOW");
});
test("confirmation after switching accounts does not put the previous wallet balance into the current view", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Claim 5 GLOW" }).click();
  await page.waitForFunction(() => window.walletFixture.pending);
  await page.evaluate(() => window.walletFixture.switchWallet("second"));
  await expect(figure(page, "Your wallet")).toHaveText("0 GLOW");
  await page.evaluate(() => window.walletFixture.confirm(true));
  await expect(figure(page, "Other addresses")).toHaveText("10 GLOW", {
    timeout: 5000,
  });
  await expect(figure(page, "Your wallet")).toHaveText("0 GLOW");
});
for (const outcome of ["rejected", "reverted"] as const)
  test(`${outcome} claims never invent an increased balance`, async ({
    page,
  }) => {
    if (outcome === "rejected")
      await page.evaluate(() => window.walletFixture.reject());
    await page.getByRole("button", { name: "Claim 5 GLOW" }).click();
    if (outcome === "reverted") {
      await page.waitForFunction(() => window.walletFixture.pending);
      await page.evaluate(() => window.walletFixture.confirm(false));
    }
    await expect(
      page.getByText(
        outcome === "reverted"
          ? "The transaction reverted. No action was completed."
          : "User rejected the request.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(figure(page, "Your wallet")).toHaveText("5 GLOW");
    await expect(figure(page, "Faucet pool")).toHaveText("4995 GLOW");
  });
