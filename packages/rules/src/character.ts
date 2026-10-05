import type { ClassDef, ItemDef, RuleTables } from '@fht/shared';

export interface CharacterProgress {
  level: number;
  xp: number;
  checkmarks: number;
  bonusPerkMarks: number;
  /** Marked boxes per perk (same order as the class perk list). */
  perkMarks: number[];
  masteries: boolean[];
}

export function maxLevel(levels: RuleTables['levels']): number {
  return levels.xpThresholds.length;
}

/** XP needed for a level (level 1 = index 0). RULE: R-CHAR-03 */
export function xpForLevel(level: number, levels: RuleTables['levels']): number | undefined {
  return levels.xpThresholds[level - 1];
}

/**
 * Whether the character must level up from experience: their XP total meets the requirement
 * of the next level. XP is a running total and is not reset by levelling up.
 * RULE: R-CHAR-03, R-CHAR-04
 */
export function xpLevelUpDue(
  c: Pick<CharacterProgress, 'level' | 'xp'>,
  levels: RuleTables['levels'],
) {
  const next = xpForLevel(c.level + 1, levels);
  return next !== undefined && c.xp >= next;
}

/**
 * Optional level-up when the level is below half the prosperity level (rounded up);
 * XP is then raised to the new level's requirement.
 * RULE: R-CHAR-05
 */
export function prosperityLevelUp(
  c: Pick<CharacterProgress, 'level' | 'xp'>,
  cap: number,
  levels: RuleTables['levels'],
): { level: number; xp: number } | null {
  const target = c.level + 1;
  if (target > cap || target > maxLevel(levels)) return null;
  const need = xpForLevel(target, levels)!;
  return { level: target, xp: Math.max(c.xp, need) };
}

/**
 * Perk marks earned: one per level above 1, one per full set of checkmarks (capped by the
 * checkmark track), one per achieved mastery, plus the new-character bonus.
 * RULE: R-CHAR-11, R-CHAR-12, R-CHAR-14
 */
export function perkMarksEarned(
  c: CharacterProgress,
  checkmarks: RuleTables['checkmarks'],
): number {
  const fromCheckmarks = Math.floor(
    Math.min(c.checkmarks, checkmarks.max) / checkmarks.perPerkMark,
  );
  return c.level - 1 + fromCheckmarks + c.masteries.filter(Boolean).length + c.bonusPerkMarks;
}

export function perkMarksSpent(c: Pick<CharacterProgress, 'perkMarks'>): number {
  return c.perkMarks.reduce((a, b) => a + b, 0);
}

export function perkMarksAvailable(c: CharacterProgress, checkmarks: RuleTables['checkmarks']) {
  return perkMarksEarned(c, checkmarks) - perkMarksSpent(c);
}

/**
 * How often each perk has been gained: unlinked boxes count one each; linked boxes count
 * only when all are filled.
 * RULE: R-CHAR-13
 */
export function perksGained(perkMarks: number[], perks: ClassDef['perks']): number[] {
  return perks.map((p, i) => {
    const marked = Math.min(perkMarks[i] ?? 0, p.boxes);
    return p.linked ? (marked === p.boxes ? 1 : 0) : marked;
  });
}

/**
 * New checkmark total after a change. Gaining stops at the end of the track; losing can only
 * go back to the last complete set (perk marks are never lost).
 * RULE: R-CHAR-11
 */
export function applyCheckmarkChange(
  current: number,
  delta: number,
  checkmarks: RuleTables['checkmarks'],
): number {
  if (delta >= 0) return Math.min(checkmarks.max, current + delta);
  const floor = Math.floor(current / checkmarks.perPerkMark) * checkmarks.perPerkMark;
  return Math.max(floor, current + delta);
}

/** Starting gold of a new character. RULE: R-CHAR-21 */
export function startingGold(prosperity: number, table: RuleTables['startingGold']): number {
  return table.perProsperityLevel * prosperity + table.base;
}

/**
 * Sell price: purchasable items half their gold cost (rounded down), craftable items 2 gold
 * per resource or item in their crafting cost. null = unknown (enter manually).
 * RULE: R-CHAR-17
 */
export function sellPrice(item: Pick<ItemDef, 'goldCost' | 'craftCostCount'>): number | null {
  if (item.goldCost !== null) return Math.floor(item.goldCost / 2);
  if (item.craftCostCount !== null) return item.craftCostCount * 2;
  return null;
}

/** Max hit points at a level, if the class data includes it. RULE: R-CHAR-06 */
export function maxHitPoints(cls: Pick<ClassDef, 'maxHpByLevel'>, level: number): number | null {
  return cls.maxHpByLevel?.[level - 1] ?? null;
}
