import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importSeed, readSeedDir } from '../../src/services/seed.ts';
import { appRouter } from '../../src/trpc/router.ts';
import { Client, createTestApp, makeUser } from './helpers.ts';

const SEED_DIR = fileURLToPath(new URL('../../../../seed-example', import.meta.url));
/** Procedures that intentionally work without a session. */
const PUBLIC = new Set(['auth.me', 'auth.register', 'auth.login', 'auth.logout']);

let t: Awaited<ReturnType<typeof createTestApp>>;
let assets: string;
beforeAll(async () => {
  assets = await mkdtemp(join(tmpdir(), 'fht-sec-'));
  await mkdir(join(assets, 'map'));
  await writeFile(join(assets, 'map', 'world.png'), 'png');
  await writeFile(join(assets, 'evil.html'), '<script>alert(1)</script>');
  await writeFile(join(assets, 'map', 'evil.svg'), '<svg onload="alert(1)"/>');
  t = await createTestApp({ SEED_DIR, ASSETS_DIR: assets });
  await t.db.transaction(async (tx) => importSeed(tx, await readSeedDir(SEED_DIR), null));
});
afterAll(async () => {
  await t.close();
  await rm(assets, { recursive: true, force: true });
});

const procedures = Object.entries(appRouter._def.procedures as Record<string, unknown>).map(
  ([path, p]) => ({ path, type: (p as { _def: { type: string } })._def.type }),
);

describe('authentication on every procedure', () => {
  it('finds the routers (sanity check)', () => {
    expect(procedures.length).toBeGreaterThan(60);
    expect(procedures.map((p) => p.path)).toContain('map.setMarker');
  });

  it('rejects calls without a session, except the public auth procedures', async () => {
    const anon = new Client(t.app);
    const failures: string[] = [];
    for (const { path, type } of procedures) {
      if (PUBLIC.has(path)) continue;
      const r =
        type === 'query'
          ? await anon.query(path, { campaignId: '00000000-0000-4000-8000-000000000000' })
          : await anon.mutate(path, { campaignId: '00000000-0000-4000-8000-000000000000' });
      if (r.error?.code !== 'UNAUTHORIZED') failures.push(`${path}: ${r.error?.code ?? r.status}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('spoilers and permissions', () => {
  it('only hosts see where scenarios are unlocked from', async () => {
    const host = await makeUser(t.app, t.db);
    const player = await makeUser(t.app, t.db);
    const { data } = await host.client.mutate<{ id: string }>('campaign.create', { name: 'Sec' });
    const campaignId = data!.id;
    const inv = await host.client.mutate<{ code: string }>('campaign.createInvite', {
      campaignId,
    });
    await player.client.mutate('campaign.acceptInvite', { code: inv.data!.code });
    const input = { campaignId, scenario: 2 };
    expect((await player.client.query('scenario.sources', input)).error?.code).toBe('FORBIDDEN');
    expect((await host.client.query('scenario.sources', input)).error).toBeUndefined();
  });
});

describe('mounted assets', () => {
  it('serves images only, never HTML or SVG', async () => {
    const user = await makeUser(t.app, t.db);
    expect((await user.client.get('/media/map/world.png')).statusCode).toBe(200);
    expect((await user.client.get('/media/evil.html')).statusCode).toBe(404);
    expect((await user.client.get('/media/map/evil.svg')).statusCode).toBe(404);
    expect((await user.client.get('/media/map/')).statusCode).toBe(404);
  });
});
