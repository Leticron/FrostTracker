import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { passwordSchema } from '@fht/shared';
import { hashPassword } from './auth/password.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { users } from './db/schema.ts';
import { writeAudit } from './audit.ts';
import { importSeed, latestDataSetId, readSeedDir, SeedError } from './services/seed.ts';

/**
 * Creates the first site admin from ADMIN_USERNAME / ADMIN_PASSWORD(_FILE) when no site admin
 * exists yet. Afterwards these variables are ignored (and the log says so).
 */
export async function bootstrapAdmin(db: Db, config: Config, log: FastifyBaseLogger) {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isSiteAdmin, true))
    .limit(1);
  if (admins[0]) {
    if (config.ADMIN_USERNAME) log.info('Site admin already exists; ADMIN_* variables are ignored');
    return;
  }
  if (!config.ADMIN_USERNAME || !config.adminPassword) {
    log.warn('No site admin exists. Set ADMIN_USERNAME and ADMIN_PASSWORD to create one.');
    return;
  }
  const weak = passwordSchema.safeParse(config.adminPassword);
  if (!weak.success) {
    throw new Error(
      `ADMIN_PASSWORD is not accepted: ${weak.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const username = config.ADMIN_USERNAME;
  const passwordHash = await hashPassword(config.adminPassword);
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
      .limit(1);
    if (existing[0]) {
      // Never promote an existing account: whoever registered this name first would become admin.
      log.error(
        { username },
        'ADMIN_USERNAME belongs to an existing non-admin account; no admin was created. Choose another name.',
      );
      return;
    }
    const [u] = await tx
      .insert(users)
      .values({ username, displayName: username, passwordHash, isSiteAdmin: true })
      .returning({ id: users.id });
    await writeAudit(tx, null, [{ entity: 'user', entityId: u!.id, action: 'bootstrap_admin' }]);
    log.info({ username }, 'Created site admin');
  });
}

/** On a fresh install, imports the mounted seed once so campaigns have game data right away. */
export async function autoImportSeed(db: Db, seedDir: string, log: FastifyBaseLogger) {
  if (await latestDataSetId(db)) return;
  try {
    const data = await readSeedDir(seedDir);
    const set = await db.transaction((tx) => importSeed(tx, data, null));
    log.info({ name: set.name, version: set.version }, 'Imported game data seed');
  } catch (err) {
    if (err instanceof SeedError)
      log.warn({ dir: seedDir, reason: err.message }, 'No game data imported');
    else throw err;
  }
}
