import {
  classes,
  classSchema,
  roads,
  locations,
  shopItemFor,
  classSpells,
  enemies,
  encounterLocations,
  BOSS_ENCOUNTER,
  encounterPools,
  type ClassId,
} from "./catalog";
import { intentSchema, type Intent } from "./intent";
import type { GameState } from "./types";
import { paymentItem } from "./payments";
// Seeded presentation randomness is for practice only, never paid eligibility.
export function practiceChance(seed: number, salt: number) {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (((value ^ (value >>> 16)) >>> 0) / 0x100000000) * 100;
}
export function initialState(
  classId: ClassId,
  kit: boolean,
  options: {
    mode?: "paid" | "practice";
    seed?: number;
    verifiedEncounters?: number[];
  } = {},
): GameState {
  const c = classes[classSchema.parse(classId)];
  const mode = options.mode ?? "paid";
  const seed = (options.seed ?? 1) >>> 0;
  if (
    options.verifiedEncounters &&
    (mode !== "paid" ||
      options.verifiedEncounters.length !== 6 ||
      options.verifiedEncounters.some(
        (enemy, index) =>
          !(encounterPools[index] as readonly number[]).includes(enemy),
      ))
  )
    throw new Error("Invalid verified encounter selection.");
  let random = seed;
  const pick = (values: number[]) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return values[random % values.length];
  };
  return {
    rulesVersion: 5,
    mode,
    classId,
    phase: "town",
    location: "inn",
    hp: c.hp + (kit ? 8 : 0),
    maxHp: c.hp + (kit ? 8 : 0),
    mp: c.mp,
    maxMp: c.mp,
    gold: mode === "practice" ? 25 : 0,
    potions: kit ? 3 : 2,
    ethers: 1,
    weapon: false,
    armor: false,
    spells:
      classId === "white_mage"
        ? ["mend"]
        : classId === "black_mage"
          ? ["spark"]
          : [],
    purchased: [],
    visited: [],
    encounter: 0,
    enemyHp: 0,
    turn: 0,
    encounters:
      mode === "practice"
        ? [
            pick([0, 1, 2]),
            pick([0, 1, 2]),
            pick([3, 4]),
            pick([3, 4, 5]),
            pick([4, 5]),
            pick([6, 7, 8]),
          ]
        : (options.verifiedEncounters ?? [0, 2, 3, 4, 5, 6]),
    cleared: [],
    curse: false,
    dancerDone: false,
    fairyDone: false,
    dancerOutcome: "none",
    fairyOutcome: "none",
    boon: "none",
    demo: false,
    clueRead: false,
    shortcutOpened: false,
    runeSolved: false,
    restored: [],
    seed,
    practiceBalance: mode === "practice" ? 29 : 0,
    spent: 1,
    refunded: 0,
    bonus: 0,
    ledger: [{ label: "Adventure entry", amount: 1 }],
    log: [
      "No dawn has touched Lantern Vale in seven days. Beyond the shutters, the forest lanterns stand cold.",
      mode === "practice"
        ? "Local rehearsal · 1 practice token spent on entry. No GLOW or real reward."
        : "GLOW adventure · one confirmed token for entry. Purchases require your wallet confirmation.",
    ],
  };
}
export const currentEnemy = (s: GameState) =>
  enemies[s.encounters[s.encounter]];
export const isBoss = (s: GameState) => s.encounter === BOSS_ENCOUNTER;
export function enemyAction(s: GameState) {
  const specials = [
    ["Spore Burst", "spores"],
    ["Lantern Flare", "flame"],
    ["Jagged Rush", "claw"],
    ["Moonfang Pounce", "claw"],
    ["Crosscut", "slash"],
    ["Stonebreak", "rocks"],
    ["Root Cataclysm", "roots"],
    ["Cinder Requiem", "flame"],
    ["Thornfall", "slash"],
  ];
  const [name, style] = specials[s.encounters[s.encounter]];
  const special = s.turn % 3 === 2;
  return {
    name: special ? name : "Attack",
    style: special ? style : "strike",
    special,
    bonus: special ? (isBoss(s) ? 18 : 6) : 0,
  };
}
// Only call this with a state loaded from the server-owned round record.
export const isPaidVictory = (s: GameState) =>
  s.rulesVersion === 5 &&
  s.mode === "paid" &&
  !s.demo &&
  s.phase === "victory" &&
  isBoss(s) &&
  s.enemyHp === 0 &&
  s.cleared.includes(BOSS_ENCOUNTER);
