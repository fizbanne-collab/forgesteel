# StravSteel Roadmap

## Phase 1: Foundation

- Preserve the original Forge Steel remote as `upstream`.
- Add the TypeScript API, PostgreSQL migration system, and health endpoint.
- Add WebSocket transport, Docker Compose, uploads volume, and database
  backups.
- Document architecture, operations, and upstream integration.

## Phase 2: Identity and campaigns

- [x] Replace Patreon authentication with Google OAuth/OpenID Connect.
- [x] Bootstrap the configured initial administrator.
- [x] Implement approved-email and one-use campaign invitations.
- [x] Add campaign membership and role-based authorization.
- [x] Remove Patreon UI, services, models, sourcebook content, and configuration.
- [x] Add director/admin screens for managing members and invitations.

## Phase 3: Server storage

- [x] Implement the StravSteel `StorageService`.
- [x] Persist characters, sourcebooks, and sessions in campaign scope.
- [x] Remove the existing backup page and replace it with campaign JSON export.
- [x] Verify authenticated character save, load, and delete against PostgreSQL.
- [ ] Move encounter and library documents from session/sourcebook containers to
  dedicated campaign endpoints as their collaboration workflows are added.

## Phase 4: Real-time characters

- [x] Add authenticated campaign WebSocket rooms.
- [x] Apply revisioned field-level patches with conflict detection.
- [x] Merge non-overlapping concurrent changes and reject overlapping edits.
- [x] Broadcast accepted updates to open campaign clients.
- [x] Display the five-entry edit history and support restoration.
- [x] Add presence indicators showing who currently has a character open.

## Phase 5: Sharing and files

- [x] Add character portraits and campaign handouts.
- [x] Enforce campaign-scoped download authorization.
- [x] Add file size and type limits.
- [ ] Add portrait image processing and thumbnail generation.

## Phase 6: Unraid readiness

- [x] Exercise backup restoration using a generated scheduled-format backup.
- [x] Add production hardening, rate limits, structured logs, and health
  monitoring guidance.
- [x] Document reverse proxy, Google callback, volumes, secrets, and upgrades.
- [x] Run desktop and tablet acceptance testing against the production
  container.
