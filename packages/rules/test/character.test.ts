import { describe, expect, it } from 'vitest';
import {
  applyCheckmarkChange,
  maxHitPoints,
  perkMarksAvailable,
  perkMarksEarned,
  perksGained,
  prosperityLevelUp,
  sellPrice,
  startingGold,
  xpLevelUpDue,
} from '../src/character.ts';
import { fixtureRules as R } from './fixtures.ts';

const base = {
  level: 1,
  xp: 0,
  checkmarks: 0,
  bonusPerkMarks: 0,
  perkMarks: [],
  masteries: [false, false],
};

describe('levels', () => {
  it('R-CHAR-04: level-up is due once XP meets the next level, XP is a running total', () => {
    expect(xpLevelUpDue({ level: 1, xp: 9 }, R.levels)).toBe(false);
    expect(xpLevelUpDue({ level: 1, xp: 10 }, R.levels)).toBe(true);
    expect(xpLevelUpDue({ level: 2, xp: 24 }, R.levels)).toBe(false);
    expect(xpLevelUpDue({ level: 4, xp: 999 }, R.levels)).toBe(false); // max level
  });

  it('R-CHAR-05: prosperity level-up raises XP to the new requirement, up to the cap', () => {
    expect(prosperityLevelUp({ level: 1, xp: 3 }, 2, R.levels)).toEqual({ level: 2, xp: 10 });
    expect(prosperityLevelUp({ level: 2, xp: 12 }, 2, R.levels)).toBeNull();
    expect(prosperityLevelUp({ level: 1, xp: 15 }, 3, R.levels)).toEqual({ level: 2, xp: 15 });
  });

  it('R-CHAR-06: max HP comes from class data when present', () => {
    expect(maxHitPoints({ maxHpByLevel: [6, 7, 8] }, 2)).toBe(7);
    expect(maxHitPoints({ maxHpByLevel: null }, 2)).toBeNull();
  });
});

describe('perk marks', () => {
  it('R-CHAR-12: earned from levels, checkmark sets, masteries and the new-character bonus', () => {
    const c = { ...base, level: 3, checkmarks: 5, bonusPerkMarks: 1, masteries: [true, false] };
    // 2 (levels) + 2 (5 checkmarks / 2) + 1 (mastery) + 1 (bonus)
    expect(perkMarksEarned(c, R.checkmarks)).toBe(6);
  });

  it('R-CHAR-11: checkmarks beyond the track give no extra perk marks', () => {
    expect(perkMarksEarned({ ...base, checkmarks: 20 }, R.checkmarks)).toBe(4);
  });

  it('R-CHAR-12: available = earned - marked boxes', () => {
    const c = { ...base, level: 3, perkMarks: [1, 0, 1] };
    expect(perkMarksAvailable(c, R.checkmarks)).toBe(0);
  });

  it('R-CHAR-13: unlinked boxes count each; linked boxes only when all are filled', () => {
    const perks = [
      { text: 'a', boxes: 2, linked: false },
      { text: 'b', boxes: 2, linked: true },
      { text: 'c', boxes: 3, linked: true },
    ];
    expect(perksGained([2, 2, 2], perks)).toEqual([2, 1, 0]);
  });
});

describe('checkmarks', () => {
  it('R-CHAR-11: gains stop at the end of the track', () => {
    expect(applyCheckmarkChange(7, 3, R.checkmarks)).toBe(8);
  });
  it('R-CHAR-11: losses only go back to the last complete set', () => {
    expect(applyCheckmarkChange(5, -3, R.checkmarks)).toBe(4);
    expect(applyCheckmarkChange(4, -1, R.checkmarks)).toBe(4);
  });
});

describe('gold and items', () => {
  it('R-CHAR-21: starting gold from prosperity', () => {
    expect(startingGold(1, R.startingGold)).toBe(12);
    expect(startingGold(3, R.startingGold)).toBe(22);
  });
  it('R-CHAR-17: sell price from gold cost or crafting cost', () => {
    expect(sellPrice({ goldCost: 25, craftCostCount: null })).toBe(12);
    expect(sellPrice({ goldCost: null, craftCostCount: 3 })).toBe(6);
    expect(sellPrice({ goldCost: null, craftCostCount: null })).toBeNull();
  });
});
