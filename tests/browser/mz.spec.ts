import { test, expect } from "./fixtures/authenticated";
import type { Page } from "@playwright/test";
import {
  initialState,
  reduceIntent,
  roads,
  encounterLocations,
  isBoss,
  type GameState,
  type Intent,
} from "../../game/rules";
type Runtime = Window & {
  MosslightBridge: {
    snapshot: { state: GameState; version: number };
    intent(intent: Intent): Promise<boolean>;
  };
};
async function press(page: Page, key: string) {
  await page.keyboard.press(key, { delay: 80 });
  const frame = await page.evaluate<number>("Graphics.frameCount");
  await page.waitForFunction(
    (frame) =>
      (window as unknown as { Graphics: { frameCount: number } }).Graphics
        .frameCount >
      frame + 2,
    frame,
  );
}
const readyTitle = (page: Page) =>
  page.waitForFunction(
    "window.SceneManager?._scene?.constructor.name === 'Scene_Title' && SceneManager._scene._commandWindow?.isOpen() && !SceneManager._scene.isBusy()",
  );
async function startPractice(page: Page) {
  await page.goto("/games/mosslight/index.html?practice=1");
  await readyTitle(page);
  await page.mouse.click(100, 250);
  await press(page, "Enter");
  await page.waitForFunction(
    "SceneManager._scene.constructor.name === 'Scene_MossClass' && SceneManager._scene._selected === 'warrior' && SceneManager._scene._hero.bitmap?.isReady()",
  );
}
async function confirm(page: Page) {
  await press(page, "Enter");
  await page.waitForFunction("SceneManager._scene._confirm?.active");
  await press(page, "Enter");
  await mapReady(page, 1);
}
async function mapReady(page: Page, id: number) {
  await page.waitForFunction((id) => {
    const w = window as unknown as {
      SceneManager: {
        _scene: {
          constructor: { name: string };
          isBusy(): boolean;
          _messageWindow?: unknown;
          _fadeDuration: number;
          isStarted(): boolean;
        };
      };
      $gameMap: { mapId(): number };
      $gamePlayer: { isTransferring(): boolean };
    };
    return (
      w.SceneManager._scene.constructor.name === "Scene_Map" &&
      !!w.SceneManager._scene._messageWindow &&
      w.SceneManager._scene.isStarted() &&
      w.$gameMap.mapId() === id &&
      !w.$gamePlayer.isTransferring() &&
      w.SceneManager._scene._fadeDuration === 0 &&
      !w.SceneManager._scene.isBusy()
    );
  }, id);
}
async function state(page: Page) {
  return page.evaluate(
    () => (window as Runtime).MosslightBridge.snapshot.state,
  );
}
async function act(page: Page, intent: Intent) {
  expect(
    await page.evaluate(
      (intent) => (window as Runtime).MosslightBridge.intent(intent),
      intent,
    ),
  ).toBe(true);
}
function next(s: GameState): Intent {
  if (s.phase === "combat")
    return isBoss(s) && s.turn % 3 === 2
      ? { type: "guard" }
      : s.hp < s.maxHp * 0.45 && s.potions
        ? { type: "potion" }
        : s.mp >= 6
          ? { type: "skill" }
          : { type: "attack" };
  const slot = encounterLocations.findIndex(
    (p, i) => p === s.location && !s.cleared.includes(i),
  );
  return slot >= 0
    ? { type: "encounter", slot }
    : { type: "move", destination: roads[roads.indexOf(s.location) + 1] };
}

test("standalone paid export blocks entry without a server snapshot", async ({
  page,
}) => {
  await page.goto("/games/mosslight/index.html");
  await readyTitle(page);
  expect(
    await page.evaluate(
      "SceneManager._scene._commandWindow.isCommandEnabled(0)",
    ),
  ).toBe(false);
});
test("the release switch disables rehearsal even with its local URL parameter", async ({
  page,
}) => {
  await page.route("**/js/practice-config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.MOSSLIGHT_PRACTICE_ENABLED = false;",
    }),
  );
  await page.goto("/games/mosslight/index.html?practice=1");
  await readyTitle(page);
  expect(await page.evaluate("MosslightBridge.practice")).toBe(false);
  expect(
    await page.evaluate(
      "SceneManager._scene._commandWindow.isCommandEnabled(0)",
    ),
  ).toBe(false);
});

