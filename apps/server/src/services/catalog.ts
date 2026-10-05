import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { campaignMembers, campaigns } from '../db/schema.ts';

/**
 * Who may edit reference data of a data set: site admins, and hosts of any campaign that uses
 * it (decision P2-3; the app targets one group on a home server).
 */
export async function requireCatalogEditor(
  ctx: { db: Db; user: { id: string; isSiteAdmin: boolean } },
  dataSetId: string,
) {
  if (ctx.user.isSiteAdmin) return;
  const rows = await ctx.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .innerJoin(campaignMembers, eq(campaignMembers.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.gameDataSetId, dataSetId),
        eq(campaignMembers.userId, ctx.user.id),
        eq(campaignMembers.role, 'host'),
      ),
    )
    .limit(1);
  if (!rows[0])
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins and hosts can edit game data' });
}
