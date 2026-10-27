import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let script: string, css: string;
test.beforeAll(async () => {
  script = (
    await build({
      entryPoints: ["tests/browser/fixtures/game-deployment.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      tsconfig: "apps/web/tsconfig.json",
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    })
  ).outputFiles[0].text;
  const from = resolve("apps/web/src/app/globals.css");
  css = (
    await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })
  ).css;
  css +=
    '\n@font-face { font-family: "Fixture Cinzel"; src: url("/fonts/cinzel-variable.ttf") format("truetype"); font-weight: 400 900; } :root { --font-display: "Fixture Cinzel"; }';
});

test("disconnected owner cannot send and receipt review clears stale success after changed input", async ({
  page,
}) => {
  let failure = true;
  let verifiedRequests = 0;
  const deploymentHash = "0x" + "1".repeat(64);
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Game contract review fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
      });
    if (path === "/fixture.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: script,
      });
    if (path === "/fixture.css")
      return route.fulfill({ contentType: "text/css", body: css });
    if (path === "/fonts/cinzel-variable.ttf")
      return route.fulfill({
        contentType: "font/ttf",
        body: await readFile("apps/web/public/fonts/cinzel-variable.ttf"),
      });
    if (path === "/dev/deploy/game/verify") {
      verifiedRequests++;
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toMatchObject({ deploymentHash });
      return route.fulfill(
        failure
          ? {
              status: 409,
              json: { error: "Receipt does not match the reviewed plan." },
            }
          : {
              json: {
                status: "PASS",
                stage: "PAUSED_DEPLOYMENT",
                economy: "0x5000000000000000000000000000000000000005",
                blockNumber: "103",
                paidPlayEnabled: false,
              },
            },
      );
    }
    return route.abort();
  });
  await page.goto("http://127.0.0.1:3199/");
  await expect(
    page.getByRole("button", {
      name: "Check or resume saved transactions",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review next transaction in MetaMask" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Game contract review",
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download unsigned review" }).click();
  const reviewFile = await downloaded;
  const review = JSON.parse(await readFile((await reviewFile.path())!, "utf8"));
  expect(review.status).toBe("REVIEW_ONLY");
  expect(review.funding).not.toHaveProperty("data");
  await page
    .getByLabel("Deployment transaction hash", { exact: true })
    .fill("0x1234");
  await page
    .getByRole("button", { name: "Verify receipts", exact: true })
    .click();
  expect(verifiedRequests).toBe(0);
  await page
    .getByLabel("Deployment transaction hash", { exact: true })
    .fill(deploymentHash);
  await page
    .getByRole("button", { name: "Verify receipts", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("does not match");
  await expect(
    page.getByRole("button", { name: "Download verification report" }),
  ).toHaveCount(0);
  failure = false;
  await page
    .getByRole("button", { name: "Verify receipts", exact: true })
    .click();
  const receiptReview = page.getByRole("region", {
    name: "Verify deployment receipts",
  });
  await expect(receiptReview.getByRole("status")).toContainText(
    "Funding is still pending",
  );
  await expect(
    page.getByRole("button", { name: "Use verified receipts", exact: true }),
  ).toBeDisabled();
  const reportDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download verification report" })
    .click();
  const report = await reportDownload;
  expect(
    JSON.parse(await readFile((await report.path())!, "utf8")),
  ).toMatchObject({ status: "PASS", paidPlayEnabled: false });
  await page
    .getByLabel("Funding transaction hash (optional)", { exact: true })
    .fill("0x" + "2".repeat(64));
  await expect(receiptReview.getByRole("status")).toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Download verification report" }),
  ).toHaveCount(0);
  expect(verifiedRequests).toBe(2);
});

test("review is usable at phone and desktop widths in both themes", async ({
  page,
}, info) => {
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Game contract review fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
      });
    if (path === "/fixture.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: script,
      });
    if (path === "/fixture.css")
      return route.fulfill({ contentType: "text/css", body: css });
    if (path === "/fonts/cinzel-variable.ttf")
      return route.fulfill({
        contentType: "font/ttf",
        body: await readFile("apps/web/public/fonts/cinzel-variable.ttf"),
      });
    return route.abort();
  });
  await page.goto("http://127.0.0.1:3199/");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`review-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await page
    .getByText("Review identity and prerequisites", { exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Plan fingerprint:/)).toBeVisible();
});
