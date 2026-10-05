import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { changePasswordInput, loginInput, registerInput } from '@fht/shared';
import { dummyVerify, hashPassword, verifyPassword } from '../auth/password.ts';
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  sessionCookieName,
} from '../auth/session.ts';
import { users } from '../db/schema.ts';
import { redeemInvite } from '../services/invites.ts';
import { writeAudit } from '../audit.ts';
import type { Context } from '../trpc/context.ts';
import { authedProcedure, publicProcedure, router } from '../trpc/trpc.ts';

function setSessionCookie(ctx: Context, token: string, expiresAt: Date) {
  ctx.res.setCookie(sessionCookieName(ctx.config.secureCookies), token, {
    httpOnly: true,
    secure: ctx.config.secureCookies,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

function clearSessionCookie(ctx: Context) {
  ctx.res.clearCookie(sessionCookieName(ctx.config.secureCookies), { path: '/' });
}

function limiterKeys(ctx: Context, username: string) {
  return [`ip:${ctx.req.ip}`, `user:${username.toLowerCase()}`];
}

function assertNotBlocked(ctx: Context, username: string) {
  if (limiterKeys(ctx, username).some((k) => ctx.loginLimiter.isBlocked(k))) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many attempts, try again later',
    });
  }
}

/** Runs a credential operation; any failure counts against the IP and username. */
async function limited<T>(ctx: Context, username: string, fn: () => Promise<T>): Promise<T> {
  assertNotBlocked(ctx, username);
  try {
    return await fn();
  } catch (err) {
    for (const k of limiterKeys(ctx, username)) ctx.loginLimiter.fail(k);
    throw err;
  }
}

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ({
    user: ctx.user,
    registrationOpen: ctx.config.ALLOW_REGISTRATION,
  })),

  register: publicProcedure.input(registerInput).mutation(({ ctx, input }) =>
    limited(ctx, input.username, async () => {
      if (!ctx.config.ALLOW_REGISTRATION && !input.inviteCode) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Registration requires an invite' });
      }
      const passwordHash = await hashPassword(input.password);
      const result = await ctx.db.transaction(async (tx) => {
        const taken = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(sql`lower(${users.username})`, input.username.toLowerCase()))
          .limit(1);
        if (taken[0]) throw new TRPCError({ code: 'CONFLICT', message: 'Username is taken' });
        const inserted = await tx
          .insert(users)
          .values({
            username: input.username,
            displayName: input.displayName ?? input.username,
            passwordHash,
          })
          .returning({ id: users.id });
        const userId = inserted[0]!.id;
        await writeAudit(tx, userId, [
          {
            entity: 'user',
            entityId: userId,
            action: 'register',
            after: { username: input.username },
          },
        ]);
        const joined = input.inviteCode ? await redeemInvite(tx, input.inviteCode, userId) : null;
        return { userId, campaignId: joined?.campaignId ?? null };
      });
      const session = await createSession(ctx.db, result.userId, ctx.config.SESSION_TTL_DAYS, {
        userAgent: ctx.req.headers['user-agent'],
        ip: ctx.req.ip,
      });
      setSessionCookie(ctx, session.token, session.expiresAt);
      return { campaignId: result.campaignId };
    }),
  ),

  login: publicProcedure.input(loginInput).mutation(({ ctx, input }) =>
    limited(ctx, input.username, async () => {
      const rows = await ctx.db
        .select()
        .from(users)
        .where(eq(sql`lower(${users.username})`, input.username.toLowerCase()))
        .limit(1);
      const user = rows[0];
      const ok =
        user?.passwordHash && !user.disabledAt
          ? await verifyPassword(user.passwordHash, input.password)
          : await dummyVerify(input.password).then(() => false);
      if (!user || !ok) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid username or password' });
      }
      ctx.loginLimiter.reset(`user:${input.username.toLowerCase()}`);
      const session = await createSession(ctx.db, user.id, ctx.config.SESSION_TTL_DAYS, {
        userAgent: ctx.req.headers['user-agent'],
        ip: ctx.req.ip,
      });
      setSessionCookie(ctx, session.token, session.expiresAt);
      return { ok: true };
    }),
  ),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) await deleteSession(ctx.db, ctx.sessionToken);
    clearSessionCookie(ctx);
    return { ok: true };
  }),

  changePassword: authedProcedure.input(changePasswordInput).mutation(({ ctx, input }) =>
    limited(ctx, ctx.user.username, async () => {
      const rows = await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const user = rows[0];
      if (
        !user?.passwordHash ||
        !(await verifyPassword(user.passwordHash, input.currentPassword))
      ) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is wrong' });
      }
      const passwordHash = await hashPassword(input.newPassword);
      await ctx.db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
        await writeAudit(tx, user.id, [
          { entity: 'user', entityId: user.id, action: 'change_password' },
        ]);
      });
      // Sign out all other devices.
      await deleteUserSessions(ctx.db, user.id, ctx.sessionToken ?? undefined);
      return { ok: true };
    }),
  ),
});
