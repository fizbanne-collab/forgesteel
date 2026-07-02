# StravSteel Operations

## Local configuration

Copy `.env.example` to `.env` and replace all placeholder secrets. Do not
commit `.env`.

At minimum, configure:

- `POSTGRES_PASSWORD`
- `SESSION_SECRET` with at least 32 random characters
- `COOKIE_SECURE=false` for local HTTP; use `true` behind production HTTPS
- Google OAuth client ID and secret
- `INITIAL_ADMIN_EMAIL`

Google OAuth must include the configured callback URL. For local development,
the default callback is:

`http://localhost:3001/api/auth/google/callback`

## Starting containers

```sh
docker compose up --build
```

The web application is available at `http://localhost:8080` by default. The
nginx container proxies `/api` to the private API container.

PostgreSQL is bound only to the host loopback interface. Local tools can reach
it, but it is not exposed to the LAN.

## Database migrations

The API container applies pending migrations before it starts. During local
development, migrations can also be run explicitly from the workspace:

```sh
npm run db:migrate
```

Migrations are ordered and recorded in `schema_migration`.

## Backups

The backup container writes dumps to `./backups`, which is intentionally
ignored by Git. Defaults retain:

- 7 daily backups
- 4 weekly backups
- 6 monthly backups

Copy this directory to storage outside the application host. A backup on the
same machine is useful for mistakes but insufficient for hardware failure.

### Restore verification

Run a restoration drill after initial deployment and at least quarterly. The
helper restores a compressed SQL backup into a disposable database, verifies
its migrations, and removes the disposable database:

```sh
./scripts/restore-backup.sh ./backups/daily/stravsteel-YYYYMMDD.sql.gz
```

This never overwrites the live `stravsteel` database. To restore production
after an incident, stop `api` and `web`, restore into a new database first,
verify it, then deliberately replace the live database. Keep the original
database until the restored application has been checked.

## Unraid

1. Clone the repository beneath appdata or use Compose Manager with both
   Compose files:

   ```sh
   docker compose -f compose.yaml -f compose.unraid.yaml up -d --build
   ```

2. Copy `.env.unraid.example` to `.env` on Unraid. The checked-in template is
   configured for this deployment:

   - public URL: `https://drawsteel.crawfords.work`
   - internal reverse-proxy target: `http://10.2.0.11:32500`

   Replace every secret placeholder, then confirm these production values:

   - `APPDATA_PATH=/mnt/user/appdata/stravsteel`
   - `BACKUP_PATH=/mnt/user/backups/stravsteel`
   - `WEB_PORT=32500`
   - a unique `POSTGRES_PASSWORD`
   - a random `SESSION_SECRET` of at least 32 characters
   - `WEB_ORIGIN=https://drawsteel.crawfords.work`
   - `COOKIE_SECURE=true`
   - `GOOGLE_CALLBACK_URL=https://drawsteel.crawfords.work/api/auth/google/callback`
   - the Google client ID, client secret, and initial admin email

3. Create the appdata and backup directories before starting the stack. The
   Unraid override bind-mounts PostgreSQL and uploads beneath `APPDATA_PATH`,
   and database dumps beneath `BACKUP_PATH`.

4. Terminate HTTPS at the existing reverse proxy and forward
   `drawsteel.crawfords.work` to `http://10.2.0.11:32500`. Enable WebSocket
   support for `/api/realtime`; the included nginx service carries the upgrade
   headers to the API. Do not publish the API or PostgreSQL to the LAN or
   internet.

5. Add the exact production callback URL to the Google OAuth client's
   authorized redirect URIs. Google requires an exact scheme, host, path, and
   port match.

6. After startup, verify:

   ```sh
   curl --fail https://drawsteel.crawfords.work/healthz
   curl --fail https://drawsteel.crawfords.work/api/health
   docker compose ps
   ```

   Then sign in, upload a portrait and handout, open the same character in two
   browsers, and confirm live edits appear in both.

## Updates and rollback

Before an update, confirm a recent backup exists and record the current commit:

```sh
git rev-parse HEAD
docker compose -f compose.yaml -f compose.unraid.yaml pull
docker compose -f compose.yaml -f compose.unraid.yaml build --pull
docker compose -f compose.yaml -f compose.unraid.yaml up -d
```

The API applies forward-only database migrations at startup. Roll back the
application only when the older version supports the migrated schema.
Otherwise restore the pre-update database into a separate instance and verify
it before switching traffic.

## Logs and monitoring

Containers use Docker's JSON logging with rotation (three 10 MB files each).
Monitor `/api/health`; it returns 503 if PostgreSQL is unavailable. The API
emits structured JSON logs in production. Configure Unraid notifications or an
external uptime monitor for the public health endpoint.

The API defaults to 300 requests per client IP per minute. Adjust
`RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW` in `.env` if normal campaign usage
requires it. The trusted reverse proxy must preserve `X-Forwarded-For`.
