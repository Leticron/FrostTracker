import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import {
  adjustCampaignInput,
  calendarAddInput,
  calendarResolveInput,
  campaignIdInput,
  eventLogInput,
  revertInput,
  stickerInput,
  treasureInput,
} from '@fht/shared';
import {
  applyEffects,
  moraleDefenseModifier,
  nextWeekPosition,
  prosperityLevel,
  prosperityLevelCap,
} from '@fht/rules';
import { revertGroup, RevertConflict } from '../audit.ts';
import {
  auditEntries,
  calendarEntries,
  campaigns,
  campaignStickers,
  eventDeckChanges,
  eventLog,
  outpostPhases,
  treasuresLooted,
  users,
} from '../db/schema.ts';
import { campaignData } from '../services/campaign-data.ts';
import { addCalendar, loadState, moraleSections, saveState } from '../services/campaign-state.ts';
import { badRequest, hostTx } from '../services/host-tx.ts';
import { authedProcedure, requireMembership, router } from '../trpc/trpc.ts';

export const stateRouter = router({
  /** Everything the campaign dashboard shows, with derived values. */
  get: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    const { role } = await requireMembership(ctx, input.campaignId);
    const { campaign, rules } = await campaignData(ctx.db, input.campaignId);
    const stickers = await ctx.db
      .select()
      .from(campaignStickers)
      .where(eq(campaignStickers.campaignId, campaign.id))
      .orderBy(asc(campaignStickers.name));
    const due = await ctx.db
      .select()
      .from(calendarEntries)
      .where(and(eq(calendarEntries.campaignId, campaign.id), isNull(calendarEntries.resolvedAt)))
      .orderBy(asc(calendarEntries.week));
    const treasures = await ctx.db
      .select({ number: treasuresLooted.number })
      .from(treasuresLooted)
      .where(eq(treasuresLooted.campaignId, campaign.id))
      .orderBy(asc(treasuresLooted.number));
    const [outpost] = await ctx.db
      .select()
      .from(outpostPhases)
      .where(and(eq(outpostPhases.campaignId, campaign.id), isNull(outpostPhases.closedAt)));
    const prosperity = prosperityLevel(campaign.prosperityChecks, rules.prosperity);
    const nextThreshold = rules.prosperity.thresholds[prosperity - 1] ?? null;
    const modifier = moraleDefenseModifier(campaign.morale, rules.morale);
    return {
      role,
      campaign,
      resources: rules.resources,
      derived: {
        // RULE: R-CAMP-02 - the season is the one of the next unmarked week
        next: nextWeekPosition(campaign.currentWeek, rules.calendar),
        prosperity,
        prosperityNextAt: nextThreshold,
        characterLevelCap: prosperityLevelCap(prosperity),
        moraleDefenseModifier: modifier,
        // RULE: R-CAMP-09
        effectiveDefense: campaign.defense + (modifier ?? 0),
        moraleRange: { min: rules.morale.min, max: rules.morale.max },
        moraleSections: moraleSections(campaign, rules),
      },
      stickers,
      calendar: due,
      treasures: treasures.map((t) => t.number),
      outpost: outpost ?? null,
    };
  }),

  /** +/- on campaign counters and the Frosthaven supply. */
  adjust: authedProcedure.input(adjustCampaignInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rules, rec }) => {
      if (input.field.startsWith('supply:')) {
        const key = input.field.slice('supply:'.length);
        if (!rules.resources.some((r) => r.key === key)) badRequest(`Unknown resource "${key}"`);
        const value = Math.max(0, (campaign.supply[key] ?? 0) + input.delta);
        await rec.update(
          'campaign',
          campaigns,
          campaign,
          { supply: { ...campaign.supply, [key]: value }, version: campaign.version + 1 },
          'adjust_supply',
        );
        return { readNext: [] as string[] };
      }
      if (input.field === 'morale' && campaign.morale === null) {
        badRequest('Set the starting morale first');
      }
      const loaded = await loadState(tx, campaign, rules);
      const out = applyEffects(
        loaded.state,
        [{ type: 'adjust', target: input.field as 'morale', amount: input.delta }],
        rules,
      );
      await saveState(rec, campaign, loaded, out.state, `adjust_${input.field}`);
      return { readNext: out.readNext };
    }),
  ),

  /** Starting morale is set by a section at the end of the first scenario. RULE: R-CAMP-07 */
  setMorale: authedProcedure
    .input(campaignIdInput.extend({ morale: z.number().int().min(0).max(100) }))
    .mutation(({ ctx, input }) =>
      hostTx(ctx, input.campaignId, async ({ campaign, rules, rec }) => {
        const morale = Math.min(rules.morale.max, Math.max(rules.morale.min, input.morale));
        await rec.update(
          'campaign',
          campaigns,
          campaign,
          { morale, version: campaign.version + 1 },
          'set_morale',
        );
        return {};
      }),
    ),

  /** The morale track sections can be replaced by the book ("cross out … write …"). */
  setMoraleSections: authedProcedure
    .input(
      campaignIdInput.extend({
        min: z.string().max(10).nullable(),
        max: z.string().max(10).nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      hostTx(ctx, input.campaignId, async ({ campaign, rec }) => {
        await rec.update(
          'campaign',
          campaigns,
          campaign,
          {
            moraleMinSection: input.min || null,
            moraleMaxSection: input.max || null,
            version: campaign.version + 1,
          },
          'set_morale_sections',
        );
        return {};
      }),
    ),

  /** RULE: R-CAMP-14 */
  sticker: authedProcedure.input(stickerInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rules, rec }) => {
      const loaded = await loadState(tx, campaign, rules);
      const out = applyEffects(
        loaded.state,
        [
          {
            type: input.delta > 0 ? 'gainCampaignSticker' : 'loseCampaignSticker',
            name: input.name,
          },
        ],
        rules,
      );
      await saveState(
        rec,
        campaign,
        loaded,
        out.state,
        input.delta > 0 ? 'gain_sticker' : 'lose_sticker',
      );
      return {};
    }),
  ),

  /** Numbered treasures can be looted once per campaign. RULE: R-SCN-15 */
  treasure: authedProcedure.input(treasureInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rec }) => {
      const [row] = await tx
        .select()
        .from(treasuresLooted)
        .where(
          and(
            eq(treasuresLooted.campaignId, campaign.id),
            eq(treasuresLooted.number, input.number),
          ),
        );
      if (input.looted && row) badRequest('This treasure was already looted');
      if (input.looted)
        await rec.insert(
          'treasure',
          treasuresLooted,
          { campaignId: campaign.id, number: input.number },
          'loot_treasure',
        );
      else if (row) await rec.delete('treasure', treasuresLooted, row, 'unloot_treasure');
      return {};
    }),
  ),

  calendarAdd: authedProcedure.input(calendarAddInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ campaign, rec }) => {
      await addCalendar(
        rec,
        campaign,
        [{ section: input.section, weeksAhead: input.weeksAhead }],
        'calendar_add',
      );
      return {};
    }),
  ),

  calendarResolve: authedProcedure.input(calendarResolveInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rec }) => {
      const [row] = await tx
        .select()
        .from(calendarEntries)
        .where(
          and(eq(calendarEntries.id, input.entryId), eq(calendarEntries.campaignId, campaign.id)),
        );
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendar entry not found' });
      await rec.update(
        'calendar_entry',
        calendarEntries,
        row,
        { resolvedAt: input.resolved ? new Date() : null },
        'calendar_resolve',
      );
      return {};
    }),
  ),

  calendarDue: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    const [c] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, input.campaignId));
    return ctx.db
      .select()
      .from(calendarEntries)
      .where(
        and(
          eq(calendarEntries.campaignId, input.campaignId),
          isNull(calendarEntries.resolvedAt),
          lte(calendarEntries.week, c!.currentWeek),
        ),
      );
  }),

  /** Road/outpost event log. RULE: R-OUT-04, R-SCN-16 */
  logEvent: authedProcedure.input(eventLogInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ campaign, rec }) => {
      await rec.insert(
        'event_log',
        eventLog,
        {
          campaignId: campaign.id,
          kind: input.kind,
          eventRef: input.eventRef,
          option: input.option,
          note: input.note,
          week: campaign.currentWeek,
        },
        'log_event',
      );
      return {};
    }),
  ),

  events: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    const events = await ctx.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.campaignId, input.campaignId))
      .orderBy(desc(eventLog.at))
      .limit(200);
    const deck = await ctx.db
      .select()
      .from(eventDeckChanges)
      .where(eq(eventDeckChanges.campaignId, input.campaignId))
      .orderBy(desc(eventDeckChanges.at))
      .limit(500);
    return { events, deck };
  }),

  /** Campaign-wide history (every audit group), newest first. */
  history: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    const { role } = await requireMembership(ctx, input.campaignId);
    const rows = await ctx.db
      .select({
        groupId: auditEntries.groupId,
        entity: auditEntries.entity,
        action: auditEntries.action,
        before: auditEntries.before,
        after: auditEntries.after,
        at: auditEntries.at,
        revertedBy: auditEntries.revertedBy,
        characterId: auditEntries.characterId,
        actorName: users.displayName,
      })
      .from(auditEntries)
      .leftJoin(users, eq(users.id, auditEntries.actorUserId))
      .where(eq(auditEntries.campaignId, input.campaignId))
      .orderBy(desc(auditEntries.at))
      .limit(1000);
    return { entries: rows, canRevert: role === 'host' };
  }),

  /** Hosts can revert any change group of their campaign. */
  revert: authedProcedure
    .input(revertInput.extend({ campaignId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx, input.campaignId, 'host');
      return ctx.db.transaction(async (tx) => {
        const entries = await tx
          .select()
          .from(auditEntries)
          .where(eq(auditEntries.groupId, input.groupId));
        if (!entries.length || entries.some((e) => e.campaignId !== input.campaignId)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'History entry not found' });
        }
        if (entries.some((e) => e.action === 'create' && e.entity === 'campaign'))
          badRequest('Campaign creation cannot be reverted');
        try {
          await revertGroup(tx, input.groupId, ctx.user.id);
        } catch (err) {
          if (err instanceof RevertConflict)
            throw new TRPCError({ code: 'CONFLICT', message: err.message });
          throw err;
        }
        // Reverting a session group deletes the session row (and its participants) again.
        return { ok: true };
      });
    }),
});
