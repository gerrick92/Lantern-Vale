import { z } from "zod";
export const encounterPools = [
  [0, 1, 2],
  [0, 1, 2],
  [3, 4],
  [3, 4, 5],
  [4, 5],
  [6, 7, 8],
] as const;
export const classes = {
  warrior: {
    name: "Warrior",
    hp: 184,
    mp: 22,
    attack: 29,
    defense: 12,
    skill: "Shieldbreaker",
    description: "Sturdy armor and a crushing shield strike.",
    character: "Actor1",
    index: 0,
    battler: "Actor1_1",
    color: "#e8bf67",
  },
  dark_knight: {
    name: "Dark Knight",
    hp: 170,
    mp: 30,
    attack: 32,
    defense: 9,
    skill: "Siphon Blade",
    description: "Heavy strikes restore a little life.",
    character: "Actor3",
    index: 6,
    battler: "Actor3_7",
    color: "#c29ce3",
  },
  white_mage: {
    name: "White Mage",
    hp: 142,
    mp: 64,
    attack: 20,
    defense: 8,
    skill: "Dawn Prayer",
    description: "Radiant magic heals while it harms.",
    character: "Actor2",
    index: 2,
    battler: "Actor2_3",
    color: "#b9ebda",
  },
  black_mage: {
    name: "Black Mage",
    hp: 130,
    mp: 68,
    attack: 22,
    defense: 7,
    skill: "Ember Bloom",
    description: "Powerful spells and a deep mana reserve.",
    character: "Actor1",
    index: 5,
    battler: "Actor1_6",
    color: "#aabcf4",
  },
  ranger: {
    name: "Ranger",
    hp: 156,
    mp: 40,
    attack: 28,
    defense: 9,
    skill: "Twin Arrows",
    description: "Precise arrows strike twice in one motion.",
    character: "Actor2",
    index: 6,
    battler: "Actor2_7",
    color: "#b4d78b",
  },
  thief: {
    name: "Thief",
    hp: 148,
    mp: 34,
    attack: 30,
    defense: 8,
    skill: "Shadow Cut",
    description: "A quick blade slips past enemy armor.",
    character: "Actor2",
    index: 4,
    battler: "Actor2_5",
    color: "#f1aca5",
  },
} as const;
export type ClassId = keyof typeof classes;
export const classIds = Object.keys(classes) as ClassId[];
export const classSchema = z.enum([
  "warrior",
  "dark_knight",
  "white_mage",
  "black_mage",
  "ranger",
  "thief",
]);
export const locations = {
  inn: { map: 1, name: "The Lantern & Leaf" },
  clearing: { map: 2, name: "Moonwell Clearing" },
  forest1: { map: 3, name: "Forest I · Whispering Boughs" },
  forest2: { map: 4, name: "Forest II · Briar Crossing" },
  shrine: { map: 5, name: "The Hollow Shrine" },
} as const;
export type Place = keyof typeof locations;
export const roads = Object.keys(locations) as Place[];
export const shopItems = {
  potion: {
    name: "Moss Tonic",
    cost: 1,
    gold: 8,
    vendor: "item",
    description: "Restore 70 HP",
  },
  ether: {
    name: "Dew Ether",
    cost: 1,
    gold: 8,
    vendor: "item",
    description: "Restore 24 MP",
  },
  weapon: {
    name: "Trail-forged Weapon",
    cost: 1,
    gold: 15,
    vendor: "weapon",
    description: "+6 attack",
  },
  armor: {
    name: "Barkweave Armor",
    cost: 1,
    gold: 15,
    vendor: "armor",
    description: "+4 defense",
  },
  spark: {
    name: "Offensive Grimoire",
    cost: 1,
    gold: 12,
    vendor: "magic",
    description: "Learn your class's offensive spell; 8 MP",
  },
  mend: {
    name: "Restoration Grimoire",
    cost: 1,
    gold: 12,
    vendor: "magic",
    description: "Learn your class's restorative spell; 8 MP",
  },
} as const;
type Spell = {
  name: string;
  damage: number;
  healing: number;
  ward: boolean;
  style: string;
  description: string;
};
export const classSpells: Record<ClassId, Record<"spark" | "mend", Spell>> = {
  warrior: {
    spark: {
      name: "Stormbrand",
      damage: 60,
      healing: 0,
      ward: false,
      style: "lightning",
      description: "60 lightning damage. Ignores armor.",
    },
    mend: {
      name: "Iron Oath",
      damage: 0,
      healing: 48,
      ward: true,
      style: "ward",
      description: "Heal 48 HP and block 22 damage this turn.",
    },
  },
  dark_knight: {
    spark: {
      name: "Dusk Leech",
      damage: 48,
      healing: 24,
      ward: false,
      style: "drain",
      description: "48 shadow damage and heal 24 HP.",
    },
    mend: {
      name: "Crimson Vow",
      damage: 18,
      healing: 60,
      ward: false,
      style: "drain",
      description: "Heal 60 HP and deal 18 shadow damage.",
    },
  },
  white_mage: {
    spark: {
      name: "Sunlance",
      damage: 54,
      healing: 12,
      ward: false,
      style: "holy",
      description: "54 radiant damage and heal 12 HP.",
    },
    mend: {
      name: "Sanctuary",
      damage: 0,
      healing: 88,
      ward: true,
      style: "holy",
      description: "Heal 88 HP and block 22 damage this turn.",
    },
  },
  black_mage: {
    spark: {
      name: "Starfall",
      damage: 76,
      healing: 0,
      ward: false,
      style: "meteor",
      description: "76 celestial damage. Ignores armor.",
    },
    mend: {
      name: "Lunar Veil",
      damage: 0,
      healing: 52,
      ward: true,
      style: "ward",
      description: "Heal 52 HP and block 22 damage this turn.",
    },
  },
  ranger: {
    spark: {
      name: "Thorn Volley",
      damage: 62,
      healing: 0,
      ward: true,
      style: "arrows",
      description: "62 piercing damage and block 22 damage this turn.",
    },
    mend: {
      name: "Springwind",
      damage: 0,
      healing: 60,
      ward: true,
      style: "leaves",
      description: "Heal 60 HP and block 22 damage this turn.",
    },
  },
  thief: {
    spark: {
      name: "Nightfang",
      damage: 68,
      healing: 0,
      ward: false,
      style: "shadow",
      description: "68 shadow damage. Ignores armor.",
    },
    mend: {
      name: "Miststep",
      damage: 0,
      healing: 46,
      ward: true,
      style: "shadow",
      description: "Heal 46 HP and block 22 damage this turn.",
    },
  },
};
export function shopItemFor(classId: ClassId, id: keyof typeof shopItems) {
  if (id !== "spark" && id !== "mend") return shopItems[id];
  const spell = classSpells[classId][id];
  return {
    ...shopItems[id],
    name: `${spell.name} Grimoire`,
    description: `${spell.description} Costs 8 MP`,
  };
}
export const enemies = [
  {
    name: "Bramble Cap",
    hp: 56,
    attack: 18,
    defense: 3,
    image: "Matango",
    character: "Nature",
    index: 5,
  },
  {
    name: "Lantern Wisp",
    hp: 52,
    attack: 19,
    defense: 3,
    image: "SF_Will_o_the_wisp",
    character: "Nature",
    index: 6,
  },
  {
    name: "Briar Goblin",
    hp: 66,
    attack: 20,
    defense: 4,
    image: "Goblin",
    character: "Monster",
    index: 1,
  },
  {
    name: "Moonfang",
    hp: 80,
    attack: 24,
    defense: 5,
    image: "SF_Wolf",
    character: "Nature",
    index: 0,
  },
  {
    name: "Hollow Sellsword",
    hp: 90,
    attack: 25,
    defense: 6,
    image: "Mercenary",
    character: "Monster",
    index: 2,
  },
  {
    name: "Root Sentinel",
    hp: 104,
    attack: 27,
    defense: 8,
    image: "Stoneknight",
    character: "Monster",
    index: 3,
  },
  {
    name: "The Hollow Warden",
    hp: 224,
    attack: 29,
    defense: 9,
    image: "Treant",
    character: "Monster",
    index: 5,
  },
  {
    name: "Lady of Cinders",
    hp: 210,
    attack: 31,
    defense: 7,
    image: "Lich",
    character: "Evil",
    index: 1,
  },
  {
    name: "The Thornbound Knight",
    hp: 240,
    attack: 28,
    defense: 10,
    image: "Blackknight",
    character: "Monster",
    index: 3,
  },
] as const;
export const encounterLocations: Place[] = [
  "forest1",
  "forest1",
  "forest2",
  "forest2",
  "forest2",
  "shrine",
];
export const BOSS_ENCOUNTER = 5;
