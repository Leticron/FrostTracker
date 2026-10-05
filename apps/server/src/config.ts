import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** Canonical external URL, e.g. https://frosthaven.example.com. Used for CSRF origin checks and cookies. */
  PUBLIC_URL: z.url(),
  /** Comma-separated IPs/CIDRs of reverse proxies whose X-Forwarded-* headers are trusted (the Traefik network). */
  TRUSTED_PROXIES: z.string().default(''),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ALLOW_REGISTRATION: bool.default(false),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_PASSWORD_FILE: z.string().optional(),
  ASSETS_DIR: z.string().default('/data/assets'),
  SEED_DIR: z.string().default('/data/seed'),
  WEB_DIST_DIR: z.string().default(fileURLToPath(new URL('../../web/dist', import.meta.url))),
  MIGRATIONS_DIR: z.string().default(fileURLToPath(new URL('../drizzle', import.meta.url))),
});

export type Config = z.infer<typeof envSchema> & {
  publicOrigin: string;
  secureCookies: boolean;
  trustProxy: string[] | false;
  adminPassword: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  const url = new URL(c.PUBLIC_URL);
  const proxies = c.TRUSTED_PROXIES.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const adminPassword = c.ADMIN_PASSWORD_FILE
    ? readFileSync(c.ADMIN_PASSWORD_FILE, 'utf8').trim()
    : c.ADMIN_PASSWORD;
  return {
    ...c,
    publicOrigin: url.origin,
    secureCookies: url.protocol === 'https:',
    trustProxy: proxies.length > 0 ? proxies : false,
    adminPassword,
  };
}
