import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, makeUser, uniqueName } from './helpers.ts';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('registration', () => {
  it('is refused without an invite while registration is closed (default)', async () => {
    const c = new Client(t.app);
    const r = await c.mutate('auth.register', {
      username: uniqueName(),
      password: 'long enough pw',
    });
    expect(r.error?.code).toBe('FORBIDDEN');
  });

  it('works when ALLOW_REGISTRATION=true and signs the user in', async () => {
    const open = await createTestApp({ ALLOW_REGISTRATION: 'true' });
    try {
      const c = new Client(open.app);
      const username = uniqueName();
      const r = await c.mutate('auth.register', { username, password: 'long enough pw' });
      expect(r.error).toBeUndefined();
      const me = await c.query<{ user: { username: string } | null }>('auth.me');
      expect(me.data?.user?.username).toBe(username);
      const dup = await new Client(open.app).mutate('auth.register', {
        username: username.toUpperCase(),
        password: 'long enough pw',
      });
      expect(dup.error?.code).toBe('CONFLICT');
    } finally {
      await open.close();
    }
  });

  it('rejects short passwords', async () => {
    const r = await new Client(t.app).mutate('auth.register', {
      username: uniqueName(),
      password: 'short',
      inviteCode: 'x',
    });
    expect(r.error?.code).toBe('BAD_REQUEST');
  });
});

describe('login / session', () => {
  it('rejects a wrong password with a generic message', async () => {
    const { username } = await makeUser(t.app, t.db);
    const r = await new Client(t.app).mutate('auth.login', {
      username,
      password: 'wrong password',
    });
    expect(r.error?.code).toBe('UNAUTHORIZED');
    expect(r.error?.message).toBe('Invalid username or password');
  });

  it('sets an HttpOnly SameSite=Lax Secure cookie and resolves the user', async () => {
    const { username, password } = await makeUser(t.app, t.db);
    const res = await t.app.inject({
      method: 'POST',
      url: '/trpc/auth.login',
      headers: { 'content-type': 'application/json', origin: 'https://tracker.test' },
      payload: JSON.stringify({ username, password }),
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-fht_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('logout invalidates the session server-side', async () => {
    const { client } = await makeUser(t.app, t.db);
    expect((await client.query<{ user: unknown }>('auth.me')).data?.user).not.toBeNull();
    await client.mutate('auth.logout');
    expect((await client.query<{ user: unknown }>('auth.me')).data?.user).toBeNull();
  });

  it('rate-limits repeated failed logins per username', async () => {
    const { username } = await makeUser(t.app, t.db);
    let last;
    for (let i = 0; i < 11; i++) {
      last = await new Client(t.app).mutate('auth.login', { username, password: 'nope nope nope' });
    }
    expect(last?.error?.code).toBe('TOO_MANY_REQUESTS');
  });

  it('protected procedures require a session', async () => {
    const r = await new Client(t.app).query('campaign.list');
    expect(r.error?.code).toBe('UNAUTHORIZED');
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without an Origin', async () => {
    const r = await new Client(t.app, null).mutate('auth.login', { username: 'a', password: 'b' });
    expect(r.status).toBe(403);
  });

  it('rejects state-changing requests from another origin', async () => {
    const r = await new Client(t.app, 'https://evil.test').mutate('auth.logout');
    expect(r.status).toBe(403);
  });

  it('rejects non-JSON tRPC posts (HTML form style)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/trpc/auth.logout',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://tracker.test',
      },
      payload: 'a=b',
    });
    expect(res.statusCode).toBe(415);
  });
});

describe('health', () => {
  it('GET /healthz reports the database as ok', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
