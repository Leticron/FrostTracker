import { describe, expect, it } from 'vitest';
import { nextWeekPosition } from '../src/calendar.ts';

// Fixture values on purpose - the real rule tables live in the private seed.
const table = { weeksPerSeason: 3, seasons: ['summer', 'winter'] as const };

describe('nextWeekPosition', () => {
  it('R-CAMP-02: starts in the first week of the first season of year 1', () => {
    expect(nextWeekPosition(0, { ...table, seasons: [...table.seasons] })).toEqual({
      year: 1,
      season: 'summer',
      weekInSeason: 1,
    });
  });

  it('R-CAMP-02: the season changes once a full season of boxes is marked', () => {
    expect(nextWeekPosition(3, { ...table, seasons: [...table.seasons] })).toMatchObject({
      season: 'winter',
      weekInSeason: 1,
    });
  });

  it('R-CAMP-02: a new year starts after all seasons', () => {
    expect(nextWeekPosition(6, { ...table, seasons: [...table.seasons] })).toMatchObject({
      year: 2,
      season: 'summer',
    });
  });

  it('rejects negative week counts', () => {
    expect(() => nextWeekPosition(-1, { ...table, seasons: [...table.seasons] })).toThrow(
      RangeError,
    );
  });
});
