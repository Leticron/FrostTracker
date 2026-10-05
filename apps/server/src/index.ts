import { bootstrapAdmin } from './bootstrap.ts';
import { buildApp } from './app.ts';
import { AttemptLimiter } from './auth/rate-limit.ts';
import { purgeExpiredSessions } from './auth/session.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { runMigrations, waitForDatabase } from './db/migrate.ts';

const config = loadConfig();

await waitForDatabase(config.DATABASE_URL);
await runMigrations(config.DATABASE_URL, config.MIGRATIONS_DIR);

const { db, pool } = createDb(config.DATABASE_URL);
const app = await buildApp({
  db,
  config,
  loginLimiter: new AttemptLimiter(10, 15 * 60 * 1000),
});

app.log.info('Database migrations applied');
await bootstrapAdmin(db, config, app.log);

const purge = setInterval(
  () => {
    purgeExpiredSessions(db).catch((err: unknown) => app.log.warn({ err }, 'Session purge failed'));
  },
  60 * 60 * 1000,
);
purge.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
