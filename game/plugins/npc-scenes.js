import { music, sound } from "./ui.js";
export function createNpcScenes({ bridge, R, notify }) {
  async function prepareOutcome(type) {
    if (bridge.practice) return R.reduceIntent(bridge.snapshot.state, { type });
    bridge.deferOutcome = true;
    if (!(await bridge.intent({ type }, true))) throw new Error(bridge.notice);
    const state = bridge.deferredSnapshot?.state;
    if (!state || !(type === "dancer" ? state.dancerDone : state.fairyDone))
      throw new Error(
        "The encounter result is not ready. Recover the saved payment before continuing.",
      );
    return state;
  }
  async function revealOutcome(type) {
    if (bridge.practice) {
      if (!(await bridge.intent({ type }, true)))
        throw new Error(bridge.notice);
    } else bridge.revealOutcome();
  }
  const waitFrames = (frames) =>
    new Promise((resolve) => {
      let left = frames,
        previous = Graphics.frameCount;
      const tick = () => {
        const now = Graphics.frameCount;
        if (!bridge.paused) left -= Math.max(0, now - previous);
        previous = now;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  function routeTo(actor, x, y) {
    const queue = [[actor.x, actor.y, []]],
      seen = new Set([`${actor.x},${actor.y}`]);
    for (let i = 0; i < queue.length; i++) {
      const [cx, cy, path] = queue[i];
      if (cx === x && cy === y) return path;
      for (const d of [2, 4, 6, 8]) {
        const nx = $gameMap.roundXWithDirection(cx, d),
          ny = $gameMap.roundYWithDirection(cy, d),
          key = `${nx},${ny}`;
        if (!seen.has(key) && actor.canPass(cx, cy, d)) {
          seen.add(key);
          queue.push([nx, ny, [...path, d]]);
        }
      }
    }
    return null;
  }
  async function walkTo(actor, x, y, follower) {
    for (
      let steps = 0;
      steps < 100 && (actor.x !== x || actor.y !== y);
      steps++
    ) {
      while (actor.isMoving() || follower?.isMoving() || bridge.paused)
        await waitFrames(1);
      // Search actual passability, including furniture and other actors. No through mode.
      const direction = routeTo(actor, x, y)?.[0];
      if (!direction)
        throw new Error("The way is blocked. Make room and try again.");
      const previous = [actor.x, actor.y];
      actor.moveStraight(direction);
      if (follower) {
        const step = routeTo(follower, ...previous);
        if (!step || step.length > 1)
          throw new Error("Your companion cannot follow this path.");
        follower.setMoveSpeed(actor.realMoveSpeed());
        if (step.length) follower.moveStraight(step[0]);
      }
      await waitFrames(1);
    }
    while (actor.isMoving() || follower?.isMoving()) await waitFrames(1);
    if (actor.x !== x || actor.y !== y)
      throw new Error("The scene could not reach its destination.");
  }
  async function stageDancer() {
    if (bridge.cutscene || bridge.busy) return;
    bridge.cutscene = true;
    const dancer = $gameMap
      .events()
      .find((e) => e.event().name.startsWith("Vesper"));
    const previousMusic = AudioManager.saveBgm();
    try {
      while ($gameMessage.isBusy()) await waitFrames(1);
      // Paid outcomes come only from the authenticated parent after confirmation.
      // Keep their visual effects hidden until the cinematic reveal.
      const preview = await prepareOutcome("dancer");
      const home = [dancer.x, dancer.y];
      dancer.setMoveSpeed(4);
      $gamePlayer.setMoveSpeed(4);
      $gamePlayer._dashing = false;
      // Join beside the hero, then walk simultaneously along the hero's previous tile.
      const joining = [2, 4, 6, 8]
        .map((d) => {
          const x = $gameMap.roundXWithDirection($gamePlayer.x, d),
            y = $gameMap.roundYWithDirection($gamePlayer.y, d);
          return { x, y, path: routeTo(dancer, x, y) };
        })
        .filter((target) => target.path)
        .sort((a, b) => a.path.length - b.path.length)[0];
      if (!joining) throw new Error("Make room for Vesper to join you.");
      await walkTo(dancer, joining.x, joining.y);
      await walkTo($gamePlayer, 4, 7, dancer);
      await walkTo(dancer, 5, 7);
      dancer.setDirection(4);
      $gamePlayer.setDirection(6);
      await waitFrames(22);
      if (preview.dancerOutcome === "slapped") {
        sound("Blow1");
        await revealOutcome("dancer");
        if (!bridge.reduced) {
          $gamePlayer.jump(-1, 0);
          $gameScreen.startShake(3, 5, 15);
        }
      } else {
        music("Scene3", 32, 1.2);
        dancer.setStepAnime(false);
        $gamePlayer.setStepAnime(false);
        $gameTemp.requestBalloon($gamePlayer, 4);
        $gameTemp.requestBalloon(dancer, 4);
        if (!bridge.reduced)
          $gameScreen.startZoom(
            $gamePlayer.screenX() + 24,
            $gamePlayer.screenY() - 24,
            1.22,
            100,
          );
        await waitFrames(75);
        $gameScreen.startFadeOut(75);
        while ($gameScreen.brightness() > 0) await waitFrames(1);
        await waitFrames(30);
        await revealOutcome("dancer");
        $gameScreen.clearZoom();
        $gameTemp.requestBalloon(
          $gamePlayer,
          preview.dancerOutcome === "drained" ? 10 : 4,
        );
        $gameScreen.startFadeIn(60);
        await waitFrames(60);
        sound(
          bridge.snapshot.state.dancerOutcome === "inspired"
            ? "Heal1"
            : "Magic1",
        );
      }
      notify(bridge.snapshot.state.log.at(-1));
      await waitFrames(35);
      await walkTo(dancer, ...home);
    } catch (error) {
      notify(error.message);
    } finally {
      bridge.revealOutcome();
      $gameScreen.clearZoom();
      if ($gameScreen.brightness() < 255) $gameScreen.startFadeIn(30);
      AudioManager.replayBgm(previousMusic);
      dancer?.setThrough(false);
      dancer?.setMoveSpeed(2);
      dancer?.setStepAnime(true);
      $gamePlayer.setStepAnime(false);
      $gamePlayer.setMoveSpeed(4);
      bridge.cutscene = false;
    }
  }
  async function stageFairy() {
    if (bridge.cutscene || bridge.busy) return;
    bridge.cutscene = true;
    const fairy = $gameMap
      .events()
      .find((e) => e.event().name.startsWith("Ilyra"));
    try {
      while ($gameMessage.isBusy()) await waitFrames(1);
      await prepareOutcome("fairy");
      const home = [fairy.x, fairy.y];
      fairy.setMoveSpeed(3);
      $gamePlayer.setMoveSpeed(3);
      await walkTo($gamePlayer, 12, 6);
      await walkTo(fairy, 13, 4);
      bridge.dancing = true;
      music("Scene2", 38, 0.6);
      $gameTemp.requestBalloon(fairy, 3);
      const steps = [
        [14, 4, 12, 6],
        [14, 5, 12, 5],
        [14, 6, 12, 4],
        [13, 6, 13, 4],
        [12, 6, 14, 4],
        [12, 5, 14, 5],
        [12, 4, 14, 6],
        [13, 4, 13, 6],
      ];
      for (const [fx, fy, px, py] of steps) {
        await Promise.all([walkTo(fairy, fx, fy), walkTo($gamePlayer, px, py)]);
        fairy.turnTowardCharacter($gamePlayer);
        $gamePlayer.turnTowardCharacter(fairy);
        await waitFrames(18);
      }
      // A deliberate bow and held beat precede the transformation.
      fairy.turnTowardCharacter($gamePlayer);
      $gamePlayer.turnTowardCharacter(fairy);
      $gameTemp.requestBalloon(fairy, 4);
      await waitFrames(40);
      for (const direction of [6, 2, 4, 8]) {
        fairy.setDirection(direction);
        if (!bridge.reduced) $gamePlayer.setDirection(10 - direction);
        await waitFrames(12);
      }
      if (!bridge.reduced) fairy.jump(0, 0);
      await waitFrames(36);
      await walkTo(fairy, ...home);
      sound("Magic1");
      await revealOutcome("fairy");
      notify(bridge.snapshot.state.log.at(-1));
    } catch (error) {
      notify(error.message);
    } finally {
      bridge.revealOutcome();
      bridge.dancing = false;
      fairy?.setThrough(false);
      fairy?.setMoveSpeed(2);
      $gamePlayer.setMoveSpeed(4);
      bridge.cutscene = false;
      $gameMap.autoplay();
    }
  }

  return { stageDancer, stageFairy };
}
