import type { Requirement, ScenarioDef } from '@fht/shared';

export type ScenarioStatus = 'locked' | 'unlocked' | 'completed' | 'locked_out';

export interface ScenarioState {
  status: Exclude<ScenarioStatus, 'locked'>;
  timesCompleted: number;
  requirementOverride: boolean;
}

export interface Availability {
  number: number;
  status: ScenarioStatus;
  /** Can be played as part of the campaign now. */
  playable: boolean;
  unmet: Requirement[];
}

/** Whether a single requirement is met by the campaign stickers. RULE: R-SCN-04 */
export function requirementMet(r: Requirement, stickers: Record<string, number>): boolean | null {
  if ('campaignSticker' in r) return (stickers[r.campaignSticker] ?? 0) >= r.minCount;
  return null; // free text: only the host can judge
}

/**
 * Availability of every scenario, computed only from data: unlock state rows, requirement
 * data and campaign stickers. A scenario is playable when it is unlocked or completed, not
 * locked out, and all requirements are met (free-text requirements need a host override).
 * RULE: R-SCN-02, R-SCN-03, R-SCN-04
 */
export function scenarioAvailability(
  defs: Pick<ScenarioDef, 'number' | 'requirements'>[],
  states: Map<number, ScenarioState>,
  stickers: Record<string, number>,
): Availability[] {
  return defs.map((d) => {
    const s = states.get(d.number);
    const status: ScenarioStatus = s?.status ?? 'locked';
    const unmet = s?.requirementOverride
      ? []
      : d.requirements.filter((r) => requirementMet(r, stickers) !== true);
    const open = status === 'unlocked' || status === 'completed';
    return { number: d.number, status, playable: open && unmet.length === 0, unmet };
  });
}

/**
 * Whether a completion grants the scenario rewards: only the first completion in a campaign.
 * Links are also only followed on the first completion.
 * RULE: R-SCN-10, R-SCN-11
 */
export function firstCompletion(state: ScenarioState | undefined): boolean {
  return !state || state.timesCompleted === 0;
}
