import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns } from '../../src/db/schema.ts';
import { importSeed, readSeedDir } from '../../src/services/seed.ts';
import { createTestApp, makeUser } from './helpers.ts';

const SEED_DIR = fileURLToPath(new URL('../../../../seed-example', import.meta.url));

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp({ SEED_DIR });
  const data = await readSeedDir(SEED_DIR);
  await t.db.transaction((tx) => importSeed(tx, data, null));
});
afterAll(() => t.close());

type Client = Awaited<ReturnType<typeof makeUser>>['client'];
type ScenarioList = { scenarios: { number: number; status: string; playable: boolean }[] };
type State = {
  campaign: {
    morale: number | null;
    inspiration: number;
    prosperityChecks: number;
    currentWeek: number;
    supply: Record<string, number>;
  };
  stickers: { name: string; count: number }[];
  calendar: { week: number; sectionRef: string; id: string }[];
  derived: { moraleDefenseModifier: number | null; effectiveDefense: number };
};

async function setup() {
  const host = await makeUser(t.app, t.db);
  const player = await makeUser(t.app, t.db);
  const { data } = await host.client.mutate<{ id: string }>('campaign.create', { name: 'Play' });
  const campaignId = data!.id;
  const inv = await host.client.mutate<{ code: string }>('campaign.createInvite', { campaignId });
  await player.client.mutate('campaign.acceptInvite', { code: inv.data!.code });
  const mk = async (c: Client, classKey: string) =>
    (await c.mutate<{ id: string }>('character.create', { campaignId, classKey, name: classKey }))
      .data!.id;
  const a = await mk(player.client, 'example-guardian');
  const b = await mk(host.client, 'example-scout');
  return { host, player, campaignId, chars: [a, b] };
}

const status = async (c: Client, campaignId: string) =>
  Object.fromEntries(
    (await c.query<ScenarioList>('scenario.list', { campaignId })).data!.scenarios.map((s) => [
      s.number,
      s,
    ]),
  );
const state = async (c: Client, campaignId: string) =>
  (await c.query<State>('state.get', { campaignId })).data!;
const sectionEffects = async (c: Client, campaignId: string, ref: string) =>
  (await c.query<{ effects: unknown[] }>('section.get', { campaignId, ref })).data!.effects;
const apply = (c: Client, campaignId: string, ref: string, effects: unknown[]) =>
  c.mutate<{ readNext: string[]; manual: string[] }>('section.commit', {
    campaignId,
    ref,
    effects,
  });

describe('campaign setup', () => {
  it('R-SCN-06/R-OUT-16: starting scenarios are unlocked and starting buildings built', async () => {
    const { host, campaignId } = await setup();
    const s = await status(host.client, campaignId);
    expect(s[0]).toMatchObject({ status: 'unlocked', playable: true });
    expect(s[1]).toMatchObject({ status: 'unlocked', playable: true });
    expect(s[2]).toMatchObject({ status: 'locked', playable: false });
    const b = await host.client.query<{
      buildings: { number: number; level: number; state: string }[];
    }>('outpost.buildings', { campaignId });
    expect(b.data!.buildings.map((x) => [x.number, x.level, x.state])).toEqual([
      [10, 1, 'built'],
      [20, 1, 'built'],
    ]);
  });
});

