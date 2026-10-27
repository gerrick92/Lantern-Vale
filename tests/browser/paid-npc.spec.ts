import { test, expect } from "./fixtures/local-game";
import { initialState, reduceIntent, type GameState } from "../../game/rules";
import type { Page } from "@playwright/test";

async function openEncounter(page: Page, type: "dancer" | "fairy") {
  let state = initialState("warrior", false);
  if (type === "fairy")
    state = reduceIntent(state, { type: "move", destination: "clearing" });
  await page.route("**/paid-npc.html", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Paid NPC fixture</title></head><body>
    <iframe title="Paid encounter" src="/index.html" style="width:960px;height:720px"></iframe><script>
      const frame=document.querySelector('iframe'); window.requests=[];
      window.send=data=>frame.contentWindow.postMessage({nonce:'npc-nonce',roundId:'npc-round',mute:true,reduced:true,...data},location.origin);
      addEventListener('message',event=>{
        if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
        if(event.data.type==='mosslight.ready')send({type:'mosslight.state',snapshot:${JSON.stringify({ state, version: 0 })},paused:false});
        if(event.data.type==='mosslight.intent')window.requests.push(event.data);
      });
    </script></body></html>`,
    }),
  );
  await page.goto("http://127.0.0.1:3198/paid-npc.html");
  const frame = page.frames().find((f) => f.url().endsWith("/index.html"))!;
  await frame.waitForFunction(
    "SceneManager._scene?.constructor.name==='Scene_Map' && SceneManager._scene.isStarted() && !SceneManager._scene.isBusy()",
  );
  await frame.evaluate(`(() => {
    $gamePlayer.locate(${type === "dancer" ? "16,10" : "12,8"});
    window.reveals=[];
    const reveal=MosslightBridge.revealOutcome.bind(MosslightBridge);
    MosslightBridge.revealOutcome=function(){
      if(this.deferredSnapshot)window.reveals.push({brightness:$gameScreen.brightness(),hp:this.snapshot.state.hp,hero:[$gamePlayer.x,$gamePlayer.y]});
      reveal();
    };
    MosslightBridge.${type}();
  })()`);
  await frame.waitForFunction(
    "SceneManager._scene._choiceListWindow?.active && SceneManager._scene._choiceListWindow.isOpen()",
  );
  await frame.evaluate(
    "SceneManager._scene._choiceListWindow.select(0); SceneManager._scene._choiceListWindow.processOk()",
  );
  await page.waitForFunction("window.requests.length===1");
  return { frame, state };
}

async function reply(page: Page, state?: GameState, wrong = false) {
  await page.evaluate(
    ({ state, wrong }) => {
      const host = window as unknown as {
        send(data: unknown): void;
        requests: { requestId: string }[];
      };
      host.send({
        type: "mosslight.action-result",
        requestId: wrong ? "wrong-request" : host.requests[0].requestId,
        accepted: !!state,
        snapshot: state ? { state, version: 1 } : undefined,
        error: "Payment was declined.",
      });
    },
    { state, wrong },
  );
}

for (const [type, roll, outcome] of [
  ["dancer", 0, "inspired"],
  ["dancer", 25, "drained"],
  ["dancer", 50, "slapped"],
  ["fairy", 0, "wild"],
  ["fairy", 25, "toad"],
] as const)
  test(`paid ${type} presents the verified ${outcome} result without a second payment`, async ({
    page,
  }) => {
    test.setTimeout(65_000);
    const { frame, state } = await openEncounter(page, type);
    expect(await frame.evaluate("MosslightBridge.practice")).toBe(false);
    expect(
      await frame.evaluate("MosslightBridge.busy && MosslightBridge.cutscene"),
    ).toBe(true);
    const result = reduceIntent(
      state,
      { type },
      type === "dancer" ? 6 : 7,
      roll,
    );
    // A snapshot refresh can arrive before the matching action acknowledgement.
    await page.evaluate(
      (snapshot) =>
        (window as unknown as { send(data: unknown): void }).send({
          type: "mosslight.state",
          snapshot,
          paused: false,
        }),
      { state: result, version: 1 },
    );
    await frame.waitForFunction(
      "MosslightBridge.deferredSnapshot?.version===1",
    );
    expect(await frame.evaluate("MosslightBridge.snapshot.state.hp")).toBe(
      state.hp,
    );
    await reply(page, result, true);
    expect(await frame.evaluate("MosslightBridge.busy")).toBe(true);
    await reply(page, result);
    await frame.waitForFunction(
      `MosslightBridge.snapshot.state.${type === "dancer" ? "dancerOutcome" : "fairyOutcome"}==='${outcome}'`,
      null,
      { timeout: 40_000 },
    );
    await frame.waitForFunction("!MosslightBridge.cutscene", null, {
      timeout: 20_000,
    });
    expect(await frame.evaluate("MosslightBridge.snapshot.state")).toEqual(
      result,
    );
    expect(await frame.evaluate("MosslightBridge.pending")).toBeNull();
    expect(await frame.evaluate("MosslightBridge.deferOutcome")).toBe(false);
    expect(await page.evaluate("window.requests.length")).toBe(1);
    if (type === "dancer")
      expect(await frame.evaluate("window.reveals[0]")).toEqual({
        brightness: outcome === "slapped" ? 255 : 0,
        hp: state.hp,
        hero: [4, 7],
      });
    // Replayed acknowledgements must not apply the encounter twice.
    await reply(page, result);
    expect(await frame.evaluate("MosslightBridge.snapshot.state.spent")).toBe(
      2,
    );
  });

test("a paid encounter waits through wallet review and rejects without changing stats or trapping controls", async ({
  page,
}) => {
  await page.clock.install();
  const { frame, state } = await openEncounter(page, "dancer");
  const heartbeat = () =>
    page.evaluate(() => {
      const host = window as unknown as {
        send(data: unknown): void;
        requests: { requestId: string }[];
      };
      host.send({
        type: "mosslight.payment-pending",
        requestId: host.requests[0].requestId,
      });
    });
  for (let i = 0; i < 7; i++) {
    const previousTimer = await frame.evaluate("MosslightBridge.pending.timer");
    await heartbeat();
    await expect
      .poll(() => frame.evaluate("MosslightBridge.pending?.timer"))
      .not.toBe(previousTimer);
    // Jump wall time without rendering thousands of irrelevant MZ frames.
    await page.clock.fastForward(30_000);
  }
  expect(
    await frame.evaluate("MosslightBridge.busy && !!MosslightBridge.pending"),
  ).toBe(true);
  expect(await frame.evaluate("MosslightBridge.snapshot.state")).toEqual(state);
  await reply(page);
  await frame.waitForFunction(
    "!MosslightBridge.cutscene && !MosslightBridge.busy",
  );
  expect(await frame.evaluate("MosslightBridge.snapshot.state")).toEqual(state);
  expect(await frame.evaluate("MosslightBridge.deferOutcome")).toBe(false);
});

test("unrelated payment keepalives cannot keep an abandoned encounter locked", async ({
  page,
}) => {
  await page.clock.install();
  const { frame, state } = await openEncounter(page, "fairy");
  const previousTimer = await frame.evaluate("MosslightBridge.pending.timer");
  await page.evaluate(() => {
    const host = window as unknown as {
      send(data: unknown): void;
      requests: { requestId: string }[];
    };
    host.send({
      type: "mosslight.payment-pending",
      requestId: host.requests[0].requestId,
    });
  });
  await expect
    .poll(() => frame.evaluate("MosslightBridge.pending?.timer"))
    .not.toBe(previousTimer);
  await page.clock.fastForward(30_000);
  await page.evaluate(() =>
    (window as unknown as { send(data: unknown): void }).send({
      type: "mosslight.payment-pending",
      requestId: "unrelated",
    }),
  );
  await page.clock.fastForward(16_000);
  await expect
    .poll(() =>
      frame.evaluate("MosslightBridge.busy || MosslightBridge.cutscene"),
    )
    .toBe(false);
  expect(await frame.evaluate("MosslightBridge.snapshot.state")).toEqual(state);
});
