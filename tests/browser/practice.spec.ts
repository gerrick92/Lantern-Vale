import { test, expect } from "./fixtures/authenticated";
import AxeBuilder from "@axe-core/playwright";
test("local companion follows the in-game class choice and respects pause on mobile", async ({
  page,
}, info) => {
  await page.goto("/adventure/test");
  test.skip(
    (await page.getByText("This page could not be found.").count()) > 0,
    "The local rehearsal page is disabled in production builds.",
  );
  const frame = page
    .frames()
    .find((f) => f.url().includes("/games/mosslight/"))!;
  async function confirmKey() {
    await page.keyboard.press("Enter", { delay: 100 });
    const rendered = await frame.evaluate<number>("Graphics.frameCount");
    await frame.waitForFunction(`Graphics.frameCount > ${rendered + 2}`);
  }
  await frame.waitForFunction(
    "window.SceneManager?._scene?.constructor.name==='Scene_Title'",
  );
  await expect(
    page.getByText("Start with text-based class selection", { exact: true }),
  ).toHaveCount(0);
  await frame.waitForFunction(
    "SceneManager._scene._commandWindow?.active && SceneManager._scene._commandWindow.isOpen() && !SceneManager._scene.isBusy()",
  );
  await frame.locator("canvas").click({ position: { x: 100, y: 250 } });
  await confirmKey();
  await frame.waitForFunction(
    "SceneManager._scene._list?.active && SceneManager._scene._selected==='warrior'",
  );
  await confirmKey();
  await frame.waitForFunction("SceneManager._scene._confirm?.active");
  await confirmKey();
  await expect(
    page.getByText("Practice balance 29 · Spent 1 · Refunded 0", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Speak to Nessa", exact: true })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Adventure events" })
      .getByText(/Nessa: The mountain has swallowed our dawn/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Speak to Nessa", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const result = await new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("companion-mobile.png"),
    fullPage: true,
  });
});