test("MZ class selection animates, locks the choice, and charges only after confirmation", async ({
  page,
}, info) => {
  await startPractice(page);
  expect(await page.evaluate("MosslightBridge.snapshot")).toBeNull();
  await press(page, "ArrowDown");
  await page.waitForFunction("SceneManager._scene._selected === 'dark_knight'");
  const before = await page.evaluate("SceneManager._scene._hero._frame.x");
  await expect
    .poll(() => page.evaluate("SceneManager._scene._hero._frame.x"))
    .not.toBe(before);
  await page.screenshot({ path: info.outputPath("class-selection.png") });
  await confirm(page);
  const s = await state(page);
  expect(s.classId).toBe("dark_knight");
  expect(s.practiceBalance).toBe(29);
  expect(s.spent).toBe(1);
  await page.screenshot({ path: info.outputPath("starting-room.png") });
  await page.reload();
  await readyTitle(page);
  await page.mouse.click(100, 250);
  await press(page, "ArrowDown");
  await press(page, "Enter");
  await mapReady(page, 1);
  expect((await state(page)).classId).toBe("dark_knight");
});

test("malformed saved progress leaves New Game usable and cannot resume a paid snapshot", async ({
  page,
}) => {
  for (const saved of [
    { state: { rulesVersion: 3, mode: "practice", classId: "warrior" } },
    { state: initialState("warrior", false), version: 0 },
  ]) {
    await page.goto("/games/mosslight/index.html?practice=1");
    await readyTitle(page);
    await page.evaluate(
      (saved) =>
        localStorage.setItem(
          "lanternvale.local-rehearsal.v5",
          JSON.stringify(saved),
        ),
      saved,
    );
    await page.reload();
    await readyTitle(page);
    expect(
      await page.evaluate(
        "SceneManager._scene._commandWindow._list.find(c => c.symbol === 'continue').enabled",
      ),
    ).toBe(false);
    await page.mouse.click(100, 250);
    await press(page, "Enter");
    await page.waitForFunction(
      "SceneManager._scene.constructor.name === 'Scene_MossClass'",
    );
  }
});

test("the hero can walk out of the bedroom and speak across Nessa’s counter", async ({
  page,
}) => {
  await startPractice(page);
  await confirm(page);
  // Use MZ's movement API at normal walking speed, with real map/event collisions.
  await page.evaluate(
    "window.walkTest = setInterval(() => { if (!$gamePlayer.isMoving() && $gamePlayer.canMove()) { if ($gamePlayer.x === 12 && $gamePlayer.y === 9) { clearInterval(window.walkTest); $gamePlayer.setDirection(8); } else { const d=$gamePlayer.findDirectionTo(12,9); if(d) $gamePlayer.moveStraight(d); } } }, 30)",
  );
  await page.waitForFunction(
    "$gamePlayer.x===12 && $gamePlayer.y===9 && !$gamePlayer.isMoving() && $gamePlayer.direction()===8",
  );
  await press(page, "Enter");
  await page.waitForFunction(
    "MosslightBridge.snapshot.state.visited.includes('inn')",
  );
  expect(await page.evaluate("$gameMessage.isChoice()")).toBe(true);
});

test("solid inn walls reject movement and Vesper walks to the bedroom and leaves", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await startPractice(page);
  await confirm(page);
  expect(
    await page.evaluate(`(() => {
    $gamePlayer.locate(7,8);
    $gamePlayer.moveStraight(6);
    return [$gamePlayer.x,$gamePlayer.y];
  })()`),
  ).toEqual([7, 8]);
  await page.evaluate(
    "MosslightBridge.snapshot.state.seed=MosslightRules.practiceDemo('warrior','slapped').seed; window.qaSounds=[]; const originalSound=AudioManager.playSe; AudioManager.playSe=function(sound){window.qaSounds.push(sound.name);return originalSound.call(this,sound);}; $gamePlayer.locate(16,10); MosslightBridge.dancer()",
  );
  await page.waitForFunction(
    "SceneManager._scene._choiceListWindow?.active && SceneManager._scene._choiceListWindow.isOpen()",
  );
  await press(page, "ArrowUp");
  await press(page, "Enter");
  await page.waitForFunction(
    "MosslightBridge.cutscene && MosslightBridge.snapshot.state.dancerDone",
  );
  await page.waitForFunction(
    "$gamePlayer.x===3 && $gamePlayer.y===7 && $gameMessage.isBusy()",
  );
  await page.screenshot({ path: info.outputPath("vesper-bedroom.png") });
  expect(await page.evaluate("window.qaSounds")).toContain("Blow1");
  for (let i = 0; i < 12 && (await page.evaluate("$gameMessage.isBusy()")); i++)
    await press(page, "Enter");
  await page.waitForFunction("!MosslightBridge.cutscene");
  expect(
    await page.evaluate(
      "(() => {const e=$gameMap.events().find(e=>e.event().name.startsWith('Vesper'));return [e.x,e.y];})()",
    ),
  ).toEqual([16, 9]);
  expect((await state(page)).spent).toBe(2);
});

