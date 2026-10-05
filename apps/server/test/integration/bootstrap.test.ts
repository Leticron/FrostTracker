import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../../src/bootstrap.ts';
import { users } from '../../src/db/schema.ts';
import { createTestApp, makeUser, testConfig, uniqueName } from './helpers.ts';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
  // Other test files may have created admins; start from "no admin".
  await t.db.update(users).set({ isSiteAdmin: false });
});
afterAll(() => t.close());

describe('first-start admin bootstrap', () => {
  it('refuses to promote an existing account with the admin username', async () => {
    const existing = await makeUser(t.app, t.db);
    const config = testConfig({
      ADMIN_USERNAME: existing.username,
      ADMIN_PASSWORD: 'admin password 1',
    });
    await bootstrapAdmin(t.db, config, t.app.log);
    const [u] = await t.db.select().from(users).where(eq(users.id, existing.id));
    expect(u!.isSiteAdmin).toBe(false);
  });

  it('creates the admin once and ignores the variables afterwards', async () => {
    const name = uniqueName('admin');
    const config = testConfig({ ADMIN_USERNAME: name, ADMIN_PASSWORD: 'admin password 1' });
    await bootstrapAdmin(t.db, config, t.app.log);
    await bootstrapAdmin(
      t.db,
      testConfig({ ADMIN_USERNAME: uniqueName('other'), ADMIN_PASSWORD: 'x'.repeat(12) }),
      t.app.log,
    );
    const admins = await t.db.select().from(users).where(eq(users.isSiteAdmin, true));
    expect(admins.map((a) => a.username)).toEqual([name]);
    const [row] = await t.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.username})`, name.toLowerCase()));
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
  });
});
