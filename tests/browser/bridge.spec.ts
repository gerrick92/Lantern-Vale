import { test, expect } from "./fixtures/authenticated";
import { initialState, reduceIntent, type Intent } from "../../game/rules";

test("native class selection requests a wallet review without creating a paid or practice round", async ({
  page,
}) => {
  await page.route("**/__qa/paid-entry", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Paid entry fixture</title></head><body><iframe title="Native class selection" src="/games/mosslight/index.html"></iframe><script>
    const frame=document.querySelector('iframe');
    addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
      if(event.data.type==='mosslight.ready')frame.contentWindow.postMessage({type:'mosslight.entry-options',enabled:true,nonce:'entry-fixture',mute:true,reduced:true},location.origin);
      if(event.data.type==='mosslight.entry-class')window.chosen=event.data;
    });
  </script></body></html>`,
    }),
  );
  await page.goto("/__qa/paid-entry");
  const frame = page
    .frames()
    .find((item) => item.url().includes("/games/mosslight/"))!;
  await frame.waitForFunction(
    "SceneManager._scene?.constructor.name==='Scene_Title' && SceneManager._scene.isStarted() && SceneManager._scene._commandWindow.isCommandEnabled(0)",
  );
  await frame.evaluate("SceneManager._scene.commandNewGame()");
  await frame.waitForFunction(
    "SceneManager._scene?.constructor.name==='Scene_MossClass' && SceneManager._scene.isStarted()",
  );
  await frame.evaluate(
    "SceneManager._scene.confirm('dark_knight'); SceneManager._scene._confirm.callHandler('yes')",
  );
  await page.waitForFunction("window.chosen");
  expect(await page.evaluate("window.chosen")).toEqual({
    type: "mosslight.entry-class",
    nonce: "entry-fixture",
    classId: "dark_knight",
  });
  expect(await frame.evaluate("MosslightBridge.snapshot")).toBeFalsy();
  expect(await frame.evaluate("MosslightBridge.practice")).toBe(false);
});

test("pending paid actions ignore preference updates and settle only on their matching result", async ({
  page,
}) => {
  const initial = { state: initialState("warrior", false), version: 0 };
  await page.route("**/__qa/bridge", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Bridge timing fixture</title></head><body>
      <iframe title="Paid bridge fixture" src="/games/mosslight/index.html"></iframe>
      <script>
        const frame = document.querySelector('iframe');
        window.send = (data) => frame.contentWindow.postMessage({ nonce: 'timing-nonce', roundId: 'timing-round', mute: true, ...data }, location.origin);
        addEventListener('message', event => {
          if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
          if (event.data.type === 'mosslight.ready') window.send({ type: 'mosslight.state', snapshot: ${JSON.stringify(initial)} });
          if (event.data.type === 'mosslight.intent') window.actionRequest = event.data;
        });
      </script></body></html>`,
    }),
  );
  await page.goto("/__qa/bridge");
  const frame = page
    .frames()
    .find((item) => item.url().includes("/games/mosslight/"))!;
  await frame.waitForFunction("window.MosslightBridge?.snapshot");
  await frame.evaluate(
    "window.actionResolved = null; void MosslightBridge.intent({ type: 'visit', place: 'inn' }).then(result => window.actionResolved = result)",
  );
  await page.waitForFunction("window.actionRequest");
  const request = await page.evaluate<{ requestId: string; intent: Intent }>(
    "window.actionRequest",
  );
  const revision = await frame.evaluate<number>("MosslightBridge.revision");
  await page.evaluate((snapshot) => {
    (window as unknown as { send(data: unknown): void }).send({
      type: "mosslight.state",
      snapshot,
      reduced: true,
    });
  }, initial);
  await frame.waitForFunction(
    (revision) =>
      (window as unknown as { MosslightBridge: { revision: number } })
        .MosslightBridge.revision > revision,
    revision,
  );
  expect(await frame.evaluate("MosslightBridge.busy")).toBe(true);
  expect(await frame.evaluate("window.actionResolved")).toBeNull();

  const snapshot = {
    state: reduceIntent(initial.state, request.intent),
    version: 1,
  };
  const reply = {
    type: "mosslight.action-result",
    requestId: request.requestId,
    accepted: true,
    snapshot,
  };
  await page.evaluate((reply) => {
    (window as unknown as { send(data: unknown): void }).send({
      ...reply,
      requestId: "another-request",
    });
  }, reply);
  await frame.waitForFunction("MosslightBridge.reduced === true");
  expect(await frame.evaluate("MosslightBridge.busy")).toBe(true);
  await page.evaluate(
    (reply) => (window as unknown as { send(data: unknown): void }).send(reply),
    reply,
  );
  await frame.waitForFunction("window.actionResolved === true");
  expect(await frame.evaluate("MosslightBridge.snapshot.version")).toBe(1);

  await page.evaluate(
    (snapshot) =>
      (window as unknown as { send(data: unknown): void }).send({
        type: "mosslight.state",
        snapshot,
      }),
    initial,
  );
  await frame.evaluate(
    "window.actionResolved = null; void MosslightBridge.intent({ type: 'visit', place: 'inn' }).then(result => window.actionResolved = result)",
  );
  await page.waitForFunction(
    (previous) =>
      (window as unknown as { actionRequest: { requestId: string } })
        .actionRequest.requestId !== previous,
    request.requestId,
  );
  expect(await frame.evaluate("MosslightBridge.snapshot.version")).toBe(1);
  await page.evaluate(() => {
    const host = window as unknown as {
      send(data: unknown): void;
      actionRequest: { requestId: string };
    };
    host.send({
      type: "mosslight.action-result",
      requestId: host.actionRequest.requestId,
      accepted: false,
      error: "The round changed. Try again.",
    });
  });
  await frame.waitForFunction("window.actionResolved === false");
  expect(await frame.evaluate("MosslightBridge.busy")).toBe(false);
  expect(await frame.evaluate("MosslightBridge.notice")).toBe(
    "The round changed. Try again.",
  );
  expect(await frame.evaluate("MosslightBridge.snapshot.version")).toBe(1);
});
