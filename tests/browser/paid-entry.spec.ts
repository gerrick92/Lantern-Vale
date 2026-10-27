import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { initialState, reduceIntent, shopItemFor } from "../../game/rules";
import type {} from "./fixtures/entry-wallet";

let script: string;
let css: string;
const wallet = "0x0000000000000000000000000000000000000001";
const origin = "http://127.0.0.1:3196";
test.beforeAll(async () => {
  const from = resolve("apps/web/src/app/globals.css");
  css = (
    await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })
  ).css;
  script = (
    await build({
      entryPoints: ["tests/browser/fixtures/paid-lobby.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      tsconfig: "apps/web/tsconfig.json",
      alias: {
        wagmi: resolve("tests/browser/fixtures/entry-wallet.ts"),
        "next/navigation": resolve("tests/browser/fixtures/entry-wallet.ts"),
      },
      define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    })
  ).outputFiles[0].text;
});

async function open(
  page: Page,
  failReview = false,
  resume = false,
  resumeStage = "submitted",
) {
  let linked = resume;
  let registered = false;
  let registrationAttempts = 0;
  let purchasePlan: unknown;
  let state = initialState("warrior", false);
  let version = 0;
  const roundId = "11111111-1111-4111-8111-111111111111";
  const plan = {
    chainId: 11155111,
    wallet,
    contract: "0x0000000000000000000000000000000000000004",
    token: "0x0000000000000000000000000000000000000003",
    paymentId: `0x${"12".repeat(32)}`,
    deadline: String(Math.floor(Date.now() / 1000) + 600),
    action: { kind: "entry", classId: "warrior" },
  };
  if (resume)
    await page.addInitScript(
      ({ plan, resumeStage }) => {
        if (window !== window.top) return;
        localStorage.setItem(
          `lantern:payment:v1:11155111:${plan.wallet}:${plan.contract}`,
          JSON.stringify({
            version: 1,
            plan,
            stage: resumeStage,
            ...(resumeStage === "submitted"
              ? { hash: `0x${"ab".repeat(32)}` }
              : {}),
          }),
        );
      },
      { plan, resumeStage },
    );
  const requests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, json: value });
    switch (url.pathname) {
      case "/fixture.css":
        return route.fulfill({ contentType: "text/css", body: css });
      case "/fixture.js":
        return route.fulfill({
          contentType: "application/javascript",
          body: script,
        });
      case "/api/wallet":
        return json({ wallet: linked ? { address: wallet } : null });
      case "/api/wallet/challenge":
        return json({
          id: "fixture-challenge",
          message: "Fixture wallet ownership",
        });
      case "/api/wallet/verify":
        expect(route.request().postDataJSON()).toEqual({
          id: "fixture-challenge",
          signature: `0x${"11".repeat(65)}`,
        });
        linked = true;
        return json({ linked: true });
      case "/api/payments/pending":
        requests.push("pending");
        return json({ plan: resume && !registered ? plan : null });
      case "/api/payments/recover":
        requests.push("recover");
        return json({ error: "No mined payment was found yet." }, 409);
      case "/api/rounds":
        requests.push("register");
        expect(route.request().postDataJSON()).toEqual({
          hash: `0x${"ab".repeat(32)}`,
          classId: "warrior",
        });
        if (++registrationAttempts === 1)
          return json(
            { error: "Waiting for the committed draw", code: "DRAW_PENDING" },
            503,
          );
        registered = true;
        return json({ id: roundId }, 201);
      case `/api/rounds/${roundId}`:
        return json({
          id: roundId,
          wallet,
          state,
          version,
          contract: plan.contract,
          contractRoundId: "1",
        });
      case `/api/rounds/${roundId}/actions`:
        state = reduceIntent(state, route.request().postDataJSON().intent);
        return json({ state, version: ++version });
      case "/api/payments/review":
        requests.push("review");
        expect(linked).toBe(true);
        if (registered) {
          const action = route.request().postDataJSON();
          expect(action.kind).toBe("purchase");
          purchasePlan = {
            ...plan,
            paymentId: `0x${"34".repeat(32)}`,
            action: { ...action, contractRoundId: "1" },
          };
          return json(purchasePlan);
        }
        expect(route.request().postDataJSON()).toEqual({
          kind: "entry",
          classId: "warrior",
        });
        return failReview
          ? json(
              { error: "The payment service is temporarily unavailable." },
              503,
            )
          : json(plan);
      case "/games/mosslight/index.html":
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="en"><body><button disabled>Review Warrior Entry</button><script>
          let nonce; window.messages=[];
          addEventListener('message', event => { if(event.source !== parent || event.origin !== location.origin)return; window.messages.push(event.data); if(event.data.type === 'mosslight.entry-options') { nonce = event.data.nonce; document.querySelector('button').disabled = !event.data.enabled; } });
          document.querySelector('button').onclick = () => parent.postMessage({type:'mosslight.entry-class', classId:'warrior', nonce}, location.origin);
          parent.postMessage({type:'mosslight.ready'}, location.origin);
        </script></body></html>`,
        });
      case "/":
        return route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Entry regression test</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
        });
      default:
        return route.abort();
    }
  });
  await page.goto(origin);
  return requests;
}
async function linkAndChoose(page: Page) {
  await page
    .getByRole("button", { name: "Link wallet to account", exact: true })
    .click();
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "Review Warrior Entry" })
    .click();
}

test("connected but unlinked wallet links before entry and reaches the wallet transaction request", async ({
  page,
}) => {
  const requests = await open(page);
  await expect(
    page.getByRole("heading", { name: "Your adventure wallet" }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(requests).toEqual([]);
  await linkAndChoose(page);
  const review = page.getByRole("dialog", { name: "GLOW payment" });
  await expect(review).toBeInViewport();
  expect((await review.boundingBox())!.y).toBeGreaterThanOrEqual(
    (await page.locator("iframe").boundingBox())!.y,
  );
  await expect(
    page.getByRole("button", { name: "Review 1 GLOW in MetaMask" }),
  ).toHaveCount(0);
  await expect(
    review
      .getByRole("status")
      .filter({ hasText: "Transaction declined in the test wallet." }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.entryFixture.signatures)).toBe(1);
  expect(await page.evaluate(() => window.entryFixture.transactions)).toBe(1);
});

test("declining ownership does not unlock class selection or request payment", async ({
  page,
}) => {
  const requests = await open(page);
  await page.evaluate(() => {
    window.entryFixture.rejectSignature = true;
  });
  await page
    .getByRole("button", { name: "Link wallet to account", exact: true })
    .click();
  await expect(
    page.getByText("Signature declined. You can try again.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("an unsent restored review can continue in MetaMask only after an explicit click", async ({
  page,
}) => {
  const requests = await open(page, false, true, "prepared");
  await expect(
    page.getByRole("button", { name: "Continue in MetaMask", exact: true }),
  ).toBeVisible();
  expect(requests).toContain("recover");
  expect(await page.evaluate(() => window.entryFixture.transactions)).toBe(0);
  await page
    .getByRole("button", { name: "Continue in MetaMask", exact: true })
    .click();
  await expect(
    page.getByText("Transaction declined in the test wallet.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.entryFixture.transactions)).toBe(1);
});

test("fresh entry shows allowance, payment and draw stages then starts the chosen class automatically", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await open(page);
  await page.evaluate(() => {
    window.entryFixture.holdTransactions = true;
  });
  await linkAndChoose(page);
  await expect(
    page.getByText(/This approval does not transfer GLOW/),
  ).toBeVisible();
  await expect(
    page.getByText("Review and confirm in MetaMask.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.entryFixture.walletRequests)).toEqual(
    ["approve"],
  );
  await page.evaluate(() => window.entryFixture.confirmNext());
  await expect(page.getByText(/Confirm the 1 GLOW payment/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.entryFixture.walletRequests))
    .toEqual(["approve", "enter"]);
  await page.evaluate(() => window.entryFixture.confirmNext());
  await expect(page.getByText(/no further payment is needed/)).toBeVisible();
  await page.clock.runFor(16_100);
  await expect(page).toHaveURL(/round=11111111-1111-4111-8111-111111111111/);
  await expect(page.locator("#paid-companion")).toContainText("Warrior");
  await expect(page.getByRole("dialog", { name: "GLOW payment" })).toHaveCount(
    0,
  );
  expect(requests.filter((r) => r === "register")).toHaveLength(2);
  expect(await page.evaluate(() => window.entryFixture.walletRequests)).toEqual(
    ["approve", "enter"],
  );
});

test("wallet readiness and account/network changes cannot silently submit a payment", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.entryFixture.ready(false));
  await linkAndChoose(page);
  await expect(
    page.getByText("Waiting for your wallet connection…", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.entryFixture.ready(true);
    window.entryFixture.switchChain(1);
  });
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Switch to Sepolia" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.entryFixture.switchChain(11155111);
    window.entryFixture.switchWallet(
      "0x0000000000000000000000000000000000000002",
    );
  });
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByText(
      "The connected wallet differs from the wallet linked to your account.",
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => window.entryFixture.transactions)).toBe(0);
});

test("entry-review errors stay inside the game view on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, true);
  await linkAndChoose(page);
  const error = page.getByRole("alert");
  await expect(error).toHaveText(
    "The payment service is temporarily unavailable.",
  );
  await expect(error).toBeInViewport();
  expect((await error.boundingBox())!.y).toBeGreaterThanOrEqual(
    (await page.locator("iframe").boundingBox())!.y,
  );
  await page.getByRole("button", { name: "Choose again", exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("button", { name: "Review Warrior Entry" }),
  ).toBeEnabled();
  expect(await page.evaluate(() => window.entryFixture.transactions)).toBe(0);
});

test("a confirmed entry waits for its draw and opens the same class without leaving fullscreen or paying again", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await open(page, false, true);
  await expect(page.getByText(/Waiting for the encounter draw/)).toBeVisible();
  await page
    .getByRole("button", { name: "Fullscreen game", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Exit fullscreen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "GLOW payment" }),
  ).toBeInViewport();
  await page.clock.runFor(16_100);
  await expect(page).toHaveURL(/round=11111111-1111-4111-8111-111111111111/);
  await expect(page.getByRole("dialog", { name: "GLOW payment" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() =>
      document.fullscreenElement?.classList.contains("glow-session"),
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Show companion", exact: true })
    .click();
  await expect(page.locator("#paid-companion")).toContainText("Warrior");
  expect(requests.filter((request) => request === "register")).toHaveLength(2);
  expect(await page.evaluate(() => window.entryFixture.transactions)).toBe(0);
  // A new shop purchase must not try to recover the completed entry's journal.
  await page
    .getByRole("button", { name: "Visit weapon counter", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `${shopItemFor("warrior", "weapon").name} · 1 GLOW`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "GLOW payment" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Show companion", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Transaction declined in the test wallet.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.entryFixture.transactions)).toBe(1);
  const game = page
    .frames()
    .find((frame) => frame.url().endsWith("/games/mosslight/index.html"))!;
  const keepalives = () =>
    game.evaluate(
      "window.messages.filter(message=>message.type==='mosslight.payment-pending')",
    ) as Promise<Array<{ nonce: string; roundId: string; requestId: string }>>;
  await expect.poll(async () => (await keepalives()).length).toBeGreaterThan(0);
  const first = (await keepalives())[0];
  expect(first.roundId).toBe("11111111-1111-4111-8111-111111111111");
  expect(first.nonce).toBe(
    await game.evaluate(
      "window.messages.find(message=>message.type==='mosslight.state').nonce",
    ),
  );
  expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
  const before = (await keepalives()).length;
  await page.clock.fastForward(31_000);
  await expect
    .poll(async () => (await keepalives()).length)
    .toBeGreaterThan(before);
  expect((await keepalives()).at(-1)).toEqual(first);
});
