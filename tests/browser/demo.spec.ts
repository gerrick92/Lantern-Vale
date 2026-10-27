import { test, expect } from "./fixtures/authenticated";

test("legacy paid routes and developer tools remain closed to ordinary accounts", async ({
  page,
}) => {
  await page.goto("/dashboard");
  for (const url of [
    "/api/rounds",
    "/api/rounds/00000000-0000-0000-0000-000000000001/claim",
    "/api/rounds/00000000-0000-0000-0000-000000000001/actions",
    "/api/payments/review",
    "/api/payments/recover",
    "/api/payments/expire",
  ]) {
    const response = await page.request.post(url, {
      headers: { Origin: new URL(page.url()).origin },
      data: {},
    });
    expect(response.status()).toBe(503);
    expect(await response.text()).toContain("Paid play remains disabled");
  }
  expect((await page.request.get("/api/payments/pending")).status()).toBe(503);
  expect((await page.goto("/dev/deploy"))?.status()).toBe(404);
});

test("the practice engine shows every NPC outcome with movement, hearts and sound", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/adventure/test");
  await expect(page.locator("iframe")).toBeVisible();
  const frame = page
    .frames()
    .find((item) => item.url().includes("/games/mosslight/"))!;
  await frame.waitForFunction(
    "window.SceneManager?._scene?.constructor.name==='Scene_Title'",
  );
  await expect(
    page.getByText("Local demo controls", { exact: true }),
  ).toHaveCount(0);
  for (const scenario of ["inspired", "drained", "slapped", "wild", "toad"]) {
    // Practice is deliberately client-controlled and cannot authorize a GLOW payout.
    await page.locator("iframe").evaluate((element, outcome) => {
      (element as HTMLIFrameElement).contentWindow!.postMessage(
        { type: "mosslight.practice-demo", scenario: outcome },
        location.origin,
      );
    }, scenario);
    const fairy = scenario === "wild" || scenario === "toad";
    await frame.waitForFunction(
      `MosslightBridge.snapshot?.state.demo && SceneManager._scene.constructor.name==='Scene_Map' && $gameMap.mapId()===${fairy ? 2 : 1} && !SceneManager._scene.isBusy() && !MosslightBridge.cutscene && !$gamePlayer.isTransferring()`,
    );
    await frame.evaluate(`(() => {
      window.qaHearts=[]; window.qaFades=[]; window.qaNpcSounds=[]; window.qaSteps=[]; window.qaResolution=[];
      const mover=Game_CharacterBase.prototype.moveStraight;
      Game_CharacterBase.prototype.moveStraight=function(d){
        mover.call(this,d);
        if(MosslightBridge.cutscene && (this===$gamePlayer || this.event?.().name.match(/Vesper|Ilyra/))) window.qaSteps.push({through:this.isThrough(),region:$gameMap.regionId(this.x,this.y)});
      };
      const action=MosslightBridge.intent.bind(MosslightBridge);
      MosslightBridge.intent=async function(intent,sceneAction){
        if(intent.type==='dancer') window.qaResolution.push({hp:this.snapshot.state.hp,mp:this.snapshot.state.mp,brightness:$gameScreen.brightness(),hero:[$gamePlayer.x,$gamePlayer.y],npc:$gameMap.events().filter(e=>e.event().name.startsWith('Vesper')).map(e=>[e.x,e.y])[0]});
        return action(intent,sceneAction);
      };
      const balloons=$gameTemp.requestBalloon.bind($gameTemp);
      $gameTemp.requestBalloon=(actor,id)=>{window.qaHearts.push(id);balloons(actor,id)};
      const fade=$gameScreen.startFadeOut.bind($gameScreen);
      $gameScreen.startFadeOut=(duration)=>{window.qaFades.push(duration);fade(duration)};
      const se=AudioManager.playSe.bind(AudioManager);
      AudioManager.playSe=(sound)=>{window.qaNpcSounds.push(sound.name);se(sound)};
      $gamePlayer.locate(${fairy ? "12,5" : "16,10"});
      MosslightBridge.${fairy ? "fairy" : "dancer"}();
    })()`);
    await frame.waitForFunction(
      "SceneManager._scene._choiceListWindow?.active && SceneManager._scene._choiceListWindow.isOpen()",
    );
    await frame.evaluate(
      "SceneManager._scene._choiceListWindow.select(0); SceneManager._scene._choiceListWindow.processOk()",
    );
    await frame.waitForFunction(
      `MosslightBridge.snapshot.state.${fairy ? "fairyOutcome" : "dancerOutcome"}==='${scenario}' && !MosslightBridge.cutscene`,
      undefined,
      { timeout: 55_000 },
    );
    expect(await frame.evaluate("MosslightBridge.snapshot.state.spent")).toBe(
      2,
    );
    expect(await frame.evaluate("MosslightBridge.snapshot.state.demo")).toBe(
      true,
    );
    expect(await frame.evaluate("window.qaSteps.length")).toBeGreaterThan(10);
    expect(
      await frame.evaluate(
        "window.qaSteps.every(s=>!s.through && s.region===254)",
      ),
    ).toBe(true);
    if (scenario === "inspired" || scenario === "drained") {
      expect(
        await frame.evaluate("window.qaHearts.filter(id=>id===4).length"),
      ).toBeGreaterThanOrEqual(2);
      expect(await frame.evaluate("window.qaFades.length")).toBeGreaterThan(0);
      const resolutions = await frame.evaluate<object[]>("window.qaResolution");
      expect(resolutions.length).toBeGreaterThan(0);
      for (const resolution of resolutions)
        expect(resolution).toEqual({
          hp: 184,
          mp: 22,
          brightness: 0,
          hero: [4, 7],
          npc: [5, 7],
        });
      expect(await frame.evaluate("window.qaNpcSounds")).toContain(
        scenario === "inspired" ? "Heal1" : "Magic1",
      );
    }
    if (scenario === "slapped")
      expect(await frame.evaluate("window.qaNpcSounds")).toContain("Blow1");
    if (scenario === "wild") {
      await frame.waitForFunction(
        "$gameParty.leader().characterName()==='Monster'",
      );
      expect(await frame.evaluate("MosslightBridge.snapshot.state.boon")).toBe(
        "wild",
      );
    }
    await frame.evaluate("$gameMessage.clear()");
  }
  await expect(
    page.getByText("LOCAL DEMO · selected outcome · no GLOW payout", {
      exact: true,
    }),
  ).toBeVisible();
});
