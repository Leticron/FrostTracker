import { z } from 'zod';
import { effect } from './effects.ts';

/**
 * Seed-data format (design/ARCHITECTURE.md §5). A seed is a directory of JSON files.
 * All game-specific values (names, numbers, tables) live in seeds, never in code.
 */
export const seedManifest = z.object({
  format: z.literal(1),
  name: z.string().min(1),
  version: z.string().min(1),
  locale: z.string().min(2).default('en'),
});
export type SeedManifest = z.infer<typeof seedManifest>;

const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and "-"');

export const resourceDef = z.object({
  key,
  name: z.string().min(1),
  kind: z.enum(['material', 'herb']),
});
export type ResourceDef = z.infer<typeof resourceDef>;

export const ruleTables = z.object({
  calendar: z.object({
    weeksPerSeason: z.number().int().positive(),
    seasons: z.array(z.enum(['summer', 'winter'])).min(1),
  }),
  /** Resource types tracked per character and in the town supply. */
  resources: z.array(resourceDef).min(1),
  levels: z.object({
    /** XP needed for each level, index 0 = level 1 (normally 0). */
    xpThresholds: z.array(z.number().int().min(0)).min(1),
  }),
  checkmarks: z.object({
    perPerkMark: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
  startingGold: z.object({
    perProsperityLevel: z.number().int().min(0),
    base: z.number().int().min(0),
  }),
  prosperity: z.object({
    /** Cumulative marked boxes needed to reach level 2, 3, … (level 1 needs 0). null = unknown yet. */
    thresholds: z.array(z.number().int().positive().nullable()),
  }),
  retirement: z.object({ prosperityGain: z.number().int().min(0) }),
  scenarioLevel: z.object({
    /** Index = scenario level (0-based). */
    goldConversion: z.array(z.number().int().min(0)).min(1),
    bonusXp: z.array(z.number().int().min(0)).min(1),
  }),
  /** Inspiration gained on completion = base - number of characters (never below 0). */
  inspiration: z.object({ base: z.number().int().min(0) }),
  morale: z.object({
    min: z.number().int(),
    max: z.number().int(),
    /** Defense modifier by morale range (inclusive). Ranges without an entry have no modifier. */
    defenseModifiers: z.array(
      z.object({ from: z.number().int(), to: z.number().int(), modifier: z.number().int() }),
    ),
    minSection: z.string().nullable(),
    maxSection: z.string().nullable(),
  }),
  /** Sections printed on the calendar; week is the absolute week number (1 = first box). */
  calendarPreprinted: z.array(
    z.object({ week: z.number().int().positive(), sections: z.array(z.string().min(1)) }),
  ),
  /** Preprinted sections apply only to the first sheet (this many weeks). */
  calendarSheetWeeks: z.number().int().positive(),
  outpost: z.object({
    secondBuildMoraleCost: z.number().int().min(0),
    repairMoraleCost: z.number().int().min(0),
  }),
});
export type RuleTables = z.infer<typeof ruleTables>;

export const perkDef = z.object({
  text: z.string().min(1),
  /** Number of boxes; each box takes one perk mark. */
  boxes: z.number().int().min(1).max(10),
  /** Linked boxes must all be filled to gain the perk once. */
  linked: z.boolean().default(false),
});
export type PerkDef = z.infer<typeof perkDef>;

export const classDef = z.object({
  key,
  name: z.string().min(1),
  starting: z.boolean().default(false),
  perks: z.array(perkDef).default([]),
  masteries: z.array(z.string().min(1)).default([]),
  maxHpByLevel: z.array(z.number().int().positive()).nullable().default(null),
  handSize: z.number().int().positive().nullable().default(null),
});
export type ClassDef = z.infer<typeof classDef>;

export const itemDef = z.object({
  number: z.number().int().min(0),
  name: z.string().min(1),
  type: z.string().nullable().default(null),
  goldCost: z.number().int().min(0).nullable().default(null),
  /** Number of resources/items in the crafting cost (for the sell price of craftable items). */
  craftCostCount: z.number().int().min(0).nullable().default(null),
  quantity: z.number().int().min(1).nullable().default(null),
});
export type ItemDef = z.infer<typeof itemDef>;

export const personalQuestDef = z.object({
  number: z.number().int().min(0),
  name: z.string().min(1),
  envelope: z.string().nullable().default(null),
  altEnvelope: z.string().nullable().default(null),
});
export type PersonalQuestDef = z.infer<typeof personalQuestDef>;

export const requirement = z.union([
  z.object({
    campaignSticker: z.string().min(1),
    minCount: z.number().int().positive().default(1),
    via: z.string().optional(),
  }),
  z.object({ freeText: z.string().min(1) }),
]);
export type Requirement = z.infer<typeof requirement>;

export const scenarioDef = z.object({
  number: z.number().int().min(0),
  name: z.string().min(1),
  coord: z.string().nullable().default(null),
  region: z.string().nullable().default(null),
  complexity: z.number().int().min(1).max(3).nullable().default(null),
  requirements: z.array(requirement).default([]),
  conclusionSections: z.array(z.string()).default([]),
  initiallyUnlocked: z.boolean().default(false),
  marker: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      layer: z.enum(['world', 'town']).default('world'),
    })
    .nullable()
    .default(null),
});
export type ScenarioDef = z.infer<typeof scenarioDef>;

