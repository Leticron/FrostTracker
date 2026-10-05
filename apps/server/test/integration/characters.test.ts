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

type Sheet = {
  character: Record<string, unknown> & {
    id: string;
    gold: number;
    level: number;
    xp: number;
    checkmarks: number;
    status: string;
    resources: Record<string, number>;
    perkMarks: number[];
    bonusPerkMarks: number;
  };
  canEdit: boolean;
  items: { id: string; name: string }[];
  derived: {
    perkMarksAvailable: number;
    perkMarksEarned: number;
    levelUpDue: boolean;
    maxHp: number | null;
  };
};

async function setup() {
  const host = await makeUser(t.app, t.db);
  const player = await makeUser(t.app, t.db);
  const { data } = await host.client.mutate<{ id: string }>('campaign.create', { name: 'Chars' });
  const campaignId = data!.id;
  const inv = await host.client.mutate<{ code: string }>('campaign.createInvite', { campaignId });
  await player.client.mutate('campaign.acceptInvite', { code: inv.data!.code });
  const created = await player.client.mutate<{ id: string }>('character.create', {
    campaignId,
    classKey: 'example-guardian',
    name: 'Hero',
  });
  expect(created.error).toBeUndefined();
  return { host, player, campaignId, characterId: created.data!.id };
}

const sheet = async (c: Awaited<ReturnType<typeof makeUser>>['client'], characterId: string) =>
  (await c.query<Sheet>('character.get', { characterId })).data!;

describe('character creation', () => {
  it('R-CHAR-21: starts with gold from prosperity, empty perks/masteries per class', async () => {
    const { player, characterId } = await setup();
    const s = await sheet(player.client, characterId);
    expect(s.character).toMatchObject({
      level: 1,
      xp: 0,
      gold: 12,
      perkMarks: [0, 0, 0],
      masteries: [false, false],
    });
    expect(s.derived.maxHp).toBe(8);
    expect(s.canEdit).toBe(true);
  });

  it('R-CHAR-02: only one character per class at a time', async () => {
    const { host, campaignId } = await setup();
    const r = await host.client.mutate('character.create', {
      campaignId,
      classKey: 'example-guardian',
      name: 'Twin',
    });
    expect(r.error?.code).toBe('CONFLICT');
  });

  it('R-CHAR-22: locked classes need an unlock by the host', async () => {
    const { host, player, campaignId } = await setup();
    const input = { campaignId, classKey: 'example-hidden', name: 'Later' };
    expect((await player.client.mutate('character.create', input)).error?.code).toBe('BAD_REQUEST');
    expect(
      (
        await player.client.mutate('campaign.setClassUnlocked', {
          campaignId,
          classKey: 'example-hidden',
          unlocked: true,
        })
      ).error?.code,
    ).toBe('FORBIDDEN');
    await host.client.mutate('campaign.setClassUnlocked', {
      campaignId,
      classKey: 'example-hidden',
      unlocked: true,
    });
    expect((await player.client.mutate('character.create', input)).error).toBeUndefined();
  });

  it('R-CHAR-21: start level is limited by prosperity', async () => {
    const { host, campaignId } = await setup();
    const input = { campaignId, classKey: 'example-scout', name: 'Vet', startLevel: 2 };
    expect((await host.client.mutate('character.create', input)).error?.code).toBe('BAD_REQUEST');
    await t.db.update(campaigns).set({ prosperityChecks: 7 }).where(eq(campaigns.id, campaignId)); // level 3 -> cap 2
    expect((await host.client.mutate('character.create', input)).error).toBeUndefined();
  });
});

