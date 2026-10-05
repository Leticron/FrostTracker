import { describe, expect, it } from 'vitest';
import { applyEffects, type CampaignState } from '../src/effects.ts';
import { firstCompletion, scenarioAvailability, type ScenarioState } from '../src/scenarios.ts';
import { outpostPhaseFollows, participantDelta } from '../src/session.ts';
import { fixtureRules as R } from './fixtures.ts';

const defs = [
  { number: 1, requirements: [] },
  { number: 2, requirements: [{ campaignSticker: 'Boat', minCount: 1 }] },
  { number: 3, requirements: [{ freeText: 'Something special' }] },
  { number: 4, requirements: [{ campaignSticker: 'Shard', minCount: 3 }] },
  { number: 5, requirements: [] },
];
const st = (
  status: ScenarioState['status'],
  extra: Partial<ScenarioState> = {},
): ScenarioState => ({
  status,
  timesCompleted: status === 'completed' ? 1 : 0,
  requirementOverride: false,
  ...extra,
});

describe('scenario availability', () => {
  it('R-SCN-02/03: locked scenarios are not playable; unlocked and completed are', () => {
    const states = new Map([
      [1, st('completed')],
      [5, st('unlocked')],
    ]);
    const a = scenarioAvailability(defs, states, {});
    expect(a.find((x) => x.number === 1)).toMatchObject({ status: 'completed', playable: true });
    expect(a.find((x) => x.number === 5)).toMatchObject({ status: 'unlocked', playable: true });
    expect(a.find((x) => x.number === 2)).toMatchObject({ status: 'locked', playable: false });
  });

  it('R-SCN-04: sticker requirements (with counts) gate playability', () => {
    const states = new Map([
      [2, st('unlocked')],
      [4, st('unlocked')],
    ]);
    expect(scenarioAvailability(defs, states, {}).find((x) => x.number === 2)?.playable).toBe(
      false,
    );
    const a = scenarioAvailability(defs, states, { Boat: 1, Shard: 2 });
    expect(a.find((x) => x.number === 2)?.playable).toBe(true);
    expect(a.find((x) => x.number === 4)?.playable).toBe(false);
  });

  it('R-SCN-04: free-text requirements need a host override', () => {
    expect(scenarioAvailability(defs, new Map([[3, st('unlocked')]]), {})[2]?.playable).toBe(false);
    const a = scenarioAvailability(
      defs,
      new Map([[3, st('unlocked', { requirementOverride: true })]]),
      {},
    );
    expect(a[2]?.playable).toBe(true);
  });

  it('R-SCN-02: locked out scenarios are not playable', () => {
    expect(scenarioAvailability(defs, new Map([[5, st('locked_out')]]), {})[4]).toMatchObject({
      playable: false,
    });
  });

  it('R-SCN-10: rewards only on the first completion', () => {
    expect(firstCompletion(undefined)).toBe(true);
    expect(firstCompletion(st('unlocked'))).toBe(true);
    expect(firstCompletion(st('completed'))).toBe(false);
  });
});

