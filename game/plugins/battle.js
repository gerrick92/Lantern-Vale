import { palette, text, lines, panel, Choices, music, sound } from "./ui.js";
export function createBattleScene({ bridge, R, resultScene }) {
  class BattleCommands extends Window_Command {
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
          se: { ...t.se, volume: Math.min(t.se.volume, 45) },
        })),
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
        ImageManager.loadBattleback1(this._boss ? "RockCave" : "Grassland"),
      );
      this.addChild(this._back);
      this._back2 = new Sprite(
        ImageManager.loadBattleback2(this._boss ? "RockCave" : "Forest"),
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
        ImageManager.loadSvActor(R.classes[s.classId].battler),
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
        new Rectangle(24, 482, 220, 214),
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
        this._boss ? 1 : 0.25,
      );
      this.refresh();
    }
    refresh() {
      const s = this._display || bridge.snapshot.state,
        e = R.currentEnemy(s);
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
        "right",
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
        R.classes[s.classId].color,
      );
      text(w, `HP ${s.hp} / ${s.maxHp}`, 0, 42, 210, 21);
      w.contents.fillRect(0, 76, 198, 7, "#284139");
      w.contents.fillRect(0, 76, (198 * s.hp) / s.maxHp, 7, palette.green);
      text(w, `MP ${s.mp} / ${s.maxMp}`, 0, 95, 210, 21);
      w.contents.fillRect(0, 128, 198, 7, "#283448");
      w.contents.fillRect(0, 128, (198 * s.mp) / s.maxMp, 7, "#94b8ea");
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
            `${R.classSpells[s.classId][spell].name} · 8 MP`,
            spell,
            s.mp >= 8,
          );
      } else {
        w.addCommand(`Moss Tonic · ${s.potions} left`, "potion", s.potions > 0);
        w.addCommand(`Dew Ether · ${s.ethers} left`, "ether", s.ethers > 0);
      }
      w.addCommand("Back", "back");
      w.refresh();
      const close = () => {
        w.close();
        w.deactivate();
        this._windowLayer.removeChild(w);
        this._subWindow = null;
        this._subType = null;
        this.refresh();
        this._commandWindow.activate();
      };
      for (const symbol of type === "magic" ? s.spells : ["potion", "ether"])
        w.setHandler(symbol, () => {
          close();
          this.act(
            type === "magic"
              ? { type: "magic", spell: symbol }
              : { type: symbol },
          );
        });
      w.setHandler("back", close);
      w.setHandler("cancel", close);
      this.addWindow(w);
      w.activate();
      w.select(0);
    }
    async act(intent) {
      if (
        this._turn ||
        this._intro ||
        bridge.busy ||
        bridge.paused ||
        bridge.animating
      )
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
        frame: 0,
      };
      this._display = before;
      this._motion =
        intent.type === "guard"
          ? 3
          : intent.type === "magic"
            ? 10
            : intent.type === "skill"
              ? 9
              : ["potion", "ether"].includes(intent.type)
                ? 11
                : 7;
      this._motionUntil = Graphics.frameCount + 72;
      this.refresh();
    }
    animateTurn() {
      const t = this._turn;
      if (!t || bridge.paused) return;
      const f = ++t.frame,
        g = this._fx,
        b = this._damage.bitmap;
      const spell =
        t.intent.type === "magic"
          ? R.classSpells[t.before.classId][t.intent.spell]
          : null;
      const skill = t.intent.type === "skill";
      const support =
        ["potion", "ether", "guard"].includes(t.intent.type) ||
        (spell && !spell.damage);
      const styles = {
        warrior: "breaker",
        dark_knight: "drain",
        white_mage: "holy",
        black_mage: "fire",
        ranger: "arrows",
        thief: "shadow",
      };
      const style =
        spell?.style ||
        (skill ? styles[t.before.classId] : support ? "ward" : "slash");
      const label =
        spell?.name ||
        (skill
          ? R.classes[t.before.classId].skill
          : t.intent.type === "guard"
            ? "Defend"
            : t.intent.type === "potion"
              ? "Moss Tonic"
              : t.intent.type === "ether"
                ? "Dew Ether"
                : "Attack");
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
        leaves: 91,
      };
      const responseIds = {
        strike: 1,
        flame: 66,
        spores: 59,
        claw: 16,
        slash: 7,
        rocks: 86,
        roots: 57,
      };
      if (f === 34)
        this.nativeEffect(
          support ? (t.intent.type === "guard" ? 51 : 41) : effectIds[style],
          support ? this._hero : this._enemy,
          support ? 40 : skill || spell ? 60 : 40,
        );
      if (f === 47 && style === "arrows")
        this.nativeEffect(11, this._enemy, 65);
      if (f === 112 && t.after.enemyHp > 0)
        this.nativeEffect(
          responseIds[response.style],
          this._hero,
          response.style === "roots" ? 32 : response.special ? 45 : 30,
        );
      const incoming = Number(
        t.after.log
          .findLast(
            (v) =>
              v.startsWith(R.currentEnemy(t.before).name) &&
              v.includes("damage."),
          )
          ?.match(/: (\d+) damage/)?.[1] || 0,
      );
      const color = ["holy", "ward"].includes(style)
        ? 0xd8f7ba
        : ["drain", "shadow"].includes(style)
          ? 0xc596f5
          : style === "arrows" || style === "leaves"
            ? 0x9fdfb4
            : style === "lightning"
              ? 0xa5ddff
              : 0xffc36a;
      const ring = (x, y, radius, c, alpha = 0.8) => {
        g.lineStyle(3, c, alpha);
        g.drawCircle(x, y, radius);
      };
      const slash = (x, y, size, c, reverse = false) => {
        g.lineStyle(8, c, 0.4);
        g.moveTo(x - size, y + (reverse ? -size : size));
        g.lineTo(x + size, y + (reverse ? size : -size));
        g.lineStyle(3, 0xfff5df, 1);
        g.moveTo(x - size, y + (reverse ? -size : size));
        g.lineTo(x + size, y + (reverse ? size : -size));
      };
      const burst = (x, y, count, spread, c, progress) => {
        for (let i = 0; i < count; i++) {
          const a = (i * Math.PI * 2) / count;
          g.lineStyle(2, c, 0.85);
          g.moveTo(
            x + Math.cos(a) * spread * progress * 0.4,
            y + Math.sin(a) * spread * progress * 0.4,
          );
          g.lineTo(
            x + Math.cos(a) * spread * progress,
            y + Math.sin(a) * spread * progress,
          );
        }
      };
      g.clear();
      b.clear();
      b.fontSize = 24;
      b.textColor = "#fff0c7";
      b.drawText(
        f < 85 || t.after.enemyHp <= 0
          ? label
          : response.special
            ? response.name
            : R.currentEnemy(t.before).name + " · Attack",
        180,
        125,
        600,
        40,
        "center",
      );
      if (!bridge.reduced) {
        // Charge, release and recoil have separate beats; basic attacks stay short and plain.
        if (f < 32 && (skill || spell)) {
          ring(740, 400, 12 + f, color, 0.7);
          burst(740, 400, 8, 55, color, 1 - f / 40);
        }
        if (
          f >= 30 &&
          f < 72 &&
          !support &&
          ["slash", "breaker", "shadow", "drain"].includes(style)
        ) {
          const progress = Math.sin(((f - 30) / 42) * Math.PI);
          this._hero.x = 740 - progress * (skill ? 350 : 280);
          if (style === "shadow") this._hero.opacity = f < 45 ? 90 : 255;
        }
        if (f >= 32 && f < 68 && !Graphics.effekseer) {
          const p = (f - 32) / 36,
            x = support ? 740 : 300;
          if (style === "arrows") {
            for (let i = 0; i < 2; i++) {
              const ax =
                  710 - Math.min(1, Math.max(0, (f - 32 - i * 7) / 20)) * 410,
                ay = 350 + i * 35;
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
            g.lineStyle(3, 0xffffff, 0.95);
            g.moveTo(320, 195);
            g.lineTo(278, 280);
            g.lineTo(325, 270);
            g.lineTo(290, 405);
          } else if (style === "meteor" || style === "fire") {
            for (let i = 0; i < 4; i++) {
              const mx = 240 + i * 40,
                my = 220 + Math.min(1, p + i * 0.12) * 190;
              g.lineStyle(12, 0xe67b46, 0.4);
              g.moveTo(mx + 30, my - 60);
              g.lineTo(mx, my);
              g.beginFill(0xffce81, 0.9);
              g.drawCircle(mx, my, 9 + i * 2);
              g.endFill();
            }
            ring(300, 410, 20 + p * 65, 0xffb75e, 1 - p);
          } else if (style === "holy" || support) {
            ring(x, 390, 22 + p * 45, color, 1 - p / 2);
            for (let i = 0; i < 5; i++) {
              const a = p * 3 + (i * Math.PI * 2) / 5;
              const px = x + Math.cos(a) * 45,
                py = 380 + Math.sin(a) * 35 - p * 40;
              g.lineStyle(2, color, 0.9);
              g.moveTo(px - 5, py);
              g.lineTo(px + 5, py);
              g.moveTo(px, py - 7);
              g.lineTo(px, py + 7);
            }
            if (!support) {
              g.lineStyle(12, 0xfff2bf, 0.35);
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
                g.beginFill(0xdb8cdd, 0.7);
                g.drawCircle(
                  320 + q * 400,
                  370 - Math.sin(q * Math.PI) * 65,
                  5,
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
          hp: t.after.enemyHp
            ? Math.min(t.after.maxHp, t.after.hp + incoming)
            : t.after.hp,
          log: [
            ...t.before.log.slice(-2),
            label +
              (support
                ? " · Recover and protect."
                : " · " + (t.before.enemyHp - t.after.enemyHp) + " damage."),
          ],
        };
        this.refresh();
      }
      if (f >= 45 && f < 82) {
        b.fontSize = skill || spell ? 36 : 28;
        b.textColor = support ? "#aff0c4" : "#ffe4a6";
        b.drawText(
          support
            ? t.intent.type === "guard"
              ? "DEFEND"
              : "RECOVER"
            : String(t.before.enemyHp - t.after.enemyHp),
          support ? 650 : 210,
          300 - (bridge.reduced ? 0 : (f - 45) / 2),
          180,
          44,
          "center",
        );
        if (!bridge.reduced && !support)
          this._enemy.setBlendColor([
            255,
            220,
            160,
            Math.max(0, 160 - (f - 45) * 8),
          ]);
        if (f > 70) {
          this._hero.x = 740;
          this._hero.opacity = 255;
        }
      }
      if (t.after.enemyHp > 0 && f >= 90 && f < 164) {
        const p = Math.min(1, (f - 108) / 38);
        if (!bridge.reduced) {
          // Native impact effects do not replace the attacker's wind-up and lunge.
          if (
            ["strike", "claw", "slash"].includes(response.style) &&
            f >= 108 &&
            f < 146
          )
            this._enemy.x =
              300 +
              Math.sin(Math.max(0, p) * Math.PI) *
                (response.special ? 180 : 95);
          if (response.special && f < 120) {
            ring(300, 400, 20 + (f - 90), 0xf09388, 0.7);
            burst(300, 365, 8, 60, 0xf09388, 1 - (f - 90) / 36);
          }
          if (f >= 108 && f < 146 && !Graphics.effekseer) {
            if (["flame", "spores"].includes(response.style)) {
              for (let i = 0; i < 7; i++) {
                g.beginFill(
                  response.style === "flame" ? 0xff985e : 0xa8d36b,
                  0.8,
                );
                g.drawCircle(
                  330 + p * 400,
                  350 + Math.sin(p * 5 + i) * 28,
                  7 + (i % 3) * 3,
                );
                g.endFill();
              }
            } else if (["roots", "rocks"].includes(response.style)) {
              for (let i = 0; i < 5; i++) {
                const x = 685 + i * 25,
                  h = Math.sin(p * Math.PI) * (45 + (i % 3) * 20);
                g.beginFill(
                  response.style === "roots" ? 0x8bad61 : 0xb5a99c,
                  0.9,
                );
                g.drawPolygon([x - 10, 440, x, 440 - h, x + 14, 440]);
                g.endFill();
              }
            } else {
              if (f > 120) {
                if (response.special)
                  for (let i = 0; i < 3; i++)
                    slash(710 + i * 20, 380 + i * 8, 35, 0xffa28d, i % 2 === 0);
                else slash(740, 380, 26, 0xffb29b);
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
            "center",
          );
          if (!bridge.reduced) {
            this._hero.setBlendColor([
              255,
              100,
              90,
              Math.max(0, 150 - (f - 126) * 9),
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
            19,
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
          330 / this._enemy.bitmap.width,
        );
        this._enemy.scale.set(scale);
      }
      if (this._hero.bitmap.isReady()) {
        const b = this._hero.bitmap,
          w = b.width / 9,
          h = b.height / 6,
          frame = bridge.reduced ? 1 : Math.floor(Graphics.frameCount / 12) % 3,
          motion = Graphics.frameCount < this._motionUntil ? this._motion : 0;
        this._hero.setFrame(
          (Math.floor(motion / 6) * 3 + frame) * w,
          (motion % 6) * h,
          w,
          h,
        );
        this._hero.scale.set(1);
      }
      // Keyboard handlers can resolve practice rules before act() resumes after await.
      // Keep this scene until that final turn has been installed and animated.
      if (
        s.phase === "trail" &&
        !this._turn &&
        !bridge.animating &&
        !bridge.resolving &&
        !bridge.busy &&
        !SceneManager.isSceneChanging()
      ) {
        AudioManager.playMe({
          name: "Victory1",
          volume: 40,
          pitch: 100,
          pan: 0,
        });
        $gameMap.autoplay();
        SceneManager.pop();
      } else if (
        ["victory", "defeat"].includes(s.phase) &&
        !this._turn &&
        !bridge.animating &&
        !bridge.resolving &&
        !bridge.busy &&
        !SceneManager.isSceneChanging()
      )
        SceneManager.goto(resultScene());
    }
  }

  return Scene_MossBattle;
}