describe('permissions', () => {
  it('other players can read but not edit; hosts can edit; outsiders see nothing', async () => {
    const { host, player, campaignId, characterId } = await setup();
    const other = await makeUser(t.app, t.db);
    const inv = await host.client.mutate<{ code: string }>('campaign.createInvite', { campaignId });
    await other.client.mutate('campaign.acceptInvite', { code: inv.data!.code });
    const otherSheet = await sheet(other.client, characterId);
    expect(otherSheet.canEdit).toBe(false);
    const adj = { characterId, field: 'gold', delta: 5 };
    expect((await other.client.mutate('character.adjust', adj)).error?.code).toBe('FORBIDDEN');
    expect((await host.client.mutate('character.adjust', adj)).error).toBeUndefined();
    const stranger = await makeUser(t.app, t.db);
    expect((await stranger.client.query('character.get', { characterId })).error?.code).toBe(
      'NOT_FOUND',
    );
    expect((await player.client.query('character.get', { characterId })).data).toBeTruthy();
  });
});

describe('counters, levels and perks', () => {
  it('counters never go negative; unknown resources are rejected', async () => {
    const { player, characterId } = await setup();
    await player.client.mutate('character.adjust', { characterId, field: 'gold', delta: -100 });
    await player.client.mutate('character.adjust', {
      characterId,
      field: 'resource:wood',
      delta: 3,
    });
    const s = await sheet(player.client, characterId);
    expect(s.character.gold).toBe(0);
    expect(s.character.resources.wood).toBe(3);
    const bad = await player.client.mutate('character.adjust', {
      characterId,
      field: 'resource:gems',
      delta: 1,
    });
    expect(bad.error?.code).toBe('BAD_REQUEST');
  });

  it('R-CHAR-11: checkmark losses stop at the last full set', async () => {
    const { player, characterId } = await setup();
    await player.client.mutate('character.adjust', { characterId, field: 'checkmarks', delta: 5 });
    await player.client.mutate('character.adjust', { characterId, field: 'checkmarks', delta: -3 });
    expect((await sheet(player.client, characterId)).character.checkmarks).toBe(4);
  });

  it('R-CHAR-04/12/13: XP level-up adds a perk mark that can be spent once', async () => {
    const { player, characterId } = await setup();
    expect(
      (await player.client.mutate('character.levelUp', { characterId, mode: 'xp' })).error?.code,
    ).toBe('BAD_REQUEST');
    await player.client.mutate('character.adjust', { characterId, field: 'xp', delta: 12 });
    expect((await sheet(player.client, characterId)).derived.levelUpDue).toBe(true);
    await player.client.mutate('character.levelUp', { characterId, mode: 'xp' });
    let s = await sheet(player.client, characterId);
    expect(s.character).toMatchObject({ level: 2, xp: 12 });
    expect(s.derived.perkMarksAvailable).toBe(1);
    expect(
      (
        await player.client.mutate('character.setPerkMarks', {
          characterId,
          perkIndex: 0,
          marked: 1,
        })
      ).error,
    ).toBeUndefined();
    const over = await player.client.mutate('character.setPerkMarks', {
      characterId,
      perkIndex: 2,
      marked: 1,
    });
    expect(over.error?.code).toBe('BAD_REQUEST');
    s = await sheet(player.client, characterId);
    expect(s.derived.perkMarksAvailable).toBe(0);
  });

  it('R-CHAR-14: masteries grant perk marks and cannot be removed while spent', async () => {
    const { player, characterId } = await setup();
    await player.client.mutate('character.setMastery', {
      characterId,
      masteryIndex: 1,
      achieved: true,
    });
    await player.client.mutate('character.setPerkMarks', { characterId, perkIndex: 2, marked: 1 });
    const r = await player.client.mutate('character.setMastery', {
      characterId,
      masteryIndex: 1,
      achieved: false,
    });
    expect(r.error?.code).toBe('BAD_REQUEST');
  });

  it('R-CHAR-05: prosperity level-up sets XP to the new level requirement', async () => {
    const { player, campaignId, characterId } = await setup();
    expect(
      (await player.client.mutate('character.levelUp', { characterId, mode: 'prosperity' })).error
        ?.code,
    ).toBe('BAD_REQUEST');
    await t.db.update(campaigns).set({ prosperityChecks: 7 }).where(eq(campaigns.id, campaignId));
    await player.client.mutate('character.levelUp', { characterId, mode: 'prosperity' });
    expect((await sheet(player.client, characterId)).character).toMatchObject({ level: 2, xp: 10 });
  });
});

