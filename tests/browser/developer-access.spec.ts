import { test, expect } from "./fixtures/authenticated";

test("another verified account cannot access developer routes or Settings tools", async ({
  page,
}) => {
  for (const path of [
    "/dev/deploy",
    "/dev/deploy/game",
    "/dev/deploy/game/verify",
    "/dev/play",
    "/dev/future-tool",
  ]) {
    for (const headers of [{}, { RSC: "1" }]) {
      const response = await page.request.get(path, { headers });
      expect(response.status()).toBe(404);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(await response.text()).not.toContain("Compiled artifact");
    }
  }
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Developer tools" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Toggle developer phone preview" }),
  ).toHaveCount(0);
  await page.goto("/adventure/test");
  await expect(page.locator("iframe.practice-frame")).toBeVisible();
  await expect(
    page.getByText("Local demo controls", { exact: true }),
  ).toHaveCount(0);
});

test("guests cannot access developer routes directly", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  for (const path of [
    "/dev/deploy",
    "/dev/deploy/game",
    "/dev/deploy/game/verify",
    "/dev/play",
  ]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
  }
});
