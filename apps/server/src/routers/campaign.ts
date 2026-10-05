import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  acceptInviteInput,
  campaignIdInput,
  createCampaignInput,
  createInviteInput,
  setMemberRoleInput,
} from '@fht/shared';
import { writeAudit } from '../audit.ts';
import { sha256Hex } from '../auth/session.ts';
import type { Tx } from '../db/client.ts';
import {
  campaignClassUnlocks,
  campaignMembers,
  campaigns,
  characters,
  gameDataSets,
  invites,
  users,
} from '../db/schema.ts';
import { generateInviteCode, redeemInvite } from '../services/invites.ts';
import { latestDataSetId } from '../services/seed.ts';
import { availableClassKeys } from '../services/campaign-data.ts';
import { authedProcedure, requireMembership, router } from '../trpc/trpc.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

async function hostCount(tx: Tx, campaignId: string): Promise<number> {
  const r = await tx
    .select({ n: count() })
    .from(campaignMembers)
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.role, 'host')));
  return r[0]?.n ?? 0;
}

export const campaignRouter = router({
  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        partyName: campaigns.partyName,
        role: campaignMembers.role,
        updatedAt: campaigns.updatedAt,
      })
      .from(campaignMembers)
      .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
      .where(eq(campaignMembers.userId, ctx.user.id))
      .orderBy(desc(campaigns.updatedAt)),
  ),

  create: authedProcedure.input(createCampaignInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(campaigns)
        .values({
          name: input.name,
          partyName: input.partyName || null,
          createdBy: ctx.user.id,
          // New campaigns pin the newest game data set; re-imports don't change running campaigns.
          gameDataSetId: await latestDataSetId(tx),
        })
        .returning();
      await tx
        .insert(campaignMembers)
        .values({ campaignId: c!.id, userId: ctx.user.id, role: 'host' });
      await writeAudit(tx, ctx.user.id, [
        { campaignId: c!.id, entity: 'campaign', entityId: c!.id, action: 'create', after: c },
      ]);
      return { id: c!.id };
    }),
  ),

  get: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    const { role } = await requireMembership(ctx, input.campaignId);
    const rows = await ctx.db.select().from(campaigns).where(eq(campaigns.id, input.campaignId));
    const campaign = rows[0]!;
    const [dataSet] = campaign.gameDataSetId
      ? await ctx.db
          .select({ id: gameDataSets.id, name: gameDataSets.name, version: gameDataSets.version })
          .from(gameDataSets)
          .where(eq(gameDataSets.id, campaign.gameDataSetId))
      : [];
    return { campaign, role, dataSet: dataSet ?? null };
  }),

  update: authedProcedure
    .input(
      campaignIdInput.extend({
        name: z.string().trim().min(1).max(80),
        partyName: z.string().trim().max(80).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx, input.campaignId, 'host');
      return ctx.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, input.campaignId));
        const [after] = await tx
          .update(campaigns)
          .set({
            name: input.name,
            partyName: input.partyName || null,
            version: before!.version + 1,
          })
          .where(eq(campaigns.id, input.campaignId))
          .returning();
        await writeAudit(tx, ctx.user.id, [
          {
            campaignId: input.campaignId,
            entity: 'campaign',
            entityId: input.campaignId,
            action: 'update',
            before: { name: before!.name, partyName: before!.partyName },
            after: { name: after!.name, partyName: after!.partyName },
          },
        ]);
        return after!;
      });
    }),

  members: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    return ctx.db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        role: campaignMembers.role,
        joinedAt: campaignMembers.joinedAt,
      })
      .from(campaignMembers)
      .innerJoin(users, eq(users.id, campaignMembers.userId))
      .where(eq(campaignMembers.campaignId, input.campaignId))
      .orderBy(asc(campaignMembers.joinedAt));
  }),

  setRole: authedProcedure.input(setMemberRoleInput).mutation(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId, 'host');
    return ctx.db.transaction(async (tx) => {
      const [m] = await tx
        .select()
        .from(campaignMembers)
        .where(
          and(
            eq(campaignMembers.campaignId, input.campaignId),
            eq(campaignMembers.userId, input.userId),
          ),
        );
      if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      if (m.role === input.role) return { ok: true };
      if (m.role === 'host' && (await hostCount(tx, input.campaignId)) <= 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A campaign needs at least one host' });
      }
      await tx
        .update(campaignMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(campaignMembers.campaignId, input.campaignId),
            eq(campaignMembers.userId, input.userId),
          ),
        );
      await writeAudit(tx, ctx.user.id, [
        {
          campaignId: input.campaignId,
          entity: 'campaign_member',
          entityId: input.userId,
          action: 'set_role',
          before: { role: m.role },
          after: { role: input.role },
        },
      ]);
      return { ok: true };
    });
  }),

  /** Hosts can remove anyone; every member can remove themselves (leave). */
  removeMember: authedProcedure
    .input(campaignIdInput.extend({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(
        ctx,
        input.campaignId,
        input.userId === ctx.user.id ? 'player' : 'host',
      );
      return ctx.db.transaction(async (tx) => {
        const [m] = await tx
          .select()
          .from(campaignMembers)
          .where(
            and(
              eq(campaignMembers.campaignId, input.campaignId),
              eq(campaignMembers.userId, input.userId),
            ),
          );
        if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
        if (m.role === 'host' && (await hostCount(tx, input.campaignId)) <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A campaign needs at least one host',
          });
        }
        await tx
          .delete(campaignMembers)
          .where(
            and(
              eq(campaignMembers.campaignId, input.campaignId),
              eq(campaignMembers.userId, input.userId),
            ),
          );
        await writeAudit(tx, ctx.user.id, [
          {
            campaignId: input.campaignId,
            entity: 'campaign_member',
            entityId: input.userId,
            action: 'remove',
            before: { role: m.role },
          },
        ]);
        return { ok: true };
      });
    }),

  createInvite: authedProcedure.input(createInviteInput).mutation(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId, 'host');
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + input.expiresInDays * DAY_MS);
    await ctx.db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(invites)
        .values({
          campaignId: input.campaignId,
          codeHash: sha256Hex(code),
          role: input.role,
          expiresAt,
          maxUses: input.maxUses,
          createdBy: ctx.user.id,
        })
        .returning({ id: invites.id });
      await writeAudit(tx, ctx.user.id, [
        {
          campaignId: input.campaignId,
          entity: 'invite',
          entityId: inv!.id,
          action: 'create',
          after: { role: input.role, expiresAt, maxUses: input.maxUses },
        },
      ]);
    });
    // The plain code is only returned here; the database stores its hash.
    return { code, joinPath: `/join/${code}`, expiresAt };
  }),

  invites: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId, 'host');
    return ctx.db
      .select({
        id: invites.id,
        role: invites.role,
        expiresAt: invites.expiresAt,
        maxUses: invites.maxUses,
        uses: invites.uses,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(and(eq(invites.campaignId, input.campaignId), isNull(invites.revokedAt)))
      .orderBy(desc(invites.createdAt));
  }),

  revokeInvite: authedProcedure
    .input(campaignIdInput.extend({ inviteId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx, input.campaignId, 'host');
      return ctx.db.transaction(async (tx) => {
        const res = await tx
          .update(invites)
          .set({ revokedAt: new Date() })
          .where(and(eq(invites.id, input.inviteId), eq(invites.campaignId, input.campaignId)))
          .returning({ id: invites.id });
        if (!res[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
        await writeAudit(tx, ctx.user.id, [
          {
            campaignId: input.campaignId,
            entity: 'invite',
            entityId: input.inviteId,
            action: 'revoke',
          },
        ]);
        return { ok: true };
      });
    }),

  /** Pin a game data set (only while no characters exist, so references stay consistent). */
  setDataSet: authedProcedure
    .input(campaignIdInput.extend({ dataSetId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx, input.campaignId, 'host');
      return ctx.db.transaction(async (tx) => {
        const [c] = await tx
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, input.campaignId))
          .for('update');
        const [set] = await tx
          .select({ id: gameDataSets.id })
          .from(gameDataSets)
          .where(eq(gameDataSets.id, input.dataSetId));
        if (!set) throw new TRPCError({ code: 'NOT_FOUND', message: 'Data set not found' });
        if (c!.gameDataSetId && c!.gameDataSetId !== input.dataSetId) {
          const [{ n } = { n: 0 }] = await tx
            .select({ n: count() })
            .from(characters)
            .where(eq(characters.campaignId, input.campaignId));
          if (n > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Switching game data with existing characters is not supported yet',
            });
          }
        }
        await tx
          .update(campaigns)
          .set({ gameDataSetId: input.dataSetId, version: c!.version + 1 })
          .where(eq(campaigns.id, input.campaignId));
        await writeAudit(tx, ctx.user.id, [
          {
            campaignId: input.campaignId,
            entity: 'campaign',
            entityId: input.campaignId,
            action: 'set_data_set',
            before: { gameDataSetId: c!.gameDataSetId },
            after: { gameDataSetId: input.dataSetId },
          },
        ]);
        return { ok: true };
      });
    }),

  /** Class unlocks (new classes become available for character creation). RULE: R-CHAR-22 */
  classUnlocks: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    const [c] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, input.campaignId));
    if (!c?.gameDataSetId) return [];
    const classes = await availableClassKeys(ctx.db, input.campaignId, c.gameDataSetId);
    return classes.map((k) => ({
      key: k.key,
      name: k.name,
      starting: k.starting,
      unlocked: k.unlocked,
    }));
  }),

  setClassUnlocked: authedProcedure
    .input(campaignIdInput.extend({ classKey: z.string().min(1), unlocked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx, input.campaignId, 'host');
      return ctx.db.transaction(async (tx) => {
        if (input.unlocked) {
          await tx
            .insert(campaignClassUnlocks)
            .values({ campaignId: input.campaignId, classKey: input.classKey })
            .onConflictDoNothing();
        } else {
          await tx
            .delete(campaignClassUnlocks)
            .where(
              and(
                eq(campaignClassUnlocks.campaignId, input.campaignId),
                eq(campaignClassUnlocks.classKey, input.classKey),
              ),
            );
        }
        await writeAudit(tx, ctx.user.id, [
          {
            campaignId: input.campaignId,
            entity: 'class_unlock',
            entityId: input.classKey,
            action: input.unlocked ? 'unlock_class' : 'lock_class',
          },
        ]);
        return { ok: true };
      });
    }),

  acceptInvite: authedProcedure
    .input(acceptInviteInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction((tx) => redeemInvite(tx, input.code, ctx.user.id)),
    ),
});
