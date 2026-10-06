import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const ADMIN = { username: 'e2e-admin', password: 'e2e-admin-password' };

/** A plain self-made PNG standing in for the owner's map image (no game graphics). */
function testMapPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([200, 220 - (x % 40), 235], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

  const assets = mkdtempSync(join(tmpdir(), 'fht-e2e-assets-'));
  mkdirSync(join(assets, 'map'));
  writeFileSync(join(assets, 'map', 'world.png'), testMapPng(800, 600));

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
      ASSETS_DIR: assets,
      SEED_DIR: 'seed-example', // fictional data, auto-imported on first start
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
    rmSync(assets, { recursive: true, force: true });
  };
}
