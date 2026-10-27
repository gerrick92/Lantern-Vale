import { test, expect } from "./fixtures/local-game";
import { initialState } from "../../game/rules";

test("native F4 keeps standalone practice fullscreen and delegates embedded GLOW fullscreen to its parent", async ({
  page,
}) => {
  await page.locator("canvas").focus();
  await page.keyboard.press("F4");
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.keyboard.press("F4");
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.route("**/fullscreen.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Embedded fullscreen fixture</title></head><body>
      <main id="game"><iframe title="Native GLOW game" src="/index.html" style="width:816px;height:624px"></iframe><p>Payment overlay stays with this parent.</p></main>
      <script>
        const game = document.querySelector('#game'), frame = document.querySelector('iframe');
        addEventListener('message', async event => {
          if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
          if (event.data.type === 'mosslight.ready') frame.contentWindow.postMessage({ type:'mosslight.entry-options', nonce:'fullscreen-test', enabled:true, mute:true, reduced:true }, location.origin);
          if (event.data.type === 'mosslight.fullscreen') await game.requestFullscreen();
        });
      </script></body></html>`,
    }),
  );
  await page.goto("http://127.0.0.1:3198/fullscreen.html");
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/index.html"))!;
  await frame.waitForFunction(
    "window.SceneManager?._scene?.constructor.name === 'Scene_Title' && SceneManager._scene.isStarted()",
  );
  await frame.locator("canvas").focus();
  await page.keyboard.press("F4");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.id))
    .toBe("game");
  expect(await frame.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.evaluate(
    (snapshot) => {
      document.querySelector("iframe")!.contentWindow!.postMessage(
        {
          type: "mosslight.state",
          nonce: "paid-snapshot",
          roundId: "fixture-round",
          snapshot,
          paused: false,
          mute: true,
          reduced: true,
        },
        location.origin,
      );
    },
    { state: initialState("warrior", false), version: 0 },
  );
  await frame.waitForFunction(
    "SceneManager._scene?.constructor.name === 'Scene_Map' && SceneManager._scene.isStarted()",
  );
  expect(
    await frame.evaluate(
      "({classId:MosslightBridge.snapshot.state.classId, map:$gameMap.mapId(),character:$gameParty.leader().characterName()})",
    ),
  ).toEqual({
    classId: "warrior",
    map: 1,
    character: "Actor1",
  });
  await frame.locator("canvas").focus();
  await expect
    .poll(() =>
      frame.evaluate<boolean>(
        "$gamePlayer.canMove() && !SceneManager._scene.isBusy()",
      ),
    )
    .toBe(true);
  const startY = await frame.evaluate<number>("$gamePlayer.y");
  await page.keyboard.down("ArrowUp");
  try {
    await expect
      .poll(() => frame.evaluate<number>("$gamePlayer.y"))
      .toBeLessThan(startY);
  } finally {
    await page.keyboard.up("ArrowUp");
  }
});
