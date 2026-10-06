import { initTRPC, TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { CampaignRole } from '@fht/shared';
import { campaignMembers } from '../db/schema.ts';
import type { Context } from './context.ts';

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    // Unexpected errors (e.g. from the database) are logged, not shown to clients in production.
    const hide = error.code === 'INTERNAL_SERVER_ERROR' && process.env.NODE_ENV === 'production';
    return {
      ...shape,
      message: hide ? 'Internal server error' : shape.message,
      data: {
        ...shape.data,
        zodIssues: error.cause instanceof ZodError ? error.cause.issues : undefined,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isSiteAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});

/**
 * Loads the caller's membership in a campaign and enforces a minimum role.
 * Non-members get NOT_FOUND so campaign ids can't be probed.
 */
export async function requireMembership(
  ctx: Pick<Context, 'db'> & { user: { id: string } },
  campaignId: string,
  minRole: CampaignRole = 'player',
): Promise<{ role: CampaignRole }> {
  const rows = await ctx.db
    .select({ role: campaignMembers.role })
    .from(campaignMembers)
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, ctx.user.id)))
    .limit(1);
  const m = rows[0];
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
  if (minRole === 'host' && m.role !== 'host') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only campaign hosts can do this' });
  }
  return m;
}
