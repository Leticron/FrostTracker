// Generates a large, fully fictional seed (seed-test/) at roughly the size of a real campaign.
// It exercises every seed feature: all effect types, links, conditions, choices, lockouts,
// sticker requirements, calendar sections, buildings with levels, map markers on both layers,
// and deliberately incomplete entries (null HP, unknown costs, missing markers).
// Output is deterministic, so rerunning it gives the same files.
//
//   node scripts/generate-test-seed.ts [outDir]     (default: seed-test)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'seed-test';

// mulberry32: small seeded PRNG so the output is stable across runs.
let state = 0x5eed7e57;
function rand() {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type Json = Record<string, unknown>;
type Effect = Json & { type: string };

// ---------------------------------------------------------------- word lists (invented)

const ADJ = [
  'Hollow',
  'Ashen',
  'Silent',
  'Drowned',
  'Gilded',
  'Broken',
  'Pale',
  'Sunken',
  'Howling',
  'Frozen',
  'Crimson',
  'Forgotten',
  'Shattered',
  'Rusted',
  'Twisted',
  'Verdant',
  'Bleak',
  'Glimmering',
  'Restless',
  'Tangled',
  'Bitter',
  'Endless',
  'Smoldering',
  'Hidden',
] as const;
const NOUN = [
  'Lantern',
  'Spire',
  'Hollow',
  'Crossing',
  'Vault',
  'Grove',
  'Causeway',
  'Den',
  'Bastion',
  'Reach',
  'Cistern',
  'Barrow',
  'Quarry',
  'Fen',
  'Harbor',
  'Observatory',
  'Kiln',
  'Archive',
  'Cairn',
  'Mill',
  'Chapel',
  'Warren',
  'Ridge',
  'Shoal',
  'Foundry',
  'Orchard',
] as const;
const REGIONS = [
  'Test Lowlands',
  'Test Highlands',
  'Test Coast',
  'Test Marsh',
  'Test Forest',
  'Test Wastes',
] as const;
const STICKERS = [
  'Test Lighthouse',
  'Test Ferry',
  'Test Charter',
  'Test Alliance',
  'Test Compass',
  'Test Relic',
  'Test Bridge',
  'Test Seal',
  'Test Truce',
  'Test Lens',
  'Test Crown',
  'Test Ledger',
] as const;
const DECKS = ['summer outpost', 'winter outpost', 'summer road', 'winter road', 'boat'] as const;
const DECK_PREFIX: Record<(typeof DECKS)[number], string> = {
  'summer outpost': 'TSO',
  'winter outpost': 'TWO',
  'summer road': 'TSR',
  'winter road': 'TWR',
  boat: 'TB',
};

const scenarioName = (i: number) => `${ADJ[i % ADJ.length]} ${NOUN[(i * 7) % NOUN.length]}`;
const sentence = () =>
  `${pick(['Gain', 'Lose', 'Mark', 'Note', 'Remove', 'Add'])} ${int(1, 5)} ${pick([
    'test tokens',
    'placeholder marks',
    'example points',
    'dummy shards',
  ])} (fictional test text).`;

// ---------------------------------------------------------------- rule tables

const resources = [
  { key: 'timber', name: 'Timber', kind: 'material' },
  { key: 'ore', name: 'Ore', kind: 'material' },
  { key: 'leather', name: 'Leather', kind: 'material' },
  { key: 'emberleaf', name: 'Emberleaf', kind: 'herb' },
  { key: 'frostcap', name: 'Frostcap', kind: 'herb' },
  { key: 'duskroot', name: 'Duskroot', kind: 'herb' },
  { key: 'saltmoss', name: 'Saltmoss', kind: 'herb' },
  { key: 'thornbud', name: 'Thornbud', kind: 'herb' },
  { key: 'glowcap', name: 'Glowcap', kind: 'herb' },
];
const materials = resources.filter((r) => r.kind === 'material').map((r) => r.key);

const WEEKS_PER_SEASON = 10;
const SHEET_WEEKS = 80;

// ---------------------------------------------------------------- sections registry

const sections = new Map<string, Json>();
function addSection(ref: string, title: string, effects: Effect[], scenario: number | null = null) {
  if (sections.has(ref)) throw new Error(`duplicate section ${ref}`);
  const s: Json = { ref, title, scenario, effects };
  if (chance(0.6)) s.rewardsText = sentence();
  sections.set(ref, s);
}

// ---------------------------------------------------------------- classes

const CLASS_NAMES = [
  'Test Warden',
  'Test Tinkerer',
  'Test Skirmisher',
  'Test Mystic',
  'Test Brute',
  'Test Herbalist',
  'Test Duelist',
  'Test Stormcaller',
  'Test Shadow',
  'Test Engineer',
  'Test Beastmaster',
  'Test Chronicler',
  'Test Lancer',
  'Test Hexer',
  'Test Tidecaller',
  'Test Smith',
  'Test Wanderer',
];
const STARTING_CLASSES = 6;
const PERK_TEXT = [
  'Remove two -1 cards',
  'Replace one -1 card with one +1 card',
  'Add two +1 cards',
  'Add one +2 FROST card',
  'Replace one +0 card with one +1 HEAL 1 card',
  'Ignore scenario effects',
  'Add three rolling PUSH 1 cards',
  'Add one +1 WOUND card',
  'Replace two +1 cards with two +2 cards',
  'Once each scenario, during your turn, gain SHIELD 1',
  'Add one rolling +1 INVISIBLE card',
  'Remove one -2 card',
];
const classes = CLASS_NAMES.map((name, i) => {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const perks = Array.from({ length: int(9, 13) }, (_, p) => {
    const boxes = pick([1, 1, 1, 2, 2, 3]);
    return {
      text: `${PERK_TEXT[(i + p) % PERK_TEXT.length]} (test perk ${p + 1})`,
      boxes,
      linked: boxes > 1 && chance(0.25),
    };
  });
  const hpBase = pick([6, 8, 10]);
  // One starting and one locked class keep unknown HP/hand size to test the "missing data" UI.
  const unknown = i === STARTING_CLASSES - 1 || i === CLASS_NAMES.length - 1;
  return {
    key,
    name,
    starting: i < STARTING_CLASSES,
    perks,
    masteries: [`Test mastery: ${pick(ADJ)} feat`, `Test mastery: ${pick(NOUN)} challenge`],
    maxHpByLevel: unknown
      ? null
      : Array.from({ length: 9 }, (_, l) => hpBase + Math.floor(l * 1.5)),
    handSize: unknown ? null : int(8, 14),
  };
});
const lockedClasses = classes.filter((c) => !c.starting).map((c) => c.key);

// ---------------------------------------------------------------- buildings

type Cost = { prosperity: number | null; resources: Record<string, number> };
const cost = (prosperity: number | null, n: number): Cost => {
  const res: Record<string, number> = {};
  for (let k = 0; k < n; k++) {
    const r = pick(materials);
    res[r] = (res[r] ?? 0) + int(1, 3);
  }
  return { prosperity, resources: res };
};
const BUILDING_NAMES = [
  'Test Barracks',
  'Test Workshop',
  'Test Market',
  'Test Infirmary',
  'Test Alchemy Hall',
  'Test Mine',
  'Test Logging Camp',
  'Test Tannery',
  'Test Garden',
  'Test Library',
  'Test Jeweler',
  'Test Docks',
  'Test Watchtower',
  'Test Walls',
  'Test Inn',
  'Test Temple',
  'Test Stables',
  'Test Trading Post',
  'Test Carpenter',
  'Test Town Hall',
];
const STARTING_BUILDINGS = 7;
const buildings = BUILDING_NAMES.map((name, i) => {
  const number = (i + 1) * 5;
  const maxLevel = i === STARTING_BUILDINGS - 1 ? 1 : int(2, 4);
  const barracks = name === 'Test Barracks';
  const levels = [];
  // One building starts at level 0 (wrecked until built) to test level-0 handling.
  if (i === 2) levels.push({ level: 0 });
  for (let level = 1; level <= maxLevel; level++) {
    levels.push({
      level,
      cost: level === 1 && i < STARTING_BUILDINGS && i !== 2 ? null : cost(level, int(2, 4)),
      // Repair cost unknown for one building, to test nulls.
      repairCost: i === 4 ? null : level,
      rebuildCost: chance(0.7) ? cost(null, int(1, 2)) : null,
      maxSoldiers: barracks ? 2 + level * 2 : null,
      prosperityGain: level === 1 ? null : 1,
    });
  }
  return { number, name, starting: i < STARTING_BUILDINGS, levels };
});
const lockedBuildings = buildings.filter((b) => !b.starting).map((b) => b.number);

// ---------------------------------------------------------------- scenarios

const SCENARIO_COUNT = 138;
const conclusionRef = (n: number, k = 1) => `${10 + n}.${k}`; // 10.1 … 147.2
const unlockedBy = new Map<number, number[]>(); // parent -> children
for (let k = 2; k < SCENARIO_COUNT; k++) {
  const parent = int(Math.max(0, k - 12), k - 1);
  unlockedBy.set(parent, [...(unlockedBy.get(parent) ?? []), k]);
}
// Extra cross-links: some scenarios are unlocked by a second, unrelated conclusion too.
for (let i = 0; i < 25; i++) {
  const k = int(10, SCENARIO_COUNT - 1);
  const parent = int(0, k - 1);
  if (!unlockedBy.get(parent)?.includes(k))
    unlockedBy.set(parent, [...(unlockedBy.get(parent) ?? []), k]);
}

const stickerSources: { sticker: string; times: number }[] = STICKERS.map((s, i) => ({
  sticker: s,
  times: i < 3 ? 2 : 1, // the first three stickers are gained twice (for minCount: 2)
}));
const pendingStickers = stickerSources.flatMap((s) =>
  Array.from({ length: s.times }, () => s.sticker),
);

const scenarios: Json[] = [];
const multiConclusion = new Set<number>();
for (let n = 0; n < SCENARIO_COUNT; n++) {
  if (n > 3 && chance(0.18)) multiConclusion.add(n);
  const sc: Json = {
    number: n,
    name: scenarioName(n) + (n >= ADJ.length ? ` ${Math.floor(n / ADJ.length) + 1}` : ''),
    coord: chance(0.9) ? `${String.fromCharCode(65 + (n % 18))}${int(1, 24)}` : null,
    region: n === 7 ? null : REGIONS[Math.floor(n / 23) % REGIONS.length],
    complexity: chance(0.85) ? int(1, 3) : null,
    initiallyUnlocked: n <= 1,
    conclusionSections: multiConclusion.has(n)
      ? [conclusionRef(n, 1), conclusionRef(n, 2)]
      : [conclusionRef(n, 1)],
  };
  const m = rand();
  if (m < 0.8)
    sc.marker = {
      x: round3(0.04 + rand() * 0.92),
      y: round3(0.04 + rand() * 0.92),
      layer: 'world',
    };
  else if (m < 0.86)
    sc.marker = { x: round3(0.1 + rand() * 0.8), y: round3(0.1 + rand() * 0.8), layer: 'town' };
  // else: no marker, to test placement mode.
  scenarios.push(sc);
}

// Requirements. Sticker requirements point at stickers gained somewhere earlier.
const reqTargets = [12, 19, 27, 33, 41, 48, 56, 63, 71, 80, 88, 95, 104, 112, 121, 130];
reqTargets.forEach((n, i) => {
  const sticker = STICKERS[i % STICKERS.length]!;
  const r: Json = { campaignSticker: sticker };
  if (i < 3) r.minCount = 2;
  if (i === 4) r.via = 'Test Ferry route';
  scenarios[n]!.requirements = [r];
});
scenarios[52]!.requirements = [{ freeText: 'Test condition: at least one character has retired' }];
scenarios[99]!.requirements = [
  { campaignSticker: 'Test Seal' },
  { freeText: 'Test condition: the party carries the test lens' },
];

// ---------------------------------------------------------------- conclusion sections

let classCursor = 0;
let buildingCursor = 0;
let deckEventNo = 1;
const calendarRefs: string[] = [];
const fillerRefs: string[] = [];

function unlockEffect(target: number): Effect {
  const e: Effect = { type: 'unlockScenario', scenario: target };
  const r = rand();
  if (r < 0.1) e.link = 'linked';
  else if (r < 0.15) e.link = 'forced';
  if (chance(0.07)) e.condition = `If ${scenarioName(int(0, 30))} is complete`;
  return e;
}

// Calendar and filler section refs are reserved up front so conclusions can reference them.
for (let i = 0; i < 60; i++) calendarRefs.push(`${160 + Math.floor(i / 3)}.${(i % 3) + 1}`);
for (let n = 200; n < 400; n++) {
  const parts = n < 330 ? 3 : 2;
  for (let k = 1; k <= parts; k++) fillerRefs.push(`${n}.${k}`);
}

for (let n = 0; n < SCENARIO_COUNT; n++) {
  const children = unlockedBy.get(n) ?? [];
  const effects: Effect[] = [];
  // Every fifth scenario with 2+ children offers a choice instead of unlocking both.
  if (children.length >= 2 && n % 5 === 0) {
    const [a, b, ...rest] = children;
    effects.push({ type: 'chooseOne', options: [unlockEffect(a!), unlockEffect(b!)] });
    children.splice(0, children.length, ...rest);
  }
  for (const c of children) effects.push(unlockEffect(c));
  if (n > 5 && chance(0.06))
    effects.push({ type: 'lockOutScenario', scenario: int(n + 1, SCENARIO_COUNT - 1) });
  if (pendingStickers.length && n >= 2 && chance(0.25)) {
    effects.push({ type: 'gainCampaignSticker', name: pendingStickers.shift()! });
  }
  if (n > 60 && chance(0.04)) effects.push({ type: 'loseCampaignSticker', name: pick(STICKERS) });
  if (chance(0.45)) effects.push({ type: 'adjust', target: 'prosperity', amount: int(1, 2) });
  if (chance(0.3))
    effects.push({ type: 'adjust', target: 'morale', amount: pick([-2, -1, 1, 1, 2]) });
  if (chance(0.12)) effects.push({ type: 'adjust', target: 'inspiration', amount: int(1, 3) });
  if (chance(0.08)) effects.push({ type: 'adjust', target: 'soldiers', amount: pick([-1, 1, 2]) });
  if (chance(0.08)) effects.push({ type: 'adjust', target: 'defense', amount: pick([-2, 2, 3]) });
  if (chance(0.15))
    effects.push({
      type: 'addCalendarSection',
      section: pick(calendarRefs),
      weeksAhead: int(0, 6),
    });
  if (chance(0.12)) {
    const deck = pick(DECKS);
    const events = Array.from(
      { length: int(1, 3) },
      () => `${DECK_PREFIX[deck]}-${String(deckEventNo++).padStart(2, '0')}`,
    );
    effects.push({ type: 'eventDeck', op: chance(0.8) ? 'add' : 'remove', deck, events });
  }
  if (n % 11 === 4 && classCursor < lockedClasses.length) {
    effects.push({ type: 'unlockClass', classKey: lockedClasses[classCursor++]! });
  }
  if (n % 13 === 6 && buildingCursor < lockedBuildings.length) {
    effects.push({ type: 'unlockBuilding', number: lockedBuildings[buildingCursor++]! });
  }
  if (chance(0.1)) effects.push({ type: 'readSection', ref: pick(fillerRefs) });
  if (chance(0.1)) effects.push({ type: 'manual', note: `Test step: ${sentence()}` });
  addSection(conclusionRef(n, 1), `${scenarios[n]!.name} conclusion`, effects, n);
  if (multiConclusion.has(n)) {
    addSection(
      conclusionRef(n, 2),
      `${scenarios[n]!.name} alternative conclusion`,
      [
        { type: 'adjust', target: 'morale', amount: -1 },
        { type: 'manual', note: 'Test alternative ending' },
      ],
      n,
    );
  }
}
// Any sticker not yet handed out goes to a late scenario, so every requirement can be met.
for (const s of pendingStickers) {
  const sec = sections.get(conclusionRef(int(2, 40), 1))!;
  (sec.effects as Effect[]).push({ type: 'gainCampaignSticker', name: s });
}
// Leftover locked classes/buildings: unlock them from filler sections below.
const leftoverClasses = lockedClasses.slice(classCursor);
const leftoverBuildings = lockedBuildings.slice(buildingCursor);

// ---------------------------------------------------------------- calendar & event sections

calendarRefs.forEach((ref, i) => {
  const effects: Effect[] = [];
  const r = i % 6;
  if (r === 0) effects.push({ type: 'adjust', target: 'morale', amount: pick([-1, 1]) });
  if (r === 1) effects.push(unlockEffect(int(20, SCENARIO_COUNT - 1)));
  if (r === 2) {
    const deck = pick(DECKS);
    effects.push({
      type: 'eventDeck',
      op: 'add',
      deck,
      events: [`${DECK_PREFIX[deck]}-${String(deckEventNo++).padStart(2, '0')}`],
    });
  }
  if (r === 3)
    effects.push(
      { type: 'adjust', target: 'soldiers', amount: -1 },
      { type: 'adjust', target: 'defense', amount: -2 },
    );
  if (r === 4)
    effects.push({
      type: 'addCalendarSection',
      section: calendarRefs[(i + 7) % calendarRefs.length]!,
      weeksAhead: int(1, 4),
    });
  if (r === 5) effects.push({ type: 'manual', note: 'Test calendar step: check the outpost' });
  addSection(ref, `Test calendar event ${i + 1}`, effects);
});

// Season changes add/remove seasonal event cards; printed on the calendar.
const calendarPreprinted: { week: number; sections: string[] }[] = [];
for (let s = 1; s * WEEKS_PER_SEASON < SHEET_WEEKS; s++) {
  const ref = `150.${s}`;
  const winter = s % 2 === 1;
  addSection(ref, `Test season change ${s}`, [
    {
      type: 'eventDeck',
      op: 'add',
      deck: winter ? 'winter outpost' : 'summer outpost',
      events: [`${winter ? 'TWO' : 'TSO'}-S${s}`],
    },
    {
      type: 'eventDeck',
      op: 'remove',
      deck: winter ? 'summer road' : 'winter road',
      events: [`${winter ? 'TSR' : 'TWR'}-01`],
    },
  ]);
  calendarPreprinted.push({ week: s * WEEKS_PER_SEASON + 1, sections: [ref] });
}
// A week with two printed sections, and one early printed section.
calendarPreprinted.push({ week: 3, sections: [calendarRefs[0]!, calendarRefs[5]!] });
calendarPreprinted.sort((a, b) => a.week - b.week);

// Morale extremes.
addSection('155.1', 'Test morale collapse', [
  { type: 'setMorale', value: 4 },
  { type: 'adjust', target: 'prosperity', amount: -1 },
  { type: 'manual', note: 'Test: one building is wrecked' },
]);
addSection('155.2', 'Test morale peak', [
  { type: 'setMorale', value: null },
  { type: 'adjust', target: 'inspiration', amount: 2 },
]);

// ---------------------------------------------------------------- filler / story sections

fillerRefs.forEach((ref, i) => {
  const effects: Effect[] = [];
  if (leftoverClasses.length && i % 17 === 3)
    effects.push({ type: 'unlockClass', classKey: leftoverClasses.shift()! });
  else if (leftoverBuildings.length && i % 17 === 9)
    effects.push({ type: 'unlockBuilding', number: leftoverBuildings.shift()! });
  else if (i === 40)
    effects.push({ type: 'unlockClass', classKey: null }); // "choose a class" variant
  else if (i === 41) effects.push({ type: 'unlockBuilding', number: null });
  else if (i % 9 === 0) effects.push({ type: 'gainCampaignSticker', name: `Test Story Mark ${i}` });
  else if (i % 7 === 0)
    effects.push({
      type: 'adjust',
      target: pick(['morale', 'prosperity', 'inspiration'] as const),
      amount: int(1, 2),
    });
  else if (i % 11 === 0)
    effects.push({
      type: 'chooseOne',
      options: [
        { type: 'adjust', target: 'morale', amount: 1 },
        { type: 'adjust', target: 'prosperity', amount: 1 },
        { type: 'manual', note: 'Test: gain a random item' },
      ],
    });
  // Chains only go forward, so readSection never loops.
  else if (i % 13 === 0 && i + 1 < fillerRefs.length)
    effects.push({ type: 'readSection', ref: fillerRefs[i + 1]! });
  addSection(ref, i % 4 === 0 ? '' : `Test story ${ref}`, effects);
});

// ---------------------------------------------------------------- items & personal quests

const ITEM_TYPES = ['head', 'body', 'legs', 'onehand', 'twohand', 'small'] as const;
const items = Array.from({ length: 250 }, (_, i) => {
  const number = i + 1;
  const type = i % 50 === 49 ? null : ITEM_TYPES[i % ITEM_TYPES.length]!;
  const bought = i < 120;
  const crafted = !bought && i < 230;
  return {
    number,
    name: `Test ${pick(ADJ)} ${type === 'small' ? 'Charm' : type === 'head' ? 'Helm' : type === 'body' ? 'Coat' : type === 'legs' ? 'Boots' : type === 'twohand' ? 'Glaive' : 'Blade'} ${number}`,
    type,
    goldCost: bought ? int(2, 16) * 5 : null,
    craftCostCount: crafted ? int(1, 5) : null,
    quantity: i >= 230 ? null : pick([1, 1, 2, 2, 2, 4]),
  };
});

const personalQuests = Array.from({ length: 24 }, (_, i) => ({
  number: 501 + i,
  name: `Test quest: ${pick(['Find', 'Protect', 'Collect', 'Defeat', 'Explore'])} the ${pick(ADJ)} ${pick(NOUN)}`,
  envelope: i % 6 === 5 ? null : pick(['A', 'B', 'C', 'D']),
  altEnvelope: i % 3 === 0 ? pick(['E', 'F', 'G']) : null,
}));

// ---------------------------------------------------------------- rule tables & manifest

const ruleTables = {
  calendar: { weeksPerSeason: WEEKS_PER_SEASON, seasons: ['summer', 'winter'] },
  resources,
  levels: { xpThresholds: [0, 45, 95, 150, 210, 275, 345, 420, 500] },
  checkmarks: { perPerkMark: 3, max: 18 },
  startingGold: { perProsperityLevel: 10, base: 20 },
  prosperity: { thresholds: [6, 15, 26, 39, 54, 71, 90, 111] },
  retirement: { prosperityGain: 2 },
  scenarioLevel: {
    goldConversion: [2, 2, 3, 3, 4, 4, 5, 6],
    bonusXp: [4, 6, 8, 10, 12, 14, 16, 18],
  },
  inspiration: { base: 4 },
  morale: {
    min: 0,
    max: 20,
    defenseModifiers: [
      { from: 0, to: 2, modifier: -10 },
      { from: 3, to: 4, modifier: -5 },
      { from: 15, to: 17, modifier: 5 },
      { from: 18, to: 20, modifier: 10 },
    ],
    minSection: '155.1',
    maxSection: '155.2',
  },
  calendarPreprinted,
  calendarSheetWeeks: SHEET_WEEKS,
  outpost: { secondBuildMoraleCost: 2, repairMoraleCost: 1 },
};

const manifest = {
  format: 1,
  name: 'Test data (large fictional seed, not game content)',
  version: '1.0.0',
  locale: 'en',
};

// ---------------------------------------------------------------- write

const sortedSections = [...sections.values()].sort((a, b) => {
  const [an, ak] = (a.ref as string).split('.').map(Number);
  const [bn, bk] = (b.ref as string).split('.').map(Number);
  return an! - bn! || ak! - bk!;
});

mkdirSync(outDir, { recursive: true });
const files: Record<string, unknown> = {
  'manifest.json': manifest,
  'rule-tables.json': ruleTables,
  'classes.json': classes,
  'items.json': items,
  'personal-quests.json': personalQuests,
  'scenarios.json': scenarios,
  'sections.json': sortedSections,
  'buildings.json': buildings,
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 2) + '\n');
}
console.log(
  `Wrote ${outDir}/: ${scenarios.length} scenarios, ${sortedSections.length} sections, ` +
    `${classes.length} classes, ${items.length} items, ${personalQuests.length} personal quests, ` +
    `${buildings.length} buildings`,
);
