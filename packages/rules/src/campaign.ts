import type { RuleTables } from '@fht/shared';

/**
 * Defense modifier for the current morale; only the current range applies.
 * RULE: R-CAMP-08
 */
export function moraleDefenseModifier(
  morale: number | null,
  table: RuleTables['morale'],
): number | null {
  if (morale === null) return null;
  const range = table.defenseModifiers.find((r) => morale >= r.from && morale <= r.to);
  return range ? range.modifier : null;
}

/**
 * New morale after a change, clamped to the track. Reaching the minimum or maximum triggers
 * the section printed there (only when the value actually arrives at it).
 * RULE: R-CAMP-07
 */
export function applyMoraleChange(
  morale: number,
  delta: number,
  table: RuleTables['morale'],
  sections: { min: string | null; max: string | null },
): { morale: number; triggeredSection: string | null } {
  const next = Math.min(table.max, Math.max(table.min, morale + delta));
  let triggeredSection: string | null = null;
  if (next !== morale && next === table.min) triggeredSection = sections.min;
  if (next !== morale && next === table.max) triggeredSection = sections.max;
  return { morale: next, triggeredSection };
}

/** Inspiration for completing a scenario. RULE: R-CAMP-11, R-SCN-10 */
export function inspirationGain(characters: number, table: RuleTables['inspiration']): number {
  return Math.max(0, table.base - characters);
}

/**
 * Recommended scenario level: average character level / 2, rounded up. Solo and
 * open-information play add 1 to the average first.
 * RULE: R-SCN-12
 */
export function recommendedScenarioLevel(levels: number[], solo = false): number {
  if (!levels.length) return 0;
  const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
  return Math.ceil((avg + (solo ? 1 : 0)) / 2);
}

/**
 * Sections preprinted on a calendar week (absolute week number, 1-based). They only exist on
 * the first campaign sheet.
 * RULE: R-CAMP-03, R-CAMP-04
 */
export function preprintedSections(
  week: number,
  table: Pick<RuleTables, 'calendarPreprinted' | 'calendarSheetWeeks'>,
): string[] {
  if (week > table.calendarSheetWeeks) return [];
  return table.calendarPreprinted.filter((p) => p.week === week).flatMap((p) => p.sections);
}
