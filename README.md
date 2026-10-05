# FrostTracker

A self-hosted web app to track a **Frosthaven** campaign and its characters: campaign state, scenarios, play sessions, outpost phases, character sheets with history, and a campaign map. Mobile-first, installable as a PWA, built to run on Unraid behind Traefik.

> **No game content in this repository.** Frosthaven is © Cephalofair Games. This repo contains only code and fictional placeholder data (`seed-example/`). Rule books, scenario/section data and graphics are copyrighted. You load your own data at runtime: game data as a seed directory (`/data/seed`), images into `/data/assets`. Never commit anything from `docs/` or `seed/`; both are gitignored.

Status: **Phase 3 (skeleton)**. Accounts, sessions, campaigns, roles, invites and the screen structure are in place. See [`design/ARCHITECTURE.md`](design/ARCHITECTURE.md) for the full design and phase plan.

## Local development

Requirements: Docker. For working outside the container you also need Node 24 LTS (`.nvmrc`) and pnpm via corepack (`corepack enable`).

```sh
docker compose -f docker-compose.dev.yml up
```

- App (Vite, hot reload): http://localhost:5173. Sign in as `dev-admin` / `dev-password-123`.
- API: http://localhost:3000 (proxied by Vite under `/trpc`)
- The first start installs dependencies into container-only volumes (takes a few minutes).
- Reset everything: `docker compose -f docker-compose.dev.yml down -v`

Without Docker for the app (needs a PostgreSQL you provide):

```sh
corepack enable
pnpm install
cp .env.example .env   # set DATABASE_URL, PUBLIC_URL=http://localhost:5173, ADMIN_* ...
pnpm dev               # server on :3000 (node --watch), web on :5173
```

## Scripts

| Command                                        | What it does                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Server (watch mode) + Vite dev server                                                                                                                 |
| `pnpm build`                                   | Production build of the web app (`apps/web/dist`)                                                                                                     |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | ESLint, Prettier, `tsc --noEmit` for all packages                                                                                                     |
| `pnpm test`                                    | Unit tests (rule logic)                                                                                                                               |
| `pnpm test:integration`                        | API tests (auth, CSRF, permissions) against a real PostgreSQL in Docker (Testcontainers)                                                              |
| `pnpm test:e2e`                                | Builds the web app, starts server + throwaway DB, runs Playwright on desktop and mobile viewports. First run: `pnpm exec playwright install chromium` |
| `pnpm db:generate`                             | Generate a SQL migration after changing `apps/server/src/db/schema.ts`                                                                                |

If the Docker CLI points at a Docker Desktop context that isn't running, set `DOCKER_HOST=unix:///var/run/docker.sock`.

## Project layout

```
apps/server     Fastify + tRPC API; TypeScript run directly by Node 24 (type stripping, no build step)
apps/web        React SPA / PWA (Vite, TanStack Router + Query, Tailwind, i18next)
packages/shared zod schemas shared by API, web and seed format
packages/rules  pure rule logic, unit-tested; each rule cites its ID from the (private) rules reference
seed-example    fictional placeholder seed data
design          architecture and data model
```

## Configuration (server environment)

| Variable                                                   | Default                   | Purpose                                                                                             |
| ---------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                             | – (required)              | PostgreSQL connection string                                                                        |
| `PUBLIC_URL`                                               | – (required)              | External URL, e.g. `https://frosthaven.example.com`. Used for CSRF origin checks and secure cookies |
| `TRUSTED_PROXIES`                                          | none                      | Comma-separated IPs/CIDRs whose `X-Forwarded-*` headers are trusted (Traefik)                       |
| `ALLOW_REGISTRATION`                                       | `false`                   | Open self-registration. Otherwise accounts are created through invite links                         |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` / `ADMIN_PASSWORD_FILE` | –                         | Create the first site admin on start if none exists                                                 |
| `SESSION_TTL_DAYS`                                         | `30`                      | Sliding session lifetime                                                                            |
| `ASSETS_DIR`                                               | `/data/assets`            | Your own game images (map), served to signed-in users                                               |
| `SEED_DIR`                                                 | `/data/seed`              | Your private game data seed                                                                         |
| `PORT`, `HOST`, `LOG_LEVEL`                                | `3000`, `0.0.0.0`, `info` |                                                                                                     |

## Deployment

`docker-compose.yml` runs the app and PostgreSQL behind an existing Traefik v3 (labels for host, `websecure` entrypoint and cert resolver come from `.env`, and no ports are published). Copy `.env.example` to `.env`, fill it in, then `docker compose up -d --build`. Migrations run automatically at start. Full Unraid instructions, backups and restore follow in `DEPLOYMENT.md` (Phase 7). It lives in the repo root because `docs/` is reserved for private, uncommitted material.

## License

Code: MIT (see `LICENSE`). Game content and graphics are not part of this project.
