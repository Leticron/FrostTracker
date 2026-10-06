import { TRPCError } from '@trpc/server';
import type { RuleTables } from '@fht/shared';
import { AuditRecorder } from '../audit.ts';
import type { Tx } from '../db/client.ts';
import type { campaigns } from '../db/schema.ts';
import type { Context } from '../trpc/context.ts';
import { requireMembership } from '../trpc/trpc.ts';
import { campaignData } from './campaign-data.ts';
import { ensureSetup } from './campaign-state.ts';

export interface HostTx {
  tx: Tx;
  campaign: typeof campaigns.$inferSelect;
  rules: RuleTables;
  dataSetId: string;
  rec: AuditRecorder;
}

/**
 * Runs a host-only campaign change in one transaction: checks the role, locks the campaign
 * row, makes sure the campaign is set up, and writes all audit entries as one group.
 */
export async function hostTx<T>(
  ctx: Context & { user: NonNullable<Context['user']> },
  campaignId: string,
  fn: (h: HostTx) => Promise<T>,
  minRole: 'host' | 'player' = 'host',
): Promise<T & { auditGroupId: string }> {
  await requireMembership(ctx, campaignId, minRole);
  return ctx.db.transaction(async (tx) => {
    const data = await campaignData(tx, campaignId, true);
    const campaign = await ensureSetup(tx, data.campaign);
    const rec = new AuditRecorder(tx, campaignId);
    const result = await fn({ tx, campaign, rules: data.rules, dataSetId: data.dataSetId, rec });
    const auditGroupId = await rec.flush(ctx.user.id);
    return { ...result, auditGroupId };
  });
}

export function badRequest(message: string): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message });
}
