import { and, eq } from 'drizzle-orm';
import type { CampaignState, ScenarioState } from '@fht/rules';
import type { RuleTables } from '@fht/shared';
import type { AuditRecorder } from '../audit.ts';
import type { Tx } from '../db/client.ts';
import {
  buildingDefs,
  calendarEntries,
  campaignBuildings,
  campaigns,
  campaignScenarios,
  campaignStickers,
  scenarioDefs,
} from '../db/schema.ts';

type Campaign = typeof campaigns.$inferSelect;

export function moraleSections(c: Campaign, rules: RuleTables) {
  return {
    min: c.moraleMinSection ?? rules.morale.minSection,
    max: c.moraleMaxSection ?? rules.morale.maxSection,
  };
}

/** Loads the campaign state the rule functions work on (rows locked for update). */
export async function loadState(tx: Tx, campaign: Campaign, rules: RuleTables) {
  const scen = await tx
    .select()
    .from(campaignScenarios)
    .where(eq(campaignScenarios.campaignId, campaign.id))
    .for('update');
  const stick = await tx
    .select()
    .from(campaignStickers)
    .where(eq(campaignStickers.campaignId, campaign.id))
    .for('update');
  const state: CampaignState = {
    morale: campaign.morale,
    prosperityChecks: campaign.prosperityChecks,
    inspiration: campaign.inspiration,
    soldiers: campaign.soldiers,
    defense: campaign.defense,
    stickers: Object.fromEntries(stick.map((s) => [s.name, s.count])),
    scenarios: new Map<number, ScenarioState>(
      scen.map((s) => [
        s.scenarioNumber,
        {
          status: s.status,
          timesCompleted: s.timesCompleted,
          requirementOverride: s.requirementOverride,
        },
      ]),
    ),
    moraleSections: moraleSections(campaign, rules),
  };
  return { state, rows: { scenarios: scen, stickers: stick } };
}

/** Writes the differences between two states through the audit recorder. */
export async function saveState(
  rec: AuditRecorder,
  campaign: Campaign,
  loaded: Awaited<ReturnType<typeof loadState>>,
  next: CampaignState,
  action: string,
  scenarioSource: string | null = null,
) {
  const counters = {
    morale: next.morale,
    prosperityChecks: next.prosperityChecks,
    inspiration: next.inspiration,
    soldiers: next.soldiers,
    defense: next.defense,
  };
  const changed = (Object.keys(counters) as (keyof typeof counters)[]).some(
    (k) => counters[k] !== campaign[k],
  );
  let updated = campaign;
  if (changed) {
    updated = await rec.update(
      'campaign',
      campaigns,
      campaign,
      { ...counters, version: campaign.version + 1 },
      action,
    );
  }

  // Stickers
  const byName = new Map(loaded.rows.stickers.map((s) => [s.name, s]));
  const names = new Set([...byName.keys(), ...Object.keys(next.stickers)]);
  for (const name of names) {
    const row = byName.get(name);
    const count = next.stickers[name] ?? 0;
    if (!row && count > 0) {
      await rec.insert(
        'campaign_sticker',
        campaignStickers,
        { campaignId: campaign.id, name, count },
        action,
      );
    } else if (row && count === 0) {
      await rec.delete('campaign_sticker', campaignStickers, row, action);
    } else if (row && row.count !== count) {
      await rec.update('campaign_sticker', campaignStickers, row, { count }, action);
    }
  }

  // Scenarios
  const byNum = new Map(loaded.rows.scenarios.map((s) => [s.scenarioNumber, s]));
  for (const [num, s] of next.scenarios) {
    const row = byNum.get(num);
    if (!row) {
      await rec.insert(
        'campaign_scenario',
        campaignScenarios,
        { campaignId: campaign.id, scenarioNumber: num, ...s, unlockedBy: scenarioSource },
        action,
      );
    } else if (
      row.status !== s.status ||
      row.timesCompleted !== s.timesCompleted ||
      row.requirementOverride !== s.requirementOverride
    ) {
      await rec.update('campaign_scenario', campaignScenarios, row, s, action);
    }
  }
  for (const [num, row] of byNum) {
    if (!next.scenarios.has(num))
      await rec.delete('campaign_scenario', campaignScenarios, row, action);
  }
  return updated;
}

/**
 * First-time setup of a campaign with a data set: starting scenarios unlocked and the starting
 * buildings built at level 1.
 * RULE: R-SCN-06, R-OUT-16
 */
export async function ensureSetup(tx: Tx, campaign: Campaign): Promise<Campaign> {
  if (campaign.setupDone || !campaign.gameDataSetId) return campaign;
  const scen = await tx
    .select({ number: scenarioDefs.number })
    .from(scenarioDefs)
    .where(
      and(
        eq(scenarioDefs.dataSetId, campaign.gameDataSetId),
        eq(scenarioDefs.initiallyUnlocked, true),
      ),
    );
  for (const s of scen) {
    await tx
      .insert(campaignScenarios)
      .values({
        campaignId: campaign.id,
        scenarioNumber: s.number,
        status: 'unlocked',
        unlockedBy: 'campaign start',
      })
      .onConflictDoNothing();
  }
  const blds = await tx
    .select()
    .from(buildingDefs)
    .where(
      and(eq(buildingDefs.dataSetId, campaign.gameDataSetId), eq(buildingDefs.starting, true)),
    );
  for (const b of blds) {
    await tx
      .insert(campaignBuildings)
      .values({ campaignId: campaign.id, number: b.number, name: b.name, level: 1, state: 'built' })
      .onConflictDoNothing();
  }
  const [updated] = await tx
    .update(campaigns)
    .set({ setupDone: true })
    .where(eq(campaigns.id, campaign.id))
    .returning();
  return updated!;
}

/** Adds calendar entries relative to the current week. RULE: R-CAMP-03 */
export async function addCalendar(
  rec: AuditRecorder,
  campaign: Campaign,
  items: { section: string; weeksAhead: number }[],
  action: string,
) {
  for (const i of items) {
    await rec.insert(
      'calendar_entry',
      calendarEntries,
      {
        campaignId: campaign.id,
        week: campaign.currentWeek + i.weeksAhead,
        sectionRef: i.section,
        source: 'added',
      },
      action,
    );
  }
}
