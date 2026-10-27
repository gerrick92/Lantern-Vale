/*: @target MZ
 * @plugindesc Lantern Vale presentation. Generated from game/plugins; run npm run game:plugins.
 * @help Practice has no reward authority. Paid actions require the authenticated server.
 */
(() => {
  var __defProp = Object.defineProperty;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

  // game/plugins/ui.js
  var palette = {
    ink: "#e9f3e5",
    gold: "#e4c386",
    muted: "#b0c9c0",
    green: "#75cfa8",
    red: "#ee9291"
  };
  function text(win, value, x, y, width, size = 22, color = palette.ink, align = "left") {
    win.contents.fontSize = size;
    win.changeTextColor(color);
    win.drawText(String(value), x, y, width, align);
  }
  __name(text, "text");
  function lines(win, value, x, y, width, size = 20) {
    win.contents.fontSize = size;
    let row = "", offset = 0;
    for (const word of String(value).split(" ")) {
      const next = row ? `${row} ${word}` : word;
      if (win.textWidth(next) > width && row) {
        text(win, row, x, y + offset, width, size);
        offset += size + 9;
        row = word;
      } else row = next;
    }
    if (row) text(win, row, x, y + offset, width, size);
    return offset + size + 9;
  }
  __name(lines, "lines");
  function panel(scene, x, y, w, h) {
    const win = new Window_Base(new Rectangle(x, y, w, h));
    scene.addWindow(win);
    return win;
  }
  __name(panel, "panel");
  var Choices = class extends Window_Command {
    static {
      __name(this, "Choices");
    }
    refresh() {
      const commands = this._list?.slice();
      super.refresh();
      if (commands?.length) {
        this._list = commands;
        this.createContents();
        this.drawAllItems();
      }
    }
  };
  function music(name, volume = 38, fade = 0) {
    AudioManager.playBgm({ name, volume, pitch: 100, pan: 0 });
    if (fade > 0) AudioManager.fadeInBgm(fade);
  }
  __name(music, "music");
  function sound(name) {
    AudioManager.playSe({ name, volume: 65, pitch: 100, pan: 0 });
  }
  __name(sound, "sound");

  // game/plugins/npc-scenes.js
  function createNpcScenes({ bridge, R, notify }) {
    async function prepareOutcome(type) {
      if (bridge.practice) return R.reduceIntent(bridge.snapshot.state, { type });
      bridge.deferOutcome = true;
      if (!await bridge.intent({ type }, true)) throw new Error(bridge.notice);
      const state = bridge.deferredSnapshot?.state;
      if (!state || !(type === "dancer" ? state.dancerDone : state.fairyDone))
        throw new Error(
          "The encounter result is not ready. Recover the saved payment before continuing."
        );
      return state;
    }
    __name(prepareOutcome, "prepareOutcome");
    async function revealOutcome(type) {
      if (bridge.practice) {
        if (!await bridge.intent({ type }, true))
          throw new Error(bridge.notice);
      } else bridge.revealOutcome();
    }
    __name(revealOutcome, "revealOutcome");
    const waitFrames = /* @__PURE__ */ __name((frames) => new Promise((resolve) => {
      let left = frames, previous = Graphics.frameCount;
      const tick = /* @__PURE__ */ __name(() => {
        const now = Graphics.frameCount;
        if (!bridge.paused) left -= Math.max(0, now - previous);
        previous = now;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      }, "tick");
      requestAnimationFrame(tick);
    }), "waitFrames");
    function routeTo(actor, x, y) {
      const queue = [[actor.x, actor.y, []]], seen = /* @__PURE__ */ new Set([`${actor.x},${actor.y}`]);
      for (let i = 0; i < queue.length; i++) {
        const [cx, cy, path] = queue[i];
        if (cx === x && cy === y) return path;
        for (const d of [2, 4, 6, 8]) {
          const nx = $gameMap.roundXWithDirection(cx, d), ny = $gameMap.roundYWithDirection(cy, d), key = `${nx},${ny}`;
          if (!seen.has(key) && actor.canPass(cx, cy, d)) {
            seen.add(key);
            queue.push([nx, ny, [...path, d]]);
          }
        }
      }
      return null;
    }
    __name(routeTo, "routeTo");
    async function walkTo(actor, x, y, follower) {
      for (let steps = 0; steps < 100 && (actor.x !== x || actor.y !== y); steps++) {
        while (actor.isMoving() || follower?.isMoving() || bridge.paused)
          await waitFrames(1);
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
    __name(walkTo, "walkTo");
    async function stageDancer() {
      if (bridge.cutscene || bridge.busy) return;
      bridge.cutscene = true;
      const dancer = $gameMap.events().find((e) => e.event().name.startsWith("Vesper"));
      const previousMusic = AudioManager.saveBgm();
      try {
        while ($gameMessage.isBusy()) await waitFrames(1);
        const preview = await prepareOutcome("dancer");
        const home = [dancer.x, dancer.y];
        dancer.setMoveSpeed(4);
        $gamePlayer.setMoveSpeed(4);
        $gamePlayer._dashing = false;
        const joining = [2, 4, 6, 8].map((d) => {
          const x = $gameMap.roundXWithDirection($gamePlayer.x, d), y = $gameMap.roundYWithDirection($gamePlayer.y, d);
          return { x, y, path: routeTo(dancer, x, y) };
        }).filter((target) => target.path).sort((a, b) => a.path.length - b.path.length)[0];
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
              100
            );
          await waitFrames(75);
          $gameScreen.startFadeOut(75);
          while ($gameScreen.brightness() > 0) await waitFrames(1);
          await waitFrames(30);
          await revealOutcome("dancer");
          $gameScreen.clearZoom();
          $gameTemp.requestBalloon(
            $gamePlayer,
            preview.dancerOutcome === "drained" ? 10 : 4
          );
          $gameScreen.startFadeIn(60);
          await waitFrames(60);
          sound(
            bridge.snapshot.state.dancerOutcome === "inspired" ? "Heal1" : "Magic1"
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
    __name(stageDancer, "stageDancer");
    async function stageFairy() {
      if (bridge.cutscene || bridge.busy) return;
      bridge.cutscene = true;
      const fairy = $gameMap.events().find((e) => e.event().name.startsWith("Ilyra"));
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
          [13, 4, 13, 6]
        ];
        for (const [fx, fy, px, py] of steps) {
          await Promise.all([walkTo(fairy, fx, fy), walkTo($gamePlayer, px, py)]);
          fairy.turnTowardCharacter($gamePlayer);
          $gamePlayer.turnTowardCharacter(fairy);
          await waitFrames(18);
        }
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
    __name(stageFairy, "stageFairy");
    return { stageDancer, stageFairy };
  }
  __name(createNpcScenes, "createNpcScenes");

  // game/plugins/battle.js
  function createBattleScene({ bridge, R, resultScene }) {
    class BattleCommands extends Window_Command {
      static {
        __name(this, "BattleCommands");
      }
      makeCommandList() {
        const s = bridge.snapshot?.state;
        if (!s) return;
        this.addCommand("Attack", "attack");
        this.addCommand("Skill", "skill", s.mp >= 6);
        this.addCommand("Magic", "magic", s.spells.length > 0);
        this.addCommand("Item", "item", s.potions + s.ethers > 0);
        this.addCommand("Defend", "guard");
      }
      itemHeight() {
        return 38;
      }
    }
    class MossBattleAnimation extends Sprite_Animation {
      static {
        __name(this, "MossBattleAnimation");
      }
      onBeforeRender(renderer) {
        super.onBeforeRender(renderer);
        const gl = renderer.gl;
        this._scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
        this._scissorBox = gl.getParameter(gl.SCISSOR_BOX);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, renderer.view.height - 480, renderer.view.width, 370);
      }
      onAfterRender(renderer) {
        super.onAfterRender(renderer);
        const gl = renderer.gl;
        gl.scissor(...this._scissorBox);
        if (this._scissorEnabled) gl.enable(gl.SCISSOR_TEST);
        else gl.disable(gl.SCISSOR_TEST);
      }
      update() {
        this._handle?.setPaused(bridge.paused);
        if (!bridge.paused) super.update();
      }
    }
    class Scene_MossBattle extends Scene_Base {
      static {
        __name(this, "Scene_MossBattle");
      }
      isReady() {
        return super.isReady() && EffectManager.isReady();
      }
      nativeEffect(id, target, scale = 65) {
        if (bridge.reduced || !Graphics.effekseer) return;
        const source = $dataAnimations[id];
        if (!source) throw new Error("Missing battle animation " + id);
        const anchor = new Sprite(new Bitmap(1, 1));
        anchor.x = target === this._hero ? 740 : 300;
        anchor.y = target === this._hero ? 412 : 360;
        this.addChildAt(anchor, this.children.indexOf(this._damage));
        const sprite = new MossBattleAnimation();
        const definition = {
          ...source,
          scale,
          speed: 150,
          displayType: 0,
          alignBottom: false,
          offsetX: 0,
          offsetY: 0,
          flashTimings: [],
          soundTimings: source.soundTimings.map((t) => ({
            ...t,
            se: { ...t.se, volume: Math.min(t.se.volume, 45) }
          }))
        };
        sprite.setup([anchor], definition, target === this._hero, 0, null);
        this.addChildAt(sprite, this.children.indexOf(this._damage));
        this._nativeEffects.push({ sprite, anchor });
      }
      clearEffects() {
        for (const { sprite, anchor } of this._nativeEffects || []) {
          sprite._handle?.stop();
          sprite.destroy();
          anchor.bitmap.destroy();
          anchor.destroy();
        }
        this._nativeEffects = [];
      }
      terminate() {
        this.clearEffects();
        super.terminate();
      }
      create() {
        super.create();
        this._nativeEffects = [];
        for (const animation of $dataAnimations.filter(Boolean))
          EffectManager.load(animation.effectName);
        const s = bridge.snapshot.state;
        this._boss = R.isBoss(s);
        this._back = new Sprite(
          ImageManager.loadBattleback1(this._boss ? "RockCave" : "Grassland")
        );
        this.addChild(this._back);
        this._back2 = new Sprite(
          ImageManager.loadBattleback2(this._boss ? "RockCave" : "Forest")
        );
        this.addChild(this._back2);
        this._shade = new Sprite(new Bitmap(960, 720));
        this._shade.bitmap.fillRect(0, 0, 960, 720, "rgba(6,17,20,.17)");
        this.addChild(this._shade);
        this._enemy = new Sprite(ImageManager.loadEnemy(R.currentEnemy(s).image));
        this._enemy.anchor.set(0.5, 1);
        this._enemy.x = 300;
        this._enemy.y = 435;
        this.addChild(this._enemy);
        this._hero = new Sprite(
          ImageManager.loadSvActor(R.classes[s.classId].battler)
        );
        this._hero.setFrame(0, 0, 0, 0);
        this._hero.anchor.set(0.5, 1);
        this._hero.x = 740;
        this._hero.y = 445;
        this.addChild(this._hero);
        this._motion = 0;
        this._fx = new PIXI.Graphics();
        this.addChild(this._fx);
        this._damage = new Sprite(new Bitmap(960, 480));
        this.addChild(this._damage);
        this.createWindowLayer();
        this._heading = panel(this, 24, 20, 912, 82);
        this._log = panel(this, 260, 500, 420, 196);
        this._status = panel(this, 696, 500, 240, 196);
        this._commandWindow = new BattleCommands(
          new Rectangle(24, 482, 220, 214)
        );
        this.addWindow(this._commandWindow);
        for (const type of ["attack", "skill", "guard"])
          this._commandWindow.setHandler(type, () => this.act({ type }));
        this._commandWindow.setHandler("magic", () => this.submenu("magic"));
        this._commandWindow.setHandler("item", () => this.submenu("item"));
        this._intro = this._boss ? 100 : 0;
        if (this._boss) AudioManager.fadeOutBgm(0.3);
        music(
          this._boss ? "Battle8" : "Battle2",
          this._boss ? 56 : 48,
          this._boss ? 1 : 0.25
        );
        this.refresh();
      }
      refresh() {
        const s = this._display || bridge.snapshot.state, e = R.currentEnemy(s);
        this._revision = bridge.revision;
        this._heading.contents.clear();
        text(this._heading, e.name, 6, 0, 540, 28, palette.gold);
        text(
          this._heading,
          `HP ${s.enemyHp} / ${e.hp}`,
          570,
          0,
          290,
          22,
          palette.ink,
          "right"
        );
        text(this._heading, R.questHint(s), 6, 35, 850, 18, palette.muted);
        const w = this._status;
        w.contents.clear();
        text(
          w,
          R.classes[s.classId].name,
          0,
          0,
          210,
          23,
          R.classes[s.classId].color
        );
        text(w, `HP ${s.hp} / ${s.maxHp}`, 0, 42, 210, 21);
        w.contents.fillRect(0, 76, 198, 7, "#284139");
        w.contents.fillRect(0, 76, 198 * s.hp / s.maxHp, 7, palette.green);
        text(w, `MP ${s.mp} / ${s.maxMp}`, 0, 95, 210, 21);
        w.contents.fillRect(0, 128, 198, 7, "#283448");
        w.contents.fillRect(0, 128, 198 * s.mp / s.maxMp, 7, "#94b8ea");
        this._log.contents.clear();
        text(this._log, "BATTLE LOG", 0, 0, 380, 16, palette.gold);
        let y = 28;
        for (const line of s.log.slice(-3)) {
          y += lines(this._log, line, 0, y, 380, 17);
          if (y > 140) break;
        }
        this._commandWindow.refresh();
        if (!bridge.busy && !bridge.paused && !this._subWindow && !this._turn)
          this._commandWindow.activate();
      }
      submenu(type) {
        const s = bridge.snapshot.state;
        this._subType = type;
        this._spellHelp = null;
        this._subWindow = new Choices(new Rectangle(24, 482, 410, 214));
        const w = this._subWindow;
        w.clearCommandList();
        if (type === "magic") {
          for (const spell of s.spells)
            w.addCommand(
              `${R.classSpells[s.classId][spell].name} \xB7 8 MP`,
              spell,
              s.mp >= 8
            );
        } else {
          w.addCommand(`Moss Tonic \xB7 ${s.potions} left`, "potion", s.potions > 0);
          w.addCommand(`Dew Ether \xB7 ${s.ethers} left`, "ether", s.ethers > 0);
        }
        w.addCommand("Back", "back");
        w.refresh();
        const close = /* @__PURE__ */ __name(() => {
          w.close();
          w.deactivate();
          this._windowLayer.removeChild(w);
          this._subWindow = null;
          this._subType = null;
          this.refresh();
          this._commandWindow.activate();
        }, "close");
        for (const symbol of type === "magic" ? s.spells : ["potion", "ether"])
          w.setHandler(symbol, () => {
            close();
            this.act(
              type === "magic" ? { type: "magic", spell: symbol } : { type: symbol }
            );
          });
        w.setHandler("back", close);
        w.setHandler("cancel", close);
        this.addWindow(w);
        w.activate();
        w.select(0);
      }
      async act(intent) {
        if (this._turn || this._intro || bridge.busy || bridge.paused || bridge.animating)
          return;
        this._commandWindow.deactivate();
        const before = structuredClone(bridge.snapshot.state);
        bridge.animating = true;
        bridge.resolving = true;
        const ok = await bridge.intent(intent);
        bridge.resolving = false;
        if (!ok) {
          bridge.animating = false;
          this.refresh();
          return;
        }
        this._turn = {
          intent,
          before,
          after: structuredClone(bridge.snapshot.state),
          frame: 0
        };
        this._display = before;
        this._motion = intent.type === "guard" ? 3 : intent.type === "magic" ? 10 : intent.type === "skill" ? 9 : ["potion", "ether"].includes(intent.type) ? 11 : 7;
        this._motionUntil = Graphics.frameCount + 72;
        this.refresh();
      }
      animateTurn() {
        const t = this._turn;
        if (!t || bridge.paused) return;
        const f = ++t.frame, g = this._fx, b = this._damage.bitmap;
        const spell = t.intent.type === "magic" ? R.classSpells[t.before.classId][t.intent.spell] : null;
        const skill = t.intent.type === "skill";
        const support = ["potion", "ether", "guard"].includes(t.intent.type) || spell && !spell.damage;
        const styles = {
          warrior: "breaker",
          dark_knight: "drain",
          white_mage: "holy",
          black_mage: "fire",
          ranger: "arrows",
          thief: "shadow"
        };
        const style = spell?.style || (skill ? styles[t.before.classId] : support ? "ward" : "slash");
        const label = spell?.name || (skill ? R.classes[t.before.classId].skill : t.intent.type === "guard" ? "Defend" : t.intent.type === "potion" ? "Moss Tonic" : t.intent.type === "ether" ? "Dew Ether" : "Attack");
        const response = R.enemyAction(t.before);
        const effectIds = {
          slash: 6,
          breaker: 7,
          drain: 58,
          holy: 96,
          fire: 67,
          arrows: 11,
          shadow: 101,
          lightning: 76,
          meteor: 106,
          ward: 51,
          leaves: 91
        };
        const responseIds = {
          strike: 1,
          flame: 66,
          spores: 59,
          claw: 16,
          slash: 7,
          rocks: 86,
          roots: 57
        };
        if (f === 34)
          this.nativeEffect(
            support ? t.intent.type === "guard" ? 51 : 41 : effectIds[style],
            support ? this._hero : this._enemy,
            support ? 40 : skill || spell ? 60 : 40
          );
        if (f === 47 && style === "arrows")
          this.nativeEffect(11, this._enemy, 65);
        if (f === 112 && t.after.enemyHp > 0)
          this.nativeEffect(
            responseIds[response.style],
            this._hero,
            response.style === "roots" ? 32 : response.special ? 45 : 30
          );
        const incoming = Number(
          t.after.log.findLast(
            (v) => v.startsWith(R.currentEnemy(t.before).name) && v.includes("damage.")
          )?.match(/: (\d+) damage/)?.[1] || 0
        );
        const color = ["holy", "ward"].includes(style) ? 14219194 : ["drain", "shadow"].includes(style) ? 12949237 : style === "arrows" || style === "leaves" ? 10477492 : style === "lightning" ? 10870271 : 16761706;
        const ring = /* @__PURE__ */ __name((x, y, radius, c, alpha = 0.8) => {
          g.lineStyle(3, c, alpha);
          g.drawCircle(x, y, radius);
        }, "ring");
        const slash = /* @__PURE__ */ __name((x, y, size, c, reverse = false) => {
          g.lineStyle(8, c, 0.4);
          g.moveTo(x - size, y + (reverse ? -size : size));
          g.lineTo(x + size, y + (reverse ? size : -size));
          g.lineStyle(3, 16774623, 1);
          g.moveTo(x - size, y + (reverse ? -size : size));
          g.lineTo(x + size, y + (reverse ? size : -size));
        }, "slash");
        const burst = /* @__PURE__ */ __name((x, y, count, spread, c, progress) => {
          for (let i = 0; i < count; i++) {
            const a = i * Math.PI * 2 / count;
            g.lineStyle(2, c, 0.85);
            g.moveTo(
              x + Math.cos(a) * spread * progress * 0.4,
              y + Math.sin(a) * spread * progress * 0.4
            );
            g.lineTo(
              x + Math.cos(a) * spread * progress,
              y + Math.sin(a) * spread * progress
            );
          }
        }, "burst");
        g.clear();
        b.clear();
        b.fontSize = 24;
        b.textColor = "#fff0c7";
        b.drawText(
          f < 85 || t.after.enemyHp <= 0 ? label : response.special ? response.name : R.currentEnemy(t.before).name + " \xB7 Attack",
          180,
          125,
          600,
          40,
          "center"
        );
        if (!bridge.reduced) {
          if (f < 32 && (skill || spell)) {
            ring(740, 400, 12 + f, color, 0.7);
            burst(740, 400, 8, 55, color, 1 - f / 40);
          }
          if (f >= 30 && f < 72 && !support && ["slash", "breaker", "shadow", "drain"].includes(style)) {
            const progress = Math.sin((f - 30) / 42 * Math.PI);
            this._hero.x = 740 - progress * (skill ? 350 : 280);
            if (style === "shadow") this._hero.opacity = f < 45 ? 90 : 255;
          }
          if (f >= 32 && f < 68 && !Graphics.effekseer) {
            const p = (f - 32) / 36, x = support ? 740 : 300;
            if (style === "arrows") {
              for (let i = 0; i < 2; i++) {
                const ax = 710 - Math.min(1, Math.max(0, (f - 32 - i * 7) / 20)) * 410, ay = 350 + i * 35;
                g.lineStyle(3, color, 1);
                g.moveTo(ax + 65, ay - 15);
                g.lineTo(ax, ay);
                g.moveTo(ax + 12, ay - 10);
                g.lineTo(ax, ay);
                g.lineTo(ax + 16, ay + 3);
              }
            } else if (style === "lightning") {
              g.lineStyle(8, color, 0.4);
              g.moveTo(320, 195);
              g.lineTo(278, 280);
              g.lineTo(325, 270);
              g.lineTo(290, 405);
              g.lineStyle(3, 16777215, 0.95);
              g.moveTo(320, 195);
              g.lineTo(278, 280);
              g.lineTo(325, 270);
              g.lineTo(290, 405);
            } else if (style === "meteor" || style === "fire") {
              for (let i = 0; i < 4; i++) {
                const mx = 240 + i * 40, my = 220 + Math.min(1, p + i * 0.12) * 190;
                g.lineStyle(12, 15104838, 0.4);
                g.moveTo(mx + 30, my - 60);
                g.lineTo(mx, my);
                g.beginFill(16764545, 0.9);
                g.drawCircle(mx, my, 9 + i * 2);
                g.endFill();
              }
              ring(300, 410, 20 + p * 65, 16758622, 1 - p);
            } else if (style === "holy" || support) {
              ring(x, 390, 22 + p * 45, color, 1 - p / 2);
              for (let i = 0; i < 5; i++) {
                const a = p * 3 + i * Math.PI * 2 / 5;
                const px = x + Math.cos(a) * 45, py = 380 + Math.sin(a) * 35 - p * 40;
                g.lineStyle(2, color, 0.9);
                g.moveTo(px - 5, py);
                g.lineTo(px + 5, py);
                g.moveTo(px, py - 7);
                g.lineTo(px, py + 7);
              }
              if (!support) {
                g.lineStyle(12, 16773823, 0.35);
                g.moveTo(x, 210);
                g.lineTo(x, 420);
              }
            } else {
              slash(300, 365, style === "slash" ? 36 : 67, color);
              if (style === "breaker" || style === "shadow") {
                slash(300, 365, 50, color, true);
                ring(300, 395, 10 + p * 85, color, 1 - p);
              }
              if (style === "drain") {
                for (let i = 0; i < 6; i++) {
                  const q = (p + i / 6) % 1;
                  g.beginFill(14388445, 0.7);
                  g.drawCircle(
                    320 + q * 400,
                    370 - Math.sin(q * Math.PI) * 65,
                    5
                  );
                  g.endFill();
                }
              }
            }
            if (skill || spell) burst(x, 380, 10, 65, color, p);
          }
        }
        if (f === 45) {
          if (bridge.reduced || !Graphics.effekseer)
            sound(support ? "Heal1" : skill || spell ? "Magic1" : "Slash1");
          this._display = {
            ...t.after,
            hp: t.after.enemyHp ? Math.min(t.after.maxHp, t.after.hp + incoming) : t.after.hp,
            log: [
              ...t.before.log.slice(-2),
              label + (support ? " \xB7 Recover and protect." : " \xB7 " + (t.before.enemyHp - t.after.enemyHp) + " damage.")
            ]
          };
          this.refresh();
        }
        if (f >= 45 && f < 82) {
          b.fontSize = skill || spell ? 36 : 28;
          b.textColor = support ? "#aff0c4" : "#ffe4a6";
          b.drawText(
            support ? t.intent.type === "guard" ? "DEFEND" : "RECOVER" : String(t.before.enemyHp - t.after.enemyHp),
            support ? 650 : 210,
            300 - (bridge.reduced ? 0 : (f - 45) / 2),
            180,
            44,
            "center"
          );
          if (!bridge.reduced && !support)
            this._enemy.setBlendColor([
              255,
              220,
              160,
              Math.max(0, 160 - (f - 45) * 8)
            ]);
          if (f > 70) {
            this._hero.x = 740;
            this._hero.opacity = 255;
          }
        }
        if (t.after.enemyHp > 0 && f >= 90 && f < 164) {
          const p = Math.min(1, (f - 108) / 38);
          if (!bridge.reduced) {
            if (["strike", "claw", "slash"].includes(response.style) && f >= 108 && f < 146)
              this._enemy.x = 300 + Math.sin(Math.max(0, p) * Math.PI) * (response.special ? 180 : 95);
            if (response.special && f < 120) {
              ring(300, 400, 20 + (f - 90), 15766408, 0.7);
              burst(300, 365, 8, 60, 15766408, 1 - (f - 90) / 36);
            }
            if (f >= 108 && f < 146 && !Graphics.effekseer) {
              if (["flame", "spores"].includes(response.style)) {
                for (let i = 0; i < 7; i++) {
                  g.beginFill(
                    response.style === "flame" ? 16750686 : 11064171,
                    0.8
                  );
                  g.drawCircle(
                    330 + p * 400,
                    350 + Math.sin(p * 5 + i) * 28,
                    7 + i % 3 * 3
                  );
                  g.endFill();
                }
              } else if (["roots", "rocks"].includes(response.style)) {
                for (let i = 0; i < 5; i++) {
                  const x = 685 + i * 25, h = Math.sin(p * Math.PI) * (45 + i % 3 * 20);
                  g.beginFill(
                    response.style === "roots" ? 9153889 : 11905436,
                    0.9
                  );
                  g.drawPolygon([x - 10, 440, x, 440 - h, x + 14, 440]);
                  g.endFill();
                }
              } else {
                if (f > 120) {
                  if (response.special)
                    for (let i = 0; i < 3; i++)
                      slash(710 + i * 20, 380 + i * 8, 35, 16753293, i % 2 === 0);
                  else slash(740, 380, 26, 16757403);
                }
              }
            }
          }
          if (f === 126) {
            if (bridge.reduced || !Graphics.effekseer)
              sound(response.special ? "Magic1" : "Blow1");
            this._display = t.after;
            this.refresh();
          }
          if (f >= 126) {
            b.fontSize = 30;
            b.textColor = "#ffb1a1";
            b.drawText(
              String(incoming),
              650,
              305 - (bridge.reduced ? 0 : (f - 126) / 2),
              180,
              40,
              "center"
            );
            if (!bridge.reduced) {
              this._hero.setBlendColor([
                255,
                100,
                90,
                Math.max(0, 150 - (f - 126) * 9)
              ]);
              this._hero.x = 740 + Math.sin((f - 126) / 6) * 5;
            }
          }
        }
        if (f >= (t.after.enemyHp > 0 ? 178 : 95)) {
          this.clearEffects();
          this._turn = null;
          this._display = null;
          bridge.animating = false;
          this._hero.x = 740;
          this._hero.opacity = 255;
          this._enemy.x = 300;
          this._hero.setBlendColor([0, 0, 0, 0]);
          this._enemy.setBlendColor([0, 0, 0, 0]);
          g.clear();
          b.clear();
          this.refresh();
        }
      }
      update() {
        super.update();
        const s = bridge.snapshot.state;
        if (bridge.reduced && this._nativeEffects.length) this.clearEffects();
        if (this._subType === "magic" && this._subWindow) {
          const id = this._subWindow.currentSymbol();
          if (id !== this._spellHelp && R.classSpells[s.classId][id]) {
            this._spellHelp = id;
            const spell = R.classSpells[s.classId][id];
            this._log.contents.clear();
            text(this._log, spell.name, 0, 0, 380, 23, palette.gold);
            lines(
              this._log,
              spell.description + " Costs 8 MP and one turn.",
              0,
              40,
              380,
              19
            );
          }
        }
        if (this._revision !== bridge.revision) this.refresh();
        this.animateTurn();
        if (this._intro && !bridge.paused) {
          this._intro--;
          const b = this._damage.bitmap;
          b.clear();
          b.fontSize = 34;
          b.textColor = "#ffe0a3";
          b.drawText(R.currentEnemy(s).name, 100, 170, 760, 52, "center");
          b.fontSize = 20;
          b.drawText("Guardian of the stolen dawn", 100, 225, 760, 35, "center");
          if (!bridge.reduced)
            this._enemy.opacity = Math.min(255, (100 - this._intro) * 5);
          if (!this._intro) {
            b.clear();
            this._enemy.opacity = 255;
          }
        }
        if (bridge.paused || bridge.busy || this._turn || this._intro) {
          this._commandWindow.deactivate();
          this._subWindow?.deactivate();
        } else if (!this._subWindow) this._commandWindow.activate();
        else this._subWindow.activate();
        for (const b of [this._back, this._back2])
          if (b.bitmap.isReady())
            b.scale.set(960 / b.bitmap.width, 500 / b.bitmap.height);
        if (this._enemy.bitmap.isReady()) {
          const scale = Math.min(
            this._boss ? 1 : 0.75,
            (this._boss ? 260 : 180) / this._enemy.bitmap.height,
            330 / this._enemy.bitmap.width
          );
          this._enemy.scale.set(scale);
        }
        if (this._hero.bitmap.isReady()) {
          const b = this._hero.bitmap, w = b.width / 9, h = b.height / 6, frame = bridge.reduced ? 1 : Math.floor(Graphics.frameCount / 12) % 3, motion = Graphics.frameCount < this._motionUntil ? this._motion : 0;
          this._hero.setFrame(
            (Math.floor(motion / 6) * 3 + frame) * w,
            motion % 6 * h,
            w,
            h
          );
          this._hero.scale.set(1);
        }
        if (s.phase === "trail" && !this._turn && !bridge.animating && !bridge.resolving && !bridge.busy && !SceneManager.isSceneChanging()) {
          AudioManager.playMe({
            name: "Victory1",
            volume: 40,
            pitch: 100,
            pan: 0
          });
          $gameMap.autoplay();
          SceneManager.pop();
        } else if (["victory", "defeat"].includes(s.phase) && !this._turn && !bridge.animating && !bridge.resolving && !bridge.busy && !SceneManager.isSceneChanging())
          SceneManager.goto(resultScene());
      }
    }
    return Scene_MossBattle;
  }
  __name(createBattleScene, "createBattleScene");

  // game/plugins/map.js
  function forestLight(state, encounters) {
    if (state.restored.includes(state.location)) return 1;
    if (!["forest1", "forest2"].includes(state.location)) return 0;
    const slots = encounters.flatMap(
      (place, slot) => place === state.location ? [slot] : []
    );
    return slots.length ? slots.filter((slot) => state.cleared.includes(slot)).length / slots.length : 0;
  }
  __name(forestLight, "forestLight");
  function installMapPresentation({
    bridge,
    R,
    setWorldTone,
    entrance,
    applyHero,
    notify,
    battleScene,
    resultScene
  }) {
    function toadBitmap() {
      const b = new Bitmap(72, 96);
      const rows = [
        "        33333333        ",
        "      3322222233        ",
        "    334422224433        ",
        "    345522225543        ",
        "    332222222233        ",
        "    322222222223        ",
        "   32222222222223       ",
        "  3222222222222223      ",
        "  3222666666222223      ",
        "   33266666622333       ",
        "  3333333333333333      "
      ];
      const colors = {
        2: "#72a643",
        3: "#2e5437",
        4: "#d6d58c",
        5: "#172926",
        6: "#b0c477"
      };
      for (let direction = 0; direction < 4; direction++)
        for (let frame = 0; frame < 3; frame++) {
          const ox = frame * 24, oy = direction * 24;
          rows.forEach(
            (row, y) => [...row].forEach((v, x) => {
              if (!colors[v]) return;
              const xx = direction === 2 ? 23 - x : x;
              const color = direction === 3 && (v === "4" || v === "5") ? colors[2] : colors[v];
              b.fillRect(
                ox + xx,
                oy + y + 5 + (frame === 1 ? 0 : 1),
                1,
                1,
                color
              );
            })
          );
          const stretch = frame === 0 ? 3 : frame === 2 ? 1 : 2;
          b.fillRect(ox + 3 - stretch, oy + 17, 5 + stretch, 2, colors[3]);
          b.fillRect(ox + 16, oy + 17, 5 + stretch, 2, colors[3]);
          if (direction === 1) b.fillRect(ox + 3, oy + 10, 3, 3, colors[4]);
          if (direction === 2) b.fillRect(ox + 18, oy + 10, 3, 3, colors[4]);
        }
      return b;
    }
    __name(toadBitmap, "toadBitmap");
    const updateCharacter = Sprite_Character.prototype.updateBitmap;
    const updateFrame = Sprite_Character.prototype.updateFrame;
    Sprite_Character.prototype.updateBitmap = function() {
      if (this._character._encounterArt) {
        this._mossEnemy = true;
        this.bitmap = ImageManager.loadEnemy(this._character._encounterArt);
      } else if (this._character === $gamePlayer && bridge.snapshot?.state.curse) {
        this._mossToad = true;
        this.bitmap = this._toadBitmap ??= toadBitmap();
      } else {
        if (this._mossEnemy) {
          this._mossEnemy = false;
          this._characterName = null;
        }
        if (this._mossToad) {
          this._characterName = null;
          this._mossToad = false;
        }
        updateCharacter.call(this);
      }
    };
    Sprite_Character.prototype.updateFrame = function() {
      if (this._mossEnemy) {
        this.setFrame(0, 0, this.bitmap.width, this.bitmap.height);
        if (this.bitmap.isReady())
          this.scale.set(
            Math.min(110 / this.bitmap.width, 96 / this.bitmap.height)
          );
      } else if (this._mossToad) {
        const dir = { 2: 0, 4: 1, 6: 2, 8: 3 }[this._character.direction()];
        this.setFrame(
          (this._character.isMoving() ? this._character.pattern() : 1) * 24,
          dir * 24,
          24,
          24
        );
        const hopping = this._character.isMoving();
        const phase = Math.sin(Graphics.frameCount * 0.55);
        this.scale.set(
          1.6 * (hopping ? 1 + phase * 0.07 : 1),
          1.6 * (hopping ? 1 - phase * 0.1 : 1)
        );
      } else {
        this.scale.set(1);
        updateFrame.call(this);
      }
    };
    const characterPosition = Sprite_Character.prototype.updatePosition;
    Sprite_Character.prototype.updatePosition = function() {
      characterPosition.call(this);
      if (this._mossToad && this._character.isMoving() && !bridge.reduced)
        this.y -= Math.abs(Math.sin(Graphics.frameCount * 0.28)) * 9;
      if (this._mossEnemy && !bridge.reduced)
        this.y -= Math.sin(Graphics.frameCount / 30) * 2;
    };
    class MossHud extends Window_Base {
      static {
        __name(this, "MossHud");
      }
      constructor() {
        super(new Rectangle(12, 10, 936, 88));
        this.opacity = 0;
        this.contentsBack.fillRect(
          0,
          0,
          this.innerWidth,
          this.innerHeight,
          "rgba(13,28,32,0.92)"
        );
        for (const y of [0, this.innerHeight - 1])
          this.contentsBack.fillRect(0, y, this.innerWidth, 1, "#a99360");
        for (const x of [0, this.innerWidth - 1])
          this.contentsBack.fillRect(x, 0, 1, this.innerHeight, "#a99360");
      }
      update() {
        super.update();
        this.visible = !bridge.cutscene;
        const s = bridge.snapshot?.state;
        if (!s) return;
        const mapId = $gameMap.mapId();
        const guardian = $gameMap.events().find((e) => e._encounterArt && !e._erased);
        this.y = guardian && guardian.screenY() > 0 && guardian.screenY() - 96 < 108 ? Graphics.boxHeight - this.height - 10 : 10;
        const key = `${bridge.revision}:${bridge.notice}:${bridge.paused}:${mapId}`;
        if (this._key === key) return;
        this._key = key;
        this.contents.clear();
        const location2 = bridge.celebrating ? Object.values(R.locations).find((place) => place.map === mapId) : R.locations[s.location];
        text(this, location2.name, 6, 0, 610, 21, palette.gold);
        text(
          this,
          `${R.classes[s.classId].name}${s.curse ? " \xB7 TOAD CURSE" : ""}   HP ${s.hp}/${s.maxHp}   MP ${s.mp}/${s.maxMp}`,
          6,
          30,
          500,
          17
        );
        text(
          this,
          bridge.practice ? `Practice ${s.practiceBalance} \xB7 Spent ${s.spent}` : `Used ${s.spent} GLOW`,
          640,
          0,
          260,
          18,
          palette.muted,
          "right"
        );
        text(
          this,
          bridge.paused ? "PAUSED" : bridge.notice || R.questHint(s),
          510,
          30,
          390,
          15,
          bridge.notice ? palette.red : palette.muted,
          "right"
        );
      }
    }
    const mapCreate = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function() {
      mapCreate.call(this);
      this._mossHud = new MossHud();
      this.addWindow(this._mossHud);
    };
    const mapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function() {
      mapLoaded.call(this);
      if (bridge.snapshot) setWorldTone(bridge.snapshot.state);
      this._seenRevision = -1;
      this._wasRestored = bridge.snapshot?.state.restored.includes(
        bridge.snapshot.state.location
      );
      this._ambient = new PIXI.Graphics();
      this._ambient.z = 1;
      this._lamps = new PIXI.Graphics();
      this._lamps.z = 5;
      this._spriteset._tilemap.addChild(this._lamps);
      this._spriteset._tilemap.addChild(this._ambient);
      this._motes = new PIXI.Graphics();
      this.addChildAt(this._motes, this.children.indexOf(this._windowLayer));
    };
    function updateActors() {
      const s = bridge.snapshot.state;
      for (const e of $gameMap.events()) {
        if (e.event().note === "trailkeeper") {
          e.setImage(s.restored.includes(s.location) ? "People1" : "", 1);
          continue;
        }
        const slot = Number(e.event().note.split(":")[1]);
        if (!e.event().note.startsWith("encounter:")) continue;
        if (s.cleared.includes(slot)) {
          e._encounterArt = null;
          e.erase();
          continue;
        }
        const enemy = R.enemies[s.encounters[slot]];
        e.setImage(enemy.character, enemy.index);
        if (slot === R.BOSS_ENCOUNTER) e._encounterArt = enemy.image;
      }
    }
    __name(updateActors, "updateActors");
    const mapUpdate = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
      mapUpdate.call(this);
      const s = bridge.snapshot?.state;
      if (!s || SceneManager.isSceneChanging()) return;
      if (s.phase === "combat" && !$gameMessage.isBusy()) {
        SceneManager.push(battleScene());
        return;
      }
      if (["victory", "defeat"].includes(s.phase) && !bridge.celebrating && !$gameMessage.isBusy()) {
        SceneManager.goto(resultScene());
        return;
      }
      const target = bridge.celebrating ? $gameMap.mapId() : R.locations[s.location].map;
      if ($gameMap.mapId() !== target && !$gamePlayer.isTransferring()) {
        const old = $gameMap.mapId();
        const [x, y] = entrance(s.location, old);
        $gamePlayer.reserveTransfer(target, x, y, old < target ? 8 : 2, 0);
        return;
      }
      if (this._seenRevision !== bridge.revision) {
        this._seenRevision = bridge.revision;
        applyHero();
        updateActors();
        setWorldTone(
          {
            ...s,
            location: Object.keys(R.locations).find(
              (k) => R.locations[k].map === target
            )
          },
          90
        );
        if (s.restored.includes(s.location) && !this._wasRestored && !this._restoredShown && s.phase !== "victory") {
          this._restoredShown = true;
          notify(
            "Trailkeeper: Look! At last, the lanterns burn again. There may yet be a morning for Lantern Vale."
          );
        }
      }
      if (bridge.danceUntil && Graphics.frameCount > bridge.danceUntil) {
        bridge.danceUntil = 0;
        $gameMap.autoplay();
      }
      if (bridge.danceUntil && Graphics.frameCount % 18 === 0) {
        const fairy = $gameMap.events().find((e) => e.event().name.startsWith("Ilyra"));
        fairy?.setDirection(
          [2, 4, 8, 6][Math.floor(Graphics.frameCount / 18) % 4]
        );
      }
      if (this._ambient) {
        const g = this._ambient;
        g.clear();
        const lamps = this._lamps;
        lamps.clear();
        if (target === 1) {
          for (const [tx, ty] of [
            [16.5, 4.5],
            [2.5, 8.5],
            [12.5, 8.5],
            [4.5, 14.5]
          ]) {
            const x = $gameMap.adjustX(tx) * 48, y = $gameMap.adjustY(ty) * 48;
            lamps.beginFill(16761706, 0.075);
            lamps.drawCircle(x, y, 58);
            lamps.endFill();
            lamps.beginFill(16768656, 0.12);
            lamps.drawCircle(x, y, 24);
            lamps.endFill();
          }
        }
        if (bridge.dancing) {
          const x = $gameMap.adjustX(13.5) * 48, y = $gameMap.adjustY(5.5) * 48;
          const t = bridge.reduced ? 0 : Graphics.frameCount / 45;
          lamps.lineStyle(2, 11924952, 0.38);
          lamps.drawEllipse(x, y, 78, 45);
          lamps.lineStyle(0);
          for (let i = 0; i < 8; i++) {
            const a = t + i * Math.PI / 4;
            lamps.beginFill(15138753, 0.7);
            lamps.drawCircle(x + Math.cos(a) * 78, y + Math.sin(a) * 45, 3);
            lamps.endFill();
          }
        }
        const trailLamps = $gameMap.events().filter((e) => e.event().note.startsWith("lantern"));
        const progress = forestLight(s, R.encounterLocations);
        for (const [index, e] of trailLamps.entries()) {
          const x = e.screenX(), y = e.screenY() - 20, lit = e.event().note === "lantern:always" || progress > index / trailLamps.length;
          e._lanternLit = lit;
          lamps.beginFill(5521197);
          lamps.drawRect(x - 2, y, 4, 22);
          lamps.endFill();
          lamps.beginFill(lit ? 16766071 : 9208944);
          lamps.drawRect(x - 7, y - 15, 14, 17);
          lamps.endFill();
          lamps.beginFill(5521197);
          lamps.drawPolygon([x - 9, y - 15, x, y - 21, x + 9, y - 15]);
          lamps.drawRect(x - 8, y + 1, 16, 3);
          lamps.endFill();
          if (lit) {
            lamps.beginFill(16764006, 0.16);
            lamps.drawCircle(x, y - 5, 28);
            lamps.endFill();
          }
        }
        if (target === 5) {
          const x = $gameMap.adjustX(12.5) * 48, y = $gameMap.adjustY(11.5) * 48;
          g.lineStyle(2, 12076885, 0.9);
          g.drawCircle(x, y, 92);
          g.drawCircle(x, y, 78);
          for (let i = 0; i < 7; i++) {
            const a = i * Math.PI * 2 / 7 - Math.PI / 2, b = (i + 3) * Math.PI * 2 / 7 - Math.PI / 2;
            g.moveTo(x + Math.cos(a) * 72, y + Math.sin(a) * 72);
            g.lineTo(x + Math.cos(b) * 72, y + Math.sin(b) * 72);
          }
        }
      }
      if (this._motes) {
        const g = this._motes;
        g.clear();
        if (target >= 3) {
          g.beginFill(
            400152,
            target === 5 ? 0.13 : 0.16 * (1 - forestLight(s, R.encounterLocations))
          );
          g.drawRect(0, 0, 960, 720);
          g.endFill();
          for (let i = 1; i <= 6; i++) {
            g.beginFill(202256, 0.045);
            g.drawRect(0, 0, i * 10, 720);
            g.drawRect(960 - i * 10, 0, i * 10, 720);
            g.drawRect(0, 0, 960, i * 8);
            g.drawRect(0, 720 - i * 8, 960, i * 8);
            g.endFill();
          }
        }
        if (target !== 1 && !bridge.reduced) {
          for (let i = 0; i < 5; i++) {
            const t = Graphics.frameCount * 2e-3;
            const x = (i * 137 + Math.sin(t + i) * 20) % 960, y = (i * 79 + Math.cos(t * 0.7 + i) * 22) % 720;
            g.beginFill(
              target === 5 ? 14843493 : 13429927,
              0.15 + 0.15 * Math.sin(t + i) ** 2
            );
            g.drawCircle(x, y, 1.5);
            g.endFill();
          }
        }
      }
    };
  }
  __name(installMapPresentation, "installMapPresentation");

  // game/plugins/bridge.js
  (() => {
    "use strict";
    const R = MosslightRules;
    Graphics._defaultStretchMode = () => true;
    const printError = Graphics.printError;
    Graphics.printError = function(...args) {
      printError.apply(this, args);
      this._errorPrinter.style.pointerEvents = "auto";
    };
    const eraseError = Graphics.eraseError;
    Graphics.eraseError = function() {
      eraseError.call(this);
      if (this._errorPrinter) this._errorPrinter.style.pointerEvents = "none";
    };
    const bootStart = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function() {
      bootStart.call(this);
      if (!Graphics._errorPrinter.textContent.trim())
        Graphics._errorPrinter.style.pointerEvents = "none";
      Video._element.style.pointerEvents = "none";
      Graphics._canvas.tabIndex = 0;
      Graphics._canvas.setAttribute("aria-label", "Lantern Vale game controls");
      Graphics._canvas.addEventListener(
        "pointerdown",
        () => Graphics._canvas.focus()
      );
    };
    const local = window.MOSSLIGHT_PRACTICE_ENABLED === true && (["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) || Utils.isNwjs()) && (new URLSearchParams(location.search).get("practice") === "1" || Utils.isNwjs());
    const SAVE = "lanternvale.local-rehearsal.v5";
    const switchFullscreen = Graphics._switchFullScreen;
    Graphics._switchFullScreen = function() {
      if (!local && parent !== window) {
        parent.postMessage({ type: "mosslight.fullscreen" }, location.origin);
      } else switchFullscreen.call(this);
    };
    let entryOptions = null;
    function notify(message) {
      for (const paragraph of String(message).split("\n")) {
        let row = "";
        for (const word of paragraph.split(" ")) {
          if (row.length + word.length > 66) {
            $gameMessage.add(row);
            row = word;
          } else row += (row ? " " : "") + word;
        }
        if (row) $gameMessage.add(row);
      }
    }
    __name(notify, "notify");
    function choose(message, choices, callback) {
      notify(message);
      $gameMessage.setChoices(choices, choices.length - 1, choices.length - 1);
      $gameMessage.setChoiceCallback(callback);
    }
    __name(choose, "choose");
    function cost(tokens) {
      return bridge.practice ? `${tokens} practice token${tokens === 1 ? "" : "s"}` : `${tokens} GLOW`;
    }
    __name(cost, "cost");
    function save() {
      if (!bridge.practice || !bridge.snapshot) return;
      try {
        localStorage.setItem(SAVE, JSON.stringify(bridge.snapshot));
      } catch {
        bridge.notice = "Local saving is unavailable in this browser.";
      }
    }
    __name(save, "save");
    function load() {
      try {
        const value = JSON.parse(localStorage.getItem(SAVE) || "null");
        return R.readPracticeSnapshot(value);
      } catch {
        return null;
      }
    }
    __name(load, "load");
    const bridge = window.MosslightBridge = {
      practice: local,
      snapshot: null,
      nonce: "",
      roundId: "",
      busy: false,
      paused: false,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      revision: 0,
      notice: "",
      pending: null,
      deferOutcome: false,
      deferredSnapshot: null,
      revealOutcome() {
        const snapshot = this.deferredSnapshot;
        this.deferOutcome = false;
        this.deferredSnapshot = null;
        if (snapshot) acceptPaidSnapshot(snapshot);
      },
      readNote(message) {
        if (!this.busy && !this.cutscene) notify(message);
      },
      trailkeeper() {
        const s = this.snapshot.state;
        if (s.restored.includes(s.location))
          notify(
            "Trailkeeper: At last, the lanterns burn again. Thank you, wanderer. I had almost forgotten their warmth."
          );
      },
      async intent(intent, sceneAction = false) {
        if (this.celebrating && intent.type === "move") {
          const [x, y] = entrance(intent.destination, $gameMap.mapId());
          $gamePlayer.reserveTransfer(
            R.locations[intent.destination].map,
            x,
            y,
            2,
            0
          );
          return true;
        }
        if (!this.snapshot || this.busy || this.paused || this.cutscene && !sceneAction || this.animating && !this.resolving)
          return false;
        this.busy = true;
        this.notice = "";
        if (this.practice) {
          try {
            const state = R.reduceIntent(this.snapshot.state, intent);
            this.snapshot = { state, version: this.snapshot.version + 1 };
            this.revision++;
            save();
            this.publish();
            return true;
          } catch (error) {
            this.notice = error.message;
            SoundManager.playBuzzer();
            return false;
          } finally {
            this.busy = false;
          }
        }
        return new Promise((resolve) => {
          const requestId = crypto.randomUUID();
          const expire = /* @__PURE__ */ __name(() => {
            this.busy = false;
            this.pending = null;
            this.notice = "The server did not respond. Refresh the saved state in the companion.";
            resolve(false);
          }, "expire");
          const priced = R.paymentItem(intent) !== void 0;
          const timer = setTimeout(expire, priced ? 18e4 : 1e4);
          this.pending = {
            resolve,
            timer,
            version: this.snapshot.version,
            requestId,
            priced,
            expire
          };
          parent.postMessage(
            {
              type: "mosslight.intent",
              nonce: this.nonce,
              roundId: this.roundId,
              requestId,
              intent
            },
            location.origin
          );
        });
      },
      publish() {
        if (this.practice && parent !== window)
          parent.postMessage(
            {
              type: "mosslight.practice-state",
              snapshot: this.snapshot,
              notice: this.notice
            },
            location.origin
          );
      },
      async story(intent) {
        const ok = await this.intent(intent);
        notify(ok ? this.snapshot.state.log.at(-1) : this.notice);
      },
      async visit(place) {
        if (bridge.celebrating)
          return choose(
            "Nessa: Sunlight on the shutters! Come in, hero. Lantern Vale has its morning back.",
            ["Stay a while", "Return to title"],
            (i) => {
              if (i === 1) {
                bridge.celebrating = false;
                SceneManager.goto(Scene_Title);
              }
            }
          );
        if (!await this.intent({ type: "visit", place }))
          return notify(this.notice);
        if (place === "inn")
          return choose(
            `Nessa: The mountain has swallowed our dawn. Defeat its guardian and bring back the light.
Rest and curse cure: ${cost(1, 8)}.`,
            ["Rest and remove curses", "Tell me about the woods", "Leave"],
            (i) => {
              if (i === 0) this.story({ type: "rest" });
              if (i === 1)
                notify(
                  "Nessa: Seven nights without a sunrise. The trail lanterns went cold first; then the birds stopped singing. My brother still tends them in the woods. He refuses to come home while they are dark."
                );
            }
          );
        const items = Object.entries(R.shopItems).map(([id]) => [id, R.shopItemFor(this.snapshot.state.classId, id)]).filter(([, v]) => v.vendor === place);
        choose(
          `${place === "magic" ? "Elowen: Knowledge travels lighter than steel." : place === "item" ? "Pip: A tonic for your courage?" : "Rowan: Something sturdy for the road?"}
Choose supplies. Gear equips immediately.`,
          [
            ...items.map(
              ([id, v]) => `${v.name.replace(" Grimoire", "")} \xB7 ${this.snapshot.state.spells.includes(id) ? "Learned" : cost(v.cost, v.gold)}`
            ),
            "Leave"
          ],
          (i) => {
            if (items[i]) this.story({ type: "buy", item: items[i][0] });
          }
        );
      },
      equipment() {
        choose(
          "Rowan: Steel for your hand, barkweave for your heart.",
          ["Weapons", "Armor", "Leave"],
          (i) => {
            if (i < 2) this.visit(i === 0 ? "weapon" : "armor");
          }
        );
      },
      dancer() {
        if (this.snapshot.state.dancerDone)
          return notify("Vesper: One lesson per customer, darling.");
        choose(
          `Vesper: Pay me ${cost(1, 8)} and I will follow you to your room.
Her smile is suspiciously theatrical.`,
          ["Accept the offer", "Keep my coin"],
          (i) => {
            if (i === 0) stageDancer();
          }
        );
      },
      fairy() {
        if (this.snapshot.state.fairyDone)
          return notify(
            "Ilyra: Such a fine little voice. Sing for the moon, wanderer."
          );
        choose(
          `Ilyra: One dance upon the moonlit shore for ${cost(1, 8)}?
Something strange stirs beneath the water.`,
          ["Dance with Ilyra", "Decline politely"],
          (i) => {
            if (i === 0) {
              stageFairy();
            }
          }
        );
      },
      puzzle() {
        choose(
          "Three stones listen. Which light borrows from the sun?",
          ["The moon", "The sun", "The flame", "Leave"],
          (i) => {
            if (i < 3)
              this.story({ type: "puzzle", answer: ["moon", "sun", "flame"][i] });
          }
        );
      }
    };
    const { stageDancer, stageFairy } = createNpcScenes({ bridge, R, notify });
    function entrance(place, from) {
      if (place === "inn") return [12, 18];
      if (place === "clearing") return from === 1 ? [7, 12] : [17, 2];
      if (place === "forest1") return from > 3 ? [17, 2] : [17, 36];
      if (place === "forest2") return from === 5 ? [17, 8] : [17, 36];
      return [12, 20];
    }
    __name(entrance, "entrance");
    function setWorldTone(state, duration = 0) {
      const bright = state.restored.includes(state.location);
      const progress = forestLight(state, R.encounterLocations);
      $gameScreen.startTint(
        bright ? [8, 3, -8, 0] : state.location === "inn" ? [8, 0, -12, 0] : state.location === "shrine" ? [-55, -60, -25, 50] : ["forest1", "forest2"].includes(state.location) ? [
          -86 + progress * 94,
          -90 + progress * 93,
          -40 + progress * 32,
          65 * (1 - progress)
        ] : [-68, -72, -30, 55],
        duration
      );
    }
    __name(setWorldTone, "setWorldTone");
    function acceptPaidSnapshot(snapshot) {
      if (snapshot?.state?.mode !== "paid" || snapshot.state.rulesVersion !== 5 || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0 || !R.classIds.includes(snapshot.state.classId) || bridge.snapshot && snapshot.version < bridge.snapshot.version || bridge.deferredSnapshot && snapshot.version < bridge.deferredSnapshot.version)
        return false;
      if (bridge.deferOutcome) {
        bridge.deferredSnapshot = snapshot;
        return true;
      }
      bridge.snapshot = snapshot;
      bridge.revision++;
      return true;
    }
    __name(acceptPaidSnapshot, "acceptPaidSnapshot");
    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin || event.source !== parent || parent === window)
        return;
      const data = event.data;
      if (!local && !bridge.snapshot && data?.type === "mosslight.entry-options" && typeof data.nonce === "string") {
        entryOptions = { nonce: data.nonce, enabled: data.enabled === true };
        bridge.reduced = data.reduced === true;
        AudioManager.bgmVolume = data.mute ? 0 : 60;
        AudioManager.meVolume = data.mute ? 0 : 60;
        AudioManager.seVolume = data.mute ? 0 : 60;
        if (SceneManager._scene instanceof Scene_Title)
          SceneManager._scene._commandWindow?.refresh();
        return;
      }
      if (bridge.practice) {
        if (data?.type === "mosslight.practice-demo" && !bridge.busy && !bridge.cutscene && R.demoScenarios.includes(data.scenario)) {
          bridge.celebrating = false;
          bridge.snapshot = {
            state: R.practiceDemo(
              bridge.snapshot?.state?.classId || "warrior",
              data.scenario
            ),
            version: 0
          };
          bridge.revision++;
          save();
          enterGame(true);
        }
        if (data?.type === "mosslight.practice-start" && R.classIds.includes(data.classId) && ["Scene_Title", "Scene_MossClass", "Scene_MossResult"].includes(
          SceneManager._scene?.constructor.name
        )) {
          beginPractice(data.classId);
        }
        if (data?.type === "mosslight.practice-request") bridge.publish();
        if (data?.type === "mosslight.practice-action")
          bridge.intent(data.intent).then(() => bridge.publish());
        if (data?.type === "mosslight.practice-preferences") {
          bridge.paused = data.paused === true;
          bridge.reduced = data.reduced === true;
          AudioManager.bgmVolume = data.mute ? 0 : 60;
          AudioManager.meVolume = data.mute ? 0 : 60;
          AudioManager.seVolume = data.mute ? 0 : 60;
        }
        return;
      }
      if (data?.type === "mosslight.payment-pending") {
        const pending = bridge.pending;
        if (pending?.priced && data.nonce === bridge.nonce && data.roundId === bridge.roundId && data.requestId === pending.requestId) {
          clearTimeout(pending.timer);
          pending.timer = setTimeout(pending.expire, 45e3);
        }
        return;
      }
      if (data?.type === "mosslight.action-result") {
        const pending = bridge.pending;
        if (!pending || data.nonce !== bridge.nonce || data.roundId !== bridge.roundId || data.requestId !== pending.requestId)
          return;
        const accepted = data.accepted === true && data.snapshot?.version > pending.version && acceptPaidSnapshot(data.snapshot);
        clearTimeout(pending.timer);
        bridge.pending = null;
        bridge.busy = false;
        if (!accepted)
          bridge.notice = typeof data.error === "string" ? data.error.slice(0, 240) : "The action could not be completed. Refresh the saved state and try again.";
        pending.resolve(accepted);
        return;
      }
      if (data?.type !== "mosslight.state" || typeof data.nonce !== "string" || typeof data.roundId !== "string" || bridge.nonce && data.nonce !== bridge.nonce || bridge.roundId && data.roundId !== bridge.roundId)
        return;
      bridge.nonce = data.nonce;
      bridge.roundId = data.roundId;
      bridge.paused = data.paused === true;
      bridge.reduced = data.reduced === true;
      AudioManager.bgmVolume = data.mute ? 0 : 60;
      AudioManager.seVolume = data.mute ? 0 : 60;
      AudioManager.meVolume = data.mute ? 0 : 60;
      acceptPaidSnapshot(data.snapshot);
    });
    const boot = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function() {
      boot.call(this);
      parent.postMessage({ type: "mosslight.ready" }, location.origin);
    };
    const passage = Game_Map.prototype.checkPassage;
    Game_Map.prototype.checkPassage = function(x, y, bit) {
      const region = this.regionId(x, y);
      if (region === 255) return false;
      if (region === 254) return true;
      return passage.call(this, x, y, bit);
    };
    const canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
      return !bridge.paused && !bridge.busy && !bridge.cutscene && canMove.call(this);
    };
    Window_TitleCommand.prototype.makeCommandList = function() {
      this.addCommand(
        local ? "New Game \xB7 local rehearsal" : "Begin / resume paid adventure",
        "newGame",
        local || !!bridge.snapshot || entryOptions?.enabled === true
      );
      if (local) this.addCommand("Continue rehearsal", "continue", !!load());
      this.addCommand("Options", "options");
    };
    const titleCreate = Scene_Title.prototype.create;
    Scene_Title.prototype.create = function() {
      titleCreate.call(this);
      this._gameTitleSprite.bitmap.clear();
      const w = panel(this, 40, 28, 880, 146);
      text(
        w,
        "L A N T E R N  V A L E",
        0,
        4,
        w.innerWidth,
        40,
        palette.gold,
        "center"
      );
      text(
        w,
        "The mountain has swallowed the dawn.",
        0,
        56,
        w.innerWidth,
        22,
        palette.ink,
        "center"
      );
      text(
        w,
        local ? "LOCAL REHEARSAL \xB7 Practice tokens only \xB7 No wallet required" : "Open a paid adventure from the Lantern Vale website to begin.",
        0,
        92,
        w.innerWidth,
        18,
        palette.muted,
        "center"
      );
    };
    const titleUpdate = Scene_Title.prototype.update;
    Scene_Title.prototype.update = function() {
      titleUpdate.call(this);
      if (!local && bridge.snapshot && !bridge.paused && this.isStarted() && !SceneManager.isSceneChanging()) {
        this._commandWindow.close();
        enterGame(true);
        return;
      }
      if (this._revision !== bridge.revision) {
        this._revision = bridge.revision;
        this._commandWindow.refresh();
      }
    };
    function applyHero() {
      const s = bridge.snapshot.state, c = R.classes[s.classId];
      $gameParty.leader().setCharacterImage(
        s.boon === "wild" ? "Monster" : c.character,
        s.boon === "wild" ? 1 : c.index
      );
      $gamePlayer.refresh();
    }
    __name(applyHero, "applyHero");
    function enterGame(resuming) {
      DataManager.setupNewGame();
      applyHero();
      $gameSystem.disableSave();
      $gameSystem.disableMenu();
      if (resuming) {
        const place = bridge.snapshot.state.location;
        $gamePlayer.reserveTransfer(
          R.locations[place].map,
          ...entrance(place, 0),
          8,
          0
        );
      }
      SceneManager.goto(Scene_Map);
      bridge.publish();
    }
    __name(enterGame, "enterGame");
    function beginPractice(classId) {
      bridge.celebrating = false;
      bridge.snapshot = {
        state: R.initialState(classId, false, {
          mode: "practice",
          seed: crypto.getRandomValues(new Uint32Array(1))[0]
        }),
        version: 0
      };
      bridge.revision++;
      save();
      enterGame(false);
    }
    __name(beginPractice, "beginPractice");
    Scene_Title.prototype.commandNewGame = function() {
      this._commandWindow.close();
      if (local || entryOptions?.enabled) SceneManager.goto(Scene_MossClass);
      else if (bridge.snapshot) enterGame(true);
    };
    Scene_Title.prototype.commandContinue = function() {
      bridge.snapshot = load();
      if (bridge.snapshot) {
        bridge.revision++;
        enterGame(true);
      }
    };
    class ClassCommands extends Window_Command {
      static {
        __name(this, "ClassCommands");
      }
      makeCommandList() {
        for (const id of R.classIds) this.addCommand(R.classes[id].name, id);
      }
      itemHeight() {
        return 58;
      }
    }
    class Scene_MossClass extends Scene_MenuBase {
      static {
        __name(this, "Scene_MossClass");
      }
      create() {
        super.create();
        this._heading = panel(this, 40, 24, 880, 112);
        text(
          this._heading,
          "Choose your adventurer",
          0,
          0,
          840,
          30,
          palette.gold
        );
        text(
          this._heading,
          local ? "Your class is locked for this journey. Confirming spends 1 of 30 practice tokens." : "Choose your class, then review the 1 GLOW entry in your wallet.",
          0,
          48,
          840,
          18
        );
        this._list = new ClassCommands(new Rectangle(40, 160, 300, 388));
        this.addWindow(this._list);
        for (const id of R.classIds)
          this._list.setHandler(id, () => this.confirm(id));
        this._list.setHandler("cancel", () => SceneManager.goto(Scene_Title));
        this._detail = panel(this, 364, 160, 556, 388);
        this._footer = panel(this, 40, 570, 880, 98);
        text(
          this._footer,
          "\u2191 \u2193 Choose   Enter Confirm   Esc Back",
          0,
          0,
          840,
          20,
          palette.muted
        );
        text(
          this._footer,
          local ? "Practice funds reset each new game. No GLOW is spent or earned." : "Your adventure begins only after the server verifies your Sepolia payment.",
          0,
          35,
          840,
          18
        );
        this._hero = new Sprite();
        this._hero.anchor.set(0.5, 1);
        this._hero.x = 805;
        this._hero.y = 360;
        this.addChild(this._hero);
      }
      update() {
        super.update();
        const id = this._list.currentSymbol();
        if (!id) return;
        const c = R.classes[id];
        if (id !== this._selected) {
          this._selected = id;
          const w = this._detail;
          w.contents.clear();
          text(w, c.name, 12, 10, 470, 30, c.color);
          text(w, `HP ${c.hp}`, 12, 83, 200, 26);
          text(w, `MP ${c.mp}`, 12, 127, 200, 26);
          text(w, `Attack ${c.attack}   Defense ${c.defense}`, 12, 180, 480, 21);
          text(w, c.skill, 12, 228, 480, 23, palette.gold);
          lines(w, c.description, 12, 269, 480, 20);
          this._hero.bitmap = ImageManager.loadSvActor(c.battler);
          this._hero.setFrame(0, 0, 0, 0);
          this._hero.visible = false;
        }
        if (this._hero.bitmap?.isReady()) {
          const bitmap = this._hero.bitmap, w = bitmap.width / 9, h = bitmap.height / 6, frame = bridge.reduced ? 1 : Math.floor(Graphics.frameCount / 15) % 3;
          this._hero.setFrame(frame * w, 0, w, h);
          this._hero.scale.set(1.4);
          this._hero.visible = true;
        }
      }
      confirm(id) {
        this._list.deactivate();
        this._confirm = new Choices(new Rectangle(230, 550, 500, 148));
        this._confirm.clearCommandList();
        this._confirm.addCommand(
          local ? `Begin as ${R.classes[id].name} \xB7 1 practice token` : `Review ${R.classes[id].name} entry \xB7 1 GLOW`,
          "yes"
        );
        this._confirm.addCommand("Choose another class", "no");
        this._confirm.refresh();
        this._confirm.setHandler("yes", () => {
          if (local) beginPractice(id);
          else if (entryOptions?.enabled) {
            parent.postMessage(
              {
                type: "mosslight.entry-class",
                nonce: entryOptions.nonce,
                classId: id
              },
              location.origin
            );
            this._confirm.callHandler("no");
          }
        });
        this._confirm.setHandler("no", () => {
          this._confirm.close();
          this._confirm.deactivate();
          this._windowLayer.removeChild(this._confirm);
          this._list.activate();
        });
        this._confirm.setHandler("cancel", () => this._confirm.callHandler("no"));
        this.addWindow(this._confirm);
        this._confirm.activate();
        this._confirm.select(0);
      }
    }
    installMapPresentation({
      bridge,
      R,
      setWorldTone,
      entrance,
      applyHero,
      notify,
      battleScene: /* @__PURE__ */ __name(() => Scene_MossBattle, "battleScene"),
      resultScene: /* @__PURE__ */ __name(() => Scene_MossResult, "resultScene")
    });
    const Scene_MossBattle = createBattleScene({
      bridge,
      R,
      resultScene: /* @__PURE__ */ __name(() => Scene_MossResult, "resultScene")
    });
    class Scene_MossResult extends Scene_MenuBase {
      static {
        __name(this, "Scene_MossResult");
      }
      create() {
        super.create();
        const s = bridge.snapshot.state, won = s.phase === "victory";
        AudioManager.stopBgm();
        AudioManager.playMe({
          name: won ? "Victory1" : "Defeat1",
          volume: 50,
          pitch: 100,
          pan: 0
        });
        const w = panel(this, 90, 65, 780, 470);
        text(
          w,
          won ? "Dawn returns to Lantern Vale" : "The lantern goes dark",
          0,
          15,
          w.innerWidth,
          34,
          palette.gold,
          "center"
        );
        let y = 86;
        y += lines(
          w,
          won ? "The hollow mountain releases its breath. Below, the inn windows glow like small suns. Nessa will have a story to tell." : "The woods are patient. Rest, learn their secrets, and return with a different plan.",
          20,
          y,
          700,
          23
        ) + 25;
        if (bridge.practice) {
          y += lines(
            w,
            `LOCAL REHEARSAL \xB7 ${s.spent} practice tokens spent. ${won ? s.refunded : 0} returned. Bonus: ${s.bonus}. Balance: ${s.practiceBalance}.`,
            20,
            y,
            700,
            22
          ) + 16;
          lines(
            w,
            "No GLOW was spent or earned. Start another rehearsal whenever you like.",
            20,
            y,
            700,
            20
          );
        } else
          lines(
            w,
            won ? "Victory recorded by the server. Use the website companion to request an eligible reward." : "This paid round has ended without a reward.",
            20,
            y,
            700,
            22
          );
        this._commandWindow = new Choices(new Rectangle(260, 535, 440, 160));
        this._commandWindow.clearCommandList();
        this._commandWindow.addCommand(
          bridge.practice ? "Return to title \xB7 play again" : "Return to title",
          "title"
        );
        if (won)
          this._commandWindow.addCommand("Return to the sunlit inn", "home");
        this._commandWindow.setHandler("home", () => {
          bridge.celebrating = true;
          $gamePlayer.reserveTransfer(1, 12, 17, 8, 0);
          SceneManager.goto(Scene_Map);
        });
        this._commandWindow.refresh();
        this._commandWindow.setHandler(
          "title",
          () => SceneManager.goto(Scene_Title)
        );
        this.addWindow(this._commandWindow);
        save();
        bridge.publish();
      }
    }
  })();
})();
