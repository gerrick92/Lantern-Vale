import { test, expect } from "./fixtures/authenticated";
import { initialState, reduceIntent } from "../../game/rules";

test("class portraits stay cropped while uncached sprite sheets load", async ({
  page,
}) => {
  await page.route("**/img/sv_actors/*.png", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  await page.goto("/games/mosslight/index.html?practice=1");
  await page.waitForFunction(
    "window.SceneManager?._scene?.constructor.name==='Scene_Title' && SceneManager._scene.isStarted()",
  );
  // Inspect the image-load callback itself, before the next scene update can crop it.
  await page.evaluate(`(() => {
    window.qaAtlasFlashes=[];
    const original=Sprite.prototype._onBitmapLoad;
    Sprite.prototype._onBitmapLoad=function(bitmap) {
      original.call(this,bitmap);
      if (this===SceneManager._scene?._hero && this.visible && bitmap.isReady() &&
          (this._frame.width>bitmap.width/9 || this._frame.height>bitmap.height/6))
        window.qaAtlasFlashes.push(bitmap.url);
    };
  })()`);
  await page.evaluate("SceneManager._scene.commandNewGame()");
  await page.waitForFunction(
    "SceneManager._scene.constructor.name==='Scene_MossClass' && SceneManager._scene.isStarted()",
  );
  const invalidFrames = await page.evaluate(async () => {
    const w = window as unknown as {
      SceneManager: {
        _scene: {
          _list: { select(i: number): void };
          _hero: {
            visible: boolean;
            bitmap: { width: number; height: number; isReady(): boolean };
            _frame: { width: number; height: number };
          };
        };
      };
    };
    const errors: number[] = [];
    for (let index = 0; index < 6; index++) {
      w.SceneManager._scene._list.select(index);
      for (let frame = 0; frame < 35; frame++) {
        await new Promise(requestAnimationFrame);
        const hero = w.SceneManager._scene._hero;
        if (
          hero.visible &&
          hero.bitmap?.isReady() &&
          (hero._frame.width > hero.bitmap.width / 9 ||
            hero._frame.height > hero.bitmap.height / 6)
        )
          errors.push(index);
      }
    }
    return errors;
  });
  expect(invalidFrames).toEqual([]);
  expect(await page.evaluate("window.qaAtlasFlashes")).toEqual([]);
});

test("every northern Forest I road lane transfers through real walking", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.goto("/games/mosslight/index.html?practice=1");
  await page.waitForFunction(
    "window.SceneManager?._scene?.constructor.name==='Scene_Title' && SceneManager._scene.isStarted()",
  );
  let state = initialState("warrior", false, { mode: "practice", seed: 7 });
  state = reduceIntent(state, { type: "move", destination: "clearing" });
  state = reduceIntent(state, { type: "move", destination: "forest1" });
  // Isolate exit geometry from randomized enemies; still move through native MZ input.
  for (const x of [15, 17, 19, 20, 22]) {
    await page.evaluate(`(() => {
      MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
      DataManager.setupNewGame(); $gamePlayer.reserveTransfer(3,${x},2,8,0); SceneManager.goto(Scene_Map);
    })()`);
    await page.waitForFunction(
      "$gameMap.mapId()===3 && SceneManager._scene.isStarted() && !SceneManager._scene.isBusy() && !$gamePlayer.isTransferring()",
    );
    await page.keyboard.down("ArrowUp");
    try {
      await expect
        .poll(() => page.evaluate("$gameMap.mapId()"), {
          timeout: 3500,
          message: `Northern road lane ${x} must lead to Forest II`,
        })
        .toBe(4);
    } finally {
      await page.keyboard.up("ArrowUp");
    }
  }
  await page.screenshot({ path: info.outputPath("forest-arrival.png") });
});

test("both forest trails reach the shrine through native movement", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/games/mosslight/index.html?practice=1");
  await page.waitForFunction(
    "window.SceneManager?._scene?.constructor.name==='Scene_Title' && SceneManager._scene.isStarted()",
  );
  let state = initialState("warrior", false, { mode: "practice", seed: 7 });
  state = reduceIntent(state, { type: "move", destination: "clearing" });
  state = reduceIntent(state, { type: "move", destination: "forest1" });
  state.cleared = [0, 1, 2, 3, 4];
  state.restored = ["forest1", "forest2"];
  await page.evaluate(`(() => {
    MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
    DataManager.setupNewGame(); $gameSystem.disableMenu(); $gamePlayer.reserveTransfer(3,17,36,8,0); SceneManager.goto(Scene_Map);
    window.qaSteps=0;
    window.qaWalk=setInterval(()=>{
      if (!$gameMap || ![3,4].includes($gameMap.mapId()) || !$gamePlayer.canMove() || $gamePlayer.isMoving() || $gamePlayer.isTransferring()) return;
      const target=$gameMap.mapId()===3?[17,0]:[17,6];
      const queue=[[$gamePlayer.x,$gamePlayer.y,0]], seen=new Set([$gamePlayer.x+','+$gamePlayer.y]);
      for(let i=0;i<queue.length;i++){
        const [x,y,first]=queue[i];
        if(x===target[0]&&y===target[1]) { if(first){$gamePlayer.moveStraight(first);window.qaSteps++;} break; }
        for(const d of [8,4,6,2]){
          const nx=$gameMap.roundXWithDirection(x,d),ny=$gameMap.roundYWithDirection(y,d),key=nx+','+ny;
          if(!seen.has(key)&&$gamePlayer.canPass(x,y,d)){seen.add(key);queue.push([nx,ny,first||d]);}
        }
      }
    },30);
  })()`);
  try {
    await page.waitForFunction(
      "$gameMap.mapId()===5 && MosslightBridge.snapshot.state.location==='shrine'",
      null,
      { timeout: 70_000 },
    );
    expect(await page.evaluate("window.qaSteps")).toBeGreaterThan(60);
  } finally {
    await page.evaluate("clearInterval(window.qaWalk)");
  }
});

test("map composition reference views", async ({ page }, info) => {
  await page.goto("/games/mosslight/index.html?practice=1");
  await page.waitForFunction(
    "window.SceneManager?._scene?.constructor.name==='Scene_Title' && SceneManager._scene.isStarted()",
  );
  let state = initialState("warrior", false, { mode: "practice", seed: 7 });
  for (const [id, location, x, y] of [
    [1, "inn", 12, 12],
    [2, "clearing", 12, 11],
    [3, "forest1", 19, 20],
    [4, "forest2", 17, 9],
  ] as const) {
    if (id > 1)
      state = reduceIntent(state, { type: "move", destination: location });
    await page.evaluate(`(() => {
      MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
      DataManager.setupNewGame(); $gameSystem.disableMenu(); $gamePlayer.reserveTransfer(${id},${x},${y},8,0); SceneManager.goto(Scene_Map);
    })()`);
    await page.waitForFunction(
      `$gameMap.mapId()===${id} && SceneManager._scene.isStarted() && !SceneManager._scene.isBusy() && !$gamePlayer.isTransferring()`,
    );
    await page.waitForFunction("$gameScreen._toneDuration===0");
    await page.screenshot({ path: info.outputPath(`map-${id}.png`) });
  }
});
