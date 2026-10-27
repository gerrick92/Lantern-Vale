import { palette, text } from "./ui.js";
export function forestLight(state, encounters) {
  if (state.restored.includes(state.location)) return 1;
  if (!["forest1", "forest2"].includes(state.location)) return 0;
  const slots = encounters.flatMap((place, slot) =>
    place === state.location ? [slot] : [],
  );
  return slots.length
    ? slots.filter((slot) => state.cleared.includes(slot)).length / slots.length
    : 0;
}
export function installMapPresentation({
  bridge,
  R,
  setWorldTone,
  entrance,
  applyHero,
  notify,
  battleScene,
  resultScene,
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
      "  3333333333333333      ",
    ];
    const colors = {
      2: "#72a643",
      3: "#2e5437",
      4: "#d6d58c",
      5: "#172926",
      6: "#b0c477",
    };
    for (let direction = 0; direction < 4; direction++)
      for (let frame = 0; frame < 3; frame++) {
        const ox = frame * 24,
          oy = direction * 24;
        rows.forEach((row, y) =>
          [...row].forEach((v, x) => {
            if (!colors[v]) return;
            const xx = direction === 2 ? 23 - x : x;
            const color =
              direction === 3 && (v === "4" || v === "5")
                ? colors[2]
                : colors[v];
            b.fillRect(
              ox + xx,
              oy + y + 5 + (frame === 1 ? 0 : 1),
              1,
              1,
              color,
            );
          }),
        );
        const stretch = frame === 0 ? 3 : frame === 2 ? 1 : 2;
        b.fillRect(ox + 3 - stretch, oy + 17, 5 + stretch, 2, colors[3]);
        b.fillRect(ox + 16, oy + 17, 5 + stretch, 2, colors[3]);
        if (direction === 1) b.fillRect(ox + 3, oy + 10, 3, 3, colors[4]);
        if (direction === 2) b.fillRect(ox + 18, oy + 10, 3, 3, colors[4]);
      }
    return b;
  }
  const updateCharacter = Sprite_Character.prototype.updateBitmap;
  const updateFrame = Sprite_Character.prototype.updateFrame;
  Sprite_Character.prototype.updateBitmap = function () {
    if (this._character._encounterArt) {
      this._mossEnemy = true;
      this.bitmap = ImageManager.loadEnemy(this._character._encounterArt);
    } else if (
      this._character === $gamePlayer &&
      bridge.snapshot?.state.curse
    ) {
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
  Sprite_Character.prototype.updateFrame = function () {
    if (this._mossEnemy) {
      this.setFrame(0, 0, this.bitmap.width, this.bitmap.height);
      if (this.bitmap.isReady())
        this.scale.set(
          Math.min(110 / this.bitmap.width, 96 / this.bitmap.height),
        );
    } else if (this._mossToad) {
      const dir = { 2: 0, 4: 1, 6: 2, 8: 3 }[this._character.direction()];
      this.setFrame(
        (this._character.isMoving() ? this._character.pattern() : 1) * 24,
        dir * 24,
        24,
        24,
      );
      const hopping = this._character.isMoving();
      const phase = Math.sin(Graphics.frameCount * 0.55);
      this.scale.set(
        1.6 * (hopping ? 1 + phase * 0.07 : 1),
        1.6 * (hopping ? 1 - phase * 0.1 : 1),
      );
    } else {
      this.scale.set(1);
      updateFrame.call(this);
    }
  };
  const characterPosition = Sprite_Character.prototype.updatePosition;
  Sprite_Character.prototype.updatePosition = function () {
    characterPosition.call(this);
    if (this._mossToad && this._character.isMoving() && !bridge.reduced)
      this.y -= Math.abs(Math.sin(Graphics.frameCount * 0.28)) * 9;
    if (this._mossEnemy && !bridge.reduced)
      this.y -= Math.sin(Graphics.frameCount / 30) * 2;
  };
  class MossHud extends Window_Base {
    constructor() {
      super(new Rectangle(12, 10, 936, 88));
      this.opacity = 0;
      this.contentsBack.fillRect(
        0,
        0,
        this.innerWidth,
        this.innerHeight,
        "rgba(13,28,32,0.92)",
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
      const guardian = $gameMap
        .events()
        .find((e) => e._encounterArt && !e._erased);
      this.y =
        guardian && guardian.screenY() > 0 && guardian.screenY() - 96 < 108
          ? Graphics.boxHeight - this.height - 10
          : 10;
      const key = `${bridge.revision}:${bridge.notice}:${bridge.paused}:${mapId}`;
      if (this._key === key) return;
      this._key = key;
      this.contents.clear();
      const location = bridge.celebrating
        ? Object.values(R.locations).find((place) => place.map === mapId)
        : R.locations[s.location];
      text(this, location.name, 6, 0, 610, 21, palette.gold);
      text(
        this,
        `${R.classes[s.classId].name}${s.curse ? " · TOAD CURSE" : ""}   HP ${s.hp}/${s.maxHp}   MP ${s.mp}/${s.maxMp}`,
        6,
        30,
        500,
        17,
      );
      text(
        this,
        bridge.practice
          ? `Practice ${s.practiceBalance} · Spent ${s.spent}`
          : `Used ${s.spent} GLOW`,
        640,
        0,
        260,
        18,
        palette.muted,
        "right",
      );
      text(
        this,
        bridge.paused ? "PAUSED" : bridge.notice || R.questHint(s),
        510,
        30,
        390,
        15,
        bridge.notice ? palette.red : palette.muted,
        "right",
      );
    }
  }
  const mapCreate = Scene_Map.prototype.createAllWindows;
  Scene_Map.prototype.createAllWindows = function () {
    mapCreate.call(this);
    this._mossHud = new MossHud();
    this.addWindow(this._mossHud);
  };
  const mapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    mapLoaded.call(this);
    if (bridge.snapshot) setWorldTone(bridge.snapshot.state);
    this._seenRevision = -1;
    this._wasRestored = bridge.snapshot?.state.restored.includes(
      bridge.snapshot.state.location,
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
      // Use the same artwork on the map and in battle, at a map-appropriate scale.
      if (slot === R.BOSS_ENCOUNTER) e._encounterArt = enemy.image;
    }
  }
  const mapUpdate = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    mapUpdate.call(this);
    const s = bridge.snapshot?.state;
    if (!s || SceneManager.isSceneChanging()) return;
    if (s.phase === "combat" && !$gameMessage.isBusy()) {
      SceneManager.push(battleScene());
      return;
    }
    if (
      ["victory", "defeat"].includes(s.phase) &&
      !bridge.celebrating &&
      !$gameMessage.isBusy()
    ) {
      SceneManager.goto(resultScene());
      return;
    }
    const target = bridge.celebrating
      ? $gameMap.mapId()
      : R.locations[s.location].map;
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
            (k) => R.locations[k].map === target,
          ),
        },
        90,
      );
      if (
        s.restored.includes(s.location) &&
        !this._wasRestored &&
        !this._restoredShown &&
        s.phase !== "victory"
      ) {
        this._restoredShown = true;
        notify(
          "Trailkeeper: Look! At last, the lanterns burn again. There may yet be a morning for Lantern Vale.",
        );
      }
    }
    if (bridge.danceUntil && Graphics.frameCount > bridge.danceUntil) {
      bridge.danceUntil = 0;
      $gameMap.autoplay();
    }
    if (bridge.danceUntil && Graphics.frameCount % 18 === 0) {
      const fairy = $gameMap
        .events()
        .find((e) => e.event().name.startsWith("Ilyra"));
      fairy?.setDirection(
        [2, 4, 8, 6][Math.floor(Graphics.frameCount / 18) % 4],
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
          [4.5, 14.5],
        ]) {
          const x = $gameMap.adjustX(tx) * 48,
            y = $gameMap.adjustY(ty) * 48;
          lamps.beginFill(0xffc36a, 0.075);
          lamps.drawCircle(x, y, 58);
          lamps.endFill();
          lamps.beginFill(0xffde90, 0.12);
          lamps.drawCircle(x, y, 24);
          lamps.endFill();
        }
      }
      if (bridge.dancing) {
        const x = $gameMap.adjustX(13.5) * 48,
          y = $gameMap.adjustY(5.5) * 48;
        const t = bridge.reduced ? 0 : Graphics.frameCount / 45;
        lamps.lineStyle(2, 0xb5f5d8, 0.38);
        lamps.drawEllipse(x, y, 78, 45);
        lamps.lineStyle(0);
        for (let i = 0; i < 8; i++) {
          const a = t + (i * Math.PI) / 4;
          lamps.beginFill(0xe6ffc1, 0.7);
          lamps.drawCircle(x + Math.cos(a) * 78, y + Math.sin(a) * 45, 3);
          lamps.endFill();
        }
      }
      const trailLamps = $gameMap
        .events()
        .filter((e) => e.event().note.startsWith("lantern"));
      const progress = forestLight(s, R.encounterLocations);
      for (const [index, e] of trailLamps.entries()) {
        const x = e.screenX(),
          y = e.screenY() - 20,
          lit =
            e.event().note === "lantern:always" ||
            progress > index / trailLamps.length;
        e._lanternLit = lit;
        lamps.beginFill(0x543f2d);
        lamps.drawRect(x - 2, y, 4, 22);
        lamps.endFill();
        lamps.beginFill(lit ? 0xffd477 : 0x8c8470);
        lamps.drawRect(x - 7, y - 15, 14, 17);
        lamps.endFill();
        lamps.beginFill(0x543f2d);
        lamps.drawPolygon([x - 9, y - 15, x, y - 21, x + 9, y - 15]);
        lamps.drawRect(x - 8, y + 1, 16, 3);
        lamps.endFill();
        if (lit) {
          lamps.beginFill(0xffcc66, 0.16);
          lamps.drawCircle(x, y - 5, 28);
          lamps.endFill();
        }
      }
      if (target === 5) {
        const x = $gameMap.adjustX(12.5) * 48,
          y = $gameMap.adjustY(11.5) * 48;
        g.lineStyle(2, 0xb84755, 0.9);
        g.drawCircle(x, y, 92);
        g.drawCircle(x, y, 78);
        for (let i = 0; i < 7; i++) {
          const a = (i * Math.PI * 2) / 7 - Math.PI / 2,
            b = ((i + 3) * Math.PI * 2) / 7 - Math.PI / 2;
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
          0x061b18,
          target === 5
            ? 0.13
            : 0.16 * (1 - forestLight(s, R.encounterLocations)),
        );
        g.drawRect(0, 0, 960, 720);
        g.endFill();
        for (let i = 1; i <= 6; i++) {
          g.beginFill(0x031610, 0.045);
          g.drawRect(0, 0, i * 10, 720);
          g.drawRect(960 - i * 10, 0, i * 10, 720);
          g.drawRect(0, 0, 960, i * 8);
          g.drawRect(0, 720 - i * 8, 960, i * 8);
          g.endFill();
        }
      }
      if (target !== 1 && !bridge.reduced) {
        for (let i = 0; i < 5; i++) {
          const t = Graphics.frameCount * 0.002;
          const x = (i * 137 + Math.sin(t + i) * 20) % 960,
            y = (i * 79 + Math.cos(t * 0.7 + i) * 22) % 720;
          g.beginFill(
            target === 5 ? 0xe27e65 : 0xcceca7,
            0.15 + 0.15 * Math.sin(t + i) ** 2,
          );
          g.drawCircle(x, y, 1.5);
          g.endFill();
        }
      }
    }
  };
}
