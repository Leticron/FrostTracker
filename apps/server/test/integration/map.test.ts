import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEntries, scenarioDefs } from '../../src/db/schema.ts';
import { importSeed, readSeedDir } from '../../src/services/seed.ts';
import { Client, createTestApp, makeUser } from './helpers.ts';

const SEED_DIR = fileURLToPath(new URL('../../../../seed-example', import.meta.url));

let t: Awaited<ReturnType<typeof createTestApp>>;
let assets: string;
beforeAll(async () => {
  assets = await mkdtemp(join(tmpdir(), 'fht-assets-'));
  await mkdir(join(assets, 'map'));
  await writeFile(join(assets, 'map', 'world.png'), 'not really a png');
  t = await createTestApp({ SEED_DIR, ASSETS_DIR: assets });
  const data = await readSeedDir(SEED_DIR);
  await t.db.transaction((tx) => importSeed(tx, data, null));
});
afterAll(async () => {
  await t.close();
  await rm(assets, { recursive: true, force: true });
});

type Scenario = { number: number; marker: { x: number; y: number; layer: string } | null };

async function setup() {
  const host = await makeUser(t.app, t.db);
  const player = await makeUser(t.app, t.db);
  const outsider = await makeUser(t.app, t.db);
  const { data } = await host.client.mutate<{ id: string }>('campaign.create', { name: 'Map' });
  const campaignId = data!.id;
  const inv = await host.client.mutate<{ code: string }>('campaign.createInvite', { campaignId });
  await player.client.mutate('campaign.acceptInvite', { code: inv.data!.code });
  return { host, player, outsider, campaignId };
}

describe('map images', () => {
  it('lists the mounted map images for members only', async () => {
    const { player, outsider, campaignId } = await setup();
    const r = await player.client.query<{ world: string | null; town: string | null }>(
      'map.images',
      { campaignId },
    );
    expect(r.data?.world).toMatch(/^\/media\/map\/world\.png\?v=\d+$/);
    expect(r.data?.town).toBeNull();
    expect((await outsider.client.query('map.images', { campaignId })).error?.code).toBe(
      'NOT_FOUND',
    );
  });

  it('serves asset files to signed-in users only', async () => {
    const { player } = await setup();
    expect((await new Client(t.app).get('/media/map/world.png')).statusCode).toBe(401);
    const res = await player.client.get('/media/map/world.png');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('not really a png');
    expect((await player.client.get('/media/../package.json')).statusCode).not.toBe(200);
  });
});

describe('markers', () => {
  it('hosts place and remove markers; players cannot; changes are audited', async () => {
    const { host, player, campaignId } = await setup();
    const marker = { x: 0.25, y: 0.75, layer: 'world' };
    expect(
      (await player.client.mutate('map.setMarker', { campaignId, scenario: 1, marker })).error
        ?.code,
    ).toBe('FORBIDDEN');
    expect(
      (await host.client.mutate('map.setMarker', { campaignId, scenario: 999, marker })).error
        ?.code,
    ).toBe('NOT_FOUND');
    expect(
      (
        await host.client.mutate('map.setMarker', {
          campaignId,
          scenario: 1,
          marker: { ...marker, x: 1.5 },
        })
      ).error?.code,
    ).toBe('BAD_REQUEST');

    expect(
      (await host.client.mutate('map.setMarker', { campaignId, scenario: 1, marker })).error,
    ).toBeUndefined();
    const list = await player.client.query<{ scenarios: Scenario[] }>('scenario.list', {
      campaignId,
    });
    expect(list.data!.scenarios.find((s) => s.number === 1)?.marker).toEqual(marker);

    const audit = await t.db
      .select()
      .from(auditEntries)
      .where(
        and(eq(auditEntries.campaignId, campaignId), eq(auditEntries.entity, 'scenario_marker')),
      );
    expect(audit.map((a) => a.action)).toEqual(['place_marker']);

    await host.client.mutate('map.setMarker', { campaignId, scenario: 1, marker: null });
    const after = await host.client.query<{ scenarios: Scenario[] }>('scenario.list', {
      campaignId,
    });
    expect(after.data!.scenarios.find((s) => s.number === 1)?.marker).toBeNull();
  });

  it('exports scenarios with markers in seed format (host only)', async () => {
    const { host, player, campaignId } = await setup();
    const marker = { x: 0.5, y: 0.5, layer: 'town' };
    await host.client.mutate('map.setMarker', { campaignId, scenario: 2, marker });
    expect((await player.client.query('map.exportScenarios', { campaignId })).error?.code).toBe(
      'FORBIDDEN',
    );
    const r = await host.client.query<(Scenario & { name: string; coord: string | null })[]>(
      'map.exportScenarios',
      { campaignId },
    );
    const s2 = r.data!.find((s) => s.number === 2)!;
    expect(s2.marker).toEqual(marker);
    expect(s2.name).toBe('Example Left Path');
    // The export is valid seed input.
    const { scenarioDef } = await import('@fht/shared');
    for (const s of r.data!) expect(scenarioDef.safeParse(s).success).toBe(true);
  });

  it('keeps placed markers when a newer seed without markers is imported', async () => {
    const { host, campaignId } = await setup();
    const marker = { x: 0.1, y: 0.2, layer: 'world' };
    await host.client.mutate('map.setMarker', { campaignId, scenario: 3, marker });
    const data = await readSeedDir(SEED_DIR);
    const set = await t.db.transaction((tx) => importSeed(tx, data, null));
    const [def] = await t.db
      .select()
      .from(scenarioDefs)
      .where(and(eq(scenarioDefs.dataSetId, set.id), eq(scenarioDefs.number, 3)));
    expect({ x: def!.markerX, y: def!.markerY, layer: def!.markerLayer }).toEqual(marker);
  });
});
