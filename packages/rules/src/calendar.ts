import type { RuleTables } from '@fht/shared';

export interface CalendarPosition {
  /** 1-based year of the campaign. */
  year: number;
  season: RuleTables['calendar']['seasons'][number];
  /** 1-based week within the season. */
  weekInSeason: number;
}

/**
 * Position of the next unmarked calendar week, which determines the current season.
 * `markedWeeks` is the number of marked boxes (0 at campaign start).
 * RULE: R-CAMP-02
 */
export function nextWeekPosition(
  markedWeeks: number,
  table: RuleTables['calendar'],
): CalendarPosition {
  if (!Number.isInteger(markedWeeks) || markedWeeks < 0) {
    throw new RangeError('markedWeeks must be a non-negative integer');
  }
  const weeksPerYear = table.weeksPerSeason * table.seasons.length;
  const index = markedWeeks % weeksPerYear;
  const seasonIndex = Math.floor(index / table.weeksPerSeason);
  return {
    year: Math.floor(markedWeeks / weeksPerYear) + 1,
    season: table.seasons[seasonIndex]!,
    weekInSeason: (index % table.weeksPerSeason) + 1,
  };
}