describe('section effects', () => {
  const base: CampaignState = {
    morale: 5,
    prosperityChecks: 2,
    inspiration: 1,
    soldiers: 1,
    defense: 0,
    stickers: {},
    scenarios: new Map([[1, st('completed')]]),
    moraleSections: { min: '1.1', max: '1.2' },
  };

  it('R-SCN-05/05a: unlock and lock out scenarios without downgrading completed ones', () => {
    const r = applyEffects(
      base,
      [
        { type: 'unlockScenario', scenario: 2, link: null, condition: null },
        { type: 'unlockScenario', scenario: 1, link: null, condition: null },
        { type: 'lockOutScenario', scenario: 1 },
        { type: 'lockOutScenario', scenario: 5 },
      ],
      R,
    );
    expect(r.state.scenarios.get(2)?.status).toBe('unlocked');
    expect(r.state.scenarios.get(1)?.status).toBe('completed');
    expect(r.state.scenarios.get(5)?.status).toBe('locked_out');
    expect(base.scenarios.get(2)).toBeUndefined(); // input untouched
  });

  it('R-CAMP-14: stickers can be gained several times and lost', () => {
    const r = applyEffects(
      base,
      [
        { type: 'gainCampaignSticker', name: 'Shard' },
        { type: 'gainCampaignSticker', name: 'Shard' },
        { type: 'loseCampaignSticker', name: 'Shard' },
        { type: 'loseCampaignSticker', name: 'Nope' },
      ],
      R,
    );
    expect(r.state.stickers).toEqual({ Shard: 1 });
  });

  it('R-CAMP-05/07/11: counters follow their rules; morale max triggers its section', () => {
    const r = applyEffects(
      base,
      [
        { type: 'adjust', target: 'morale', amount: 9 },
        { type: 'adjust', target: 'prosperity', amount: -5 },
        { type: 'adjust', target: 'inspiration', amount: -3 },
        { type: 'adjust', target: 'defense', amount: -2 },
      ],
      R,
    );
    expect(r.state).toMatchObject({ morale: 10, prosperityChecks: 0, inspiration: 0, defense: -2 });
    expect(r.readNext).toEqual(['1.2']);
  });

  it('R-SCN-19/20: calendar, event decks, reads and manual choices are collected', () => {
    const r = applyEffects(
      base,
      [
        { type: 'addCalendarSection', section: '9.9', weeksAhead: 3 },
        { type: 'eventDeck', op: 'add', deck: 'winter outpost', events: ['W-1', 'W-2'] },
        { type: 'readSection', ref: '7.7' },
        { type: 'unlockClass', classKey: null },
        { type: 'setMorale', value: null },
      ],
      R,
    );
    expect(r.calendar).toEqual([{ section: '9.9', weeksAhead: 3 }]);
    expect(r.eventDeck).toHaveLength(2);
    expect(r.readNext).toEqual(['7.7']);
    expect(r.manual).toHaveLength(2);
  });

  it('rejects unresolved choices', () => {
    expect(() =>
      applyEffects(
        base,
        [
          {
            type: 'chooseOne',
            options: [
              { type: 'unlockScenario', scenario: 3, link: null, condition: null },
              { type: 'unlockScenario', scenario: 4, link: null, condition: null },
            ],
          },
        ],
        R,
      ),
    ).toThrow();
  });
});

describe('session results', () => {
  const p = { coins: 3, xp: 6, checkmarks: 1, masteries: [0], resources: { wood: 2 } };
  const s = { scenarioLevel: 1, outcome: 'completed' as const, lostChoice: null, casual: false };

  it('R-SCN-08/10/14: completed gives gold, XP + bonus, checkmarks, masteries, resources', () => {
    expect(participantDelta(p, s, R.scenarioLevel)).toEqual({
      gold: 6,
      xp: 13,
      checkmarks: 1,
      masteries: [0],
      resources: { wood: 2 },
    });
  });

  it('R-SCN-08/09: lost keeps gold and dial XP; resources only when returning', () => {
    const lostReturn = participantDelta(
      p,
      { ...s, outcome: 'lost', lostChoice: 'return' },
      R.scenarioLevel,
    );
    expect(lostReturn).toEqual({
      gold: 6,
      xp: 6,
      checkmarks: 0,
      masteries: [],
      resources: { wood: 2 },
    });
    const lostReplay = participantDelta(
      p,
      { ...s, outcome: 'lost', lostChoice: 'replay' },
      R.scenarioLevel,
    );
    expect(lostReplay.resources).toEqual({});
  });

  it('R-SCN-17: casual sessions change nothing', () => {
    expect(participantDelta(p, { ...s, casual: true }, R.scenarioLevel)).toMatchObject({
      gold: 0,
      xp: 0,
    });
  });

  it('R-OUT-01: no outpost phase after replaying a lost scenario', () => {
    expect(outpostPhaseFollows({ outcome: 'lost', lostChoice: 'replay', casual: false })).toBe(
      false,
    );
    expect(outpostPhaseFollows({ outcome: 'lost', lostChoice: 'return', casual: false })).toBe(
      true,
    );
    expect(outpostPhaseFollows({ outcome: 'completed', lostChoice: null, casual: false })).toBe(
      true,
    );
  });
});
