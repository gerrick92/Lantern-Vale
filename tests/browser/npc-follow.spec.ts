import { test, expect } from "./fixtures/local-game";
import { practiceDemo } from "../../game/rules";

for (const outcome of ["drained", "inspired", "slapped"] as const)
  test(`Vesper follows continuously and resolves ${outcome} beside the bed`, async ({
    page,
  }, info) => {
    test.setTimeout(55_000);
    const state = practiceDemo("warrior", outcome);
    await page.evaluate(`(() => {
      MosslightBridge.snapshot=${JSON.stringify({ state, version: 0 })}; MosslightBridge.revision++;
      DataManager.setupNewGame(); $gameSystem.disableMenu();
      $gamePlayer.reserveTransfer(1,16,10,8,0); SceneManager.goto(Scene_Map);
    })()`);
    await page.waitForFunction(
      "$gameMap.mapId()===1 && SceneManager._scene.isStarted() && !SceneManager._scene.isBusy()",
    );
    await page.evaluate(`(() => {
      window.qaFollowing=[]; window.qaResolution=[]; window.qaWalls=[];
      const intent=MosslightBridge.intent.bind(MosslightBridge);
      MosslightBridge.intent=async function(action,staged){
        if(action.type==='dancer') window.qaResolution.push({hp:this.snapshot.state.hp,mp:this.snapshot.state.mp,brightness:$gameScreen.brightness(),hero:[$gamePlayer.x,$gamePlayer.y],npc:$gameMap.events().filter(e=>e.event().name.startsWith('Vesper')).map(e=>[e.x,e.y])[0]});
        return intent(action,staged);
      };
      window.qaFollow=setInterval(()=>{
        if(!MosslightBridge.cutscene)return;
        const npc=$gameMap.events().find(e=>e.event().name.startsWith('Vesper'));
        if($gamePlayer.isMoving())window.qaFollowing.push({gap:Math.abs(npc._realX-$gamePlayer._realX)+Math.abs(npc._realY-$gamePlayer._realY),moving:npc.isMoving()});
        for(const actor of [npc,$gamePlayer])if(actor.isThrough()||$gameMap.regionId(actor.x,actor.y)!==254)window.qaWalls.push([actor.x,actor.y]);
      },16);
      MosslightBridge.dancer();
    })()`);
    await page.waitForFunction(
      "SceneManager._scene._choiceListWindow?.active && SceneManager._scene._choiceListWindow.isOpen()",
    );
    await page.evaluate(
      "SceneManager._scene._choiceListWindow.select(0); SceneManager._scene._choiceListWindow.processOk()",
    );
    await page.waitForFunction(
      `MosslightBridge.snapshot.state.dancerOutcome==='${outcome}'`,
      null,
      { timeout: 30_000 },
    );
    if (outcome !== "slapped") {
      await page.waitForFunction("$gameScreen.brightness()===255");
      await page.screenshot({ path: info.outputPath("bedroom-scene.png") });
    }
    await page.waitForFunction("!MosslightBridge.cutscene", null, {
      timeout: 20_000,
    });
    await page.evaluate("clearInterval(window.qaFollow)");
    const following =
      await page.evaluate<{ gap: number; moving: boolean }[]>(
        "window.qaFollowing",
      );
    expect(following.length).toBeGreaterThan(60);
    // Ignore the short comic jump after the slap; it is not part of the escort.
    const walking = outcome === "slapped" ? following.slice(0, -25) : following;
    expect(Math.max(...walking.map((frame) => frame.gap))).toBeLessThanOrEqual(
      1.1,
    );
    expect(
      walking.filter((frame) => frame.moving).length / walking.length,
    ).toBeGreaterThan(0.9);
    expect(await page.evaluate("window.qaWalls")).toEqual([]);
    expect(await page.evaluate("window.qaResolution[0]")).toEqual({
      hp: 184,
      mp: 22,
      brightness: outcome === "slapped" ? 255 : 0,
      hero: [4, 7],
      npc: [5, 7],
    });
    expect(await page.evaluate("MosslightBridge.snapshot.state.spent")).toBe(2);
  });