export const sectionDef = z.object({
  ref: z.string().regex(/^\d{1,3}\.\d{1,2}$/),
  title: z.string().default(''),
  scenario: z.number().int().min(0).nullable().default(null),
  effects: z.array(effect).default([]),
  /** Optional reminder text from the private seed (never shipped with the app). */
  rewardsText: z.string().nullable().default(null),
});
export type SectionDef = z.infer<typeof sectionDef>;

const cost = z.object({
  prosperity: z.number().int().min(0).nullable().default(null),
  resources: z.record(z.string(), z.number().int().min(0)).default({}),
});

export const buildingDef = z.object({
  number: z.number().int().min(0),
  name: z.string().min(1),
  /** In the building deck at campaign start (built at level 1). */
  starting: z.boolean().default(false),
  levels: z
    .array(
      z.object({
        level: z.number().int().min(0),
        /** Cost to reach this level (build for level 1, upgrade otherwise). */
        cost: cost.nullable().default(null),
        repairCost: z.number().int().min(0).nullable().default(null),
        rebuildCost: cost.nullable().default(null),
        maxSoldiers: z.number().int().min(0).nullable().default(null),
        prosperityGain: z.number().int().min(0).nullable().default(null),
      }),
    )
    .default([]),
});
export type BuildingDef = z.infer<typeof buildingDef>;

export const seedFiles = {
  manifest: { file: 'manifest.json', schema: seedManifest, required: true },
  ruleTables: { file: 'rule-tables.json', schema: ruleTables, required: true },
  classes: { file: 'classes.json', schema: z.array(classDef), required: false },
  items: { file: 'items.json', schema: z.array(itemDef), required: false },
  personalQuests: {
    file: 'personal-quests.json',
    schema: z.array(personalQuestDef),
    required: false,
  },
  scenarios: { file: 'scenarios.json', schema: z.array(scenarioDef), required: false },
  sections: { file: 'sections.json', schema: z.array(sectionDef), required: false },
  buildings: { file: 'buildings.json', schema: z.array(buildingDef), required: false },
} as const;

export const seedData = z.object({
  manifest: seedManifest,
  ruleTables,
  classes: z.array(classDef).default([]),
  items: z.array(itemDef).default([]),
  personalQuests: z.array(personalQuestDef).default([]),
  scenarios: z.array(scenarioDef).default([]),
  sections: z.array(sectionDef).default([]),
  buildings: z.array(buildingDef).default([]),
});
export type SeedData = z.infer<typeof seedData>;

/** Resource amounts keyed by resource key; missing keys mean 0. */
export const resourceBag = z.record(z.string(), z.number().int().min(0));
export type ResourceBag = z.infer<typeof resourceBag>;
