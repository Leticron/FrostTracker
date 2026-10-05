import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionCookieName(secure: boolean): string {
  // __Host- requires Secure, Path=/ and no Domain; only usable behind HTTPS.
  return secure ? '__Host-fht_session' : 'fht_session';
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  isSiteAdmin: boolean;
  locale: string;
}

export async function createSession(
  db: Db,
  userId: string,
  ttlDays: number,
  meta: { userAgent?: string | undefined; ip?: string | undefined },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
  await db.insert(sessions).values({
    tokenHash: sha256Hex(token),
    userId,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
  });
  return { token, expiresAt };
}

/**
 * Resolves a session token. Sliding expiry: when less than half the TTL is left, the expiry
 * is extended and `renewedExpiresAt` is returned so the cookie can be refreshed.
 */
export async function validateSession(
  db: Db,
  token: string,
  ttlDays: number,
): Promise<{ user: SessionUser; renewedExpiresAt?: Date } | null> {
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const rows = await db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      isSiteAdmin: users.isSiteAdmin,
      locale: users.locale,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row || row.disabledAt) return null;
  const user: SessionUser = {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isSiteAdmin: row.isSiteAdmin,
    locale: row.locale,
  };
  if (row.expiresAt.getTime() - now.getTime() < (ttlDays * DAY_MS) / 2) {
    const renewedExpiresAt = new Date(now.getTime() + ttlDays * DAY_MS);
    await db
      .update(sessions)
      .set({ expiresAt: renewedExpiresAt, lastSeenAt: now })
      .where(eq(sessions.tokenHash, tokenHash));
    return { user, renewedExpiresAt };
  }
  return { user };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}

export async function deleteUserSessions(db: Db, userId: string, exceptToken?: string) {
  await db
    .delete(sessions)
    .where(
      exceptToken
        ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, sha256Hex(exceptToken)))
        : eq(sessions.userId, userId),
    );
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