test("local MZ adventure renders all maps, curse, combat commands and a single victory refund", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [],
    missing: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/games/mosslight/") && r.status() >= 400)
      missing.push(r.url());
  });
  await startPractice(page);
  await confirm(page);
  await act(page, { type: "visit", place: "inn" });
  await act(page, { type: "visit", place: "armor" });
  await act(page, { type: "buy", item: "armor" });
  await act(page, { type: "dancer" });
  await act(page, { type: "move", destination: "clearing" });
  await mapReady(page, 2);
  await page.screenshot({ path: info.outputPath("fairy-clearing.png") });
  await page.evaluate(
    "MosslightBridge.snapshot.state.seed=MosslightRules.practiceDemo('warrior','toad').seed",
  );
  await act(page, { type: "fairy" });
  expect((await state(page)).curse).toBe(true);
  await page.screenshot({ path: info.outputPath("toad-curse.png") });
  await act(page, { type: "move", destination: "inn" });
  await mapReady(page, 1);
  await act(page, { type: "rest" });
  await act(page, { type: "move", destination: "clearing" });
  await mapReady(page, 2);
  let s = await state(page);
  const captured = new Set<number>();
  for (
    let i = 0;
    i < 180 && s.phase !== "victory" && s.phase !== "defeat";
    i++
  ) {
    for (
      let j = 0;
      j < 12 && (await page.evaluate("$gameMessage.isBusy()"));
      j++
    )
      await press(page, "Enter");
    if (s.phase === "combat") {
      await page.waitForFunction(
        "SceneManager._scene.constructor.name==='Scene_MossBattle' && SceneManager._scene._hero.bitmap.isReady() && SceneManager._scene._enemy.bitmap.isReady()",
      );
      if (!captured.has(s.encounter)) {
        captured.add(s.encounter);
        await page.screenshot({
          path: info.outputPath(`battle-${s.encounter}.png`),
        });
        expect(await page.evaluate("SceneManager._scene._hero.scale.x")).toBe(
          1,
        );
        expect(
          await page.evaluate(
            "SceneManager._scene._commandWindow._list.map(c=>c.name)",
          ),
        ).toEqual(["Attack", "Skill", "Magic", "Item", "Defend"]);
      }
    } else {
      await mapReady(page, roads.indexOf(s.location) + 1);
      await page.screenshot({ path: info.outputPath(`${s.location}.png`) });
      if (s.location === "forest2" && !s.runeSolved)
        await act(page, { type: "puzzle", answer: "moon" });
    }
    await act(page, next(await state(page)));
    s = await state(page);
  }
  expect(s.phase).toBe("victory");
  expect(s.refunded).toBe(s.spent);
  expect(s.practiceBalance).toBe(32);
  await page.waitForFunction(
    "SceneManager._scene.constructor.name==='Scene_MossResult' && !SceneManager._scene.isBusy()",
  );
  await page.screenshot({ path: info.outputPath("victory.png") });
  await page.waitForFunction(
    "SceneManager._scene._commandWindow?.active && SceneManager._scene._commandWindow.isOpen()",
  );
  await press(page, "ArrowDown");
  await press(page, "Enter");
  await mapReady(page, 1);
  expect(await page.evaluate("MosslightBridge.celebrating")).toBe(true);
  expect(await page.evaluate("$gameScreen.tone()[0]")).toBeGreaterThanOrEqual(
    0,
  );
  await page.screenshot({ path: info.outputPath("restored-inn.png") });
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
});

