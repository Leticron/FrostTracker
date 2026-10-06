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
  scenarioLevel: { goldConversion: [1, 2, 3], bonusXp: [5, 7, 9] },
  inspiration: { base: 3 },
  morale: {
    min: 0,
    max: 10,
    defenseModifiers: [
      { from: 1, to: 4, modifier: -2 },
      { from: 5, to: 7, modifier: 0 },
      { from: 8, to: 10, modifier: 3 },
    ],
    minSection: '1.1',
    maxSection: '1.2',
  },
  calendarPreprinted: [
    { week: 2, sections: ['5.1'] },
    { week: 4, sections: ['5.2', '5.3'] },
    { week: 9, sections: ['5.9'] },
  ],
  calendarSheetWeeks: 8,
  outpost: { secondBuildMoraleCost: 2, repairMoraleCost: 1 },
};
