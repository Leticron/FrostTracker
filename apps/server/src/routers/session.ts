import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { campaignIdInput, sessionIdInput, sessionInput, type Effect } from '@fht/shared';
import {
  applyCheckmarkChange,
  firstCompletion,
  inspirationGain,
  outpostPhaseFollows,
  participantDelta,
  recommendedScenarioLevel,
  scenarioAvailability,
} from '@fht/rules';
import {
  campaignStickers,
  characters,
  playSessions,
  scenarioDefs,
  sectionDefs,
  sessionParticipants,
  users,
} from '../db/schema.ts';
import { campaignData } from '../services/campaign-data.ts';
import { loadState, saveState } from '../services/campaign-state.ts';
import { badRequest, hostTx } from '../services/host-tx.ts';
import { authedProcedure, requireMembership, router } from '../trpc/trpc.ts';

export const sessionRouter = router({
  list: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    const sessions = await ctx.db
      .select({
        id: playSessions.id,
        date: playSessions.date,
        scenarioNumber: playSessions.scenarioNumber,
        scenarioLevel: playSessions.scenarioLevel,
        outcome: playSessions.outcome,
        lostChoice: playSessions.lostChoice,
        casual: playSessions.casual,
        notes: playSessions.notes,
        firstCompletion: playSessions.firstCompletion,
        auditGroupId: playSessions.auditGroupId,
        createdAt: playSessions.createdAt,
        createdByName: users.displayName,
      })
      .from(playSessions)
      .leftJoin(users, eq(users.id, playSessions.createdBy))
      .where(eq(playSessions.campaignId, input.campaignId))
      .orderBy(desc(playSessions.createdAt));
    const ids = sessions.map((s) => s.id);
    const parts = ids.length
      ? await ctx.db
          .select({
            sessionId: sessionParticipants.sessionId,
            characterId: sessionParticipants.characterId,
            name: characters.name,
            applied: sessionParticipants.applied,
          })
          .from(sessionParticipants)
          .innerJoin(characters, eq(characters.id, sessionParticipants.characterId))
          .where(inArray(sessionParticipants.sessionId, ids))
      : [];
    return sessions.map((s) => ({ ...s, participants: parts.filter((p) => p.sessionId === s.id) }));
  }),

  /** Data for the "log a session" form: active characters, playable scenarios, suggested level. */
  form: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId, 'host');
    const { dataSetId, rules } = await campaignData(ctx.db, input.campaignId);
    const chars = await ctx.db
      .select({
        id: characters.id,
        name: characters.name,
        level: characters.level,
        masteries: characters.masteries,
        classKey: characters.classKey,
      })
      .from(characters)
      .where(and(eq(characters.campaignId, input.campaignId), eq(characters.status, 'active')))
      .orderBy(asc(characters.name));
    const defs = await ctx.db
      .select({
        number: scenarioDefs.number,
        name: scenarioDefs.name,
        requirements: scenarioDefs.requirements,
      })
      .from(scenarioDefs)
      .where(eq(scenarioDefs.dataSetId, dataSetId))
      .orderBy(asc(scenarioDefs.number));
    return {
      characters: chars,
      scenarios: defs.map((d) => ({ number: d.number, name: d.name })),
      resources: rules.resources,
      maxScenarioLevel: rules.scenarioLevel.goldConversion.length - 1,
      recommendedLevel: recommendedScenarioLevel(chars.map((c) => c.level)),
    };
  }),

  /**
   * Logs a played scenario and applies its results in one step: character gold/XP/checkmarks/
   * masteries/resources, inspiration, and the scenario becoming completed.
   * RULE: R-SCN-03, R-SCN-07..R-SCN-11, R-SCN-14, R-SCN-17, R-CAMP-11
   */
  log: authedProcedure.input(sessionInput).mutation(({ ctx, input }) =>
    hostTx(ctx, input.campaignId, async ({ tx, campaign, rules, dataSetId, rec }) => {
      if (input.outcome === 'lost' && !input.lostChoice)
        badRequest('Choose whether the party returns or replays');
      const completed = input.outcome === 'completed';
      const loaded = await loadState(tx, campaign, rules);

      let first = false;
      let conclusionSections: string[] = [];
      if (input.scenario !== null) {
        const [def] = await tx
          .select()
          .from(scenarioDefs)
          .where(
            and(eq(scenarioDefs.dataSetId, dataSetId), eq(scenarioDefs.number, input.scenario)),
          );
        if (!def) badRequest('Unknown scenario');
        const stickers = await tx
          .select()
          .from(campaignStickers)
          .where(eq(campaignStickers.campaignId, campaign.id));
        const [avail] = scenarioAvailability(
          [def],
          loaded.state.scenarios,
          Object.fromEntries(stickers.map((s) => [s.name, s.count])),
        );
        const open = avail!.status === 'unlocked' || avail!.status === 'completed';
        // Casual mode ignores requirements but still needs an unlocked scenario (R-SCN-17).
        if (input.casual ? !open : !avail!.playable) {
          badRequest(
            avail!.status === 'locked' || avail!.status === 'locked_out'
              ? 'This scenario is not available'
              : 'The scenario requirements are not met',
          );
        }
        first =
          completed && !input.casual && firstCompletion(loaded.state.scenarios.get(input.scenario));
        conclusionSections = def.conclusionSections;
      }

      const ids = input.participants.map((p) => p.characterId);
      if (new Set(ids).size !== ids.length) badRequest('A character is listed twice');
      const chars = await tx
        .select()
        .from(characters)
        .where(inArray(characters.id, ids))
        .for('update');
      if (
        chars.length !== ids.length ||
        chars.some((c) => c.campaignId !== campaign.id || c.status !== 'active')
      ) {
        badRequest('Only active characters of this campaign can take part');
      }

      const session = await rec.insert(
        'play_session',
        playSessions,
        {
          campaignId: campaign.id,
          date: input.date,
          scenarioNumber: input.scenario,
          scenarioLevel: input.scenarioLevel,
          outcome: input.outcome,
          lostChoice: input.outcome === 'lost' ? input.lostChoice : null,
          casual: input.casual,
          notes: input.notes,
          firstCompletion: first,
          createdBy: ctx.user.id,
        },
        'log_session',
      );

      for (const p of input.participants) {
        const c = chars.find((x) => x.id === p.characterId)!;
        for (const k of Object.keys(p.resources)) {
          if (!rules.resources.some((r) => r.key === k)) badRequest(`Unknown resource "${k}"`);
        }
        const d = participantDelta(
          p,
          { ...input, lostChoice: input.outcome === 'lost' ? input.lostChoice : null },
          rules.scenarioLevel,
        );
        const masteries = [...c.masteries];
        // RULE: R-CHAR-14 - each mastery can only be achieved once.
        const newMasteries = d.masteries.filter((i) => !masteries[i]);
        for (const i of newMasteries) masteries[i] = true;
        const resources = { ...c.resources };
        for (const [k, v] of Object.entries(d.resources))
          if (v) resources[k] = (resources[k] ?? 0) + v;
        const changes = {
          gold: c.gold + d.gold,
          xp: c.xp + d.xp,
          checkmarks: applyCheckmarkChange(c.checkmarks, d.checkmarks, rules.checkmarks),
          masteries,
          resources,
          version: c.version + 1,
        };
        await rec.update('character', characters, c, changes, 'session_result', c.id);
        await tx.insert(sessionParticipants).values({
          sessionId: session.id,
          characterId: c.id,
          coins: p.coins,
          xp: p.xp,
          checkmarks: p.checkmarks,
          masteries: p.masteries,
          resources: p.resources,
          applied: { ...d, masteries: newMasteries },
        });
      }

      if (completed && !input.casual) {
        const next = { ...loaded.state, scenarios: new Map(loaded.state.scenarios) };
        next.inspiration += inspirationGain(input.participants.length, rules.inspiration);
        if (input.scenario !== null) {
          const cur = next.scenarios.get(input.scenario);
          next.scenarios.set(input.scenario, {
            status: 'completed',
            timesCompleted: (cur?.timesCompleted ?? 0) + 1,
            requirementOverride: cur?.requirementOverride ?? false,
          });
        }
        await saveState(rec, campaign, loaded, next, 'session_result', 'session');
      }

      // Link suggestions from the conclusion sections, only on the first completion (R-SCN-11).
      let links: { scenario: number; link: string; section: string }[] = [];
      if (first && conclusionSections.length) {
        const secs = await tx
          .select()
          .from(sectionDefs)
          .where(
            and(eq(sectionDefs.dataSetId, dataSetId), inArray(sectionDefs.ref, conclusionSections)),
          );
        const flat = (e: Effect): Effect[] => (e.type === 'chooseOne' ? e.options : [e]);
        links = secs.flatMap((s) =>
          s.effects
            .flatMap(flat)
            .filter((e) => e.type === 'unlockScenario' && e.link)
            .map((e) => ({
              scenario: (e as { scenario: number }).scenario,
              link: (e as { link: string }).link,
              section: s.ref,
            })),
        );
      }
      return {
        sessionId: session.id,
        firstCompletion: first,
        // Rewards are only gained once per campaign (R-SCN-10): read the conclusion, apply effects only if first.
        conclusionSections: completed && !input.casual ? conclusionSections : [],
        links,
        outpostPhaseFollows: outpostPhaseFollows({
          ...input,
          lostChoice: input.outcome === 'lost' ? input.lostChoice : null,
        }),
      };
    }),
  ),

  participants: authedProcedure.input(sessionIdInput).query(async ({ ctx, input }) => {
    const [s] = await ctx.db
      .select()
      .from(playSessions)
      .where(eq(playSessions.id, input.sessionId));
    if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
    await requireMembership(ctx, s.campaignId);
    return ctx.db.select().from(sessionParticipants).where(eq(sessionParticipants.sessionId, s.id));
  }),
});
