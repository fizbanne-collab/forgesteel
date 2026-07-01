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

Before production use, perform and document a restoration drill against a
disposable database. A backup is not considered operational until restoration
has been verified.

## Unraid

Use Compose Manager or an equivalent Docker Compose workflow. Persist the
database, upload, and backup volumes. Terminate HTTPS at the existing reverse
proxy and forward to the `web` service only; the database and API should not be
published directly.
