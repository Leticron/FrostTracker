import type { BaseEffect, Effect, RuleTables } from '@fht/shared';
import { applyMoraleChange } from './campaign.ts';
import { applyProsperityChange } from './prosperity.ts';
import type { ScenarioState } from './scenarios.ts';

export interface CampaignState {
  morale: number | null;
  prosperityChecks: number;
  inspiration: number;
  soldiers: number;
  defense: number;
  stickers: Record<string, number>;
  scenarios: Map<number, ScenarioState>;
  moraleSections: { min: string | null; max: string | null };
}

export interface EffectOutcome {
  state: CampaignState;
  /** Calendar entries to add (relative weeks). */
  calendar: { section: string; weeksAhead: number }[];
  eventDeck: { op: 'add' | 'remove'; deck: string; event: string }[];
  /** Sections the host should read next (incl. morale track triggers). */
  readNext: string[];
  /** Things the host must do by hand (class/building choices, free-text conditions, notes). */
  manual: string[];
  classUnlocks: string[];
  buildingUnlocks: number[];
}

/**
 * Applies section effects to campaign state (pure). chooseOne effects must be resolved by the
 * caller first; conditional unlocks are applied as given because the host confirmed them.
 * RULE: R-SCN-05, R-SCN-05a, R-SCN-19, R-SCN-20, R-CAMP-05, R-CAMP-07, R-CAMP-11, R-CAMP-14
 */
export function applyEffects(
  input: CampaignState,
  effects: Effect[],
  rules: RuleTables,
): EffectOutcome {
  const state: CampaignState = {
    ...input,
    stickers: { ...input.stickers },
    scenarios: new Map(input.scenarios),
  };
  const out: EffectOutcome = {
    state,
    calendar: [],
    eventDeck: [],
    readNext: [],
    manual: [],
    classUnlocks: [],
    buildingUnlocks: [],
  };
  for (const e of effects) {
    if (e.type === 'chooseOne') {
      throw new Error('chooseOne effects must be resolved before applying');
    }
    applyOne(state, e, rules, out);
  }
  return out;
}

function applyOne(s: CampaignState, e: BaseEffect, rules: RuleTables, out: EffectOutcome) {
  switch (e.type) {
    case 'unlockScenario': {
      const cur = s.scenarios.get(e.scenario);
      // Unlocking never downgrades a completed or locked-out scenario.
      if (!cur)
        s.scenarios.set(e.scenario, {
          status: 'unlocked',
          timesCompleted: 0,
          requirementOverride: false,
        });
      break;
    }
    case 'lockOutScenario': {
      const cur = s.scenarios.get(e.scenario);
      if (cur?.status === 'completed') break; // completed scenarios stay completed
      s.scenarios.set(e.scenario, {
        status: 'locked_out',
        timesCompleted: cur?.timesCompleted ?? 0,
        requirementOverride: cur?.requirementOverride ?? false,
      });
      break;
    }
    case 'gainCampaignSticker':
      s.stickers[e.name] = (s.stickers[e.name] ?? 0) + 1;
      break;
    case 'loseCampaignSticker':
      if ((s.stickers[e.name] ?? 0) > 1) s.stickers[e.name]! -= 1;
      else delete s.stickers[e.name];
      break;
    case 'adjust':
      switch (e.target) {
        case 'morale': {
          if (s.morale === null) {
            out.manual.push('Morale is not set yet; set it first');
            break;
          }
          const r = applyMoraleChange(s.morale, e.amount, rules.morale, s.moraleSections);
          s.morale = r.morale;
          if (r.triggeredSection) out.readNext.push(r.triggeredSection);
          break;
        }
        case 'prosperity':
          s.prosperityChecks = applyProsperityChange(
            s.prosperityChecks,
            e.amount,
            rules.prosperity,
          );
          break;
        case 'inspiration':
        case 'soldiers':
          // Losses can't go below zero (R-CAMP-13: lose what you have).
          s[e.target] = Math.max(0, s[e.target] + e.amount);
          break;
        case 'defense':
          s.defense += e.amount;
          break;
      }
      break;
    case 'setMorale':
      if (e.value === null) out.manual.push('Set morale to the value given in the section');
      else s.morale = Math.min(rules.morale.max, Math.max(rules.morale.min, e.value));
      break;
    case 'addCalendarSection':
      out.calendar.push({ section: e.section, weeksAhead: e.weeksAhead });
      break;
    case 'eventDeck':
      for (const ev of e.events) out.eventDeck.push({ op: e.op, deck: e.deck, event: ev });
      break;
    case 'unlockClass':
      if (e.classKey) out.classUnlocks.push(e.classKey);
      else out.manual.push('Unlock a class (choose which in Settings)');
      break;
    case 'unlockBuilding':
      if (e.number !== null) out.buildingUnlocks.push(e.number);
      else out.manual.push('Unlock a building (add it under Buildings)');
      break;
    case 'readSection':
      out.readNext.push(e.ref);
      break;
    case 'manual':
      out.manual.push(e.note);
      break;
  }
}
