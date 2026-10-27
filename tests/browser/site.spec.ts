import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("display controls survive malformed preferences and unavailable storage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("mosslight:appearance", "null");
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "mosslight:appearance") {
        throw new DOMException(
          "Storage blocked for this test",
          "SecurityError",
        );
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto("/settings");
  await page.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Accessibility Mode", { exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-accessible", "true");
  await page.getByLabel("Mute game audio", { exact: true }).check();
  await expect(
    page.getByLabel("Mute game audio", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Info", exact: true })
    .click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("guests see account access and brief homepage features", async ({
  page,
}, info) => {
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Lantern Vale", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", {
      name: "Play an RPG. Earn tokens.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Connect your wallet.", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Play", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("A classic fantasy RPG", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("home-desktop.png"),
    fullPage: true,
  });
  await main.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create account", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Next, set up Google Authenticator/),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Info", exact: true }).click();
  await expect(
    nav.getByRole("link", { name: "Info", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#rpg details")).not.toHaveAttribute("open");
  await page.screenshot({
    path: info.outputPath("features-collapsed.png"),
    fullPage: true,
  });
  await page
    .getByText("Read more about the game and tokens", { exact: true })
    .click();
  await expect(
    page.locator("#rpg").getByText(/GLOW adventures are in player testing/),
  ).toBeVisible();
  await page
    .getByText("Read more about wallet connection", { exact: true })
    .click();
  await expect(
    page.getByText(/Your wallet stays under your control/),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("features-desktop.png"),
    fullPage: true,
  });
  await page.goBack();
  await expect(page).toHaveURL(/\/auth\?mode=register$/);
});

test("guests cannot start or directly load the game", async ({
  page,
  request,
}) => {
  for (const path of ["/adventure", "/adventure/test"]) {
    await page.goto(path);
    await expect(page.locator('iframe[src*="/games/mosslight/"]')).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: "Start game", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
  }
  for (const path of [
    "/games/mosslight/index.html",
    "/games/mosslight/index.html?practice=1",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/auth$/);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  for (const path of [
    "/games/mosslight/js/main.js",
    "/games/mosslight/data/System.json",
  ]) {
    expect((await request.get(path)).status()).toBe(401);
  }
});

test("the website remains readable and navigable on a phone in both themes", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await page.goto("/settings");
    await page.getByLabel("Appearance", { exact: true }).selectOption(theme);
    for (const path of [
      "/",
      "/adventure",
      "/features",
      "/wallet",
      "/settings",
      "/auth",
    ]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(
          (path.slice(1) || "home") + "-" + theme + "-mobile.png",
        ),
        fullPage: true,
      });
    }
  }
});

test("keyboard navigation works with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Sign in", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/auth$/);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Info", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/features$/);
  const detail = page.locator("#rpg summary");
  await detail.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#rpg details")).toHaveAttribute("open", "");
});

test("desktop themes and narrow layouts preserve readable controls", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  for (const theme of ["light", "dark"]) {
    await page.goto("/settings");
    await page.getByLabel("Appearance", { exact: true }).selectOption(theme);
    for (const path of [
      "/",
      "/features",
      "/adventure",
      "/auth",
      "/wallet",
      "/dashboard",
      "/settings",
    ]) {
      await page.goto(path);
      if (path === "/auth") {
        await page
          .getByLabel("Email address", { exact: true })
          .fill("layout-qa@example.invalid");
        await page
          .getByLabel("Password", { exact: true })
          .fill("Local layout test only.");
        await page.getByLabel("Password", { exact: true }).focus();
      }
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          path + " at " + width,
        ).toBe(true);
      }
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      if (path === "/" || path === "/settings")
        await page.screenshot({
          path: info.outputPath(
            (path.slice(1) || "home") + "-" + theme + "-desktop.png",
          ),
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/settings");
  await page.getByLabel("Larger text", { exact: true }).check();
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
