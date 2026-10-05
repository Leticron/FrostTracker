import type { RuleTables } from '@fht/shared';

/** Invented values on purpose; the real tables live in the private seed. */
export const fixtureRules: RuleTables = {
  calendar: { weeksPerSeason: 3, seasons: ['summer', 'winter'] },
  resources: [
    { key: 'wood', name: 'Wood', kind: 'material' },
    { key: 'leaf', name: 'Leaf', kind: 'herb' },
  ],
  levels: { xpThresholds: [0, 10, 25, 50] },
  checkmarks: { perPerkMark: 2, max: 8 },
  startingGold: { perProsperityLevel: 5, base: 7 },
  prosperity: { thresholds: [3, 7, 12, null] },
  retirement: { prosperityGain: 1 },
};
