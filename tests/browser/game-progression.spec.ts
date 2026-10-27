import { test, expect } from "./fixtures/local-game";
import { initialState, reduceIntent } from "../../game/rules";

test("walking into creatures, winning with keyboard commands and following the road reaches the cave", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  let state = initialState("warrior", false, { mode: "practice", seed: 23 });
  for (const place of ["weapon", "armor"] as const) {
    state = reduceIntent(state, { type: "visit", place });
    state = reduceIntent(state, { type: "buy", item: place });
  }
  for (const destination of ["clearing", "forest1"] as const)
    state = reduceIntent(state, { type: "move", destination });
  await page.evaluate(`(() => {
    MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
    DataManager.setupNewGame(); $gameSystem.disableMenu();
    $gamePlayer.reserveTransfer(3,17,36,8,0); SceneManager.goto(Scene_Map);
    window.qaWalk=setInterval(()=>{
      if (!$dataMap || SceneManager.isSceneChanging() || !SceneManager._scene.isStarted() || SceneManager._scene.constructor.name!=='Scene_Map' || !$gamePlayer.canMove() || $gamePlayer.isMoving() || $gamePlayer.isTransferring() || ![3,4].includes($gameMap.mapId())) return;
      const mob=$gameMap.events().find(e=>e.event().note.startsWith('encounter:')&&!e._erased);
      const target=mob?[mob.x,mob.y]:$gameMap.mapId()===3?[17,0]:[17,6];
      const queue=[[$gamePlayer.x,$gamePlayer.y,0]],seen=new Set([$gamePlayer.x+','+$gamePlayer.y]);
      for(let i=0;i<queue.length;i++){
        const [x,y,first]=queue[i];
        if(x===target[0]&&y===target[1]){if(first)$gamePlayer.moveStraight(first);break;}
        for(const d of [8,4,6,2]){
          const nx=$gameMap.roundXWithDirection(x,d),ny=$gameMap.roundYWithDirection(y,d),key=nx+','+ny;
          if(!seen.has(key)&&($gamePlayer.canPass(x,y,d)||(mob&&nx===target[0]&&ny===target[1]))){seen.add(key);queue.push([nx,ny,first||d]);}
        }
      }
    },25);
  })()`);
  try {
    for (let step = 0; step < 250; step++) {
      await page.keyboard.press("Enter", { delay: 80 });
      if (await page.evaluate("$gameMap.mapId()===5")) break;
      if (errors.length) break;
      await page.waitForTimeout(400);
    }
    expect(errors).toEqual([]);
    const result = await page.evaluate(
      "({map:$gameMap.mapId(),cleared:MosslightBridge.snapshot.state.cleared,phase:MosslightBridge.snapshot.state.phase,notice:MosslightBridge.notice,canMove:$gamePlayer.canMove(),animating:MosslightBridge.animating,cutscene:MosslightBridge.cutscene,message:$gameMessage.isBusy(),interpreter:$gameMap._interpreter._index,player:[$gamePlayer.x,$gamePlayer.y]})",
    );
    await info.attach("walk-result", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    expect(result.map, JSON.stringify(result)).toBe(5);
    expect(result.cleared).toEqual([0, 1, 2, 3, 4]);
  } finally {
    await page.evaluate("clearInterval(window.qaWalk)");
  }
});

test("normal victories release map controls for the next enemy and forest exit", async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let state = initialState("warrior", false, { mode: "practice", seed: 7 });
  for (const place of ["weapon", "armor"] as const) {
    state = reduceIntent(state, { type: "visit", place });
    state = reduceIntent(state, { type: "buy", item: place });
  }
  for (const destination of ["clearing", "forest1"] as const)
    state = reduceIntent(state, { type: "move", destination });
  await page.evaluate(`(() => {
    MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
    DataManager.setupNewGame(); $gameSystem.disableMenu();
    $gamePlayer.reserveTransfer(3,17,36,8,0); SceneManager.goto(Scene_Map);
  })()`);
  await page.waitForFunction(
    "$gameMap.mapId()===3 && SceneManager._scene.isStarted() && !SceneManager._scene.isBusy()",
  );
  const startingTone = await page.evaluate<number[]>("$gameScreen.tone()");
  await page.screenshot({ path: info.outputPath("forest-before.png") });
  for (const slot of [0, 1]) {
    // Start the actual map event, including its native interpreter lock.
    await page.evaluate(
      `$gameMap.events().find(e=>e.event().note==='encounter:${slot}').start()`,
    );
    await page.waitForFunction(
      "SceneManager._scene.constructor.name==='Scene_MossBattle' && SceneManager._scene.isStarted()",
    );
    for (let turn = 0; turn < 12; turn++) {
      await page.evaluate(
        "SceneManager._scene.act({type:MosslightBridge.snapshot.state.mp>=6?'skill':'attack'})",
      );
      await page.waitForFunction(
        "!MosslightBridge.animating && !MosslightBridge.busy",
      );
      if (await page.evaluate("MosslightBridge.snapshot.state.phase==='trail'"))
        break;
    }
    await page.waitForFunction(
      "SceneManager._scene.constructor.name==='Scene_Map' && SceneManager._scene.isStarted()",
    );
    expect(errors).toEqual([]);
    await expect
      .poll(() =>
        page.evaluate(
          "({canMove:$gamePlayer.canMove(),animating:!!MosslightBridge.animating,resolving:!!MosslightBridge.resolving,busy:MosslightBridge.busy,message:$gameMessage.isBusy()})",
        ),
      )
      .toEqual({
        canMove: true,
        animating: false,
        resolving: false,
        busy: false,
        message: false,
      });
    await page.waitForFunction("$gameScreen._toneDuration===0");
    expect(
      await page.evaluate("$gameMap.events().filter(e=>e._lanternLit).length"),
    ).toBe(slot + 1);
    expect(
      (await page.evaluate<number[]>("$gameScreen.tone()"))[0],
    ).toBeGreaterThan(startingTone[0]);
    await page.screenshot({
      path: info.outputPath(`forest-after-${slot + 1}.png`),
    });
  }
  expect(await page.evaluate("MosslightBridge.snapshot.state.cleared")).toEqual(
    [0, 1],
  );
  await page.evaluate("$gamePlayer.locate(17,2)");
  await page.keyboard.down("ArrowUp");
  try {
    await page.waitForFunction("$gameMap.mapId()===4", null, { timeout: 5000 });
  } finally {
    await page.keyboard.up("ArrowUp");
  }
});

