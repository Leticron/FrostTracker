import { describe, expect, it } from 'vitest';
import {
  applyMoraleChange,
  inspirationGain,
  moraleDefenseModifier,
  preprintedSections,
  recommendedScenarioLevel,
} from '../src/campaign.ts';
import { fixtureRules as R } from './fixtures.ts';

const sections = { min: R.morale.minSection, max: R.morale.maxSection };

describe('morale', () => {
  it('R-CAMP-08: only the current range modifier applies; none outside the table', () => {
    expect(moraleDefenseModifier(9, R.morale)).toBe(3);
    expect(moraleDefenseModifier(5, R.morale)).toBe(0);
    expect(moraleDefenseModifier(0, R.morale)).toBeNull();
    expect(moraleDefenseModifier(null, R.morale)).toBeNull();
  });
  it('R-CAMP-07: clamps to the track and triggers the section at min/max once reached', () => {
    expect(applyMoraleChange(9, 5, R.morale, sections)).toEqual({
      morale: 10,
      triggeredSection: '1.2',
    });
    expect(applyMoraleChange(2, -5, R.morale, sections)).toEqual({
      morale: 0,
      triggeredSection: '1.1',
    });
    expect(applyMoraleChange(0, -1, R.morale, sections)).toEqual({
      morale: 0,
      triggeredSection: null,
    });
    expect(applyMoraleChange(4, 1, R.morale, sections)).toEqual({
      morale: 5,
      triggeredSection: null,
    });
  });
});

describe('inspiration and scenario level', () => {
  it('R-CAMP-11: base minus characters, never negative', () => {
    expect(inspirationGain(2, R.inspiration)).toBe(1);
    expect(inspirationGain(4, R.inspiration)).toBe(0);
  });
  it('R-SCN-12: half the average level rounded up; solo adds 1 first', () => {
    expect(recommendedScenarioLevel([2, 2])).toBe(1);
    expect(recommendedScenarioLevel([3, 2])).toBe(2);
    expect(recommendedScenarioLevel([4, 4, 4], true)).toBe(3);
    expect(recommendedScenarioLevel([])).toBe(0);
  });
});

describe('calendar', () => {
  it('R-CAMP-04: preprinted sections per week, only on the first sheet', () => {
    expect(preprintedSections(4, R)).toEqual(['5.2', '5.3']);
    expect(preprintedSections(3, R)).toEqual([]);
    expect(preprintedSections(9, R)).toEqual([]);
  });
});
