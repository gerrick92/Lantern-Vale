import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initialState, reduceIntent } from "../../game/rules";
import type {} from "./fixtures/companion";

let script: string, css: string;
test.beforeAll(async () => {
  script = (
    await build({
      entryPoints: ["tests/browser/fixtures/companion.tsx"],
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
test.beforeEach(async ({ page }) => {
  // All resources are fulfilled locally. No running app, Supabase session or wallet is used.
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local companion test</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
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
  await page.evaluate(() => document.fonts.ready);
});

test("keyboard purchases retain focus and unrelated updates do not steal it", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Visit armor counter", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const purchase = page.getByRole("button", { name: /Barkweave/ });
  await purchase.focus();
  await page.keyboard.press("Enter");
  await expect(purchase).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Available actions" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Speak to Nessa" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Outside the game" }).focus();
  await page.evaluate(() =>
    window.companionFixture.set({ ...window.companionFixture.get(), hp: 50 }),
  );
  await expect(
    page.getByRole("button", { name: "Outside the game" }),
  ).toBeFocused();
});

test("unavailable commands and concise live battle status reflect actual resources", async ({
  page,
}) => {
  let state = initialState("white_mage", false, { mode: "practice" });
  state = reduceIntent(state, { type: "visit", place: "magic" });
  await page.evaluate((value) => window.companionFixture.set(value), state);
  await expect(
    page.getByRole("button", { name: /Sanctuary Grimoire/ }),
  ).toHaveCount(0);
  state = reduceIntent(state, { type: "move", destination: "clearing" });
  state = reduceIntent(state, { type: "move", destination: "forest1" });
  state = reduceIntent(state, { type: "encounter", slot: 0 });
  state = { ...state, mp: 0, potions: 0, ethers: 0, turn: 2 };
  await page.evaluate((value) => window.companionFixture.set(value), state);
  await expect(
    page.getByRole("button", { name: /Requires 6 MP/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Requires 8 MP/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /No tonics left/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /No ethers left/ }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("MP 0/64");
  await expect(page.getByRole("status")).toContainText("Next:");
  await expect(
    page.getByRole("list", { name: "Adventure events" }),
  ).not.toHaveAttribute("aria-live");
  await page.getByRole("button", { name: "Defend · recover 6 MP" }).click();
  await expect(page.getByRole("status")).toContainText("MP 6/64");
  await expect(
    page.getByRole("button", { name: "Dawn Prayer · 6 MP", exact: true }),
  ).toBeEnabled();
});

test("companion fits desktop/mobile and passes automated accessibility in both themes", async ({
  page,
}) => {
  for (const width of [320, 1440])
    for (const theme of ["light", "dark"])
      for (const accessible of [false, true]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          ({ theme, accessible }) => {
            const root = document.documentElement;
            root.dataset.theme = theme;
            root.dataset.accessible = String(accessible);
            root.dataset.reduced = String(accessible);
            root.dataset.large = String(accessible);
          },
          { theme, accessible },
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
      }
  await page.getByRole("link", { name: "Skip to available actions" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Adventure actions" }),
  ).toBeFocused();
});
