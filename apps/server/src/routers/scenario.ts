import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  applySectionInput,
  campaignIdInput,
  requirementOverrideInput,
  scenarioStatusInput,
  type Effect,
} from '@fht/shared';
import { applyEffects, requirementMet, scenarioAvailability } from '@fht/rules';
import {
  campaignBuildings,
  campaignClassUnlocks,
  campaignScenarios,
  campaignStickers,
  buildingDefs,
  eventDeckChanges,
  scenarioDefs,
  sectionApplications,
  sectionDefs,
} from '../db/schema.ts';
import { campaignData } from '../services/campaign-data.ts';
import { addCalendar, loadState, saveState } from '../services/campaign-state.ts';
import { badRequest, hostTx } from '../services/host-tx.ts';
import { authedProcedure, requireMembership, router } from '../trpc/trpc.ts';

const sectionRef = z.string().regex(/^\d{1,3}\.\d{1,2}$/);

export const scenarioRouter = router({
  /** All scenarios with their campaign status and computed availability. RULE: R-SCN-02..04 */
  list: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    const { role } = await requireMembership(ctx, input.campaignId);
    const { dataSetId } = await campaignData(ctx.db, input.campaignId);
    const defs = await ctx.db
      .select()
      .from(scenarioDefs)
      .where(eq(scenarioDefs.dataSetId, dataSetId))
      .orderBy(asc(scenarioDefs.number));
    const rows = await ctx.db
      .select()
      .from(campaignScenarios)
      .where(eq(campaignScenarios.campaignId, input.campaignId));
    const stickers = await ctx.db
      .select()
      .from(campaignStickers)
      .where(eq(campaignStickers.campaignId, input.campaignId));
    const stickerMap = Object.fromEntries(stickers.map((s) => [s.name, s.count]));
    const byNum = new Map(rows.map((r) => [r.scenarioNumber, r]));
    const avail = scenarioAvailability(
      defs,
      new Map(rows.map((r) => [r.scenarioNumber, r])),
      stickerMap,
    );
    const list = defs.map((d, i) => ({
      number: d.number,
      name: d.name,
      coord: d.coord,
      region: d.region,
      complexity: d.complexity,
      requirements: d.requirements.map((r) => ({ ...r, met: requirementMet(r, stickerMap) })),
      status: avail[i]!.status,
      playable: avail[i]!.playable,
      timesCompleted: byNum.get(d.number)?.timesCompleted ?? 0,
      requirementOverride: byNum.get(d.number)?.requirementOverride ?? false,
      unlockedBy: byNum.get(d.number)?.unlockedBy ?? null,
      conclusionSections: d.conclusionSections,
      marker:
        d.markerX !== null && d.markerY !== null
          ? { x: d.markerX, y: d.markerY, layer: d.markerLayer ?? 'world' }
          : null,
    }));
    // Players never receive locked scenarios (names would be spoilers).
    return { role, scenarios: role === 'host' ? list : list.filter((s) => s.status !== 'locked') };
  }),

  /**
   * Which sections unlock/lock a scenario and with which link type (from section data).
   * Host only: for players this would reveal where locked scenarios come from.
   */
  sources: authedProcedure
    .input(campaignIdInput.extend({ scenario: z.number().int().min(0) }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.campaignId, 'host');
      const { dataSetId } = await campaignData(ctx.db, input.campaignId);
      const sections = await ctx.db
        .select()
        .from(sectionDefs)
        .where(eq(sectionDefs.dataSetId, dataSetId));
      const flat = (e: Effect): Effect[] => (e.type === 'chooseOne' ? e.options : [e]);
      const unlockedBy: { ref: string; link: string | null; condition: string | null }[] = [];
      const lockedOutBy: string[] = [];
      for (const s of sections) {
        for (const e of s.effects.flatMap(flat)) {
          if (e.type === 'unlockScenario' && e.scenario === input.scenario)
            unlockedBy.push({ ref: s.ref, link: e.link, condition: e.condition });
          if (e.type === 'lockOutScenario' && e.scenario === input.scenario)
            lockedOutBy.push(s.ref);
        }
      }
      return { unlockedBy, lockedOutBy };
    }),

  /** Manual correction of a scenario's state (e.g. unlocks from cards not in the books). */
  setStatus: authedProcedure.input(scenarioStatusInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rules, rec }) => {
      const loaded = await loadState(tx, campaign, rules);
      const next = { ...loaded.state, scenarios: new Map(loaded.state.scenarios) };
      const cur = next.scenarios.get(input.scenario);
      if (input.status === 'locked') next.scenarios.delete(input.scenario);
      else
        next.scenarios.set(input.scenario, {
          status: input.status,
          timesCompleted:
            input.status === 'completed'
              ? Math.max(1, cur?.timesCompleted ?? 0)
              : (cur?.timesCompleted ?? 0),
          requirementOverride: cur?.requirementOverride ?? false,
        });
      await saveState(rec, campaign, loaded, next, `scenario_${input.status}`, 'manual');
      return {};
    }),
  ),

  /** Host confirms free-text requirements (or overrides any requirement). RULE: R-SCN-04 */
  overrideRequirement: authedProcedure.input(requirementOverrideInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rec }) => {
      const [row] = await tx
        .select()
        .from(campaignScenarios)
        .where(
          and(
            eq(campaignScenarios.campaignId, campaign.id),
            eq(campaignScenarios.scenarioNumber, input.scenario),
          ),
        );
      if (!row) badRequest('The scenario is not unlocked');
      await rec.update(
        'campaign_scenario',
        campaignScenarios,
        row,
        { requirementOverride: input.override },
        'requirement_override',
      );
      return {};
    }),
  ),
});

