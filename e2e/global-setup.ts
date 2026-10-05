import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const ADMIN = { username: 'e2e-admin', password: 'e2e-admin-password' };

/**
 * Starts a throwaway PostgreSQL (unless E2E_DATABASE_URL is given) and the production server
 * serving the built web app. Returns the teardown function.
 */
export default async function globalSetup() {
  if (!existsSync('apps/web/dist/index.html')) {
    throw new Error('Build the web app first: pnpm build');
  }
  const port = Number(process.env.E2E_PORT ?? 3100);
  const container = process.env.E2E_DATABASE_URL
    ? undefined
    : await new PostgreSqlContainer('postgres:18.6-alpine').start();
  const databaseUrl = process.env.E2E_DATABASE_URL ?? container!.getConnectionUri();

  const server = spawn('node', ['apps/server/src/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_URL: databaseUrl,
      PUBLIC_URL: `http://localhost:${port}`,
      ADMIN_USERNAME: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
      ASSETS_DIR: '/nonexistent',
      LOG_LEVEL: 'warn',
    },
    stdio: 'inherit',
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`http://localhost:${port}/healthz`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (server.exitCode !== null) throw new Error('Server exited during startup');
    if (Date.now() > deadline) throw new Error('Server did not become healthy');
    await new Promise((r) => setTimeout(r, 500));
  }

  return async () => {
    server.kill('SIGTERM');
    await container?.stop();
  };
}
