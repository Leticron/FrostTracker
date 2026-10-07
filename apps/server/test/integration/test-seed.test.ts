import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sectionDefs } from '../../src/db/schema.ts';
import { importSeed, readSeedDir } from '../../src/services/seed.ts';
import { createTestApp, makeUser } from './helpers.ts';

// The large fictional seed (scripts/generate-test-seed.ts) imports and plays like a real one.
const SEED_DIR = fileURLToPath(new URL('../../../../seed-test', import.meta.url));

let t: Awaited<ReturnType<typeof createTestApp>>;
let dataSetId: string;
beforeAll(async () => {
  t = await createTestApp({ SEED_DIR });
  const data = await readSeedDir(SEED_DIR);
  dataSetId = (await t.db.transaction((tx) => importSeed(tx, data, null))).id;
});
afterAll(async () => t.close());

type ScenarioList = { scenarios: { number: number; status: string }[] };

describe('seed-test', () => {
  it('imports every section', async () => {
    const rows = await t.db
      .select({ ref: sectionDefs.ref })
      .from(sectionDefs)
      .where(eq(sectionDefs.dataSetId, dataSetId));
    expect(rows.length).toBe((await readSeedDir(SEED_DIR)).sections.length);
  });

  it('starts a campaign and applies a conclusion', async () => {
    const host = await makeUser(t.app, t.db);
    const { data } = await host.client.mutate<{ id: string }>('campaign.create', { name: 'Big' });
    const campaignId = data!.id;
    const list = async () =>
      (await host.client.query<ScenarioList>('scenario.list', { campaignId })).data!.scenarios;
    const before = await list();
    expect(before.length).toBe(138);
    expect(before.filter((s) => s.status === 'unlocked').map((s) => s.number)).toEqual([0, 1]);

    const effects = (
      await host.client.query<{ effects: { type: string }[] }>('section.get', {
        campaignId,
        ref: '10.1',
      })
    ).data!.effects;
    // chooseOne needs a pick; take the first option so the commit is unambiguous.
    const resolved = effects.map((e) =>
      e.type === 'chooseOne' ? (e as unknown as { options: unknown[] }).options[0] : e,
    );
    const r = await host.client.mutate('section.commit', {
      campaignId,
      ref: '10.1',
      effects: resolved,
    });
    expect(r.error).toBeUndefined();
    expect((await list()).filter((s) => s.status === 'unlocked').length).toBeGreaterThan(2);
  });
});
