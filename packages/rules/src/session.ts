import type { ResourceBag, RuleTables } from '@fht/shared';

export interface ParticipantResult {
  coins: number;
  xp: number;
  checkmarks: number;
  masteries: number[];
  resources: ResourceBag;
}

export interface CharacterDelta {
  gold: number;
  xp: number;
  checkmarks: number;
  masteries: number[];
  resources: ResourceBag;
}

/**
 * What one character gains from a scenario.
 * - Gold: loot coins × gold conversion of the scenario level, lost or completed (R-SCN-08).
 * - XP: dial XP always; bonus XP by scenario level only when completed (R-SCN-08).
 * - Checkmarks and new masteries only when completed (R-SCN-10, R-SCN-14, R-CHAR-14).
 * - Loot resources when completed, or when lost and the party returns to Frosthaven;
 *   not when the party replays immediately (R-SCN-09, R-SCN-10).
 * - Casual mode changes nothing (R-SCN-17).
 */
export function participantDelta(
  p: ParticipantResult,
  session: {
    scenarioLevel: number;
    outcome: 'completed' | 'lost';
    lostChoice: 'return' | 'replay' | null;
    casual: boolean;
  },
  table: RuleTables['scenarioLevel'],
): CharacterDelta {
  const zero = { gold: 0, xp: 0, checkmarks: 0, masteries: [], resources: {} };
  if (session.casual) return zero;
  const completed = session.outcome === 'completed';
  const conversion = table.goldConversion[session.scenarioLevel] ?? table.goldConversion.at(-1)!;
  const bonus = table.bonusXp[session.scenarioLevel] ?? table.bonusXp.at(-1)!;
  const keepLoot = completed || session.lostChoice === 'return';
  return {
    gold: p.coins * conversion,
    xp: p.xp + (completed ? bonus : 0),
    checkmarks: completed ? p.checkmarks : 0,
    masteries: completed ? p.masteries : [],
    resources: keepLoot ? p.resources : {},
  };
}

/**
 * Whether an outpost phase follows the session.
 * RULE: R-OUT-01 (none after replaying a lost scenario; linked scenarios may skip it)
 */
export function outpostPhaseFollows(session: {
  outcome: 'completed' | 'lost';
  lostChoice: 'return' | 'replay' | null;
  casual: boolean;
}) {
  if (session.casual) return false;
  return !(session.outcome === 'lost' && session.lostChoice === 'replay');
}
