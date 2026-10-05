import { inject } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { AttemptLimiter } from '../../src/auth/rate-limit.ts';
import { loadConfig, type Config } from '../../src/config.ts';
import { createDb, type Db } from '../../src/db/client.ts';

export const ORIGIN = 'https://tracker.test';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    PUBLIC_URL: ORIGIN,
    LOG_LEVEL: 'silent',
    ASSETS_DIR: '/nonexistent-assets',
    WEB_DIST_DIR: '/nonexistent-web',
    ...overrides,
  });
}

export async function createTestApp(overrides: Record<string, string> = {}) {
  const config = testConfig(overrides);
  const { db, pool } = createDb(config.DATABASE_URL);
  const app = await buildApp({
    db,
    config,
    loginLimiter: new AttemptLimiter(10, 15 * 60 * 1000),
    logger: false,
  });
  await app.ready();
  return { app, db, config, close: async () => (await app.close(), await pool.end()) };
}

type App = Awaited<ReturnType<typeof createTestApp>>['app'];

export interface TrpcResult<T = unknown> {
  status: number;
  data?: T;
  error?: { message: string; code: string };
}

/** Minimal tRPC-over-HTTP client with a cookie jar, as a browser would behave. */
export class Client {
  private cookies = new Map<string, string>();

  private readonly app: App;
  origin: string | null;

  constructor(app: App, origin: string | null = ORIGIN) {
    this.app = app;
    this.origin = origin;
  }

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private store(setCookie: string | string[] | undefined) {
    for (const c of [setCookie ?? []].flat()) {
      const [pair] = c.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name!.trim());
      else this.cookies.set(name!.trim(), value);
    }
  }

  async query<T = unknown>(path: string, input?: unknown): Promise<TrpcResult<T>> {
    const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await this.app.inject({
      method: 'GET',
      url: `/trpc/${path}${qs}`,
      headers: { cookie: this.cookieHeader() },
    });
    this.store(res.headers['set-cookie']);
    return parse<T>(res.statusCode, res.body);
  }

  async mutate<T = unknown>(
    path: string,
    input?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TrpcResult<T>> {
    const res = await this.app.inject({
      method: 'POST',
      url: `/trpc/${path}`,
      headers: {
        'content-type': 'application/json',
        cookie: this.cookieHeader(),
        ...(this.origin ? { origin: this.origin } : {}),
        ...headers,
      },
      payload: JSON.stringify(input ?? null),
    });
    this.store(res.headers['set-cookie']);
    return parse<T>(res.statusCode, res.body);
  }
}

function parse<T>(status: number, body: string): TrpcResult<T> {
  const json = JSON.parse(body) as {
    result?: { data: T };
    error?: { message: string; data?: { code: string } };
  };
  if (json.result) return { status, data: json.result.data };
  if (json.error)
    return { status, error: { message: json.error.message, code: json.error.data?.code ?? '' } };
  return { status, error: { message: body, code: 'HTTP' } };
}

let counter = 0;
export function uniqueName(prefix = 'user') {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export async function makeUser(
  app: App,
  db: Db,
  opts: { admin?: boolean } = {},
): Promise<{ client: Client; username: string; password: string; id: string }> {
  const { hashPassword } = await import('../../src/auth/password.ts');
  const { users } = await import('../../src/db/schema.ts');
  const username = uniqueName();
  const password = 'correct horse battery';
  const [u] = await db
    .insert(users)
    .values({
      username,
      displayName: username,
      passwordHash: await hashPassword(password),
      isSiteAdmin: opts.admin ?? false,
    })
    .returning({ id: users.id });
  const client = new Client(app);
  const r = await client.mutate('auth.login', { username, password });
  if (r.error) throw new Error(`login failed: ${r.error.message}`);
  return { client, username, password, id: u!.id };
}
