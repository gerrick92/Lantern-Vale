import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { HtmlValidate } from "html-validate";

test("public pages render semantic content without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of [
    "/",
    "/auth",
    "/settings",
    "/features",
    "/adventure",
    "/dashboard",
  ]) {
    await page.goto(path);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main")).toBeVisible();
    const html = await page.content();
    const report = await new HtmlValidate({
      extends: ["html-validate:recommended"],
      rules: {
        "void-style": "off",
        "no-inline-style": "off",
        "prefer-native-element": "off",
        // Browser serialization uses empty boolean attributes; React IDs are valid HTML5.
        "attribute-boolean-style": ["error", { style: "empty" }],
        "attribute-empty-style": ["error", { style: "empty" }],
        "valid-id": ["error", { relaxed: true }],
      },
    }).validateString(html);
    expect(
      report.results.flatMap((r) =>
        r.messages.map((m) => `${path}: ${m.ruleId}: ${m.message}`),
      ),
    ).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("settings own display controls and hide developer preview from guests", async ({
  page,
}) => {
  await page.goto("/auth");
  await expect(page.getByLabel("Appearance", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign out all sessions" }),
  ).toHaveCount(0);
  await page.goto("/settings");
  const originalSize = await page
    .locator("body")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.getByLabel("Larger text", { exact: true }).check();
  expect(
    await page
      .locator("body")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThan(originalSize);
  await page.getByLabel("Larger text", { exact: true }).uncheck();
  const toggle = page.getByRole("button", {
    name: "Toggle developer phone preview",
  });
  await expect(toggle).toHaveCount(0);
  await expect(page.getByTitle("Developer phone viewport")).toHaveCount(0);
});

test("light, dark and accessible mobile settings remain usable", async ({
  page,
}, info) => {
  await page.goto("/settings");
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Appearance", { exact: true }).selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Accessibility Mode", { exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-accessible", "true");
  await page.reload();
  await expect(
    page.getByLabel("Accessibility Mode", { exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("settings-mobile.png"),
    fullPage: true,
  });
});

test("keyboard skip link and mobile landing have no axe violations", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("home-mobile.png"),
    fullPage: true,
  });
});

test("private APIs reject unauthenticated and cross-origin writes", async ({
  request,
}) => {
  for (const path of [
    "/api/profile",
    "/api/contacts",
    "/api/wallet",
    "/api/rounds",
  ]) {
    const response = await request.get(path);
    expect([401, 503]).toContain(response.status());
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  const response = await request.post("/api/wallet/challenge", {
    headers: { origin: "https://untrusted.example" },
    data: {},
  });
  expect(response.status()).toBe(403);
});
