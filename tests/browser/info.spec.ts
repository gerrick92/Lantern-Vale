import { test, expect } from "./fixtures/info";
import AxeBuilder from "@axe-core/playwright";

test("Info keeps details optional and distinguishes draft economics from practice", async ({
  page,
}) => {
  await page.goto("/features");
  await expect(
    page.getByRole("heading", { name: "Info", exact: true }),
  ).toBeVisible();
  for (const id of ["rpg", "wallet", "tokens", "voting", "roadmap"]) {
    await expect(page.locator(`#${id} details`)).not.toHaveAttribute("open");
  }
  const summary = page.locator("#tokens summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#tokens .info-notice")).toContainText(
    "Every registered player can link a wallet",
  );
  await expect(page.locator(".supply-figure")).toContainText("1,000,000");
  await expect(page.locator(".claim-limits")).toContainText("5 GLOW");
  await expect(page.locator(".claim-limits")).toContainText("10 GLOW");
  await expect(page.getByText(/GLOW has no USD peg/)).toBeVisible();
  await expect(
    page.getByText(/GLOW is the name of the token used in paid play/),
  ).toBeVisible();
  await expect(page.locator("#tokens")).toContainText("chain ID 11155111");
  await expect(page.locator("#tokens")).toContainText(
    "exact source matches on Etherscan and Sourcify",
  );
  for (const link of await page.locator("#tokens a.address").all()) {
    const address = await link.innerText();
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    await expect(link).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${address}`,
    );
  }

  const slider = page.getByRole("slider", { name: "Tokens spent:" });
  await expect(slider).toHaveValue("5");
  const win = page.locator(".practice-outcomes > div").nth(0);
  const loss = page.locator(".practice-outcomes > div").nth(1);
  await expect(win).toContainText("25 unspent + 5 returned + 1 bonus");
  await expect(loss).toContainText("25 left");
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("30");
  await expect(win).toContainText("31 left");
  await expect(loss).toContainText("0 left");
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("1");
  await expect(loss).toContainText("29 left");

  await page.locator("#voting summary").click();
  await expect(
    page.getByText("Planned, not available.", { exact: true }),
  ).toBeVisible();
  await page.locator("#roadmap summary").click();
  await expect(
    page.locator(".roadmap-trail [aria-current='step']"),
  ).toContainText("Welcome new players");
  await expect(
    page.locator(".roadmap-trail [aria-current='step']"),
  ).toHaveCount(1);
  await expect(page.locator("#roadmap")).toContainText("Play with friends");
  await expect(page.locator("#roadmap")).not.toContainText("Available locally");
  await expect(page.locator("#roadmap")).not.toContainText("Status reviewed");
  await expect(page.locator("#tokens details")).toHaveAttribute("open", "");
  await page.locator("#roadmap summary").click();
  await expect(page.locator("#roadmap details")).not.toHaveAttribute("open");
  await expect(page.locator("#tokens details")).toHaveAttribute("open", "");
});

test("expanded diagrams remain readable in both themes and narrow or enlarged layouts", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  for (const theme of ["light", "dark"]) {
    await page.goto("/settings");
    await page.getByLabel("Appearance", { exact: true }).selectOption(theme);
    await page.goto("/features");
    for (const id of ["rpg", "wallet", "tokens", "voting", "roadmap"]) {
      await page.locator(`#${id} summary`).click();
    }
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const locator of [
        ".supply-figure",
        ".allocation-figure",
        ".claim-clock",
        ".practice-example",
        ".voting-flow",
        ".roadmap-figure",
      ]) {
        const bounds = await page.locator(locator).boundingBox();
        expect(bounds?.width).toBeGreaterThan(0);
        expect(
          (bounds?.x ?? -1) >= 0 &&
            (bounds?.x ?? width) + (bounds?.width ?? width) <= width,
        ).toBe(true);
      }
      if (width === 390 || width === 1440) {
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
          path: info.outputPath(`info-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
  }
  await page.goto("/settings");
  await page.getByLabel("Accessibility Mode", { exact: true }).check();
  await page.goto("/features");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator("#tokens summary").click();
  await page.locator("#roadmap summary").click();
  await expect(page.locator("html")).toHaveAttribute("data-accessible", "true");
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
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("main")
      .evaluate((main) =>
        [...main.querySelectorAll("p, li, h3, figcaption")]
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.textContent?.slice(0, 60)),
      ),
  ).toEqual([]);
});
