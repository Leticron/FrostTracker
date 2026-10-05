import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import {
  buildingInput,
  campaignIdInput,
  outpostStepInput,
  type BuildingDef,
  type ResourceBag,
  type RuleTables,
} from '@fht/shared';
import {
  applyMoraleChange,
  applyProsperityChange,
  preprintedSections,
  prosperityLevel,
} from '@fht/rules';
import type { AuditRecorder } from '../audit.ts';
import type { Db, Tx } from '../db/client.ts';
import {
  buildingDefs,
  calendarEntries,
  campaignBuildings,
  campaigns,
  outpostPhases,
} from '../db/schema.ts';
import { campaignData } from '../services/campaign-data.ts';
import { moraleSections } from '../services/campaign-state.ts';
import { badRequest, hostTx } from '../services/host-tx.ts';
import { authedProcedure, requireMembership, router } from '../trpc/trpc.ts';

type Campaign = typeof campaigns.$inferSelect;

export async function openOutpostPhase(db: Db | Tx, campaignId: string) {
  const [p] = await db
    .select()
    .from(outpostPhases)
    .where(and(eq(outpostPhases.campaignId, campaignId), isNull(outpostPhases.closedAt)));
  return p ?? null;
}

/**
 * Pays a building cost from the Frosthaven supply. Missing material resources can be replaced
 * 1:1 by inspiration. RULE: R-OUT-14, R-CAMP-11, R-CAMP-12
 */
function payCost(
  campaign: Campaign,
  cost: { resources: ResourceBag },
  rules: RuleTables,
): { supply: ResourceBag; inspiration: number } {
  const supply = { ...campaign.supply };
  let inspiration = campaign.inspiration;
  for (const [key, need] of Object.entries(cost.resources)) {
    const have = supply[key] ?? 0;
    const take = Math.min(have, need);
    supply[key] = have - take;
    const missing = need - take;
    if (missing > 0) {
      const isMaterial = rules.resources.find((r) => r.key === key)?.kind === 'material';
      if (!isMaterial || inspiration < missing) {
        badRequest(
          `Not enough ${rules.resources.find((r) => r.key === key)?.name ?? key} in the Frosthaven supply`,
        );
      }
      inspiration -= missing;
    }
  }
  return { supply, inspiration };
}

/** Pays a repair cost of N material resources of any type, taking the largest stacks first. RULE: R-OUT-08 */
function payAnyMaterials(campaign: Campaign, n: number, rules: RuleTables): ResourceBag {
  const supply = { ...campaign.supply };
  let left = n;
  const mats = rules.resources.filter((r) => r.kind === 'material').map((r) => r.key);
  while (left > 0) {
    const key = mats
      .filter((k) => (supply[k] ?? 0) > 0)
      .sort((a, b) => (supply[b] ?? 0) - (supply[a] ?? 0))[0];
    if (!key) badRequest('Not enough materials for the repair; lose morale instead');
    supply[key] = (supply[key] ?? 0) - 1;
    left -= 1;
  }
  return supply;
}

async function changeMorale(
  rec: AuditRecorder,
  campaign: Campaign,
  delta: number,
  rules: RuleTables,
  action: string,
) {
  if (campaign.morale === null) badRequest('Set the starting morale first');
  const r = applyMoraleChange(
    campaign.morale,
    delta,
    rules.morale,
    moraleSections(campaign, rules),
  );
  const updated = await rec.update(
    'campaign',
    campaigns,
    campaign,
    { morale: r.morale, version: campaign.version + 1 },
    action,
  );
  return { campaign: updated, readNext: r.triggeredSection ? [r.triggeredSection] : [] };
}