export function questHint(s: GameState): string {
  if (s.curse) return "Moonwell curse · weakened attack and defense";
  if (s.boon === "wild") return "Woodland form · +8 damage and +4 defense";
  if (s.boon === "inspired") return "Inspired · +4 damage and +2 defense";
  if (s.phase === "victory")
    return "The mountain is quiet. Your adventure is complete.";
  if (s.phase === "defeat")
    return "Your lantern has gone dark. A new journey awaits.";
  if (s.phase === "combat")
    return enemyAction(s).special
      ? `${enemyAction(s).name} is coming. Defend!`
      : "Choose a command. Battles wait for you.";
  return s.location === "inn"
    ? "The Lantern & Leaf"
    : s.restored.includes(s.location)
      ? "The lanterns burn again."
      : "The stolen dawn";
}
// Only the server supplies verifiedPaymentItem, after receipt verification and before
// atomically consuming that receipt with the new state. It is not part of Intent.
export function reduceIntent(
  previous: GameState,
  input: Intent,
  verifiedPaymentItem?: number,
  verifiedChance?: number,
): GameState {
  const intent = intentSchema.parse(input);
  if (previous.rulesVersion !== 5)
    throw new Error("This adventure uses older rules. Start a new round.");
  if (["victory", "defeat"].includes(previous.phase))
    throw new Error("This adventure has ended.");
  const s = structuredClone(previous);
  const c = classes[s.classId];
  const say = (line: string) => {
    s.log = [...s.log.slice(-7), line];
  };
  const need = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const spend = (tokens: number, _gold: number, label: string) => {
    if (s.mode === "practice") {
      need(s.practiceBalance >= tokens, "Not enough practice tokens.");
      s.practiceBalance -= tokens;
      s.spent += tokens;
      s.ledger.push({ label, amount: tokens });
    } else {
      need(
        verifiedPaymentItem !== undefined &&
          verifiedPaymentItem === paymentItem(intent),
        "A confirmed GLOW payment for this action is required.",
      );
      s.spent += tokens;
      s.ledger.push({ label, amount: tokens });
    }
  };
  if (intent.type === "abandon") {
    s.phase = "defeat";
    s.hp = 0;
    say(
      "The adventure ends. Tokens used in this round are forfeited; unspent tokens are untouched.",
    );
    return s;
  }
  if (intent.type === "move") {
    need(s.phase !== "combat", "Finish the battle first.");
    const from = roads.indexOf(s.location),
      to = roads.indexOf(intent.destination);
    need(Math.abs(from - to) === 1, "Follow the connected woodland road.");
    s.location = intent.destination;
    s.phase = s.location === "inn" ? "town" : "trail";
    say(`You arrive at ${locations[s.location].name}.`);
    return s;
  }
  if (intent.type === "visit") {
    need(
      s.location === "inn" && s.phase === "town",
      "The shops are inside the inn.",
    );
    if (!s.visited.includes(intent.place)) s.visited.push(intent.place);
    say(
      intent.place === "inn"
        ? "Nessa: The mountain has swallowed our dawn. Follow the lanterns, and defeat whatever waits beneath it. Beware the pond's promises."
        : `The ${intent.place} counter is open. Choose supplies carefully.`,
    );
    return s;
  }
  if (intent.type === "rest") {
    need(
      s.location === "inn" && s.visited.includes("inn") && s.phase === "town",
      "Ask Nessa at the inn.",
    );
    need(
      s.curse || s.hp < s.maxHp || s.mp < s.maxMp,
      "You are already fully rested.",
    );
    spend(1, 8, "Inn rest and curse cure");
    s.curse = false;
    s.hp = s.maxHp;
    s.mp = s.maxMp;
    say(
      "Nessa's bitter tea restores HP and MP. Any woodland curse melts away.",
    );
    return s;
  }
  if (intent.type === "buy") {
    const item = shopItemFor(s.classId, intent.item);
    need(
      s.phase === "town" &&
        s.location === "inn" &&
        s.visited.includes(item.vendor),
      "Visit the matching counter first.",
    );
    need(
      !s.purchased.includes(intent.item),
      "That purchase is sold out for this round.",
    );
    if (intent.item === "potion")
      need(s.potions < 5, "You can carry five tonics.");
    if (intent.item === "ether")
      need(s.ethers < 3, "You can carry three ethers.");
    if (intent.item === "weapon" || intent.item === "armor")
      need(!s[intent.item], "That equipment is already owned.");
    if (intent.item === "spark" || intent.item === "mend")
      need(!s.spells.includes(intent.item), "You already know that spell.");
    spend(item.cost, item.gold, item.name);
    s.purchased.push(intent.item);
    if (intent.item === "potion") s.potions++;
    else if (intent.item === "ether") s.ethers++;
    else if (intent.item === "weapon" || intent.item === "armor")
      s[intent.item] = true;
    else s.spells.push(intent.item);
    say(`${item.name} acquired. ${item.description}.`);
    return s;
  }
  if (intent.type === "dancer") {
    need(
      s.mode === "practice" ||
        (Number.isInteger(verifiedChance) &&
          verifiedChance! >= 0 &&
          verifiedChance! < 100),
      "This paid encounter requires verified randomness.",
    );
    need(
      s.location === "inn" && s.phase === "town" && !s.dancerDone,
      "The dancer has already taken her bow.",
    );
    spend(1, 8, "Vesper's invitation");
    s.dancerDone = true;
    const roll =
      s.mode === "practice"
        ? practiceChance(s.seed, 0x56455350)
        : verifiedChance!;
    s.dancerOutcome =
      roll < 25 ? "inspired" : roll < 50 ? "drained" : "slapped";
    if (s.dancerOutcome === "inspired") {
      if (s.boon !== "wild") s.boon = "inspired";
      say(
        "The candle goes out. Later, Vesper leaves with a knowing smile. Your spirits soar: Inspired grants +4 damage and +2 defense for this round.",
      );
    } else if (s.dancerOutcome === "drained") {
      s.hp = Math.max(1, Math.min(s.hp, Math.floor(s.maxHp / 4)));
      s.mp = 0;
      say(
        "The candle goes out. You wake to an empty room, utterly exhausted. HP falls to at most a quarter and MP to zero.",
      );
    } else
      say(
        "A theatrical slap! Vesper bows: 'That was the room service, darling.' One token spent; no benefit gained.",
      );
    return s;
  }
  if (intent.type === "fairy") {
    need(
      s.mode === "practice" ||
        (Number.isInteger(verifiedChance) &&
          verifiedChance! >= 0 &&
          verifiedChance! < 100),
      "This paid encounter requires verified randomness.",
    );
    need(
      s.location === "clearing" && s.phase === "trail" && !s.fairyDone,
      "The fairy's dance is over.",
    );
    spend(1, 8, "Ilyra's moonwell dance");
    s.fairyDone = true;
    s.fairyOutcome =
      (s.mode === "practice"
        ? practiceChance(s.seed, 0x46414952)
        : verifiedChance!) < 25
        ? "wild"
        : "toad";
    s.curse = s.fairyOutcome === "toad";
    if (s.curse) {
      s.boon = "none";
      s.hp = Math.min(s.hp, 8);
      s.mp = 0;
      say(
        "The moonlit dance ends in a croak. Ilyra laughs: 'What a lovely singing voice!' The toad curse weakens you until Nessa cures it.",
      );
    } else {
      s.boon = "wild";
      say(
        "Moonlight gathers beneath your skin. You take a powerful woodland form: +8 damage and +4 defense for this round.",
      );
    }
    return s;
  }
  if (intent.type === "clue") {
    need(s.phase !== "combat", "Read after the battle.");
    s.clueRead = true;
    say(
      "A faded verse: Pale flowers hide a road. Where three stones listen, choose the light that borrows from the sun: the moon.",
    );
    return s;
  }
  if (intent.type === "shortcut") {
    need(
      s.location === "forest1" && s.phase === "trail",
      "There is no passage here.",
    );
    s.shortcutOpened = true;
    say(
      "You find a gap beneath the boughs. This secret path avoids the first forest's creatures, but the final guardian still waits.",
    );
    return s;
  }
  if (intent.type === "puzzle") {
    need(
      s.location === "forest2" && s.phase === "trail" && !s.runeSolved,
      "The listening stones are quiet.",
    );
    if (intent.answer === "moon") {
      s.runeSolved = true;
      s.potions = Math.min(5, s.potions + 1);
      s.ethers = Math.min(3, s.ethers + 1);
      say(
        "The moon stone opens a mossy cache: one tonic and one ether, up to your carrying limit.",
      );
    } else {
      s.hp = Math.max(1, s.hp - 10);
      say(
        "The wrong stone sends a cold shiver through you. Lose 10 HP. Read the verse again.",
      );
    }
    return s;
  }
  if (intent.type === "encounter") {
    need(
      s.phase === "trail" &&
        encounterLocations[intent.slot] === s.location &&
        !s.cleared.includes(intent.slot),
      "That encounter is unavailable.",
    );
    s.encounter = intent.slot;
    s.enemyHp = currentEnemy(s).hp;
    s.turn = 0;
    s.phase = "combat";
    say(`${currentEnemy(s).name} blocks the path!`);
    return s;
  }
  need(s.phase === "combat", "Choose a road or speak to someone first.");
  const enemy = currentEnemy(s);
  let damage = 0,
    defending = false;
  if (intent.type === "potion") {
    need(s.potions > 0, "No tonics left.");
    s.potions--;
    s.hp = Math.min(s.maxHp, s.hp + 70);
    say("Moss Tonic restores up to 70 HP.");
  } else if (intent.type === "ether") {
    need(s.ethers > 0, "No ethers left.");
    s.ethers--;
    s.mp = Math.min(s.maxMp, s.mp + 24);
    say("Dew Ether restores up to 24 MP.");
  } else if (intent.type === "guard") {
    defending = true;
    s.mp = Math.min(s.maxMp, s.mp + 6);
    say("You defend and recover 6 MP.");
  } else if (intent.type === "magic") {
    need(
      s.spells.includes(intent.spell) && s.mp >= 8,
      "Learn this spell and keep at least 8 MP.",
    );
    s.mp -= 8;
    const spell = classSpells[s.classId][intent.spell];
    damage = spell.damage;
    s.hp = Math.min(s.maxHp, s.hp + spell.healing);
    defending = spell.ward;
    say(`${spell.name}! ${spell.description}`);
  } else if (intent.type === "skill") {
    need(s.mp >= 6, "This skill needs 6 MP.");
    s.mp -= 6;
    damage =
      c.attack +
      22 +
      (s.weapon ? 6 : 0) -
      (s.classId === "thief" ? 0 : enemy.defense);
    if (s.classId === "white_mage") {
      damage = 32;
      s.hp = Math.min(s.maxHp, s.hp + 38);
    }
    if (s.classId === "dark_knight") s.hp = Math.min(s.maxHp, s.hp + 18);
    if (s.classId === "black_mage") damage += 12;
    if (s.classId === "ranger") damage += 4;
    say(
      `${c.skill}! ${s.classId === "warrior" ? "A charged blow shatters the guard." : s.classId === "ranger" ? "Two arrows strike as one." : s.classId === "thief" ? "Your blade slips past armor." : s.classId === "dark_knight" ? "The blade draws life from shadow." : s.classId === "white_mage" ? "Dawn mends your wounds and sears the foe." : "A ring of embers erupts."}`,
    );
  } else if (intent.type === "attack")
    damage = Math.max(1, c.attack + (s.weapon ? 6 : 0) - enemy.defense);
  else throw new Error("Unknown combat action.");
  if (damage) damage += s.boon === "wild" ? 8 : s.boon === "inspired" ? 4 : 0;
  if (s.curse && damage) damage = Math.max(1, Math.floor(damage / 5));
  s.enemyHp = Math.max(0, s.enemyHp - damage);
  if (damage) say(`You deal ${damage} damage.`);
  if (!s.enemyHp) {
    s.cleared.push(s.encounter);
    if (
      !s.restored.includes(s.location) &&
      encounterLocations.every(
        (place, slot) => place !== s.location || s.cleared.includes(slot),
      )
    )
      s.restored.push(s.location);
    s.gold += 12;
    s.hp = Math.min(s.maxHp, s.hp + 16);
    s.mp = Math.min(s.maxMp, s.mp + 8);
    s.phase = isBoss(s) ? "victory" : "trail";
    if (s.phase === "victory") {
      s.restored = [...roads];
      if (s.mode === "practice") {
        s.refunded = s.spent;
        s.bonus = s.cleared.length === encounterLocations.length ? 2 : 1;
        s.practiceBalance += s.refunded + s.bonus;
        say(
          `Dawn returns. ${s.refunded} spent practice tokens refunded once, plus ${s.bonus} practice bonus. This local victory has no GLOW reward.`,
        );
      } else
        say(
          "The guardian falls. Server progress is complete; a real reward still requires an eligible signed claim and a mined transaction.",
        );
    } else
      say(`${enemy.name} falls. Catch your breath: recover 16 HP and 8 MP.`);
    return s;
  }
  const retaliation = enemyAction(s);
  const incoming = Math.max(
    1,
    enemy.attack +
      retaliation.bonus -
      (s.curse ? 0 : c.defense) -
      (s.armor ? 4 : 0) -
      (s.boon === "wild" ? 4 : s.boon === "inspired" ? 2 : 0) -
      (defending ? 22 : 0),
  );
  s.hp = Math.max(0, s.hp - incoming);
  s.turn++;
  say(`${enemy.name} uses ${retaliation.name}: ${incoming} damage.`);
  if (enemyAction(s).special)
    say(`${enemyAction(s).name} is coming. Defend on the next turn!`);
  if (!s.hp) {
    s.phase = "defeat";
    say(
      "Your lantern goes dark. Spent tokens are not refunded. No reward is available.",
    );
  }
  return s;
}
