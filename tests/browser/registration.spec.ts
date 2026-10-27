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
      entryPoints: ["tests/browser/fixtures/registration.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      tsconfig: "apps/web/tsconfig.json",
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.NEXT_PUBLIC_SUPABASE_URL":
          '"https://registration.supabase.test"',
        "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY":
          '"fixture-public-key"',
      },
      plugins: [
        {
          name: "fixture-router",
          setup(builder) {
            builder.onResolve(
              { filter: /^next\/(navigation|link)$/ },
              ({ path }) => ({ path, namespace: "fixture-router" }),
            );
            builder.onLoad(
              { filter: /.*/, namespace: "fixture-router" },
              ({ path }) => ({
                contents:
                  path === "next/navigation"
                    ? "export const useRouter=()=>({replace:(path)=>history.replaceState({},'',path),refresh:()=>{}});"
                    : "import React from 'react'; export default function Link(props){return React.createElement('a',props)}",
                loader: "js",
                resolveDir: process.cwd(),
              }),
            );
          },
        },
      ],
    })
  ).outputFiles[0].text;
  const from = resolve("apps/web/src/app/globals.css");
  css = (
    await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })
  ).css;
});

test("registration validates passwords, handles errors and waits for a real session", async ({
  page,
}) => {
  let requests = 0;
  let status = 422;
  let response: object = {
    code: "user_already_exists",
    msg: "User already registered",
  };
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/signup") {
      requests++;
      expect(route.request().postDataJSON()).toMatchObject({
        email: "player@example.test",
        password: "Strong fixture password!",
      });
      expect(route.request().postDataJSON()).not.toHaveProperty("role");
      return route.fulfill({ status, json: response });
    }
    if (path === "/fixture.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: script,
      });
    if (path === "/fixture.css")
      return route.fulfill({ contentType: "text/css", body: css });
    if (path === "/")
      return route.fulfill({ contentType: "text/html", body: html });
    return route.abort();
  });
  await page.goto("http://127.0.0.1:3199/");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("player@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Strong fixture password!");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("Different fixture password!");
  const submit = page.getByRole("button", {
    name: "Create account",
    exact: true,
  });
  await submit.click();
  await expect(page.getByRole("status")).toHaveText("Passwords do not match.");
  expect(requests).toBe(0);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("Strong fixture password!");
  await submit.click();
  await expect(page.getByRole("status")).toHaveText("User already registered");
  status = 200;
  response = {
    id: "fixture-user",
    email: "player@example.test",
    identities: [],
  };
  await submit.click();
  await expect(page.getByRole("status")).toContainText(
    "Registration could not finish",
  );
  expect(new URL(page.url()).pathname).toBe("/");
  response = {
    access_token: "fixture-access-token",
    refresh_token: "fixture-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id: "fixture-user",
      email: "player@example.test",
      identities: [{ provider: "email" }],
      app_metadata: {},
      user_metadata: {},
    },
  };
  await submit.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(requests).toBe(3);
});

test("registration is accessible on phones and unavailable email recovery sends nothing", async ({
  page,
}) => {
  const unexpected: string[] = [];
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: script,
      });
    if (path === "/fixture.css")
      return route.fulfill({ contentType: "text/css", body: css });
    if (path === "/")
      return route.fulfill({ contentType: "text/html", body: html });
    unexpected.push(path);
    return route.abort();
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("http://127.0.0.1:3199/");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
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
  }
  await page.goto("http://127.0.0.1:3199/?mode=reset");
  await expect(
    page.getByText("Email password reset is unavailable in this demo."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send reset link" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Back to sign in" }).focus();
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeFocused();
  expect(unexpected).toEqual([]);
});

const html =
  '<!doctype html><html lang="en"><head><title>Registration fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