describe('sections', () => {
  it('R-SCN-05/05a/19: applying sections unlocks, locks out, adds stickers, prosperity and calendar', async () => {
    const { host, campaignId } = await setup();
    const r1 = await apply(
      host.client,
      campaignId,
      '11.1',
      await sectionEffects(host.client, campaignId, '11.1'),
    );
    expect(r1.data?.manual).toHaveLength(1); // set starting morale
    let s = await status(host.client, campaignId);
    expect(s[2]?.status).toBe('unlocked');
    expect(s[3]?.status).toBe('unlocked');

    await apply(
      host.client,
      campaignId,
      '12.1',
      await sectionEffects(host.client, campaignId, '12.1'),
    );
    s = await status(host.client, campaignId);
    expect(s[3]?.status).toBe('locked_out');
    expect(s[4]).toMatchObject({ status: 'unlocked', playable: false }); // needs the boat sticker
    const st = await state(host.client, campaignId);
    expect(st.stickers).toEqual([expect.objectContaining({ name: 'Example Map', count: 1 })]);
    expect(st.campaign.prosperityChecks).toBe(1);
    expect(st.calendar).toEqual([expect.objectContaining({ week: 2, sectionRef: '81.1' })]);

    // R-SCN-04: the sticker requirement is met after "Example Boat Built"
    await apply(
      host.client,
      campaignId,
      '20.1',
      await sectionEffects(host.client, campaignId, '20.1'),
    );
    expect((await status(host.client, campaignId))[4]?.playable).toBe(true);
  });

  it('choices must be resolved; players cannot apply sections or see their effects', async () => {
    const { host, player, campaignId } = await setup();
    const eff = await sectionEffects(host.client, campaignId, '13.1');
    expect((await apply(host.client, campaignId, '13.1', eff)).error?.code).toBe('BAD_REQUEST');
    expect((await apply(player.client, campaignId, '20.1', [])).error?.code).toBe('FORBIDDEN');
    expect(await sectionEffects(player.client, campaignId, '13.1')).toEqual([]);
  });

  it('R-SCN-04: free-text requirements need the host override', async () => {
    const { host, campaignId } = await setup();
    await host.client.mutate('scenario.setStatus', { campaignId, scenario: 5, status: 'unlocked' });
    expect((await status(host.client, campaignId))[5]?.playable).toBe(false);
    await host.client.mutate('scenario.overrideRequirement', {
      campaignId,
      scenario: 5,
      override: true,
    });
    expect((await status(host.client, campaignId))[5]?.playable).toBe(true);
  });

  it('host can revert a section application from the campaign history', async () => {
    const { host, campaignId } = await setup();
    await apply(
      host.client,
      campaignId,
      '11.1',
      await sectionEffects(host.client, campaignId, '11.1'),
    );
    const h = await host.client.query<{ entries: { groupId: string; action: string }[] }>(
      'state.history',
      { campaignId },
    );
    const g = h.data!.entries.find((e) => e.action === 'section_11.1')!;
    expect(
      (await host.client.mutate('state.revert', { campaignId, groupId: g.groupId })).error,
    ).toBeUndefined();
    expect((await status(host.client, campaignId))[2]?.status).toBe('locked');
  });
});

