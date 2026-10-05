import { z } from 'zod';

/**
 * Machine-applicable effects of a section (design §5). Anything that can't be expressed here is a
 * `manual` note the host resolves by hand.
 */
const counterTarget = z.enum(['morale', 'prosperity', 'inspiration', 'soldiers', 'defense']);
export type CounterTarget = z.infer<typeof counterTarget>;

const baseEffect = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('unlockScenario'),
    scenario: z.number().int().min(0),
    link: z.enum(['linked', 'forced']).nullable().default(null),
    /** Free-text condition from the book ("If X is complete:"); the host confirms it. */
    condition: z.string().nullable().default(null),
  }),
  z.object({ type: z.literal('lockOutScenario'), scenario: z.number().int().min(0) }),
  z.object({ type: z.literal('gainCampaignSticker'), name: z.string().min(1) }),
  z.object({ type: z.literal('loseCampaignSticker'), name: z.string().min(1) }),
  z.object({ type: z.literal('adjust'), target: counterTarget, amount: z.number().int() }),
  z.object({ type: z.literal('setMorale'), value: z.number().int().nullable().default(null) }),
  z.object({
    type: z.literal('addCalendarSection'),
    section: z.string().min(1),
    weeksAhead: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('eventDeck'),
    op: z.enum(['add', 'remove']),
    deck: z.string().min(1),
    events: z.array(z.string().min(1)).min(1),
  }),
  z.object({ type: z.literal('unlockClass'), classKey: z.string().nullable().default(null) }),
  z.object({
    type: z.literal('unlockBuilding'),
    number: z.number().int().min(0).nullable().default(null),
  }),
  z.object({ type: z.literal('readSection'), ref: z.string().min(1) }),
  z.object({ type: z.literal('manual'), note: z.string().min(1) }),
]);

export type BaseEffect = z.infer<typeof baseEffect>;

export const effect = z.union([
  baseEffect,
  z.object({
    type: z.literal('chooseOne'),
    options: z.array(baseEffect).min(2),
  }),
]);
export type Effect = z.infer<typeof effect>;
