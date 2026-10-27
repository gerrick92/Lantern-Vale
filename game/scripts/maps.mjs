export function buildMaps({ R, floorTable, write }) {
  const B = (x, y) => (x >= 8 ? 128 : 0) + y * 8 + (x % 8);
  function makeMap(id, tilesetId, name, music, width = 25, height = 21) {
    const data = Array(width * height * 6).fill(0),
      events = [null];
    const set = (x, y, z, tile) => {
      if (x >= 0 && x < width && y >= 0 && y < height)
        data[(z * height + y) * width + x] = tile;
    };
    const get = (x, y, z = 0) =>
      x < 0 || y < 0 || x >= width || y >= height
        ? -1
        : data[(z * height + y) * width + x];
    const rect = (x, y, w, h, tile, z = 0) => {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) set(xx, yy, z, tile);
    };
    const object = (x, y, sx, sy, w = 1, h = 1, block = true, sheet = 0) => {
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          set(x + dx, y + dy, 2, B(sx + dx, sy + dy) + sheet);
          if (block) set(x + dx, y + dy, 5, 255);
        }
    };
    const walk = (x, y, w = 1, h = 1) => rect(x, y, w, h, 254, 5);
    function event(name, x, y, script, options = {}) {
      const eventId = events.length;
      events.push({
        id: eventId,
        name,
        x,
        y,
        note: options.note || "",
        pages: [
          {
            conditions: {
              actorId: 1,
              actorValid: false,
              itemId: 1,
              itemValid: false,
              selfSwitchCh: "A",
              selfSwitchValid: false,
              switch1Id: 1,
              switch1Valid: false,
              switch2Id: 1,
              switch2Valid: false,
              variableId: 1,
              variableValid: false,
              variableValue: 0,
            },
            directionFix: !!options.door,
            image: {
              tileId: 0,
              characterName: options.character ?? "People2",
              characterIndex: options.index ?? 0,
              direction: options.openDoor ? 6 : 2,
              pattern: options.door ? 0 : 1,
            },
            list: [
              { code: 355, indent: 0, parameters: [script] },
              { code: 0, indent: 0, parameters: [] },
            ],
            moveFrequency: 3,
            moveRoute: {
              list: [{ code: 0, parameters: [] }],
              repeat: true,
              skippable: true,
              wait: false,
            },
            moveSpeed: 2,
            moveType: options.wander ? 1 : 0,
            priorityType: options.floor ? 0 : 1,
            stepAnime: !options.door,
            through: !!options.floor,
            trigger: options.touch ? 1 : 0,
            walkAnime: true,
          },
        ],
      });
      if (get(x, y, 5) !== 254 && !options.scenery)
        throw new Error(`Event ${name} overlaps solid scenery at ${x},${y}`);
      return eventId;
    }
    function exit(x, y, destination) {
      event(
        `Road to ${destination}`,
        x,
        y,
        `MosslightBridge.intent({type:'move',destination:'${destination}'});`,
        { character: "", floor: true, touch: true },
      );
    }
    function smooth(z = 0) {
      const original = data.slice();
      const same = (x, y, tile) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return true;
        return original[(z * height + y) * width + x] === tile;
      };
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const t = original[(z * height + y) * width + x];
          if (t < 2048) continue;
          const kind = Math.floor((t - 2048) / 48),
            l = same(x - 1, y, t),
            r = same(x + 1, y, t),
            u = same(x, y - 1, t),
            d = same(x, y + 1, t);
          let shape;
          if ((t >= 4352 && t < 5888) || (t >= 5888 && kind % 16 >= 8))
            shape = (!l ? 1 : 0) + (!u ? 2 : 0) + (!r ? 4 : 0) + (!d ? 8 : 0);
          else {
            const q = [
              l && u
                ? same(x - 1, y - 1, t)
                  ? [2, 4]
                  : [2, 0]
                : [l ? 2 : 0, u ? 4 : 2],
              r && u
                ? same(x + 1, y - 1, t)
                  ? [1, 4]
                  : [3, 0]
                : [r ? 1 : 3, u ? 4 : 2],
              l && d
                ? same(x - 1, y + 1, t)
                  ? [2, 3]
                  : [2, 1]
                : [l ? 2 : 0, d ? 3 : 5],
              r && d
                ? same(x + 1, y + 1, t)
                  ? [1, 3]
                  : [3, 1]
                : [r ? 1 : 3, d ? 3 : 5],
            ];
            shape = floorTable.findIndex(
              (value) => JSON.stringify(value) === JSON.stringify(q),
            );
            if (shape < 0) shape = 0;
          }
          set(x, y, z, t + shape);
        }
    }
    const save = () => {
      smooth();
      smooth(1);
      write(`data/Map${String(id).padStart(3, "0")}.json`, {
        autoplayBgm: true,
        autoplayBgs: false,
        battleback1Name: "",
        battleback2Name: "",
        bgm: { name: music, pan: 0, pitch: 100, volume: 38 },
        bgs: { name: "", pan: 0, pitch: 100, volume: 0 },
        disableDashing: false,
        displayName: name,
        encounterList: [],
        encounterStep: 30,
        height,
        note: "Fresh Mosslight map. Region 254: authored walkway; 255: solid scenery. Paid progress is never determined by map position.",
        parallaxLoopX: false,
        parallaxLoopY: false,
        parallaxName: "",
        parallaxShow: true,
        parallaxSx: 0,
        parallaxSy: 0,
        scrollType: 0,
        specifyBattleback: false,
        tilesetId,
        width,
        data,
        events,
      });
    };
    return { set, get, rect, object, walk, event, exit, save };
  }
  const inn = makeMap(1, 3, R.locations.inn.name, "Town4");
  inn.rect(0, 0, 25, 21, 1536);
  inn.rect(0, 0, 25, 21, 255, 5);
  inn.rect(2, 5, 21, 14, 1553);
  inn.walk(2, 5, 21, 14);
  function wall(x, y, w, h) {
    inn.rect(x, y, w, h, 7088);
    inn.rect(x, y, w, h, 255, 5);
  }
  wall(1, 2, 23, 3);
  wall(1, 5, 1, 15);
  wall(23, 5, 1, 15);
  wall(2, 19, 21, 1);
  wall(8, 5, 1, 6);
  wall(2, 10, 6, 1);
  inn.rect(6, 10, 1, 1, 1553);
  inn.walk(6, 10);
  inn.event("Bedroom doorway", 6, 10, "", {
    character: "!Door1",
    door: true,
    openDoor: true,
    floor: true,
  });
  inn.object(3, 5, 8, 5, 1, 2);
  inn.object(5, 5, 14, 3, 2, 2);
  inn.event(
    "A book beside the bed",
    5,
    6,
    "MosslightBridge.story({type:'clue'});",
    { character: "", scenery: true },
  );
  // A private guest room opens onto the common room through a real doorway.
  inn.object(3, 3, 0, 8, 2, 1);
  inn.object(6, 3, 4, 8);
  inn.rect(3, 7, 3, 2, 3344);
  inn.object(2, 8, 8, 10);
  inn.set(2, 8, 3, B(1, 1) + 256);
  inn.object(7, 5, 7, 10, 1, 1, true, 256);
  // The hearth, reception and bar occupy complete, separate furniture assemblies.
  inn.object(10, 3, 4, 8);
  inn.object(13, 3, 10, 0, 2, 1);
  inn.object(15, 3, 13, 7, 3, 2);
  inn.object(21, 3, 5, 8);
  inn.object(10, 5, 8, 0, 2, 1);
  inn.object(13, 5, 11, 1, 1, 2);
  inn.object(11, 8, 0, 14, 2, 1);
  inn.set(11, 8, 3, B(4, 8) + 256);
  inn.set(12, 8, 3, B(1, 1) + 256);
  // Small woven rugs define welcoming corners without a hallway-sized carpet.
  inn.rect(11, 9, 3, 3, 3344);
  inn.rect(2, 16, 5, 3, 3344);
  inn.rect(18, 16, 5, 3, 3344);
  inn.rect(14, 7, 4, 4, 3200);
  inn.event("Nessa · innkeeper", 12, 7, "MosslightBridge.visit('inn');", {
    index: 0,
  });
  // Complete cabinet, counter and piano assemblies, with a free tile for each merchant.
  inn.object(18, 5, 12, 1, 4, 2);
  inn.object(18, 8, 8, 8, 2, 1);
  inn.object(20, 8, 8, 8, 2, 1);
  inn.event("Pip · item bar", 20, 7, "MosslightBridge.visit('item');", {
    character: "People1",
    index: 2,
  });
  // A bookseller's alcove and an armourer's workbench frame the lower hall.
  inn.object(2, 11, 13, 3, 3, 2);
  inn.object(7, 12, 6, 8, 1, 1, true, 256);
  inn.object(7, 13, 7, 10, 1, 1, true, 256);
  inn.object(3, 14, 0, 14, 2, 1);
  inn.set(3, 14, 3, B(4, 8) + 256);
  inn.set(4, 14, 3, B(2, 1) + 256);
  inn.event("Elowen · spell books", 4, 13, "MosslightBridge.visit('magic');", {
    character: "People1",
    index: 6,
  });
  wall(18, 10, 5, 2);
  inn.object(19, 11, 2, 10, 2, 1);
  inn.object(21, 11, 2, 11);
  inn.object(21, 13, 10, 2, 1, 1, true, 256);
  inn.object(18, 14, 0, 14, 2, 1);
  inn.set(18, 14, 3, B(8, 0) + 256);
  inn.set(19, 14, 3, B(11, 1) + 256);
  inn.event("Rowan · equipment", 19, 13, "MosslightBridge.equipment();", {
    index: 6,
  });
  inn.object(19, 16, 13, 9, 3, 2);
  // Complete dining tables, stools, food and cups; none obstruct the main aisle.
  for (const [x, y] of [
    [3, 17],
    [8, 14],
    [15, 15],
  ]) {
    inn.object(x, y, 0, 14, 2, 1);
    inn.object(x, y + 1, 0, 15);
    inn.object(x + 1, y - 1, 0, 15);
    inn.set(x, y, 3, B(1, 4) + 256);
    inn.set(x + 1, y, 3, B(0, 0) + 256);
  }
  inn.object(2, 16, 0, 15);
  inn.object(22, 16, 7, 10, 1, 1, true, 256);
  inn.object(10, 18, 6, 10, 1, 1, true, 256);
  inn.object(14, 18, 6, 10, 1, 1, true, 256);
  inn.object(15, 5, 5, 12, 1, 2);
  inn.object(17, 5, 5, 12, 1, 2);
  inn.object(18, 3, 15, 0);
  inn.object(9, 3, 11, 0, 2, 1);
  inn.object(2, 15, 7, 10, 1, 1, true, 256);
  inn.object(22, 12, 13, 10);
  inn.object(21, 12, 12, 10);
  // A writing desk and a travelling musician give the room a lived-in purpose.
  inn.object(9, 17, 0, 14, 1, 1);
  inn.set(9, 17, 3, B(3, 9) + 256);
  inn.event(
    "A traveller's unfinished letter",
    9,
    17,
    "MosslightBridge.readNote('Dear Mara, the road is dark, but Nessa keeps the hearth lit. Follow the old lanterns north. I will wait where the listening stones stand.');",
    { character: "", scenery: true },
  );
  inn.event(
    "Travelling musician",
    18,
    17,
    "MosslightBridge.readNote('A quiet melody for a long night. When the dawn returns, I will play something worth dancing to.');",
    { character: "People2", index: 5 },
  );
  inn.event("Hearth fire", 16, 4, "", {
    character: "!Flame",
    index: 0,
    floor: true,
    scenery: true,
  });
  inn.event("Vesper · dancer", 16, 9, "MosslightBridge.dancer();", {
    character: "Actor2",
    index: 5,
  });
  inn.rect(12, 19, 1, 2, 1553);
  inn.walk(12, 19, 1, 2);
  inn.event(
    "Road to clearing",
    12,
    19,
    "MosslightBridge.intent({type:'move',destination:'clearing'});",
    {
      character: "!Door1",
      door: true,
      openDoor: true,
      floor: true,
      touch: true,
    },
  );
  inn.save();
  function trees(m, width, height) {
    const free = (x, y) =>
      x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height &&
      m.get(x, y) === 2816 &&
      m.get(x, y, 5) === 255 &&
      m.get(x, y, 2) === 0;
    // Whole crowns AND trunks from Outside_B. Never substitute the flat A4 leaf texture.
    const candidates = [];
    for (let y = 0; y < height - 1; y++)
      for (let x = 0; x < width; x++) candidates.push([x, y]);
    const order = (x, y) =>
      (Math.imul(x + 13, 374761393) ^ Math.imul(y + 71, 668265263)) >>> 0;
    candidates.sort((a, b) => order(...a) - order(...b));
    for (const [x, y] of candidates) {
      if (!free(x, y) || !free(x, y + 1)) continue;
      if (free(x + 1, y) && free(x + 1, y + 1)) {
        m.object(x, y, 8, 6, 2, 2);
        // Tree shade anchors the trunks to the ground instead of a bright lawn.
        m.set(x, y + 1, 4, 3);
        m.set(x + 1, y + 1, 4, 3);
      } else if (order(x, y) % 4 !== 0) {
        m.object(x, y, 13, 3, 1, 2);
        m.set(x, y + 1, 4, 3);
      }
    }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (free(x, y)) {
          const detail = order(x, y) % 7;
          if (detail < 3) m.object(x, y, 9, 3);
          else if (detail === 3) m.object(x, y, 12, 3);
          else if (detail === 4) m.object(x, y, 15, 3);
          else m.object(x, y, 8, 3);
        }
  }
  const clearing = makeMap(2, 2, R.locations.clearing.name, "Field2", 25, 23);
  clearing.rect(0, 0, 25, 23, 2816);
  clearing.rect(0, 0, 25, 23, 255, 5);
  clearing.rect(5, 11, 14, 7, 2816);
  for (let y = 11; y <= 15; y++) {
    const start = 6 + Math.max(0, y - 12) * 2;
    clearing.rect(start, y, 18 - start, 1, 2864);
  }
  clearing.walk(5, 11, 14, 7);
  clearing.rect(16, 0, 3, 18, 2864);
  clearing.walk(16, 0, 3, 18);
  clearing.rect(4, 6, 7, 3, 4592);
  clearing.rect(4, 9, 7, 2, 4976);
  clearing.object(4, 9, 0, 12, 2, 1);
  clearing.object(8, 9, 0, 12, 1, 1);
  clearing.object(9, 9, 6, 8);
  clearing.object(10, 8, 8, 0);
  clearing.object(5, 10, 8, 4, 1, 1, false);
  clearing.object(9, 10, 9, 4, 1, 1, false);
  clearing.walk(7, 10);
  clearing.event(
    "Road to inn",
    7,
    10,
    "MosslightBridge.intent({type:'move',destination:'inn'});",
    { character: "!Door1", door: true, touch: true },
  );
  clearing.rect(4, 2, 6, 3, 2048);
  clearing.rect(5, 5, 4, 1, 2048);
  clearing.walk(11, 3, 5, 8);
  clearing.event(
    "Ilyra · fairy of the moonwell",
    11,
    4,
    "MosslightBridge.fairy();",
    { character: "Nature", index: 6 },
  );
  clearing.object(15, 9, 12, 1);
  clearing.event(
    "Moonwell inscription",
    15,
    9,
    "MosslightBridge.story({type:'clue'});",
    { character: "", scenery: true },
  );
  for (let x = 16; x <= 18; x++) clearing.exit(x, 0, "forest1");
  // Flowers and seating frame the pond and the inn without hiding the dance floor.
  clearing.object(5, 15, 8, 4, 1, 1, false);
  clearing.object(6, 16, 8, 4, 1, 1, false);
  clearing.object(8, 16, 9, 4, 1, 1, false);
  clearing.object(11, 10, 8, 4, 1, 1, false);
  clearing.object(14, 10, 9, 4, 1, 1, false);
  clearing.object(5, 13, 11, 1);
  clearing.object(5, 14, 11, 2);
  clearing.object(18, 15, 12, 4);
  clearing.object(18, 16, 11, 3);
  clearing.object(4, 1, 8, 4, 1, 1, false);
  clearing.object(9, 1, 9, 4, 1, 1, false);
  clearing.object(5, 4, 14, 15, 1, 1, false);
  clearing.object(8, 3, 15, 15, 1, 1, false);
  // A garden, bench and supplies connect the inn to the working woodland village.
  clearing.object(6, 17, 12, 4, 1, 1, false);
  clearing.object(8, 17, 12, 3, 1, 1, false);
  clearing.object(4, 12, 13, 1);
  clearing.object(3, 11, 12, 2);
  clearing.object(3, 10, 13, 2);
  clearing.object(10, 12, 11, 4, 1, 1, false);
  clearing.object(11, 13, 8, 4, 1, 1, false);
  clearing.object(12, 14, 9, 4, 1, 1, false);
  clearing.event("Inn lantern", 8, 11, "", {
    character: "",
    floor: true,
    note: "lantern:always",
  });
  clearing.event(
    "Northbound signpost",
    19,
    12,
    "MosslightBridge.readNote('North: Whispering Boughs. Beyond the listening stones: the mountain shrine.');",
    { character: "", scenery: true },
  );
  clearing.object(19, 12, 9, 1);
  for (const [x, y] of [
    [3, 12],
    [20, 10],
    [20, 18],
    [10, 19],
  ])
    clearing.object(x, y, 15, 3);
  trees(clearing, 25, 23);
  clearing.save();
  function forest(id, key) {
    const w = 35,
      h = 39,
      m = makeMap(id, 2, R.locations[key].name, "Dungeon2", w, h);
    m.rect(0, 0, w, h, 2816);
    m.rect(0, 0, w, h, 255, 5);
    const center = (y) => 17 + Math.round(Math.sin(y * 0.19 + id) * 5);
    for (let y = 2; y < h; y++) {
      const x = center(y);
      m.rect(x - 1, y, 3, 1, 2864);
      m.walk(x - 1, y, 3, 1);
    }
    m.rect(10, 35, 13, 4, 2864);
    m.walk(10, 35, 13, 4);
    if (key === "forest1") {
      m.rect(15, 0, 8, 4, 2864);
      m.walk(15, 0, 8, 4);
      m.rect(1, 13, 4, 6, 2048);
      m.rect(3, 16, 3, 5, 2048);
      m.object(2, 15, 14, 15, 1, 1, false);
      m.object(4, 18, 15, 15, 1, 1, false);
      m.object(5, 13, 15, 3);
      m.object(6, 18, 12, 4);
      const campX = center(24) + 2;
      m.rect(campX, 23, 4, 4, 2816);
      m.walk(campX, 23, 4, 4);
      m.object(campX + 2, 24, 11, 2);
      m.object(campX + 1, 26, 12, 4);
      m.object(campX + 3, 23, 12, 3);
      m.event(
        "Cold campfire",
        campX + 2,
        24,
        "MosslightBridge.readNote('The ashes are cold. Someone left in a hurry. Pale flowers grow against the western trees.');",
        { character: "", scenery: true },
      );
    }
    // An optional glade with the listening stones lies off the second trail.
    if (key === "forest2") {
      m.rect(7, 20, 13, 5, 2864);
      m.walk(7, 20, 13, 5);
      for (const x of [8, 11, 14]) {
        m.object(x, 21, 12, 1);
        m.event("Listening stone", x, 21, "MosslightBridge.puzzle();", {
          character: "",
          scenery: true,
        });
      }
      m.object(8, 24, 8, 4, 1, 1, false);
      m.object(14, 24, 9, 4, 1, 1, false);
      m.object(6, 22, 15, 3);
      m.rect(0, 0, w, 7, 2816);
      m.rect(0, 0, w, 7, 255, 5);
      for (let x = 9; x <= 26; x++) {
        const front = 4 + (x > 11 && x < 24 ? 2 : 0);
        m.rect(x, 0, 1, front - 1, 7616);
        m.rect(x, front - 1, 1, 2, 8000);
        m.rect(x, 0, 1, front + 1, 255, 5);
      }
      m.rect(15, 7, 9, 3, 2864);
      m.walk(15, 7, 9, 3);
      // A complete one-person arch sits in the rock face.
      m.object(17, 5, 9, 4, 1, 2, false, 256);
      m.walk(17, 5, 1, 3);
      m.exit(17, 6, "shrine");
    }
    // Small woodland vignettes break up the tree line without opening bypass lanes.
    for (const y of [6, 12, 19, 26, 32]) {
      const x = center(y);
      const side = y % 2 ? -1 : 1;
      if (m.get(x + side * 3, y, 5) === 255 && m.get(x + side * 3, y) === 2816)
        m.object(x + side * 3, y, y % 3 === 0 ? 12 : 15, y % 3 === 0 ? 4 : 3);
      m.object(x - side, y + 1, y % 2 ? 9 : 8, 4, 1, 1, false);
    }
    trees(m, w, h);
    if (key === "forest1") {
      // Concealed under intact tree crowns; no visible cut-out lane in the canopy.
      m.walk(7, 3, 1, 31);
      m.walk(7, 33, 11, 1);
      m.walk(7, 3, 12, 1);
      // Clue flowers sit over the ground layer, preserving every complete tree crown.
      for (const [x, y] of [
        [16, 33],
        [7, 33],
        [7, 4],
        [7, 3],
        [11, 3],
        [15, 3],
      ])
        m.set(x, y, 3, B(8, 4));
      m.event(
        "Pale-flower passage",
        7,
        33,
        "MosslightBridge.intent({type:'shortcut'});",
        { character: "", floor: true, touch: true },
      );
      // Every open edge tile must transfer, including the right side of the broad road.
      for (let x = 15; x <= 22; x++) m.exit(x, 0, "forest2");
    }
    const slots = R.encounterLocations
      .map((p, i) => (p === key ? i : -1))
      .filter((i) => i >= 0);
    for (const [i, slot] of slots.entries()) {
      const y = [29, 15, 10][i],
        x = center(y);
      m.event(
        "Creature " + slot,
        x,
        y,
        'MosslightBridge.intent({type:"encounter",slot:' + slot + "});",
        {
          character: "Monster",
          index: 1,
          wander: true,
          touch: true,
          note: "encounter:" + slot,
        },
      );
    }
    for (const y of key === "forest1" ? [32, 13] : [32, 20, 9]) {
      const x = center(y) + 1;
      // Nearby victories gradually relight the trail; a full clear restores daylight.
      m.event("Old trail lantern", x, y, "", {
        character: "",
        floor: true,
        note: "lantern",
      });
    }
    m.event(
      "Trailkeeper",
      center(32) - 1,
      32,
      "MosslightBridge.trailkeeper();",
      {
        character: "",
        floor: true,
        note: "trailkeeper",
      },
    );
    for (let x = 10; x <= 22; x++)
      m.exit(x, 38, key === "forest1" ? "clearing" : "forest1");
    m.save();
  }
  forest(3, "forest1");
  forest(4, "forest2");
  const shrine = makeMap(5, 4, R.locations.shrine.name, "Dungeon5", 25, 23);
  shrine.rect(0, 0, 25, 23, 5936);
  shrine.rect(0, 0, 25, 23, 255, 5);
  shrine.rect(5, 5, 15, 13, 3200);
  shrine.walk(6, 6, 13, 12);
  shrine.rect(5, 3, 15, 3, 6320);
  shrine.rect(12, 17, 1, 6, 3200);
  shrine.walk(12, 17, 1, 6);
  for (const x of [6, 18])
    for (const y of [7, 14]) shrine.object(x, y, 3, 4, 1, 2);
  shrine.event(
    "Guardian of the hollow",
    12,
    8,
    "MosslightBridge.intent({type:'encounter',slot:5});",
    { character: "Monster", index: 5, note: "encounter:5" },
  );
  shrine.exit(12, 22, "forest2");
  shrine.save();
  write("data/MapInfos.json", [
    null,
    ...Object.values(R.locations).map((value) => ({
      id: value.map,
      expanded: true,
      name: value.name,
      order: value.map,
      parentId: 0,
      scrollX: 0,
      scrollY: 0,
    })),
  ]);
}
