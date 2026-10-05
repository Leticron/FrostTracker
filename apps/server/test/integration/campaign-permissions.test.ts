import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEntries, invites } from '../../src/db/schema.ts';
import { Client, createTestApp, makeUser, uniqueName } from './helpers.ts';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function campaignWithHost() {
  const host = await makeUser(t.app, t.db);
  const r = await host.client.mutate<{ id: string }>('campaign.create', { name: 'Test campaign' });
  return { host, campaignId: r.data!.id };
}

async function invite(client: Client, campaignId: string, role: 'host' | 'player' = 'player') {
  const r = await client.mutate<{ code: string }>('campaign.createInvite', { campaignId, role });
  expect(r.error).toBeUndefined();
  return r.data!.code;
}

describe('campaign creation', () => {
  it('makes the creator host and writes an audit entry', async () => {
    const { host, campaignId } = await campaignWithHost();
    const got = await host.client.query<{ role: string }>('campaign.get', { campaignId });
    expect(got.data?.role).toBe('host');
    const audit = await t.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.campaignId, campaignId));
    expect(audit.map((a) => a.action)).toContain('create');
  });
});

describe('membership isolation', () => {
  it('non-members cannot see a campaign (NOT_FOUND, not FORBIDDEN)', async () => {
    const { campaignId } = await campaignWithHost();
    const stranger = await makeUser(t.app, t.db);
    expect((await stranger.client.query('campaign.get', { campaignId })).error?.code).toBe(
      'NOT_FOUND',
    );
    expect((await stranger.client.query('campaign.members', { campaignId })).error?.code).toBe(
      'NOT_FOUND',
    );
    const list = await stranger.client.query<unknown[]>('campaign.list');
    expect(list.data).toEqual([]);
  });
});

describe('roles are per campaign', () => {
  it('players cannot perform host actions', async () => {
    const { host, campaignId } = await campaignWithHost();
    const player = await makeUser(t.app, t.db);
    const code = await invite(host.client, campaignId);
    expect((await player.client.mutate('campaign.acceptInvite', { code })).error).toBeUndefined();

    expect((await player.client.query('campaign.get', { campaignId })).data).toMatchObject({
      role: 'player',
    });
    expect((await player.client.mutate('campaign.createInvite', { campaignId })).error?.code).toBe(
      'FORBIDDEN',
    );
    expect(
      (await player.client.mutate('campaign.update', { campaignId, name: 'x', partyName: null }))
        .error?.code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await player.client.mutate('campaign.setRole', {
          campaignId,
          userId: player.id,
          role: 'host',
        })
      ).error?.code,
    ).toBe('FORBIDDEN');
    expect(
      (await player.client.mutate('campaign.removeMember', { campaignId, userId: host.id })).error
        ?.code,
    ).toBe('FORBIDDEN');
  });

  it('the same user can be host in one campaign and player in another', async () => {
    const a = await campaignWithHost();
    const b = await campaignWithHost();
    const code = await invite(b.host.client, b.campaignId);
    await a.host.client.mutate('campaign.acceptInvite', { code });
    const list = await a.host.client.query<{ id: string; role: string }[]>('campaign.list');
    const roles = Object.fromEntries(list.data!.map((c) => [c.id, c.role]));
    expect(roles[a.campaignId]).toBe('host');
    expect(roles[b.campaignId]).toBe('player');
  });

  it('a campaign always keeps at least one host', async () => {
    const { host, campaignId } = await campaignWithHost();
    const r = await host.client.mutate('campaign.setRole', {
      campaignId,
      userId: host.id,
      role: 'player',
    });
    expect(r.error?.code).toBe('BAD_REQUEST');
    const leave = await host.client.mutate('campaign.removeMember', {
      campaignId,
      userId: host.id,
    });
    expect(leave.error?.code).toBe('BAD_REQUEST');
  });

  it('players can leave on their own', async () => {
    const { host, campaignId } = await campaignWithHost();
    const player = await makeUser(t.app, t.db);
    await player.client.mutate('campaign.acceptInvite', {
      code: await invite(host.client, campaignId),
    });
    const r = await player.client.mutate('campaign.removeMember', {
      campaignId,
      userId: player.id,
    });
    expect(r.error).toBeUndefined();
    expect((await player.client.query('campaign.get', { campaignId })).error?.code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('invites', () => {
  it('registering with an invite joins the campaign even with registration closed', async () => {
    const { host, campaignId } = await campaignWithHost();
    const code = await invite(host.client, campaignId);
    const c = new Client(t.app);
    const r = await c.mutate<{ campaignId: string }>('auth.register', {
      username: uniqueName(),
      password: 'long enough pw',
      inviteCode: code,
    });
    expect(r.data?.campaignId).toBe(campaignId);
    expect((await c.query('campaign.get', { campaignId })).data).toMatchObject({ role: 'player' });
  });

  it('a failed invite registration does not create the account', async () => {
    const username = uniqueName();
    const r = await new Client(t.app).mutate('auth.register', {
      username,
      password: 'long enough pw',
      inviteCode: 'not-a-real-code',
    });
    expect(r.error?.code).toBe('BAD_REQUEST');
    const login = await new Client(t.app).mutate('auth.login', {
      username,
      password: 'long enough pw',
    });
    expect(login.error?.code).toBe('UNAUTHORIZED');
  });

  it('enforces max uses, revocation and expiry; codes are stored hashed', async () => {
    const { host, campaignId } = await campaignWithHost();
    const code = await invite(host.client, campaignId);
    const stored = await t.db.select().from(invites).where(eq(invites.campaignId, campaignId));
    expect(stored[0]!.codeHash).not.toContain(code);

    const p1 = await makeUser(t.app, t.db);
    const p2 = await makeUser(t.app, t.db);
    expect((await p1.client.mutate('campaign.acceptInvite', { code })).error).toBeUndefined();
    expect((await p2.client.mutate('campaign.acceptInvite', { code })).error?.code).toBe(
      'BAD_REQUEST',
    );

    const code2 = await invite(host.client, campaignId);
    const [inv2] = await t.db.select().from(invites).where(eq(invites.campaignId, campaignId));
    const list = await host.client.query<{ id: string }[]>('campaign.invites', { campaignId });
    const target = list.data!.find((i) => i.id !== stored[0]!.id) ?? inv2!;
    await host.client.mutate('campaign.revokeInvite', { campaignId, inviteId: target.id });
    expect((await p2.client.mutate('campaign.acceptInvite', { code: code2 })).error?.code).toBe(
      'BAD_REQUEST',
    );

    const code3 = await invite(host.client, campaignId);
    await t.db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.campaignId, campaignId));
    expect((await p2.client.mutate('campaign.acceptInvite', { code: code3 })).error?.code).toBe(
      'BAD_REQUEST',
    );
  });

  it('a host invite grants host role', async () => {
    const { host, campaignId } = await campaignWithHost();
    const cohost = await makeUser(t.app, t.db);
    await cohost.client.mutate('campaign.acceptInvite', {
      code: await invite(host.client, campaignId, 'host'),
    });
    expect(
      (await cohost.client.mutate('campaign.createInvite', { campaignId })).error,
    ).toBeUndefined();
  });
});
