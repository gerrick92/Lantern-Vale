import { palette, text, lines, panel, Choices } from "./ui.js";
import { createNpcScenes } from "./npc-scenes.js";
import { createBattleScene } from "./battle.js";
import { installMapPresentation, forestLight } from "./map.js";
/*:
 * @target MZ
 * @plugindesc Mosslight: original maps, side-view battles and local rehearsal.
 * @author Mosslight
 * @help
 * Local rehearsal has no chain value or reward authority. Paid actions are
 * sent to the authenticated parent and only its server can advance them.
 */
(() => {
  "use strict";
  const R = MosslightRules;
  Graphics._defaultStretchMode = () => true;
  const printError = Graphics.printError;
  Graphics.printError = function (...args) {
    printError.apply(this, args);
    this._errorPrinter.style.pointerEvents = "auto";
  };
  const eraseError = Graphics.eraseError;
  Graphics.eraseError = function () {
    eraseError.call(this);
    if (this._errorPrinter) this._errorPrinter.style.pointerEvents = "none";
  };
  const bootStart = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    bootStart.call(this);
    if (!Graphics._errorPrinter.textContent.trim())
      Graphics._errorPrinter.style.pointerEvents = "none";
    Video._element.style.pointerEvents = "none";
    Graphics._canvas.tabIndex = 0;
    Graphics._canvas.setAttribute("aria-label", "Lantern Vale game controls");
    Graphics._canvas.addEventListener("pointerdown", () =>
      Graphics._canvas.focus(),
    );
  };
  const local =
    window.MOSSLIGHT_PRACTICE_ENABLED === true &&
    (["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) ||
      Utils.isNwjs()) &&
    (new URLSearchParams(location.search).get("practice") === "1" ||
      Utils.isNwjs());
  const SAVE = "lanternvale.local-rehearsal.v5";
  const switchFullscreen = Graphics._switchFullScreen;
  Graphics._switchFullScreen = function () {
    if (!local && parent !== window) {
      // Keep authenticated payment overlays inside the parent's fullscreen view.
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
  function choose(message, choices, callback) {
    notify(message);
    $gameMessage.setChoices(choices, choices.length - 1, choices.length - 1);
    $gameMessage.setChoiceCallback(callback);
  }
  function cost(tokens) {
    return bridge.practice
      ? `${tokens} practice token${tokens === 1 ? "" : "s"}`
      : `${tokens} GLOW`;
  }
  function save() {
    if (!bridge.practice || !bridge.snapshot) return;
    try {
      localStorage.setItem(SAVE, JSON.stringify(bridge.snapshot));
    } catch {
      bridge.notice = "Local saving is unavailable in this browser.";
    }
  }
  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(SAVE) || "null");
      return R.readPracticeSnapshot(value);
    } catch {
      return null;
    }
  }
  const bridge = (window.MosslightBridge = {
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
          "Trailkeeper: At last, the lanterns burn again. Thank you, wanderer. I had almost forgotten their warmth.",
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
          0,
        );
        return true;
      }
      if (
        !this.snapshot ||
        this.busy ||
        this.paused ||
        (this.cutscene && !sceneAction) ||
        (this.animating && !this.resolving)
      )
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
        const expire = () => {
          this.busy = false;
          this.pending = null;
          this.notice =
            "The server did not respond. Refresh the saved state in the companion.";
          resolve(false);
        };
        // Wallet approval and a future beacon take longer than ordinary actions.
        // The parent renews this timer only for the matching payment review.
        const priced = R.paymentItem(intent) !== undefined;
        const timer = setTimeout(expire, priced ? 180000 : 10000);
        this.pending = {
          resolve,
          timer,
          version: this.snapshot.version,
          requestId,
          priced,
          expire,
        };
        parent.postMessage(
          {
            type: "mosslight.intent",
            nonce: this.nonce,
            roundId: this.roundId,
            requestId,
            intent,
          },
          location.origin,
        );
      });
    },
    publish() {
      if (this.practice && parent !== window)
        parent.postMessage(
          {
            type: "mosslight.practice-state",
            snapshot: this.snapshot,
            notice: this.notice,
          },
          location.origin,
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
          },
        );
      if (!(await this.intent({ type: "visit", place })))
        return notify(this.notice);
      if (place === "inn")
        return choose(
          `Nessa: The mountain has swallowed our dawn. Defeat its guardian and bring back the light.\nRest and curse cure: ${cost(1, 8)}.`,
          ["Rest and remove curses", "Tell me about the woods", "Leave"],
          (i) => {
            if (i === 0) this.story({ type: "rest" });
            if (i === 1)
              notify(
                "Nessa: Seven nights without a sunrise. The trail lanterns went cold first; then the birds stopped singing. My brother still tends them in the woods. He refuses to come home while they are dark.",
              );
          },
        );
      const items = Object.entries(R.shopItems)
        .map(([id]) => [id, R.shopItemFor(this.snapshot.state.classId, id)])
        .filter(([, v]) => v.vendor === place);
      choose(
        `${place === "magic" ? "Elowen: Knowledge travels lighter than steel." : place === "item" ? "Pip: A tonic for your courage?" : "Rowan: Something sturdy for the road?"}\nChoose supplies. Gear equips immediately.`,
        [
          ...items.map(
            ([id, v]) =>
              `${v.name.replace(" Grimoire", "")} · ${this.snapshot.state.spells.includes(id) ? "Learned" : cost(v.cost, v.gold)}`,
          ),
          "Leave",
        ],
        (i) => {
          if (items[i]) this.story({ type: "buy", item: items[i][0] });
        },
      );
    },
    equipment() {
      choose(
        "Rowan: Steel for your hand, barkweave for your heart.",
        ["Weapons", "Armor", "Leave"],
        (i) => {
          if (i < 2) this.visit(i === 0 ? "weapon" : "armor");
        },
      );
    },
    dancer() {
      if (this.snapshot.state.dancerDone)
        return notify("Vesper: One lesson per customer, darling.");
      choose(
        `Vesper: Pay me ${cost(1, 8)} and I will follow you to your room.\nHer smile is suspiciously theatrical.`,
        ["Accept the offer", "Keep my coin"],
        (i) => {
          if (i === 0) stageDancer();
        },
      );
    },
    fairy() {
      if (this.snapshot.state.fairyDone)
        return notify(
          "Ilyra: Such a fine little voice. Sing for the moon, wanderer.",
        );
      choose(
        `Ilyra: One dance upon the moonlit shore for ${cost(1, 8)}?\nSomething strange stirs beneath the water.`,
        ["Dance with Ilyra", "Decline politely"],
        (i) => {
          if (i === 0) {
            stageFairy();
          }
        },
      );
    },
    puzzle() {
      choose(
        "Three stones listen. Which light borrows from the sun?",
        ["The moon", "The sun", "The flame", "Leave"],
        (i) => {
          if (i < 3)
            this.story({ type: "puzzle", answer: ["moon", "sun", "flame"][i] });
        },
      );
    },
  });

  const { stageDancer, stageFairy } = createNpcScenes({ bridge, R, notify });
  function entrance(place, from) {
    if (place === "inn") return [12, 18];
    if (place === "clearing") return from === 1 ? [7, 12] : [17, 2];
    if (place === "forest1") return from > 3 ? [17, 2] : [17, 36];
    if (place === "forest2") return from === 5 ? [17, 8] : [17, 36];
    return [12, 20];
  }
  function setWorldTone(state, duration = 0) {
    const bright = state.restored.includes(state.location);
    const progress = forestLight(state, R.encounterLocations);
    $gameScreen.startTint(
      bright
        ? [8, 3, -8, 0]
        : state.location === "inn"
          ? [8, 0, -12, 0]
          : state.location === "shrine"
            ? [-55, -60, -25, 50]
            : ["forest1", "forest2"].includes(state.location)
              ? [
                  -86 + progress * 94,
                  -90 + progress * 93,
                  -40 + progress * 32,
                  65 * (1 - progress),
                ]
              : [-68, -72, -30, 55],
      duration,
    );
  }
  function acceptPaidSnapshot(snapshot) {
    if (
      snapshot?.state?.mode !== "paid" ||
      snapshot.state.rulesVersion !== 5 ||
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.version < 0 ||
      !R.classIds.includes(snapshot.state.classId) ||
      (bridge.snapshot && snapshot.version < bridge.snapshot.version) ||
      (bridge.deferredSnapshot &&
        snapshot.version < bridge.deferredSnapshot.version)
    )
      return false;
    if (bridge.deferOutcome) {
      bridge.deferredSnapshot = snapshot;
      return true;
    }
    bridge.snapshot = snapshot;
    bridge.revision++;
    return true;
  }
  window.addEventListener("message", (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      parent === window
    )
      return;
    const data = event.data;
    if (
      !local &&
      !bridge.snapshot &&
      data?.type === "mosslight.entry-options" &&
      typeof data.nonce === "string"
    ) {
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
      if (
        data?.type === "mosslight.practice-demo" &&
        !bridge.busy &&
        !bridge.cutscene &&
        R.demoScenarios.includes(data.scenario)
      ) {
        bridge.celebrating = false;
        bridge.snapshot = {
          state: R.practiceDemo(
            bridge.snapshot?.state?.classId || "warrior",
            data.scenario,
          ),
          version: 0,
        };
        bridge.revision++;
        save();
        enterGame(true);
      }
      if (
        data?.type === "mosslight.practice-start" &&
        R.classIds.includes(data.classId) &&
        ["Scene_Title", "Scene_MossClass", "Scene_MossResult"].includes(
          SceneManager._scene?.constructor.name,
        )
      ) {
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
      if (
        pending?.priced &&
        data.nonce === bridge.nonce &&
        data.roundId === bridge.roundId &&
        data.requestId === pending.requestId
      ) {
        clearTimeout(pending.timer);
        pending.timer = setTimeout(pending.expire, 45000);
      }
      return;
    }
    if (data?.type === "mosslight.action-result") {
      const pending = bridge.pending;
      if (
        !pending ||
        data.nonce !== bridge.nonce ||
        data.roundId !== bridge.roundId ||
        data.requestId !== pending.requestId
      )
        return;
      const accepted =
        data.accepted === true &&
        data.snapshot?.version > pending.version &&
        acceptPaidSnapshot(data.snapshot);
      clearTimeout(pending.timer);
      bridge.pending = null;
      bridge.busy = false;
      if (!accepted)
        bridge.notice =
          typeof data.error === "string"
            ? data.error.slice(0, 240)
            : "The action could not be completed. Refresh the saved state and try again.";
      pending.resolve(accepted);
      return;
    }
    if (
      data?.type !== "mosslight.state" ||
      typeof data.nonce !== "string" ||
      typeof data.roundId !== "string" ||
      (bridge.nonce && data.nonce !== bridge.nonce) ||
      (bridge.roundId && data.roundId !== bridge.roundId)
    )
      return;
    bridge.nonce = data.nonce;
    bridge.roundId = data.roundId;
    bridge.paused = data.paused === true;
    bridge.reduced = data.reduced === true;
    AudioManager.bgmVolume = data.mute ? 0 : 60;
    AudioManager.seVolume = data.mute ? 0 : 60;
    AudioManager.meVolume = data.mute ? 0 : 60;
    // Preferences and background refreshes do not acknowledge an action.
    acceptPaidSnapshot(data.snapshot);
  });
  const boot = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    boot.call(this);
    parent.postMessage({ type: "mosslight.ready" }, location.origin);
  };
  // Authored region collision is visual navigation only, never paid progression.
  const passage = Game_Map.prototype.checkPassage;
  Game_Map.prototype.checkPassage = function (x, y, bit) {
    const region = this.regionId(x, y);
    if (region === 255) return false;
    if (region === 254) return true;
    return passage.call(this, x, y, bit);
  };
  const canMove = Game_Player.prototype.canMove;
  Game_Player.prototype.canMove = function () {
    return (
      !bridge.paused && !bridge.busy && !bridge.cutscene && canMove.call(this)
    );
  };
  Window_TitleCommand.prototype.makeCommandList = function () {
    this.addCommand(
      local ? "New Game · local rehearsal" : "Begin / resume paid adventure",
      "newGame",
      local || !!bridge.snapshot || entryOptions?.enabled === true,
    );
    if (local) this.addCommand("Continue rehearsal", "continue", !!load());
    this.addCommand("Options", "options");
  };
  const titleCreate = Scene_Title.prototype.create;
  Scene_Title.prototype.create = function () {
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
      "center",
    );
    text(
      w,
      "The mountain has swallowed the dawn.",
      0,
      56,
      w.innerWidth,
      22,
      palette.ink,
      "center",
    );
    text(
      w,
      local
        ? "LOCAL REHEARSAL · Practice tokens only · No wallet required"
        : "Open a paid adventure from the Lantern Vale website to begin.",
      0,
      92,
      w.innerWidth,
      18,
      palette.muted,
      "center",
    );
  };
  const titleUpdate = Scene_Title.prototype.update;
  Scene_Title.prototype.update = function () {
    titleUpdate.call(this);
    if (
      !local &&
      bridge.snapshot &&
      !bridge.paused &&
      this.isStarted() &&
      !SceneManager.isSceneChanging()
    ) {
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
    const s = bridge.snapshot.state,
      c = R.classes[s.classId];
    $gameParty
      .leader()
      .setCharacterImage(
        s.boon === "wild" ? "Monster" : c.character,
        s.boon === "wild" ? 1 : c.index,
      );
    $gamePlayer.refresh();
  }
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
        0,
      );
    }
    SceneManager.goto(Scene_Map);
    bridge.publish();
  }
  function beginPractice(classId) {
    bridge.celebrating = false;
    bridge.snapshot = {
      state: R.initialState(classId, false, {
        mode: "practice",
        seed: crypto.getRandomValues(new Uint32Array(1))[0],
      }),
      version: 0,
    };
    bridge.revision++;
    save();
    enterGame(false);
  }
  Scene_Title.prototype.commandNewGame = function () {
    this._commandWindow.close();
    if (local || entryOptions?.enabled) SceneManager.goto(Scene_MossClass);
    else if (bridge.snapshot) enterGame(true);
  };
  Scene_Title.prototype.commandContinue = function () {
    bridge.snapshot = load();
    if (bridge.snapshot) {
      bridge.revision++;
      enterGame(true);
    }
  };
  class ClassCommands extends Window_Command {
    makeCommandList() {
      for (const id of R.classIds) this.addCommand(R.classes[id].name, id);
    }
    itemHeight() {
      return 58;
    }
  }
  class Scene_MossClass extends Scene_MenuBase {
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
        palette.gold,
      );
      text(
        this._heading,
        local
          ? "Your class is locked for this journey. Confirming spends 1 of 30 practice tokens."
          : "Choose your class, then review the 1 GLOW entry in your wallet.",
        0,
        48,
        840,
        18,
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
        "↑ ↓ Choose   Enter Confirm   Esc Back",
        0,
        0,
        840,
        20,
        palette.muted,
      );
      text(
        this._footer,
        local
          ? "Practice funds reset each new game. No GLOW is spent or earned."
          : "Your adventure begins only after the server verifies your Sepolia payment.",
        0,
        35,
        840,
        18,
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
        // MZ otherwise expands an asynchronously loaded bitmap to the full atlas.
        this._hero.setFrame(0, 0, 0, 0);
        this._hero.visible = false;
      }
      if (this._hero.bitmap?.isReady()) {
        const bitmap = this._hero.bitmap,
          w = bitmap.width / 9,
          h = bitmap.height / 6,
          frame = bridge.reduced ? 1 : Math.floor(Graphics.frameCount / 15) % 3;
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
        local
          ? `Begin as ${R.classes[id].name} · 1 practice token`
          : `Review ${R.classes[id].name} entry · 1 GLOW`,
        "yes",
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
              classId: id,
            },
            location.origin,
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
  // An original code-drawn toad replaces the walking sprite while cursed.
  installMapPresentation({
    bridge,
    R,
    setWorldTone,
    entrance,
    applyHero,
    notify,
    battleScene: () => Scene_MossBattle,
    resultScene: () => Scene_MossResult,
  });
  const Scene_MossBattle = createBattleScene({
    bridge,
    R,
    resultScene: () => Scene_MossResult,
  });
  class Scene_MossResult extends Scene_MenuBase {
    create() {
      super.create();
      const s = bridge.snapshot.state,
        won = s.phase === "victory";
      AudioManager.stopBgm();
      AudioManager.playMe({
        name: won ? "Victory1" : "Defeat1",
        volume: 50,
        pitch: 100,
        pan: 0,
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
        "center",
      );
      let y = 86;
      y +=
        lines(
          w,
          won
            ? "The hollow mountain releases its breath. Below, the inn windows glow like small suns. Nessa will have a story to tell."
            : "The woods are patient. Rest, learn their secrets, and return with a different plan.",
          20,
          y,
          700,
          23,
        ) + 25;
      if (bridge.practice) {
        y +=
          lines(
            w,
            `LOCAL REHEARSAL · ${s.spent} practice tokens spent. ${won ? s.refunded : 0} returned. Bonus: ${s.bonus}. Balance: ${s.practiceBalance}.`,
            20,
            y,
            700,
            22,
          ) + 16;
        lines(
          w,
          "No GLOW was spent or earned. Start another rehearsal whenever you like.",
          20,
          y,
          700,
          20,
        );
      } else
        lines(
          w,
          won
            ? "Victory recorded by the server. Use the website companion to request an eligible reward."
            : "This paid round has ended without a reward.",
          20,
          y,
          700,
          22,
        );
      this._commandWindow = new Choices(new Rectangle(260, 535, 440, 160));
      this._commandWindow.clearCommandList();
      this._commandWindow.addCommand(
        bridge.practice ? "Return to title · play again" : "Return to title",
        "title",
      );
      if (won)
        this._commandWindow.addCommand("Return to the sunlit inn", "home");
      this._commandWindow.setHandler("home", () => {
        bridge.celebrating = true;
        $gamePlayer.reserveTransfer(1, 12, 17, 8, 0);
        SceneManager.goto(Scene_Map);
      });
      this._commandWindow.refresh();
      this._commandWindow.setHandler("title", () =>
        SceneManager.goto(Scene_Title),
      );
      this.addWindow(this._commandWindow);
      save();
      bridge.publish();
    }
  }
})();
