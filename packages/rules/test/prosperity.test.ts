import { describe, expect, it } from 'vitest';
import { applyProsperityChange, prosperityLevel, prosperityLevelCap } from '../src/prosperity.ts';
import { fixtureRules as R } from './fixtures.ts';

describe('prosperity', () => {
  it('R-CAMP-05: level increases when a numbered box is reached', () => {
    expect(prosperityLevel(0, R.prosperity)).toBe(1);
    expect(prosperityLevel(2, R.prosperity)).toBe(1);
    expect(prosperityLevel(3, R.prosperity)).toBe(2);
    expect(prosperityLevel(12, R.prosperity)).toBe(4);
  });
  it('R-CAMP-05: an unknown threshold caps the level', () => {
    expect(prosperityLevel(1000, R.prosperity)).toBe(4);
  });
  it('R-CAMP-05: losses never erase a reached numbered box', () => {
    expect(applyProsperityChange(8, -3, R.prosperity)).toBe(7);
    expect(applyProsperityChange(2, -5, R.prosperity)).toBe(0);
    expect(applyProsperityChange(4, 2, R.prosperity)).toBe(6);
  });
  it('R-CHAR-05: level cap is half the prosperity level, rounded up', () => {
    expect(prosperityLevelCap(1)).toBe(1);
    expect(prosperityLevelCap(4)).toBe(2);
    expect(prosperityLevelCap(5)).toBe(3);
  });
});