describe('sessions', () => {
  const base = (campaignId: string, chars: string[], over: Record<string, unknown> = {}) => ({
    campaignId,
    date: '2026-10-05',
    scenario: 1,
    scenarioLevel: 1,
    outcome: 'completed',
    lostChoice: null,
    participants: [
      {
        characterId: chars[0],
        coins: 3,
        xp: 4,
        checkmarks: 1,
        masteries: [0],
        resources: { wood: 2 },
      },
      { characterId: chars[1], coins: 1, xp: 2, checkmarks: 0, masteries: [], resources: {} },
    ],
    ...over,
  });
  type Sheet = {
    character: {
      gold: number;
      xp: number;
      checkmarks: number;
      masteries: boolean[];
      resources: Record<string, number>;
    };
  };
  const sheet = async (c: Client, characterId: string) =>
    (await c.query<Sheet>('character.get', { characterId })).data!.character;

  it('R-SCN-08/10/14, R-CAMP-11: a completed session applies gold, XP, checkmarks, masteries, loot, inspiration', async () => {
    const { host, player, campaignId, chars } = await setup();
    const r = await host.client.mutate<{ firstCompletion: boolean; conclusionSections: string[] }>(
      'session.log',
      base(campaignId, chars),
    );
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({ firstCompletion: true, conclusionSections: ['11.1'] });
    // starting gold 12 + 3 coins x 2 ; xp 4 + bonus 5
    expect(await sheet(player.client, chars[0]!)).toMatchObject({
      gold: 18,
      xp: 9,
      checkmarks: 1,
      masteries: [true, false],
      resources: { wood: 2 },
    });
    const st = await state(host.client, campaignId);
    expect(st.campaign.inspiration).toBe(2); // 4 - 2 characters
    expect((await status(host.client, campaignId))[1]?.status).toBe('completed');

    // R-SCN-10: replaying a completed scenario gives no rewards again
    const again = await host.client.mutate<{ firstCompletion: boolean }>(
      'session.log',
      base(campaignId, chars),
    );
    expect(again.data?.firstCompletion).toBe(false);
  });

  it('R-SCN-09: lost + replay keeps gold and XP but not loot resources; no outpost phase', async () => {
    const { host, player, campaignId, chars } = await setup();
    const r = await host.client.mutate<{ outpostPhaseFollows: boolean }>(
      'session.log',
      base(campaignId, chars, { outcome: 'lost', lostChoice: 'replay' }),
    );
    expect(r.data?.outpostPhaseFollows).toBe(false);
    expect(await sheet(player.client, chars[0]!)).toMatchObject({
      gold: 18,
      xp: 4,
      checkmarks: 0,
      resources: {},
    });
    expect((await status(host.client, campaignId))[1]?.status).toBe('unlocked');
  });

  it('R-SCN-03/17: locked scenarios are refused; casual sessions change nothing', async () => {
    const { host, player, campaignId, chars } = await setup();
    expect(
      (await host.client.mutate('session.log', base(campaignId, chars, { scenario: 2 }))).error
        ?.code,
    ).toBe('BAD_REQUEST');
    await host.client.mutate('session.log', base(campaignId, chars, { casual: true }));
    expect(await sheet(player.client, chars[0]!)).toMatchObject({ gold: 12, xp: 0 });
    expect((await status(host.client, campaignId))[1]?.status).toBe('unlocked');
  });

  it('only hosts log sessions; a logged session can be reverted completely', async () => {
    const { host, player, campaignId, chars } = await setup();
    expect((await player.client.mutate('session.log', base(campaignId, chars))).error?.code).toBe(
      'FORBIDDEN',
    );
    const r = await host.client.mutate<{ auditGroupId: string }>(
      'session.log',
      base(campaignId, chars),
    );
    expect(
      (await host.client.mutate('state.revert', { campaignId, groupId: r.data!.auditGroupId }))
        .error,
    ).toBeUndefined();
    expect(await sheet(player.client, chars[0]!)).toMatchObject({ gold: 12, xp: 0, checkmarks: 0 });
    expect((await status(host.client, campaignId))[1]?.status).toBe('unlocked');
    expect((await state(host.client, campaignId)).campaign.inspiration).toBe(0);
    expect((await host.client.query<unknown[]>('session.list', { campaignId })).data).toEqual([]);
  });
});

describe('campaign state', () => {
  it('R-CAMP-07/08: morale is clamped, the max triggers a section, defense modifier follows', async () => {
    const { host, campaignId } = await setup();
    expect(
      (await host.client.mutate('state.adjust', { campaignId, field: 'morale', delta: 1 })).error
        ?.code,
    ).toBe('BAD_REQUEST');
    await host.client.mutate('state.setMorale', { campaignId, morale: 11 });
    const r = await host.client.mutate<{ readNext: string[] }>('state.adjust', {
      campaignId,
      field: 'morale',
      delta: 3,
    });
    expect(r.data?.readNext).toEqual(['90.2']);
    const st = await state(host.client, campaignId);
    expect(st.campaign.morale).toBe(12);
    expect(st.derived.moraleDefenseModifier).toBe(5);
  });

  it('R-SCN-15: a numbered treasure can only be looted once; stickers count up and down', async () => {
    const { host, player, campaignId } = await setup();
    expect(
      (await host.client.mutate('state.treasure', { campaignId, number: 7, looted: true })).error,
    ).toBeUndefined();
    expect(
      (await host.client.mutate('state.treasure', { campaignId, number: 7, looted: true })).error
        ?.code,
    ).toBe('BAD_REQUEST');
    await host.client.mutate('state.sticker', { campaignId, name: 'Shard', delta: 1 });
    await host.client.mutate('state.sticker', { campaignId, name: 'Shard', delta: 1 });
    await host.client.mutate('state.sticker', { campaignId, name: 'Shard', delta: -1 });
    expect((await state(host.client, campaignId)).stickers).toEqual([
      expect.objectContaining({ name: 'Shard', count: 1 }),
    ]);
    expect(
      (await player.client.mutate('state.sticker', { campaignId, name: 'X', delta: 1 })).error
        ?.code,
    ).toBe('FORBIDDEN');
  });
});

