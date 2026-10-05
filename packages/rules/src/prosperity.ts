import type { RuleTables } from '@fht/shared';

/**
 * Prosperity level from the number of marked boxes. Thresholds are the cumulative box counts
 * for level 2, 3, …; an unknown (null) threshold stops the level at the previous one.
 * RULE: R-CAMP-05
 */
export function prosperityLevel(checks: number, table: RuleTables['prosperity']): number {
  let level = 1;
  for (const t of table.thresholds) {
    if (t === null || checks < t) break;
    level += 1;
  }
  return level;
}

/**
 * Losing prosperity never drops below the last numbered (level) box already reached.
 * RULE: R-CAMP-05
 */
export function applyProsperityChange(
  checks: number,
  delta: number,
  table: RuleTables['prosperity'],
): number {
  if (delta >= 0) return checks + delta;
  const level = prosperityLevel(checks, table);
  const floor = level === 1 ? 0 : (table.thresholds[level - 2] ?? 0);
  return Math.max(floor, checks + delta);
}

/**
 * Highest level a character may reach without enough XP: half the prosperity level, rounded up.
 * RULE: R-CHAR-05, R-CHAR-21, R-OUT-15
 */
export function prosperityLevelCap(prosperity: number): number {
  return Math.ceil(prosperity / 2);
}
