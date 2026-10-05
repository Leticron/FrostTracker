import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Arbitrary constant identifying the migration lock. */
const MIGRATION_LOCK_KEY = 4_242_001;

/**
 * Runs pending migrations while holding a Postgres advisory lock, so concurrent or
 * restarting containers never migrate at the same time.
 */
export async function runMigrations(databaseUrl: string, migrationsFolder: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

/** Waits until the database accepts connections (container start ordering). */
export async function waitForDatabase(databaseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new pg.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query('select 1');
      await client.end();
      return;
    } catch (err) {
      await client.end().catch(() => {});
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