export const sectionRouter = router({
  /** A section's data and pre-filled effects, for the host to review before applying. */
  get: authedProcedure
    .input(campaignIdInput.extend({ ref: sectionRef }))
    .query(async ({ ctx, input }) => {
      const { role } = await requireMembership(ctx, input.campaignId);
      const { dataSetId } = await campaignData(ctx.db, input.campaignId);
      const [def] = await ctx.db
        .select()
        .from(sectionDefs)
        .where(and(eq(sectionDefs.dataSetId, dataSetId), eq(sectionDefs.ref, input.ref)));
      const applied = await ctx.db
        .select({ at: sectionApplications.at })
        .from(sectionApplications)
        .where(
          and(
            eq(sectionApplications.campaignId, input.campaignId),
            eq(sectionApplications.sectionRef, input.ref),
          ),
        );
      // Players see that a section exists, but not its contents (spoilers stay with the host).
      if (role !== 'host')
        return {
          ref: input.ref,
          known: !!def,
          title: def?.title ?? '',
          scenario: null,
          effects: [],
          rewardsText: null,
          appliedAt: applied.map((a) => a.at),
        };
      return {
        ref: input.ref,
        known: !!def,
        title: def?.title ?? '',
        scenario: def?.scenarioNumber ?? null,
        effects: def?.effects ?? [],
        rewardsText: def?.rewardsText ?? null,
        appliedAt: applied.map((a) => a.at),
      };
    }),

  /** Applies reviewed effects of a section. RULE: R-SCN-05, R-SCN-19 */
  commit: authedProcedure.input(applySectionInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rules, dataSetId, rec }) => {
      if (input.effects.some((e) => e.type === 'chooseOne'))
        badRequest('Pick one option of each choice first');
      const loaded = await loadState(tx, campaign, rules);
      const out = applyEffects(loaded.state, input.effects, rules);
      const action = `section_${input.ref}`;
      const updated = await saveState(
        rec,
        campaign,
        loaded,
        out.state,
        action,
        `section ${input.ref}`,
      );
      await addCalendar(rec, updated, out.calendar, action);
      for (const d of out.eventDeck) {
        await rec.insert(
          'event_deck_change',
          eventDeckChanges,
          {
            campaignId: campaign.id,
            deck: d.deck,
            eventRef: d.event,
            op: d.op,
            sectionRef: input.ref,
          },
          action,
        );
      }
      for (const key of out.classUnlocks) {
        const [exists] = await tx
          .select()
          .from(campaignClassUnlocks)
          .where(
            and(
              eq(campaignClassUnlocks.campaignId, campaign.id),
              eq(campaignClassUnlocks.classKey, key),
            ),
          );
        if (!exists)
          await rec.insert(
            'class_unlock',
            campaignClassUnlocks,
            { campaignId: campaign.id, classKey: key },
            action,
          );
      }
      for (const number of out.buildingUnlocks) {
        const [exists] = await tx
          .select()
          .from(campaignBuildings)
          .where(
            and(
              eq(campaignBuildings.campaignId, campaign.id),
              eq(campaignBuildings.number, number),
            ),
          );
        if (exists) continue;
        const [def] = await tx
          .select()
          .from(buildingDefs)
          .where(and(eq(buildingDefs.dataSetId, dataSetId), eq(buildingDefs.number, number)));
        await rec.insert(
          'campaign_building',
          campaignBuildings,
          {
            campaignId: campaign.id,
            number,
            name: def?.name ?? `#${number}`,
            level: 0,
            state: 'unlocked',
          },
          action,
        );
      }
      await rec.insert(
        'section_application',
        sectionApplications,
        {
          campaignId: campaign.id,
          sectionRef: input.ref,
          effects: input.effects,
          appliedBy: ctx.user.id,
        },
        action,
      );
      for (const m of out.manual) rec.note('manual_step', { section: input.ref, note: m });
      return { readNext: out.readNext, manual: out.manual };
    }),
  ),

  history: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    return ctx.db
      .select({ ref: sectionApplications.sectionRef, at: sectionApplications.at })
      .from(sectionApplications)
      .where(eq(sectionApplications.campaignId, input.campaignId))
      .orderBy(asc(sectionApplications.at));
  }),
});
