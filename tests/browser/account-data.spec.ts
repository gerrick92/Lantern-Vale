import { test, expect } from "./fixtures/authenticated";
import AxeBuilder from "@axe-core/playwright";

test("profile changes survive navigation and reload without exposing an empty form", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Display name", { exact: true }).fill("Gerrik QA");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Info", exact: true })
    .click();
  await expect(page).toHaveURL(/\/features$/);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
    "Gerrik QA",
  );
  await page.reload();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
    "Gerrik QA",
  );
});

test("contacts can be created, edited, reused and deleted through the real private API", async ({
  page,
}, info) => {
  const first = "0x1111111111111111111111111111111111111111";
  const second = "0x2222222222222222222222222222222222222222";
  await page.goto("/wallet");
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page
    .getByLabel("Contact name", { exact: true })
    .fill("Travel companion");
  await page.getByLabel("Ethereum address", { exact: true }).fill(first);
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByText("Contact saved.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Travel companion", exact: true })
    .click();
  await expect(page.getByLabel("Contact name", { exact: true })).toBeFocused();
  await page.getByLabel("Contact name", { exact: true }).fill("Trail friend");
  await page.getByLabel("Ethereum address", { exact: true }).fill(second);
  await page.getByLabel("Favorite", { exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Contact updated.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  const row = page
    .locator(".contact-list > li")
    .filter({ hasText: "Trail friend" });
  await expect(row).toContainText("Favorite");
  await expect(row).toContainText(second);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("contacts-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Use address for Trail friend", exact: true })
    .click();
  await expect(
    page.getByLabel("Recipient’s full Ethereum address", { exact: true }),
  ).toHaveValue(second);
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("contacts-mobile.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Delete Trail friend", exact: true })
    .click();
  await expect(
    page.getByText("Contact deleted.", { exact: true }),
  ).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(
    page.getByText("No saved contacts yet.", { exact: true }),
  ).toBeVisible();
});
