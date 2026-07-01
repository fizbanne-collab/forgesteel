# StravSteel Architecture

StravSteel is a web-hosted, campaign-focused fork of Forge Steel. It preserves
the upstream React application while adding an authenticated TypeScript API,
PostgreSQL persistence, real-time character collaboration, and managed file
storage.

## Design goals

- Keep upstream Forge Steel merges practical.
- Require authentication and an active campaign membership for stored data.
- Treat the server as the source of truth; offline synchronization is out of
  scope.
- Support desktop and tablet layouts.
- Run locally and on Unraid with the same Docker Compose topology.
- Keep infrastructure replaceable: PostgreSQL and file storage are accessed
  through narrow application boundaries.

## Repository shape

- `src/`: upstream-derived React/Vite application.
- `server/src/`: StravSteel API and real-time service.
- `server/migrations/`: ordered PostgreSQL migrations.
- `nginx/`: production web server and API/WebSocket proxy.
- `compose.yaml`: local and Unraid-compatible service topology.

The frontend's existing `StorageService` interface is the primary integration
seam. The StravSteel implementation now stores campaign characters,
sourcebooks, and sessions through the authenticated API without forcing server
concerns into the domain and presentation layers. Personal display options and
hidden-sourcebook preferences remain local to the browser.

## Data model

Campaigns are the authorization boundary. Membership grants either `director`
or `player` access. Site administration is represented separately on the user.

Characters and other Forge Steel domain objects are stored as JSONB documents.
This deliberately avoids duplicating Forge Steel's large and frequently
changing model in relational tables. Ownership, campaign membership, revision,
and audit metadata remain relational and enforceable.

Character mutations use a monotonically increasing revision. Clients submit
field-level patches against a known revision. The server applies compatible
patches, rejects conflicting paths, persists the resulting snapshot, and
broadcasts accepted changes to the character's WebSocket room.

The database retains the five most recent character changes. Each entry stores
the patch and resulting snapshot so the UI can explain and restore changes.

## Authentication and authorization

The production authentication method is Google OAuth/OpenID Connect. There is
no development bypass. The email configured by `INITIAL_ADMIN_EMAIL` becomes
the initial site administrator after a successful Google login.

Access is invite-only:

- Site administrators can approve an email globally.
- Directors can create one-use invitations for campaigns they manage.
- Directors may edit every character in their campaigns.
- Players may create characters and edit characters assigned to them.
- Removing a member leaves their characters in the campaign with no owner.

Google authentication, database-backed sessions, invite admission, campaign
creation, membership listing, and role-aware invitation endpoints are
implemented. The frontend gates Forge Steel behind authentication and an active
campaign selection. Server-backed domain storage begins in Phase 3.

## Files

Portraits and handouts are represented by metadata in PostgreSQL and bytes in
an upload provider. The first provider is a Docker volume. The interface will
permit a later move to S3-compatible object storage without changing campaign
authorization.

## Deployment

Docker Compose runs four services:

1. `web`: built React application served by nginx.
2. `api`: TypeScript/Node API and WebSocket endpoint.
3. `database`: PostgreSQL.
4. `backup`: scheduled PostgreSQL dumps with daily, weekly, and monthly
   retention.

The existing reverse proxy terminates HTTPS and forwards traffic to `web`.
nginx forwards `/api` (including WebSocket upgrades) to the API container.

## License

StravSteel remains licensed under GPLv3. Original notices and the license must
remain available, and modified public distributions must make corresponding
source available under compatible terms.
