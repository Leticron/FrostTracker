import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BaseEffect, Effect, SeedData } from '@fht/shared';
import { describe, expect, it } from 'vitest';
import { readSeedDir } from '../../src/services/seed.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const SEED_EXAMPLE = join(root, 'seed-example');
const SEED_TEST = join(root, 'seed-test');

const flat = (effects: Effect[]): BaseEffect[] =>
  effects.flatMap((e) => (e.type === 'chooseOne' ? e.options : [e]));

/** Every reference inside a seed points at something that exists. */
function danglingRefs(d: SeedData): string[] {
  const out: string[] = [];
  const sections = new Map(d.sections.map((s) => [s.ref, s]));
  const scenarios = new Set(d.scenarios.map((s) => s.number));
  const classes = new Set(d.classes.map((c) => c.key));
  const buildings = new Set(d.buildings.map((b) => b.number));
  const resources = new Set(d.ruleTables.resources.map((r) => r.key));
  const section = (ref: string | null, where: string) => {
    if (ref !== null && !sections.has(ref)) out.push(`${where}: section ${ref}`);
  };

  for (const sc of d.scenarios) {
    for (const ref of sc.conclusionSections) {
      section(ref, `scenario ${sc.number}`);
      const s = sections.get(ref);
      if (s && s.scenario !== sc.number) out.push(`section ${ref} belongs to ${s.scenario}`);
    }
  }
  for (const s of d.sections) {
    for (const e of flat(s.effects)) {
      const where = `section ${s.ref}`;
      if (
        (e.type === 'unlockScenario' || e.type === 'lockOutScenario') &&
        !scenarios.has(e.scenario)
      )
        out.push(`${where}: scenario ${e.scenario}`);
      if (e.type === 'readSection') section(e.ref, where);
      if (e.type === 'addCalendarSection') section(e.section, where);
      if (e.type === 'unlockClass' && e.classKey !== null && !classes.has(e.classKey))
        out.push(`${where}: class ${e.classKey}`);
      if (e.type === 'unlockBuilding' && e.number !== null && !buildings.has(e.number))
        out.push(`${where}: building ${e.number}`);
    }
  }
  for (const p of d.ruleTables.calendarPreprinted)
    for (const ref of p.sections) section(ref, `calendar week ${p.week}`);
  section(d.ruleTables.morale.minSection, 'morale.minSection');
  section(d.ruleTables.morale.maxSection, 'morale.maxSection');
  for (const b of d.buildings)
    for (const l of b.levels)
      for (const c of [l.cost, l.rebuildCost])
        for (const r of Object.keys(c?.resources ?? {}))
          if (!resources.has(r)) out.push(`building ${b.number}: resource ${r}`);
  return out;
}

describe('seed-example', () => {
  it('is valid and has no dangling references', async () => {
    expect(danglingRefs(await readSeedDir(SEED_EXAMPLE))).toEqual([]);
  });
});

describe('seed-test (large fictional seed)', () => {
  it('is valid, full-size and has no dangling references', async () => {
    const d = await readSeedDir(SEED_TEST);
    expect(d.scenarios.length).toBeGreaterThanOrEqual(130);
    expect(d.sections.length).toBeGreaterThanOrEqual(700);
    expect(danglingRefs(d)).toEqual([]);
  });

  it('uses every effect type and every map marker case', async () => {
    const d = await readSeedDir(SEED_TEST);
    const types = new Set(d.sections.flatMap((s) => s.effects.map((e) => e.type)));
    for (const t of [
      'unlockScenario',
      'lockOutScenario',
      'gainCampaignSticker',
      'loseCampaignSticker',
      'adjust',
      'setMorale',
      'addCalendarSection',
      'eventDeck',
      'unlockClass',
      'unlockBuilding',
      'readSection',
      'manual',
      'chooseOne',
    ])
      expect(types, t).toContain(t);
    const layers = new Set(d.scenarios.map((s) => s.marker?.layer ?? 'none'));
    expect([...layers].sort()).toEqual(['none', 'town', 'world']);
  });

  it('can reach every scenario, locked class and building', async () => {
    const d = await readSeedDir(SEED_TEST);
    const effects = d.sections.flatMap((s) => flat(s.effects));
    const unlocked = new Set([
      ...d.scenarios.filter((s) => s.initiallyUnlocked).map((s) => s.number),
      ...effects.flatMap((e) => (e.type === 'unlockScenario' ? [e.scenario] : [])),
    ]);
    expect(d.scenarios.filter((s) => !unlocked.has(s.number)).map((s) => s.number)).toEqual([]);
    const classKeys = new Set(
      effects.flatMap((e) => (e.type === 'unlockClass' ? [e.classKey] : [])),
    );
    expect(d.classes.filter((c) => !c.starting && !classKeys.has(c.key)).map((c) => c.key)).toEqual(
      [],
    );
    const buildingNos = new Set(
      effects.flatMap((e) => (e.type === 'unlockBuilding' ? [e.number] : [])),
    );
    expect(
      d.buildings.filter((b) => !b.starting && !buildingNos.has(b.number)).map((b) => b.number),
    ).toEqual([]);
  });

  it('can meet every sticker requirement', async () => {
    const d = await readSeedDir(SEED_TEST);
    const gained = new Map<string, number>();
    for (const s of d.sections)
      for (const e of flat(s.effects))
        if (e.type === 'gainCampaignSticker') gained.set(e.name, (gained.get(e.name) ?? 0) + 1);
    for (const sc of d.scenarios)
      for (const r of sc.requirements)
        if ('campaignSticker' in r)
          expect(
            gained.get(r.campaignSticker) ?? 0,
            `scenario ${sc.number}`,
          ).toBeGreaterThanOrEqual(r.minCount);
  });

  it('matches the generator output', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fht-seed-'));
    try {
      execFileSync(process.execPath, [join(root, 'scripts/generate-test-seed.ts'), tmp]);
      for (const f of readdirSync(SEED_TEST))
        expect(readFileSync(join(tmp, f), 'utf8'), `${f} is stale; run the generator`).toBe(
          readFileSync(join(SEED_TEST, f), 'utf8'),
        );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