describe('outpost phase and buildings', () => {
  it('R-OUT-02/03, R-CAMP-03/04: passage of time marks a week and brings due sections', async () => {
    const { host, campaignId } = await setup();
    await apply(
      host.client,
      campaignId,
      '12.1',
      await sectionEffects(host.client, campaignId, '12.1'),
    ); // calendar +2 weeks
    for (const week of [1, 2]) {
      await host.client.mutate('outpost.start', { campaignId });
      const r = await host.client.mutate<{ week: number; due: { sectionRef: string }[] }>(
        'outpost.passTime',
        { campaignId },
      );
      expect(r.data?.week).toBe(week);
      if (week === 2) expect(r.data!.due.map((d) => d.sectionRef).sort()).toEqual(['80.1', '81.1']);
      expect((await host.client.mutate('outpost.passTime', { campaignId })).error?.code).toBe(
        'BAD_REQUEST',
      );
      await host.client.mutate('outpost.close', { campaignId });
    }
  });

  it('R-OUT-14: builds need an outpost phase, prosperity and costs (inspiration covers missing materials)', async () => {
    const { host, campaignId } = await setup();
    const act = (action: string, extra: Record<string, unknown> = {}) =>
      host.client.mutate('outpost.building', { campaignId, number: 30, action, ...extra });
    expect((await act('unlock')).error).toBeUndefined();
    expect((await act('build')).error?.message).toMatch(/outpost phase/);
    await host.client.mutate('outpost.start', { campaignId });
    expect((await act('build')).error?.message).toMatch(/prosperity 1|Not enough/);
    await t.db
      .update(campaigns)
      .set({ supply: { wood: 1 }, inspiration: 2 })
      .where(eq(campaigns.id, campaignId));
    expect((await act('build')).error).toBeUndefined();
    let st = await state(host.client, campaignId);
    expect(st.campaign).toMatchObject({ supply: { wood: 0 }, inspiration: 0, prosperityChecks: 1 });

    // Second build costs morale and must be confirmed; a third is not allowed.
    await host.client.mutate('state.setMorale', { campaignId, morale: 6 });
    await t.db
      .update(campaigns)
      .set({ supply: { wood: 5, stone: 5 }, prosperityChecks: 3 })
      .where(eq(campaigns.id, campaignId));
    const up = (extra: Record<string, unknown> = {}) =>
      host.client.mutate('outpost.building', {
        campaignId,
        number: 10,
        action: 'upgrade',
        ...extra,
      });
    expect((await up()).error?.message).toMatch(/morale/);
    expect((await up({ extraBuild: true })).error).toBeUndefined();
    st = await state(host.client, campaignId);
    expect(st.campaign).toMatchObject({ morale: 4, supply: { wood: 3, stone: 4 } });
    expect((await act('wreck')).error).toBeUndefined();
    expect((await act('rebuild')).error).toBeUndefined();
    expect(
      (
        await host.client.mutate('outpost.building', {
          campaignId,
          number: 20,
          action: 'upgrade',
          extraBuild: true,
        })
      ).error?.message,
    ).toMatch(/two/);
  });

  it('R-OUT-08: damaged buildings are repaired with materials or morale', async () => {
    const { host, campaignId } = await setup();
    await host.client.mutate('state.setMorale', { campaignId, morale: 6 });
    await t.db
      .update(campaigns)
      .set({ supply: { wood: 1, stone: 3 } })
      .where(eq(campaigns.id, campaignId));
    expect(
      (
        await host.client.mutate('outpost.building', {
          campaignId,
          number: 10,
          action: 'damage_repair_pay',
        })
      ).error,
    ).toBeUndefined();
    expect((await state(host.client, campaignId)).campaign.supply).toEqual({ wood: 1, stone: 1 });
    await host.client.mutate('outpost.building', {
      campaignId,
      number: 10,
      action: 'damage_repair_morale',
    });
    expect((await state(host.client, campaignId)).campaign.morale).toBe(5);
  });
});
