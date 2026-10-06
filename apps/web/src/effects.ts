import type { Effect } from '@fht/shared';

/** Human-readable effect line for the review list. */
export function describeEffect(e: Effect, scenarioName: (n: number) => string): string {
  switch (e.type) {
    case 'unlockScenario':
      return `${e.condition ? `${e.condition} ` : ''}Unlock scenario ${scenarioName(e.scenario)}${
        e.link === 'forced' ? ' (force-linked)' : e.link === 'linked' ? ' (linked)' : ''
      }`;
    case 'lockOutScenario':
      return `Lock out scenario ${scenarioName(e.scenario)}`;
    case 'gainCampaignSticker':
      return `Gain campaign sticker "${e.name}"`;
    case 'loseCampaignSticker':
      return `Lose campaign sticker "${e.name}"`;
    case 'adjust':
      return `${e.amount >= 0 ? 'Gain' : 'Lose'} ${Math.abs(e.amount)} ${e.target}`;
    case 'setMorale':
      return e.value === null ? 'Set morale (by hand)' : `Set morale to ${e.value}`;
    case 'addCalendarSection':
      return `Add section ${e.section} to the calendar in ${e.weeksAhead} weeks`;
    case 'eventDeck':
      return `${e.op === 'add' ? 'Add' : 'Remove'} event(s) ${e.events.join(', ')} ${e.op === 'add' ? 'to' : 'from'} the ${e.deck} deck`;
    case 'unlockClass':
      return e.classKey ? `Unlock class ${e.classKey}` : 'Unlock a class (choose in Settings)';
    case 'unlockBuilding':
      return e.number !== null ? `Unlock building ${e.number}` : 'Unlock a building';
    case 'readSection':
      return `Read section ${e.ref}`;
    case 'manual':
      return e.note;
    case 'chooseOne':
      return 'Choose one';
  }
}
