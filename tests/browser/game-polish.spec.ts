import { test, expect } from "./fixtures/authenticated";
import {
  classIds,
  classes,
  classSpells,
  initialState,
  reduceIntent,
} from "../../game/rules";

for (const [index, classId] of classIds.entries()) {
  test(`${classId}: matching guardian, distinct skill and visible enemy special`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/games/mosslight/index.html?practice=1");
    await page.waitForFunction(
      "window.SceneManager?._scene?.constructor.name==='Scene_Title' && SceneManager._scene.isStarted()",
    );
    let state = initialState(classId, false, {
      mode: "practice",
      seed: index + 1,
    });
    state = reduceIntent(state, { type: "visit", place: "magic" });
    for (const item of ["spark", "mend"] as const)
      if (!state.spells.includes(item))
        state = reduceIntent(state, { type: "buy", item });
    for (const destination of [
      "clearing",
      "forest1",
      "forest2",
      "shrine",
    ] as const)
      state = reduceIntent(state, { type: "move", destination });
    // Controlled practice fixture selects each guardian; it cannot reach paid rewards.
    state.encounters[5] = 6 + (index % 3);
    await page.evaluate(`(() => {
      MosslightBridge.snapshot=${JSON.stringify({ state, version: 10 })}; MosslightBridge.revision++;
      DataManager.setupNewGame();
      $gameParty.leader().setCharacterImage('${classes[classId].character}',${classes[classId].index}); $gamePlayer.refresh();
      $gamePlayer.reserveTransfer(5,12,13,8,0); SceneManager.goto(Scene_Map);
    })()`);
    await page.waitForFunction(
      "$gameMap.mapId()===5 && SceneManager._scene.isStarted() && !SceneManager._scene.isBusy() && $gameMap.events().find(e=>e.event().note==='encounter:5')?._encounterArt",
    );
    expect(
      await page.evaluate(`(() => {
      const e=$gameMap.events().find(e=>e.event().note==='encounter:5');
      return e._encounterArt===MosslightRules.enemies[MosslightBridge.snapshot.state.encounters[5]].image;
    })()`),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("guardian-on-map.png") });
    await page.evaluate("MosslightBridge.intent({type:'encounter',slot:5})");
    await page.waitForFunction(
      "SceneManager._scene.constructor.name==='Scene_MossBattle' && SceneManager._scene.isStarted() && !SceneManager._scene._intro",
    );
    expect(await page.evaluate("AudioManager._currentBgm.name")).toBe(
      "Battle8",
    );
    await page.evaluate("SceneManager._scene.submenu('magic')");
    expect(
      await page.evaluate(
        "SceneManager._scene._subWindow._list.map(v=>v.name)",
      ),
    ).toEqual([
      ...state.spells.map((id) => `${classSpells[classId][id].name} · 8 MP`),
      "Back",
    ]);
    await page.evaluate(`(() => {
      const scene=SceneManager._scene; scene._subWindow.callHandler('back');
      MosslightBridge.snapshot.state.turn=2;
      window.qaLabels=[]; const draw=scene._damage.bitmap.drawText.bind(scene._damage.bitmap);
      scene._damage.bitmap.drawText=(label,...args)=>{window.qaLabels.push(label);draw(label,...args);};
      window.qaBefore=structuredClone(MosslightBridge.snapshot.state);
      scene.act({type:'skill'});
    })()`);
    await page.waitForFunction(
      "SceneManager._scene._turn?.frame>=15 && SceneManager._scene._turn.frame<32",
    );
    expect(
      await page.evaluate(
        "SceneManager._scene._display.hp===window.qaBefore.hp",
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        "SceneManager._scene._fx.geometry.graphicsData.length",
      ),
    ).toBeGreaterThan(0);
    await page.waitForFunction(
      "SceneManager._scene._turn?.frame>=46 && SceneManager._scene._turn.frame<66",
    );
    expect(
      await page.evaluate(
        "SceneManager._scene._nativeEffects.some(e=>e.sprite._handle?.exists)",
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("class-skill.png") });
    await page.waitForFunction(
      "SceneManager._scene._turn?.frame>=128 && SceneManager._scene._turn.frame<144",
    );
    expect(
      await page.evaluate(
        "SceneManager._scene._nativeEffects.some(e=>e.sprite._handle?.exists)",
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("enemy-special.png") });
    await page.waitForFunction(
      "!MosslightBridge.animating && !SceneManager._scene._turn",
    );
    expect(await page.evaluate("window.qaLabels")).toContain(
      classes[classId].skill,
    );
    expect(
      await page.evaluate(
        "window.qaLabels.includes(MosslightRules.enemyAction(window.qaBefore).name)",
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        "MosslightBridge.snapshot.state.mp===window.qaBefore.mp-6",
      ),
    ).toBe(true);
    // Reduced motion preserves readable action names and results without moving effects.
    await page.evaluate(
      "MosslightBridge.reduced=true; SceneManager._scene.act({type:'guard'})",
    );
    await page.waitForFunction(
      "SceneManager._scene._turn?.frame>=46 && SceneManager._scene._turn.frame<66",
    );
    expect(
      await page.evaluate(
        "SceneManager._scene._fx.geometry.graphicsData.length",
      ),
    ).toBe(0);
    expect(await page.evaluate("SceneManager._scene._hero.x")).toBe(740);
    await page.waitForFunction("!MosslightBridge.animating");
    for (const spell of ["spark", "mend"]) {
      await page.evaluate(
        `MosslightBridge.reduced=false; MosslightBridge.snapshot.state.mp=68; SceneManager._scene.act({type:'magic',spell:'${spell}'})`,
      );
      await page.waitForFunction(
        "SceneManager._scene._turn?.frame>=46 && SceneManager._scene._turn.frame<66",
      );
      expect(
        await page.evaluate(
          "SceneManager._scene._nativeEffects.some(e=>e.sprite._handle?.exists)",
        ),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`spell-${spell}.png`) });
      await page.waitForFunction("!MosslightBridge.animating");
    }
    expect(errors).toEqual([]);
  });
}
