import { z } from 'zod';
import { perkDef } from './seed.ts';

export const characterStatus = z.enum(['active', 'set_aside', 'abandoned', 'retired', 'dead']);
export type CharacterStatus = z.infer<typeof characterStatus>;

export const characterIdInput = z.object({ characterId: z.uuid() });

export const createCharacterInput = z.object({
  campaignId: z.uuid(),
  classKey: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  /** Optional start above level 1 (allowed up to half the prosperity level, rounded up). */
  startLevel: z.number().int().min(1).max(20).default(1),
  /** Owner; hosts may create characters for other members. Defaults to the caller. */
  ownerUserId: z.uuid().optional(),
});

/** Fields that +/- controls adjust. Resources use `resource:<key>`. */
export const counterField = z.union([
  z.enum(['xp', 'gold', 'checkmarks']),
  z.string().regex(/^resource:[a-z0-9-]+$/),
]);

export const adjustCharacterInput = z.object({
  characterId: z.uuid(),
  field: counterField,
  delta: z.number().int().min(-1000).max(1000),
});

export const updateCharacterInput = z.object({
  characterId: z.uuid(),
  name: z.string().trim().min(1).max(60).optional(),
  notes: z.string().max(10_000).optional(),
  personalQuestNumber: z.number().int().min(0).nullable().optional(),
  personalQuestText: z.string().max(200).nullable().optional(),
  personalQuestProgress: z.string().max(2_000).optional(),
});

export const setPerkMarksInput = z.object({
  characterId: z.uuid(),
  perkIndex: z.number().int().min(0),
  marked: z.number().int().min(0).max(10),
});

export const setMasteryInput = z.object({
  characterId: z.uuid(),
  masteryIndex: z.number().int().min(0),
  achieved: z.boolean(),
});

export const levelUpInput = z.object({
  characterId: z.uuid(),
  /** 'xp': required level-up from experience; 'prosperity': optional catch-up level-up. */
  mode: z.enum(['xp', 'prosperity']),
});

export const addItemInput = z.object({
  characterId: z.uuid(),
  itemNumber: z.number().int().min(0).optional(),
  name: z.string().trim().min(1).max(80).optional(),
});

export const sellItemInput = z.object({
  characterItemId: z.uuid(),
  /** Gold received; when the item catalog has costs, the server computes it and this is ignored. */
  gold: z.number().int().min(0).max(1000).optional(),
});

export const transferToSupplyInput = z.object({
  characterId: z.uuid(),
  resourceKey: z.string().min(1),
  amount: z.number().int().min(1).max(1000),
});

export const statusChangeInput = z.object({
  characterId: z.uuid(),
  action: z.enum(['set_aside', 'reactivate', 'abandon', 'retire']),
});

export const revertInput = z.object({ groupId: z.uuid() });

export const updateClassInput = z.object({
  dataSetId: z.uuid(),
  key: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  starting: z.boolean(),
  perks: z.array(perkDef).max(30),
  masteries: z.array(z.string().trim().min(1).max(300)).max(5),
  maxHpByLevel: z.array(z.number().int().positive()).max(20).nullable(),
  handSize: z.number().int().positive().max(30).nullable(),
});
