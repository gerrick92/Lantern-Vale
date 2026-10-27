import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AccountDataStatus } from "../../apps/web/src/lib/account-data";

let script: string, css: string;
test.beforeAll(async () => {
  script = (
    await build({
      entryPoints: ["tests/browser/fixtures/account-data.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      tsconfig: "apps/web/tsconfig.json",
      define: { "process.env.NODE_ENV": '"production"' },
    })
  ).outputFiles[0].text;
  const from = resolve("apps/web/src/app/globals.css");
  css = (
    await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })
  ).css;
  css +=
    '\n@font-face { font-family: "Fixture Cinzel"; src: url("/fonts/cinzel-variable.ttf") format("truetype"); font-weight: 400 900; } :root { --font-display: "Fixture Cinzel"; }';
});

test("private downloads, explicit requests, cancellation and focus work without external services", async ({
  page,
}, info) => {
  let state: AccountDataStatus = {
    available: true,
    requestedAt: null,
    needsPaymentReview: true,
  };
  let mutationCount = 0;
  let exportFailure = false;
  const exportData = {
    format: "lantern-vale-account-v1",
    account: { email: "fixture@example.test" },
    data: { contacts: [], adventures: [] },
  };
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Account data fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
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
    if (path === "/api/account/deletion") {
      if (route.request().method() === "POST") {
        mutationCount++;
        const data = route.request().postDataJSON();
        if (data.action === "request")
          expect(data).toEqual({ action: "request", confirmation: "DELETE" });
        else expect(data).toEqual({ action: "cancel" });
        state = {
          ...state,
          requestedAt:
            data.action === "request" ? "2026-10-24T00:00:00Z" : null,
        };
      }
      return route.fulfill({ json: state });
    }
    if (path === "/api/account/data")
      return route.fulfill(
        exportFailure
          ? {
              status: 503,
              json: { error: "Export unavailable. Please retry." },
            }
          : { json: exportData },
      );
    return route.abort();
  });
  await page.goto("http://127.0.0.1:3199/");
  await page
    .getByText("Download data or request deletion", { exact: true })
    .click();
  await expect(
    page.getByText(/Your payment or adventure records require review/),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download account data", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("lantern-vale-account.json");
  expect(JSON.parse(await readFile((await file.path())!, "utf8"))).toEqual(
    exportData,
  );
  exportFailure = true;
  await page
    .getByRole("button", { name: "Download account data", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Export unavailable");
  await expect(
    page.getByRole("button", { name: "Request deletion", exact: true }),
  ).toBeDisabled();
  const confirmation = page.getByLabel("Type DELETE to request deletion", {
    exact: true,
  });
  await confirmation.fill("delete");
  await expect(
    page.getByRole("button", { name: "Request deletion", exact: true }),
  ).toBeDisabled();
  await confirmation.fill("DELETE");
  await page
    .getByRole("button", { name: "Request deletion", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const cancel = page.getByRole("button", {
    name: "Cancel deletion request",
    exact: true,
  });
  await expect(cancel).toBeFocused();
  expect(mutationCount).toBe(1);
  await expect(
    page.getByText(
      "Deletion request awaiting review. You can still use your account or cancel this request.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await page
    .getByText("Download data or request deletion", { exact: true })
    .click();
  await expect(cancel).toBeVisible();
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(confirmation).toBeFocused();
  await expect(confirmation).toHaveValue("");
  expect(mutationCount).toBe(2);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.setViewportSize({
      width: theme === "light" ? 1440 : 320,
      height: 900,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`account-data-${theme}.png`),
      fullPage: true,
    });
  }
  state = { available: false, requestedAt: null, needsPaymentReview: false };
  await page.reload();
  await page
    .getByText("Download data or request deletion", { exact: true })
    .click();
  await expect(
    page.getByText("Account data tools are awaiting a service update.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download account data", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Request deletion", exact: true }),
  ).toBeDisabled();
});
