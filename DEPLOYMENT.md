# Deploying FrostTracker on Unraid

This guide installs FrostTracker on Unraid behind a Traefik v3 that is already running. The recommended way uses the **Docker Compose Manager** plugin: one stack with the app, PostgreSQL and a backup job. A [plain Unraid template](#alternative-unraid-docker-template) is described at the end.

The app image (`ghcr.io/leticron/frosttracker`) contains code only. Game data and graphics are copyrighted by Cephalofair Games; you provide your own copies as files on the server.

## 1. What this guide assumes

Check these against your setup. The values in brackets are the defaults; you can change them in `.env`.

- Unraid 6.12 or 7.x with the **Docker Compose Manager** plugin (Apps → search "Compose Manager").
- **Traefik v3** runs as a container and:
  - watches Docker labels (Docker provider enabled, ideally with `exposedByDefault=false`),
  - is attached to a user-defined Docker network that other containers can join (`traefik`),
  - has an HTTPS entrypoint (`websecure`) and a certificate resolver (you name it, e.g. `letsencrypt`),
  - redirects HTTP to HTTPS (recommended; the app sends HSTS and secure cookies, so it must be opened via HTTPS).
- A DNS name for the app (e.g. `frosthaven.example.com`) that points to Traefik.

Find the network name with `docker network ls`. If Traefik uses a different network, set `TRAEFIK_NETWORK` accordingly.

FrostTracker publishes **no ports** on the host. Only Traefik can reach it, through the shared Docker network.

## 2. Folders

The stack uses these folders under `/mnt/user/appdata/frosthaven-tracker/` (all configurable in `.env`):

| Folder     | Contents                                                                         |
| ---------- | -------------------------------------------------------------------------------- |
| `db/`      | PostgreSQL data. Created on first start; don't touch it while the stack runs     |
| `backups/` | Daily database dumps (`frosthaven-YYYYMMDD-HHMMSSZ.dump`)                        |
| `seed/`    | Your game data seed (`manifest.json`, `scenarios.json`, …). Read-only in the app |
| `assets/`  | Your own images: `map/world.jpg` and optionally `map/town.jpg`. Read-only        |

Copy your seed and images there before the first start (e.g. via an SMB share of `appdata`). Both are optional: without a seed the app starts empty and an admin can import one later; without images the map shows a grid.

## 3. Make the image pullable (once)

The image is published to the GitHub Container Registry by CI after every merge to `main` and for every `v*` tag. GHCR packages start out private. Either:

- make it public: GitHub → your profile → **Packages** → `frosttracker` → **Package settings** → **Change visibility** → Public, or
- log in on Unraid once: `docker login ghcr.io -u <github-user>` with a personal access token that has `read:packages`.

## 4. Install the stack

1. **Docker** tab → **Compose** section (bottom) → **Add New Stack**, name it `frosthaven-tracker`.
2. Click the stack's gear icon → **Edit Stack** → **Compose File**. Paste the contents of [`docker-compose.yml`](docker-compose.yml) and save. The backup script is embedded in that file, so nothing else is needed from the repository.
3. **Edit Stack** → **ENV File**. Paste [`.env.example`](.env.example) and fill in at least:

   ```env
   APP_HOST=frosthaven.example.com
   TRAEFIK_CERTRESOLVER=letsencrypt
   POSTGRES_PASSWORD=<long random string>
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<at least 10 characters>
   TZ=Europe/Berlin
   ```

   Generate a password with `openssl rand -base64 24` in the Unraid terminal. Pin `APP_VERSION` to a release tag (e.g. `1.0.0`) if you want updates only when you choose (see [Updating](#6-updating)).

4. **Compose Up**. The first start pulls the images, creates the database, runs the migrations, creates the admin and imports the seed from `seed/` if there is one.

Check the result:

```sh
cd /boot/config/plugins/compose.manager/projects/frosthaven-tracker
docker compose ps        # app "healthy", db "healthy", backup "running"
docker compose logs app  # "Created site admin", "Imported game data seed"
```

## 5. First start

1. Open `https://frosthaven.example.com` and sign in as the admin.
2. **Remove `ADMIN_PASSWORD`** from the ENV file afterwards (it is ignored once an admin exists, but shouldn't stay on disk). Compose Up again to apply it.
3. **Admin** page: check the seed status. If you add or change the seed later, use **Import as new data set**. Existing campaigns keep their data set until a host switches it under **Settings**.
4. Create a campaign and invite your group from **Members** (invite links). Open self-registration only if you want it (`ALLOW_REGISTRATION=true`).
5. On phones, use the browser's "Add to Home screen" / "Install app" to install the PWA.

## 6. Updating

Database migrations run automatically and safely at start (under a PostgreSQL advisory lock).

1. Take a backup first: `docker compose exec backup fht-backup now`.
2. If you pinned `APP_VERSION`, change it in the ENV file.
3. Compose Manager: **Update Stack** (or in the terminal: `docker compose pull && docker compose up -d`).
4. Check `docker compose logs app` for "Database migrations applied".

To go back to an older version after a failed update, set the old `APP_VERSION` and **restore the backup taken before the update**. Migrations only go forward, so an older app can't use a database that a newer one has migrated.

## 7. Backups and restore

The `backup` service writes a `pg_dump` (custom format) to `backups/` every day at `BACKUP_TIME` (in `TZ`) and deletes dumps older than `BACKUP_KEEP_DAYS`. If the newest dump is more than a day old when the stack starts (e.g. after downtime), it makes one right away. Old dumps are only deleted after a successful new one.

Run these from the stack folder (`/boot/config/plugins/compose.manager/projects/frosthaven-tracker`):

```sh
docker compose exec backup fht-backup now     # backup right away
docker compose exec backup fht-backup list    # show backups
docker compose logs backup                    # schedule and results
```

The dumps hold everything important: accounts, campaigns, characters, history, imported game data and map markers. The `seed/` and `assets/` folders are your own files; keep copies of them too. Copy `backups/` off the server (e.g. Unraid's Backup/Restore Appdata plugin or a sync to another machine). A backup on the same disks doesn't protect against disk failure.

### Restore

Restoring **replaces the whole database**. The script first saves the current state as `…-before-restore.dump`, so you can go back.

```sh
docker compose stop app
docker compose exec backup fht-backup list
docker compose exec backup fht-backup restore frosthaven-20261006-033000Z.dump
docker compose start app
```

### Moving to a new server

Install the stack as above with the **same** `POSTGRES_*` values, but leave `ADMIN_*` empty. Start it once (this creates an empty database), copy a dump into the new `backups/` folder, and restore it as above. Sign in with your old accounts afterwards.

## 8. Troubleshooting

| Symptom                                                  | Cause and fix                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traefik returns 404                                      | Traefik doesn't see the container: check `traefik.enable`, that the app is on `TRAEFIK_NETWORK`, and that Traefik watches Docker. `docker compose logs app` should show the server listening on port 3000                                                       |
| 502 / Bad Gateway                                        | The app isn't healthy yet or crashed: `docker compose ps`, `docker compose logs app`                                                                                                                                                                            |
| Sign-in fails with "Forbidden" (403)                     | `APP_HOST` doesn't match the address in the browser. Requests from other origins are rejected (CSRF protection)                                                                                                                                                 |
| Sign-in seems to work but you stay on the login page     | The site was opened via plain HTTP. The session cookie is HTTPS-only; enable the HTTP→HTTPS redirect in Traefik                                                                                                                                                 |
| `pull access denied` for `ghcr.io/leticron/frosttracker` | The package is still private or no image has been published yet, see [step 3](#3-make-the-image-pullable-once)                                                                                                                                                  |
| "This campaign has no game data yet"                     | No seed was imported. Put it into `seed/` and use **Admin → Import as new data set**, then pick it in the campaign's **Settings**                                                                                                                               |
| Map shows a grid                                         | No `map/world.*` image in `assets/` (supported: jpg, jpeg, png, webp, avif). Reload the page after adding it                                                                                                                                                    |
| Lost a password                                          | Reset it in the app container (you are asked for the new password; the user is signed out everywhere): `docker compose exec app node apps/server/src/cli.ts reset-password <username>`. `… cli.ts make-admin <username>` makes an existing account a site admin |

## Building from source

Instead of pulling the image you can build it on any Docker host from a checkout of the repository:

```sh
git clone https://github.com/Leticron/FrostTracker.git && cd FrostTracker
cp .env.example .env   # fill in
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Alternative: Unraid Docker template

If you prefer Unraid's normal Docker UI over Compose Manager, use the template in [`unraid/frosttracker.xml`](unraid/frosttracker.xml). You run PostgreSQL as a second container yourself.

1. Install PostgreSQL: **Apps** → `postgres` (official image), or **Add Container** with repository `postgres:18.6-alpine`. Name it `frosttracker-db`, network `traefik`, variables `POSTGRES_USER=frosthaven`, `POSTGRES_PASSWORD=<random>`, `POSTGRES_DB=frosthaven`, path `/var/lib/postgresql` → `/mnt/user/appdata/frosthaven-tracker/db`. Don't publish its port.
2. Copy the template to the flash drive: `/boot/config/plugins/dockerMan/templates-user/my-frosttracker.xml`.
3. **Docker** → **Add Container** → Template **frosttracker**. Set the database URL (`postgres://frosthaven:<password>@frosttracker-db:5432/frosthaven`), the public URL, the Traefik host rule and cert resolver, and the admin password. Apply.
4. Continue with [First start](#5-first-start).

Differences from the Compose stack: both containers share the Traefik network (the database isn't on a private network), and there is no backup service. Schedule a backup with the **User Scripts** plugin, e.g. daily:

```sh
#!/bin/bash
dir=/mnt/user/appdata/frosthaven-tracker/backups
file="$dir/frosthaven-$(date -u +%Y%m%d-%H%M%SZ).dump"
mkdir -p "$dir"
if docker exec frosttracker-db pg_dump -U frosthaven -d frosthaven --format=custom > "$file.partial"; then
  mv "$file.partial" "$file"
  find "$dir" -name 'frosthaven-*.dump' -mtime +14 -delete
else
  rm -f "$file.partial"
  echo "Backup failed" >&2
fi
```

Restore (stop the `frosttracker` container first):

```sh
docker exec frosttracker-db psql -U frosthaven -d postgres -c 'DROP DATABASE frosthaven WITH (FORCE)' -c 'CREATE DATABASE frosthaven'
docker exec -i frosttracker-db pg_restore -U frosthaven -d frosthaven --no-owner < /mnt/user/appdata/frosthaven-tracker/backups/<file>.dump
```

## Security notes

- Accounts: passwords are hashed with Argon2id; sessions are random tokens in `__Host-` HTTP-only, secure, SameSite cookies; login is rate-limited; every API call checks campaign membership and role.
- `TRUSTED_PROXIES` defaults to the private address ranges because the app is only reachable through Docker networks. Any container on the Traefik network could therefore set `X-Forwarded-For`. Narrow it to Traefik's address (or subnet) if you share that network with untrusted containers.
- Single sign-on (OIDC, e.g. Authelia/Authentik) isn't built in yet. You can still put a Traefik forward-auth middleware in front of the whole site; users then sign in twice.
- The `assets/` folder is served to signed-in users only, and only image files.
