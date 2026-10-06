import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { sessionCookieName, validateSession, type SessionUser } from './auth/session.ts';
import type { AppDeps, Context } from './trpc/context.ts';
import { appRouter, type AppRouter } from './trpc/router.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface BuildAppOptions extends AppDeps {
  logger?: boolean | object;
}

export async function buildApp(opts: BuildAppOptions) {
  const { db, config } = opts;
  const app = Fastify({
    logger: opts.logger ?? { level: config.LOG_LEVEL },
    // Only honour X-Forwarded-* from the configured proxy network (Traefik).
    trustProxy: config.trustProxy,
    routerOptions: { maxParamLength: 5000 }, // tRPC batch URLs carry procedure names in the path
  });

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'blob:'],
        'upgrade-insecure-requests': config.secureCookies ? [] : null,
      },
    },
    hsts: config.secureCookies,
  });
  // Coarse global limit; credential endpoints have a stricter limiter of their own.
  await app.register(fastifyRateLimit, { max: 600, timeWindow: '1 minute' });

  // CSRF defence in depth (SameSite=Lax cookies are the first layer): every state-changing
  // request must come from our own origin, and tRPC mutations must be JSON (no HTML forms).
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
    if (origin !== config.publicOrigin) {
      return reply.code(403).send({ error: 'Cross-origin request rejected' });
    }
    if (
      req.url.startsWith('/trpc') &&
      !req.headers['content-type']?.startsWith('application/json')
    ) {
      return reply.code(415).send({ error: 'JSON required' });
    }
  });

  async function resolveSession(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ user: SessionUser | null; token: string | null }> {
    const name = sessionCookieName(config.secureCookies);
    const token = req.cookies[name];
    if (!token) return { user: null, token: null };
    const s = await validateSession(db, token, config.SESSION_TTL_DAYS);
    if (!s) {
      reply.clearCookie(name, { path: '/' });
      return { user: null, token: null };
    }
    if (s.renewedExpiresAt) {
      reply.setCookie(name, token, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
        path: '/',
        expires: s.renewedExpiresAt,
      });
    }
    return { user: s.user, token };
  }

  // Polled every 30 s by the Docker healthcheck; only failures are worth a log line.
  app.get('/healthz', { logLevel: 'warn' }, async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'db_unavailable' });
    }
  });

  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: async ({ req, res }): Promise<Context> => {
        const { user, token } = await resolveSession(req, res);
        return { ...opts, req, res, user, sessionToken: token };
      },
      onError({ error, path }) {
        if (error.code === 'INTERNAL_SERVER_ERROR')
          app.log.error({ err: error, path }, 'tRPC error');
      },
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>);

  // Game graphics the owner mounted at ASSETS_DIR (never bundled). Signed-in users only.
  const mediaFile = /\.(png|jpe?g|webp|avif|gif)$/i;
  if (existsSync(config.ASSETS_DIR)) {
    await app.register(async (scope) => {
      scope.addHook('onRequest', async (req, reply) => {
        const { user } = await resolveSession(req, reply);
        if (!user) return reply.code(401).send({ error: 'Unauthorized' });
        // Images only: other files (HTML, SVG, ...) must not run on the app's origin.
        if (!mediaFile.test(req.url.split('?')[0]!))
          return reply.code(404).send({ error: 'Not found' });
      });
      await scope.register(fastifyStatic, {
        root: config.ASSETS_DIR,
        prefix: '/media/',
        decorateReply: false,
        index: false,
        list: false,
        dotfiles: 'deny',
      });
    });
  } else {
    app.log.info(
      { dir: config.ASSETS_DIR },
      'Assets directory not found; map uses the placeholder',
    );
  }

  // Built web app (SPA) with client-side routing fallback.
  if (existsSync(join(config.WEB_DIST_DIR, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.WEB_DIST_DIR,
      wildcard: false,
      setHeaders(res, path) {
        if (path.includes('/assets/'))
          res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const isApi = req.url.startsWith('/trpc') || req.url.startsWith('/media/');
      if (req.method === 'GET' && !isApi && req.headers.accept?.includes('text/html')) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.log.warn({ dir: config.WEB_DIST_DIR }, 'Web build not found; serving API only');
  }

  return app;
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