test("the flower passage can be walked from entrance to exit without fighting", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  let state = initialState("warrior", false, { mode: "practice", seed: 8 });
  for (const destination of ["clearing", "forest1"] as const)
    state = reduceIntent(state, { type: "move", destination });
  await page.evaluate(`(() => {
    MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
    DataManager.setupNewGame(); $gameSystem.disableMenu();
    $gamePlayer.reserveTransfer(3,16,33,4,0); SceneManager.goto(Scene_Map);
  })()`);
  await page.waitForFunction(
    "$gameMap.mapId()===3 && SceneManager._scene.isStarted() && !SceneManager._scene.isBusy()",
  );
  for (const [x, y] of [
    [7, 33],
    [7, 3],
    [15, 3],
    [17, 3],
  ]) {
    await page.evaluate(`window.qaWalk=setInterval(()=>{
      if(!$gamePlayer.canMove() || $gamePlayer.isMoving()) return;
      const d=$gamePlayer.x!==${x}?($gamePlayer.x>${x}?4:6):$gamePlayer.y!==${y}?($gamePlayer.y>${y}?8:2):0;
      if(d)$gamePlayer.moveStraight(d);
    },20)`);
    try {
      await page.waitForFunction(
        `$gamePlayer.x===${x} && $gamePlayer.y===${y} && !$gamePlayer.isMoving()`,
        null,
        { timeout: 20_000 },
      );
    } finally {
      await page.evaluate("clearInterval(window.qaWalk)");
    }
  }
  await page.screenshot({ path: info.outputPath("flower-path-north.png") });
  await page.keyboard.down("ArrowUp");
  try {
    await page.waitForFunction("$gameMap.mapId()===4", null, { timeout: 5000 });
  } finally {
    await page.keyboard.up("ArrowUp");
  }
  expect(await page.evaluate("MosslightBridge.snapshot.state.cleared")).toEqual(
    [],
  );
  expect(
    await page.evaluate("MosslightBridge.snapshot.state.restored"),
  ).toEqual([]);
});

for (const outcome of ["victory", "defeat"] as const)
  test(`a keyboard finishing turn completes the ${outcome} scene without leaving a stale animation lock`, async ({
    page,
  }) => {
    let state = initialState("warrior", false, { mode: "practice", seed: 12 });
    for (const destination of [
      "clearing",
      "forest1",
      "forest2",
      "shrine",
    ] as const)
      state = reduceIntent(state, { type: "move", destination });
    state = reduceIntent(state, { type: "encounter", slot: 5 });
    // Isolate each terminal transition; these fixture values never authorize rewards.
    if (outcome === "victory") state.enemyHp = 1;
    else state.hp = 1;
    await page.evaluate(`(() => {
      MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
      DataManager.setupNewGame(); $gameSystem.disableMenu();
      $gamePlayer.reserveTransfer(5,12,13,8,0); SceneManager.goto(Scene_Map);
    })()`);
    await page.waitForFunction(
      "SceneManager._scene.constructor.name==='Scene_MossBattle' && SceneManager._scene.isStarted() && !SceneManager._scene._intro",
    );
    // MZ samples keys per animation frame; a zero-duration press can be missed.
    await page.keyboard.press("Enter", { delay: 80 });
    await page.waitForFunction(
      "SceneManager._scene.constructor.name==='Scene_MossResult' && SceneManager._scene.isStarted()",
    );
    expect(await page.evaluate("MosslightBridge.snapshot.state.phase")).toBe(
      outcome,
    );
    expect(
      await page.evaluate(
        "MosslightBridge.animating || MosslightBridge.resolving || MosslightBridge.busy",
      ),
    ).toBe(false);
  });
