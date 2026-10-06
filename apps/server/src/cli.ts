// Maintenance commands, run inside the app container:
//   docker compose exec app node apps/server/src/cli.ts reset-password <username>
//   docker compose exec app node apps/server/src/cli.ts make-admin <username>
import { createInterface } from 'node:readline';
import { eq, sql } from 'drizzle-orm';
import { passwordSchema } from '@fht/shared';
import { writeAudit } from './audit.ts';
import { hashPassword } from './auth/password.ts';
import { deleteUserSessions } from './auth/session.ts';
import { createDb } from './db/client.ts';
import { users } from './db/schema.ts';

/** Reads one line from stdin; on a terminal the typed characters are not echoed. */
function readSecret(prompt: string): Promise<string> {
  const tty = !!process.stdin.isTTY;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  if (tty) {
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let prompted = false;
    out._writeToOutput = (s) => {
      if (!prompted) process.stdout.write(s);
      prompted = true;
    };
  }
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      if (tty) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const [command, username] = process.argv.slice(2);
const usage = 'usage: cli.ts reset-password <username> | make-admin <username>';
if (!command || !username || !['reset-password', 'make-admin'].includes(command)) {
  console.error(usage);
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}

const { db, pool } = createDb(url);
try {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.username})`, username.toLowerCase()));
  if (!user) throw new Error(`No user named "${username}"`);

  if (command === 'reset-password') {
    const password = await readSecret(`New password for ${user.username}: `);
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await writeAudit(tx, null, [
        { entity: 'user', entityId: user.id, action: 'cli_reset_password' },
      ]);
    });
    await deleteUserSessions(db, user.id);
    console.log(`Password changed; ${user.username} was signed out everywhere.`);
  } else {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ isSiteAdmin: true }).where(eq(users.id, user.id));
      await writeAudit(tx, null, [{ entity: 'user', entityId: user.id, action: 'cli_make_admin' }]);
    });
    console.log(`${user.username} is now a site admin.`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