describe('items and supply', () => {
  it('R-CHAR-15/17: one copy per item; sell prices from the catalog', async () => {
    const { player, characterId } = await setup();
    const a = await player.client.mutate<{ item: { id: string } }>('character.addItem', {
      characterId,
      itemNumber: 1,
    });
    expect(
      (await player.client.mutate('character.addItem', { characterId, itemNumber: 1 })).error?.code,
    ).toBe('CONFLICT');
    const sold = await player.client.mutate<{ gold: number }>('character.sellItem', {
      characterItemId: a.data!.item.id,
    });
    expect(sold.data?.gold).toBe(12);
    const b = await player.client.mutate<{ item: { id: string } }>('character.addItem', {
      characterId,
      itemNumber: 2,
    });
    expect(
      (
        await player.client.mutate<{ gold: number }>('character.sellItem', {
          characterItemId: b.data!.item.id,
        })
      ).data?.gold,
    ).toBe(6);
    const c = await player.client.mutate<{ item: { id: string } }>('character.addItem', {
      characterId,
      name: 'Lucky stone',
    });
    expect(
      (await player.client.mutate('character.sellItem', { characterItemId: c.data!.item.id })).error
        ?.code,
    ).toBe('BAD_REQUEST');
    expect(
      (
        await player.client.mutate('character.sellItem', {
          characterItemId: c.data!.item.id,
          gold: 3,
        })
      ).error,
    ).toBeUndefined();
    expect((await sheet(player.client, characterId)).character.gold).toBe(12 + 12 + 6 + 3);
  });

  it('R-CHAR-10: resources move one way into the Frosthaven supply', async () => {
    const { player, campaignId, characterId } = await setup();
    await player.client.mutate('character.adjust', {
      characterId,
      field: 'resource:moss',
      delta: 2,
    });
    expect(
      (
        await player.client.mutate('character.transferToSupply', {
          characterId,
          resourceKey: 'moss',
          amount: 3,
        })
      ).error?.code,
    ).toBe('BAD_REQUEST');
    await player.client.mutate('character.transferToSupply', {
      characterId,
      resourceKey: 'moss',
      amount: 2,
    });
    const [c] = await t.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(c!.supply).toEqual({ moss: 2 });
  });
});

describe('retirement and status', () => {
  it('R-CHAR-20: retiring moves resources, drops gold/items, gains prosperity, locks the sheet', async () => {
    const { player, campaignId, characterId } = await setup();
    await player.client.mutate('character.adjust', {
      characterId,
      field: 'resource:wood',
      delta: 4,
    });
    await player.client.mutate('character.addItem', { characterId, itemNumber: 1 });
    await player.client.mutate('character.changeStatus', { characterId, action: 'retire' });
    const s = await sheet(player.client, characterId);
    expect(s.character).toMatchObject({ status: 'retired', gold: 0, resources: {} });
    expect(s.items).toHaveLength(0);
    expect(s.canEdit).toBe(false);
    const [c] = await t.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(c!.supply).toEqual({ wood: 4 });
    expect(c!.prosperityChecks).toBe(1);
    expect(
      (await player.client.mutate('character.adjust', { characterId, field: 'gold', delta: 1 }))
        .error?.code,
    ).toBe('BAD_REQUEST');

    // R-CAMP-15 / R-CHAR-12: retirement table; the next character gets a bonus perk mark, class is free again.
    const table = await player.client.query<unknown[]>('character.retirements', { campaignId });
    expect(table.data).toHaveLength(1);
    const next = await player.client.mutate<{ id: string }>('character.create', {
      campaignId,
      classKey: 'example-guardian',
      name: 'Heir',
    });
    expect((await sheet(player.client, next.data!.id)).character.bonusPerkMarks).toBe(1);
  });

  it('R-CHAR-19: set aside keeps the class taken; abandon frees it and loses gold', async () => {
    const { host, player, campaignId, characterId } = await setup();
    await player.client.mutate('character.changeStatus', { characterId, action: 'set_aside' });
    expect(
      (
        await host.client.mutate('character.create', {
          campaignId,
          classKey: 'example-guardian',
          name: 'X',
        })
      ).error?.code,
    ).toBe('CONFLICT');
    await player.client.mutate('character.changeStatus', { characterId, action: 'abandon' });
    expect((await sheet(player.client, characterId)).character).toMatchObject({
      status: 'abandoned',
      gold: 0,
    });
    expect(
      (
        await host.client.mutate('character.create', {
          campaignId,
          classKey: 'example-guardian',
          name: 'X',
        })
      ).error,
    ).toBeUndefined();
  });
});