export const outpostRouter = router({
  current: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    const phase = await openOutpostPhase(ctx.db, input.campaignId);
    const [c] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, input.campaignId));
    const due = await ctx.db
      .select()
      .from(calendarEntries)
      .where(
        and(
          eq(calendarEntries.campaignId, input.campaignId),
          isNull(calendarEntries.resolvedAt),
          lte(calendarEntries.week, c!.currentWeek),
        ),
      )
      .orderBy(asc(calendarEntries.week));
    return { phase, due };
  }),

  /** RULE: R-OUT-01, R-OUT-02 */
  start: authedProcedure.input(campaignIdInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rec }) => {
      if (await openOutpostPhase(tx, campaign.id)) badRequest('An outpost phase is already open');
      await tx
        .insert(outpostPhases)
        .values({ campaignId: campaign.id, week: campaign.currentWeek + 1, step: 1 });
      rec.note('outpost_start', { week: campaign.currentWeek + 1 });
      return {};
    }),
  ),

  /**
   * Passage of time: mark the next calendar week and list the sections in it.
   * RULE: R-OUT-03, R-CAMP-02, R-CAMP-03, R-CAMP-04
   */
  passTime: authedProcedure.input(campaignIdInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rules, rec }) => {
      const phase = await openOutpostPhase(tx, campaign.id);
      if (!phase || phase.step !== 1)
        badRequest('Passage of time is the first step of an outpost phase');
      const week = campaign.currentWeek + 1;
      const updated = await rec.update(
        'campaign',
        campaigns,
        campaign,
        { currentWeek: week, version: campaign.version + 1 },
        'pass_time',
      );
      for (const section of preprintedSections(week, rules)) {
        await rec.insert(
          'calendar_entry',
          calendarEntries,
          { campaignId: campaign.id, week, sectionRef: section, source: 'preprinted' },
          'pass_time',
        );
      }
      await tx.update(outpostPhases).set({ step: 2, week }).where(eq(outpostPhases.id, phase.id));
      const due = await tx
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.campaignId, campaign.id),
            isNull(calendarEntries.resolvedAt),
            lte(calendarEntries.week, updated.currentWeek),
          ),
        );
      return { week, due };
    }),
  ),

  setStep: authedProcedure.input(outpostStepInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign }) => {
      const phase = await openOutpostPhase(tx, campaign.id);
      if (!phase) badRequest('No outpost phase is open');
      if (phase.step === 1 && input.step > 1) badRequest('Mark the passage of time first');
      await tx
        .update(outpostPhases)
        .set({ step: input.step, notes: input.notes ?? phase.notes })
        .where(eq(outpostPhases.id, phase.id));
      return {};
    }),
  ),

  close: authedProcedure.input(campaignIdInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rec }) => {
      const phase = await openOutpostPhase(tx, campaign.id);
      if (!phase) badRequest('No outpost phase is open');
      await tx
        .update(outpostPhases)
        .set({ closedAt: new Date() })
        .where(eq(outpostPhases.id, phase.id));
      rec.note('outpost_close', { week: phase.week });
      return {};
    }),
  ),

  buildings: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    const { dataSetId } = await campaignData(ctx.db, input.campaignId);
    const rows = await ctx.db
      .select()
      .from(campaignBuildings)
      .where(eq(campaignBuildings.campaignId, input.campaignId))
      .orderBy(asc(campaignBuildings.number));
    const defs = await ctx.db
      .select()
      .from(buildingDefs)
      .where(eq(buildingDefs.dataSetId, dataSetId));
    const byNum = new Map(defs.map((d) => [d.number, d]));
    return {
      buildings: rows.map((r) => ({ ...r, def: byNum.get(r.number) ?? null })),
      catalog: defs.map((d) => ({ number: d.number, name: d.name })),
    };
  }),

  /** RULE: R-OUT-08, R-OUT-09, R-OUT-14, R-OUT-17 */
  building: authedProcedure.input(buildingInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rules, dataSetId, rec }) => {
      const [row] = await tx
        .select()
        .from(campaignBuildings)
        .where(
          and(
            eq(campaignBuildings.campaignId, campaign.id),
            eq(campaignBuildings.number, input.number),
          ),
        );
      const [def] = await tx
        .select()
        .from(buildingDefs)
        .where(and(eq(buildingDefs.dataSetId, dataSetId), eq(buildingDefs.number, input.number)));
      const levelDef = (lvl: number): BuildingDef['levels'][number] | undefined =>
        def?.levels.find((l) => l.level === lvl);
      let readNext: string[] = [];

      if (input.action === 'unlock') {
        if (row) badRequest('This building is already unlocked');
        const name = input.name || def?.name;
        if (!name) badRequest('Enter the building name');
        await rec.insert(
          'campaign_building',
          campaignBuildings,
          { campaignId: campaign.id, number: input.number, name, level: 0, state: 'unlocked' },
          'building_unlock',
        );
        return { readNext };
      }
      if (!row) badRequest('Unlock the building first');

      if (input.action === 'build' || input.action === 'upgrade') {
        const phase = await openOutpostPhase(tx, campaign.id);
        // RULE: R-OUT-14 - construction happens in the outpost phase; one by default, a second for morale.
        if (!phase)
          badRequest('Buildings are built during the construction step of an outpost phase');
        if (input.action === 'build' && row.state !== 'unlocked') badRequest('Already built');
        if (input.action === 'upgrade' && row.state !== 'built')
          badRequest('Only built, non-wrecked buildings can be upgraded');
        if (phase.builds >= 2) badRequest('At most two builds or upgrades per outpost phase');
        let current = campaign;
        if (phase.builds >= 1) {
          if (!input.extraBuild) badRequest('A second build costs morale; confirm it');
          const m = await changeMorale(
            rec,
            current,
            -rules.outpost.secondBuildMoraleCost,
            rules,
            'extra_build',
          );
          current = m.campaign;
          readNext = m.readNext;
        }
        const target = row.level + 1;
        const cost = levelDef(target)?.cost;
        const changes: Partial<Campaign> = {};
        if (cost) {
          const prosperity = prosperityLevel(current.prosperityChecks, rules.prosperity);
          if (cost.prosperity !== null && prosperity < cost.prosperity)
            badRequest(`Needs prosperity ${cost.prosperity}`);
          Object.assign(changes, payCost(current, cost, rules));
        }
        const gain = levelDef(target)?.prosperityGain;
        if (gain)
          changes.prosperityChecks = applyProsperityChange(
            current.prosperityChecks,
            gain,
            rules.prosperity,
          );
        if (Object.keys(changes).length) {
          await rec.update(
            'campaign',
            campaigns,
            current,
            { ...changes, version: current.version + 1 },
            `building_${input.action}`,
          );
        }
        await rec.update(
          'campaign_building',
          campaignBuildings,
          row,
          { level: target, state: 'built' },
          `building_${input.action}`,
        );
        await tx
          .update(outpostPhases)
          .set({ builds: phase.builds + 1 })
          .where(eq(outpostPhases.id, phase.id));
        if (!cost)
          rec.note('manual_step', {
            note: `Pay the ${input.action} cost of building ${input.number} by hand (no cost data)`,
          });
        return { readNext };
      }

      switch (input.action) {
        case 'wreck':
          if (row.state !== 'built') badRequest('Only built buildings can be wrecked');
          await rec.update(
            'campaign_building',
            campaignBuildings,
            row,
            { state: 'wrecked' },
            'building_wreck',
          );
          break;
        case 'rebuild': {
          if (row.state !== 'wrecked') badRequest('Only wrecked buildings can be rebuilt');
          const cost = levelDef(row.level)?.rebuildCost;
          if (cost) {
            const paid = payCost(campaign, cost, rules);
            await rec.update(
              'campaign',
              campaigns,
              campaign,
              { ...paid, version: campaign.version + 1 },
              'building_rebuild',
            );
          } else
            rec.note('manual_step', {
              note: `Pay the rebuild cost of building ${input.number} by hand`,
            });
          await rec.update(
            'campaign_building',
            campaignBuildings,
            row,
            { state: 'built' },
            'building_rebuild',
          );
          break;
        }
        case 'damage_repair_pay': {
          const n = levelDef(row.level)?.repairCost;
          if (n === null || n === undefined)
            badRequest('No repair cost known for this building; adjust the supply by hand');
          await rec.update(
            'campaign',
            campaigns,
            campaign,
            { supply: payAnyMaterials(campaign, n, rules), version: campaign.version + 1 },
            'building_repair',
          );
          break;
        }
        case 'damage_repair_morale': {
          const m = await changeMorale(
            rec,
            campaign,
            -rules.outpost.repairMoraleCost,
            rules,
            'building_repair_morale',
          );
          readNext = m.readNext;
          break;
        }
        case 'set_level':
          if (input.level === undefined) badRequest('Level required');
          await rec.update(
            'campaign_building',
            campaignBuildings,
            row,
            { level: input.level, state: input.level > 0 ? 'built' : 'unlocked' },
            'building_set_level',
          );
          break;
      }
      return { readNext };
    }),
  ),
});
