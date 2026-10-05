import { z } from 'zod';

/**
 * Seed-data format (design/ARCHITECTURE.md §5). Only the manifest and rule tables are
 * defined in the skeleton; catalog schemas are added in the phases that use them.
 */
export const seedManifest = z.object({
  format: z.literal(1),
  name: z.string().min(1),
  version: z.string().min(1),
  locale: z.string().min(2).default('en'),
});
export type SeedManifest = z.infer<typeof seedManifest>;

export const ruleTables = z.object({
  calendar: z.object({
    weeksPerSeason: z.number().int().positive(),
    seasons: z.array(z.enum(['summer', 'winter'])).min(1),
  }),
});
export type RuleTables = z.infer<typeof ruleTables>;