test("the paid message bridge still delegates every action to its parent validator", async ({
  page,
}) => {
  let saved = initialState("warrior", false),
    version = 0;
  const nonce = "fixture-nonce",
    roundId = "fixture-round";
  await page.exposeFunction("validateIntent", async (intent: Intent) => {
    saved = reduceIntent(saved, intent);
    version++;
    return { state: saved, version };
  });
  await page.route("**/__qa/mz", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Isolated bridge test</title></head><body><iframe title="Paid MZ fixture" src="/games/mosslight/index.html" width="960" height="720"></iframe><script>const frame=document.querySelector('iframe');let snapshot=${JSON.stringify({ state: saved, version })};const send=(type='mosslight.state',requestId)=>frame.contentWindow.postMessage({type,requestId,accepted:true,snapshot,nonce:'${nonce}',roundId:'${roundId}',mute:true},location.origin);addEventListener('message',async e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow)return;if(e.data.type==='mosslight.ready')send();if(e.data.type==='mosslight.intent'&&e.data.nonce==='${nonce}'&&e.data.roundId==='${roundId}'){snapshot=await window.validateIntent(e.data.intent);send('mosslight.action-result',e.data.requestId);}});</script></body></html>`,
    }),
  );
  await page.goto("/__qa/mz");
  const frame = page
    .frames()
    .find((f) => f.url().includes("/games/mosslight/"))!;
  await frame.waitForFunction("window.MosslightBridge?.snapshot");
  expect(
    await frame.evaluate(() =>
      (window as Runtime).MosslightBridge.intent({
        type: "visit",
        place: "inn",
      }),
    ),
  ).toBe(true);
  expect(saved.visited).toContain("inn");
  expect(version).toBe(1);
  expect(saved.mode).toBe("paid");
});

test("MZ spell shop, fairy music and combat submenus execute real commands", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await startPractice(page);
  await confirm(page);
  await act(page, { type: "visit", place: "inn" });
  await page.evaluate('MosslightBridge.visit("magic")');
  await page.waitForFunction(
    "SceneManager._scene._choiceListWindow?.active && SceneManager._scene._choiceListWindow.isOpen()",
  );
  await press(page, "ArrowUp");
  await press(page, "ArrowUp");
  await press(page, "Enter");
  await page.waitForFunction(
    'MosslightBridge.snapshot.state.spells.includes("spark")',
  );
  for (let i = 0; i < 10 && (await page.evaluate("$gameMessage.isBusy()")); i++)
    await press(page, "Enter");
  await page.waitForFunction("!$gameMessage.isBusy()");
  await act(page, { type: "move", destination: "clearing" });
  await mapReady(page, 2);
  await page.evaluate(
    "MosslightBridge.snapshot.state.seed=MosslightRules.practiceDemo('warrior','toad').seed; window.qaFairyTrail=[]; const fairy=$gameMap.events().find(e=>e.event().name.startsWith('Ilyra')); const originalMove=fairy.moveStraight; fairy.moveStraight=function(d){originalMove.call(this,d);window.qaFairyTrail.push([this.x,this.y]);}; MosslightBridge.fairy()",
  );
  await page.waitForFunction(
    "SceneManager._scene._choiceListWindow?.active && SceneManager._scene._choiceListWindow.isOpen()",
  );
  await press(page, "ArrowUp");
  await press(page, "Enter");
  await page.waitForFunction(
    'MosslightBridge.cutscene && AudioManager._currentBgm?.name === "Scene2" && AudioManager._bgmBuffer.isReady()',
  );
  await page.waitForFunction(
    "MosslightBridge.snapshot.state.curse && !MosslightBridge.cutscene",
  );
  for (let i = 0; i < 10 && (await page.evaluate("$gameMessage.isBusy()")); i++)
    await press(page, "Enter");
  await page.waitForFunction("!$gameMessage.isBusy()");
  expect(
    await page.evaluate(
      "new Set(window.qaFairyTrail.map(p=>p.join(','))).size",
    ),
  ).toBeGreaterThan(4);
  await page.screenshot({ path: info.outputPath("fairy-dance-toad.png") });
  await act(page, { type: "move", destination: "inn" });
  await mapReady(page, 1);
  await act(page, { type: "rest" });
  await page.evaluate("MosslightBridge.snapshot.state.encounters[0]=2");
  await act(page, { type: "move", destination: "clearing" });
  await mapReady(page, 2);
  await act(page, { type: "move", destination: "forest1" });
  await mapReady(page, 3);
  await act(page, { type: "encounter", slot: 0 });
  await page.waitForFunction(
    "SceneManager._scene.constructor.name==='Scene_MossBattle' && SceneManager._scene.isStarted() && SceneManager._scene._commandWindow.active && SceneManager._scene._commandWindow.isOpen()",
  );
  await press(page, "ArrowDown");
  await press(page, "ArrowDown");
  await press(page, "Enter");
  await page.waitForFunction("SceneManager._scene._subWindow?.active");
  expect(
    await page.evaluate("SceneManager._scene._subWindow._list[0].name"),
  ).toContain("Stormbrand");
  const mp = (await state(page)).mp;
  await press(page, "Enter");
  await expect.poll(async () => (await state(page)).mp).toBe(mp - 8);
  expect(await page.evaluate("MosslightBridge.intent({type:'potion'})")).toBe(
    false,
  );
  await page.waitForFunction(
    "SceneManager._scene._turn?.frame>=27 && SceneManager._scene._turn.frame<55",
  );
  await page.screenshot({ path: info.outputPath("spark-impact.png") });
  await page.waitForFunction(
    "!MosslightBridge.animating && SceneManager._scene._commandWindow.active",
  );
  await press(page, "ArrowDown");
  await press(page, "Enter");
  await page.waitForFunction("SceneManager._scene._subWindow?.active");
  const count = (await state(page)).potions;
  const turn = (await state(page)).turn;
  await press(page, "Enter");
  await expect.poll(async () => (await state(page)).potions).toBe(count - 1);
  expect((await state(page)).turn).toBe(turn + 1);
  await page.screenshot({ path: info.outputPath("magic-and-items.png") });
});

test("the fairy shore and inn door are reachable through actual MZ movement", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await startPractice(page);
  await confirm(page);
  await act(page, { type: "visit", place: "inn" });
  await act(page, { type: "move", destination: "clearing" });
  await mapReady(page, 2);
  async function walk(x: number, y: number, direction: number) {
    await page.evaluate(
      ({ x, y, direction }) => {
        const runtime = window as unknown as {
          walkTest: number;
          $gamePlayer: {
            x: number;
            y: number;
            isMoving(): boolean;
            canMove(): boolean;
            setDirection(d: number): void;
            findDirectionTo(x: number, y: number): number;
            moveStraight(d: number): void;
          };
        };
        runtime.walkTest = window.setInterval(() => {
          const p = runtime.$gamePlayer;
          if (!p.isMoving() && p.canMove()) {
            if (p.x === x && p.y === y) {
              clearInterval(runtime.walkTest);
              p.setDirection(direction);
            } else {
              const d = p.findDirectionTo(x, y);
              if (d) p.moveStraight(d);
            }
          }
        }, 30);
      },
      { x, y, direction },
    );
    await page.waitForFunction(
      ({ x, y, direction }) => {
        const p = (
          window as unknown as {
            $gamePlayer: {
              x: number;
              y: number;
              isMoving(): boolean;
              direction(): number;
            };
          }
        ).$gamePlayer;
        return (
          p.x === x && p.y === y && !p.isMoving() && p.direction() === direction
        );
      },
      { x, y, direction },
    );
  }
  await walk(12, 4, 4);
  await press(page, "Enter");
  await page.waitForFunction(
    "SceneManager._scene._choiceListWindow?.active && SceneManager._scene._choiceListWindow.isOpen()",
  );
  await page.screenshot({ path: info.outputPath("fairy-by-the-pond.png") });
  await press(page, "Enter");
  await page.waitForFunction("!$gameMessage.isBusy()");
  expect((await state(page)).curse).toBe(false);
  await walk(7, 11, 8);
  await press(page, "Enter");
  await mapReady(page, 1);
  expect((await state(page)).location).toBe("inn");
});
