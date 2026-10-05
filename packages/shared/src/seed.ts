import { z } from 'zod';

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
} as const;

export const seedData = z.object({
  manifest: seedManifest,
  ruleTables,
  classes: z.array(classDef).default([]),
  items: z.array(itemDef).default([]),
  personalQuests: z.array(personalQuestDef).default([]),
});
export type SeedData = z.infer<typeof seedData>;

/** Resource amounts keyed by resource key; missing keys mean 0. */
export const resourceBag = z.record(z.string(), z.number().int().min(0));
export type ResourceBag = z.infer<typeof resourceBag>;
