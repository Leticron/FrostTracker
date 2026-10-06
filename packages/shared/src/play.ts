import { z } from 'zod';
import { effect } from './effects.ts';

const campaignId = z.uuid();

export const campaignCounter = z.enum([
  'morale',
  'prosperity',
  'inspiration',
  'soldiers',
  'defense',
]);

export const adjustCampaignInput = z.object({
  campaignId,
  field: z.union([campaignCounter, z.string().regex(/^supply:[a-z0-9-]+$/)]),
  delta: z.number().int().min(-100).max(100),
});

export const stickerInput = z.object({
  campaignId,
  name: z.string().trim().min(1).max(80),
  delta: z.union([z.literal(1), z.literal(-1)]),
});

export const treasureInput = z.object({
  campaignId,
  number: z.number().int().min(0).max(999),
  looted: z.boolean(),
});

export const calendarAddInput = z.object({
  campaignId,
  section: z.string().regex(/^\d{1,3}\.\d{1,2}$/),
  weeksAhead: z.number().int().min(1).max(200),
});

export const calendarResolveInput = z.object({
  campaignId,
  entryId: z.uuid(),
  resolved: z.boolean(),
});

export const scenarioStatusInput = z.object({
  campaignId,
  scenario: z.number().int().min(0),
  status: z.enum(['locked', 'unlocked', 'completed', 'locked_out']),
});

export const requirementOverrideInput = z.object({
  campaignId,
  scenario: z.number().int().min(0),
  override: z.boolean(),
});

export const applySectionInput = z.object({
  campaignId,
  ref: z.string().regex(/^\d{1,3}\.\d{1,2}$/),
  /** Effects after the host reviewed/edited them; chooseOne must already be resolved. */
  effects: z.array(effect).max(50),
  sessionId: z.uuid().optional(),
});

export const participantInput = z.object({
  characterId: z.uuid(),
  /** Money from loot cards (converted to gold by scenario level). */
  coins: z.number().int().min(0).max(200).default(0),
  /** XP from the character dial. */
  xp: z.number().int().min(0).max(200).default(0),
  /** Battle goal checkmarks (only applied when completed). */
  checkmarks: z.number().int().min(0).max(10).default(0),
  /** Indices of masteries newly achieved (only applied when completed). */
  masteries: z.array(z.number().int().min(0)).max(5).default([]),
  /** Resources from loot cards: key -> amount. */
  resources: z.record(z.string(), z.number().int().min(0).max(100)).default({}),
});

export const sessionInput = z.object({
  campaignId,
  date: z.iso.date(),
  scenario: z.number().int().min(0).nullable(),
  scenarioLevel: z.number().int().min(0).max(7),
  outcome: z.enum(['completed', 'lost']),
  lostChoice: z.enum(['return', 'replay']).nullable().default(null),
  casual: z.boolean().default(false),
  notes: z.string().max(5000).default(''),
  participants: z.array(participantInput).min(1).max(8),
});
export type SessionInput = z.infer<typeof sessionInput>;

export const sessionIdInput = z.object({ sessionId: z.uuid() });

export const outpostStepInput = z.object({
  campaignId,
  step: z.number().int().min(1).max(5),
  notes: z.string().max(2000).optional(),
});

export const eventLogInput = z.object({
  campaignId,
  kind: z.enum(['road', 'outpost']),
  eventRef: z.string().trim().min(1).max(20),
  option: z.string().trim().max(20).default(''),
  note: z.string().max(2000).default(''),
});

export const buildingInput = z.object({
  campaignId,
  number: z.number().int().min(0).max(999),
  name: z.string().trim().max(60).optional(),
  action: z.enum([
    'unlock',
    'build',
    'upgrade',
    'wreck',
    'rebuild',
    'damage_repair_pay',
    'damage_repair_morale',
    'set_level',
  ]),
  level: z.number().int().min(0).max(10).optional(),
  /** Construction steps beyond the first in an outpost phase cost morale. */
  extraBuild: z.boolean().default(false),
});

export const mapLayer = z.enum(['world', 'town']);
export type MapLayer = z.infer<typeof mapLayer>;

/** Host "place markers" mode: position relative to the map image, or null to remove it. */
export const setMarkerInput = z.object({
  campaignId,
  scenario: z.number().int().min(0),
  marker: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), layer: mapLayer })
    .nullable(),
});
