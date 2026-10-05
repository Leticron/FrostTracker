import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { ClassDef, RuleTables } from '@fht/shared';
import type { Db, Tx } from '../db/client.ts';
import { campaignClassUnlocks, campaigns, classDefs, gameDataSets } from '../db/schema.ts';

export interface CampaignData {
  campaign: typeof campaigns.$inferSelect;
  dataSetId: string;
  rules: RuleTables;
}

/** Loads a campaign together with its pinned game data set (rule tables). */
export async function campaignData(
  db: Db | Tx,
  campaignId: string,
  lock = false,
): Promise<CampaignData> {
  const q = db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const [campaign] = lock ? await q.for('update') : await q;
  if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
  if (!campaign.gameDataSetId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'This campaign has no game data yet. An admin must import a seed first.',
    });
  }
  const [set] = await db
    .select({ ruleTables: gameDataSets.ruleTables })
    .from(gameDataSets)
    .where(eq(gameDataSets.id, campaign.gameDataSetId));
  return { campaign, dataSetId: campaign.gameDataSetId, rules: set!.ruleTables };
}

export async function classDef(
  db: Db | Tx,
  dataSetId: string,
  key: string,
): Promise<ClassDef | null> {
  const [c] = await db
    .select()
    .from(classDefs)
    .where(and(eq(classDefs.dataSetId, dataSetId), eq(classDefs.key, key)));
  return c ?? null;
}

/**
 * Classes a new character may choose: starting classes plus classes unlocked in this campaign.
 * RULE: R-CHAR-22
 */
export async function availableClassKeys(db: Db | Tx, campaignId: string, dataSetId: string) {
  const all = await db.select().from(classDefs).where(eq(classDefs.dataSetId, dataSetId));
  const unlocked = await db
    .select({ key: campaignClassUnlocks.classKey })
    .from(campaignClassUnlocks)
    .where(eq(campaignClassUnlocks.campaignId, campaignId));
  const unlockedSet = new Set(unlocked.map((u) => u.key));
  return all.map((c) => ({
    ...c,
    available: c.starting || unlockedSet.has(c.key),
    unlocked: unlockedSet.has(c.key),
  }));
}