describe('history and revert', () => {
  type History = { entries: { groupId: string; action: string; revertedBy: string | null }[] };

  it('every change is in the history and can be reverted once', async () => {
    const { player, characterId } = await setup();
    await player.client.mutate('character.adjust', { characterId, field: 'gold', delta: 5 });
    const h = await player.client.query<History>('character.history', { characterId });
    const g = h.data!.entries.find((e) => e.action === 'adjust_gold')!;
    expect(
      (await player.client.mutate('character.revert', { groupId: g.groupId })).error,
    ).toBeUndefined();
    expect((await sheet(player.client, characterId)).character.gold).toBe(12);
    expect(
      (await player.client.mutate('character.revert', { groupId: g.groupId })).error?.code,
    ).toBe('BAD_REQUEST');
  });

  it('a revert is refused when the value changed again afterwards', async () => {
    const { player, characterId } = await setup();
    await player.client.mutate('character.adjust', { characterId, field: 'gold', delta: 5 });
    await player.client.mutate('character.adjust', { characterId, field: 'gold', delta: 1 });
    const h = await player.client.query<History>('character.history', { characterId });
    const first = h.data!.entries.filter((e) => e.action === 'adjust_gold').at(-1)!;
    expect(
      (await player.client.mutate('character.revert', { groupId: first.groupId })).error?.code,
    ).toBe('CONFLICT');
  });

  it('reverting a retirement restores the character, items, supply and prosperity', async () => {
    const { host, player, campaignId, characterId } = await setup();
    await player.client.mutate('character.adjust', {
      characterId,
      field: 'resource:stone',
      delta: 2,
    });
    await player.client.mutate('character.addItem', { characterId, itemNumber: 2 });
    await player.client.mutate('character.changeStatus', { characterId, action: 'retire' });
    const h = await host.client.query<History>('character.history', { characterId });
    const g = h.data!.entries.find((e) => e.action === 'retire')!;
    expect(
      (await host.client.mutate('character.revert', { groupId: g.groupId })).error,
    ).toBeUndefined();
    const s = await sheet(player.client, characterId);
    expect(s.character).toMatchObject({ status: 'active', gold: 12, resources: { stone: 2 } });
    expect(s.items).toHaveLength(1);
    const [c] = await t.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(c!.supply).toEqual({});
    expect(c!.prosperityChecks).toBe(0);
  });

  it("players cannot revert other players' characters", async () => {
    const { host, player, campaignId, characterId } = await setup();
    const other = await makeUser(t.app, t.db);
    const inv = await host.client.mutate<{ code: string }>('campaign.createInvite', { campaignId });
    await other.client.mutate('campaign.acceptInvite', { code: inv.data!.code });
    await player.client.mutate('character.adjust', { characterId, field: 'gold', delta: 5 });
    const h = await other.client.query<History>('character.history', { characterId });
    const g = h.data!.entries.find((e) => e.action === 'adjust_gold')!;
    expect(
      (await other.client.mutate('character.revert', { groupId: g.groupId })).error?.code,
    ).toBe('FORBIDDEN');
  });
});

describe('seed admin', () => {
  it('only site admins can check/import seeds', async () => {
    const user = await makeUser(t.app, t.db);
    expect((await user.client.query('admin.seedCheck')).error?.code).toBe('FORBIDDEN');
    const admin = await makeUser(t.app, t.db, { admin: true });
    const check = await admin.client.query<{ ok: boolean; counts: { classes: number } }>(
      'admin.seedCheck',
    );
    expect(check.data).toMatchObject({ ok: true, counts: { classes: 3 } });
  });
});
