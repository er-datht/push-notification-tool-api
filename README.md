# be-push-notification-tool

Backend for the Push Notification Tool. Express 5 + Prisma 7 + MySQL 8, TypeScript.

It is the `express` dispatch target the FE console (`fe-push-notification-tool`) lists as
"not ready yet", and takes over the auto-app-push path from the Rails `ecs-api`: it validates the
same payload, writes the same delivery file, and records every run in MySQL.

## Run

```bash
docker compose up -d          # MySQL 8 on 127.0.0.1:3306 (first run pulls the image)
cp .env.example .env          # then fill in the values below
yarn install
yarn db:generate              # build the Prisma client from prisma/schema.prisma
yarn db:migrate               # apply migrations (none yet — creates _prisma_migrations)
yarn dev                      # http://localhost:8080, restarts on file change
```

```bash
curl -i localhost:8080/health   # {"status":"ok","db":"ok"}
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | process + database check |
| `POST` | `/api/notifications/auto-app-pushes` | `X-APIToken` | validate an auto-app-push request, write one delivery CSV per edition under `PUSH_FILE_DIR`, record the run in `push_runs` / `push_editions`; `201` with no body |

Request body, validation rules and error ids: `docs/superpowers/specs/2026-09-22-auto-app-push-design.md`.
The delivery file matches what the Rails `ecs-api` writes; nothing is uploaded or sent.

```bash
curl -i -X POST localhost:8080/api/notifications/auto-app-pushes \
  -H 'Content-Type: application/json' -H "X-APIToken: $API_TOKEN" \
  -d '{"login_ids":["502001185"],"editions":[{"publish_hour_min":[11,30],"deliv_id":"H020064377","title":"テスト","link_type":"03","link_item":"https://eplus.jp/"}]}'
```

(`publish_hour_min` must be a Tokyo time between 08:00 and 22:00 and no more than 2 hours ahead.)

## Environment

`.env.example` lists every variable; `src/lib/env.ts` validates them at startup and refuses to
start on a bad one. Values for local development:

| Variable | Local value | Notes |
|---|---|---|
| `PORT` | `8080` | The FE docs expect the local backend here. Default if empty. |
| `NODE_ENV` | `development` | Default if empty. |
| `LOG_LEVEL` | `debug` | pino level. Default `info`. |
| `CORS_ORIGIN` | `http://localhost:3000` | The FE dev server. Comma-separate for several. |
| `API_TOKEN` | any string, e.g. `dev-token` | Required. The FE sends it as `X-APIToken`. |
| `PUSH_FILE_DIR` | `tmp/push_test` | Where delivery CSV files are written. Default if empty. Git-ignored. |
| `DATABASE_URL` | `mysql://push:push@127.0.0.1:3306/push_notification_tool` | Required. Use `127.0.0.1`, not `localhost` — the MySQL driver may treat `localhost` as a Unix socket, which does not exist for a Docker container. |
| `MYSQL_ROOT_PASSWORD` | `root` | docker-compose only |
| `MYSQL_DATABASE` | `push_notification_tool` | docker-compose only; must match `DATABASE_URL` |
| `MYSQL_USER` | `push` | docker-compose only; must match `DATABASE_URL` |
| `MYSQL_PASSWORD` | `push` | docker-compose only; must match `DATABASE_URL` |
| `MYSQL_PORT` | `3306` | docker-compose only |

`.env` is git-ignored. `.env.example` is the list of keys and is committed.

## TablePro

| Field | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `3306` |
| User | `push` |
| Password | `push` |
| Database | `push_notification_tool` |

After `yarn db:migrate` you will see `push_runs`, `push_editions` and `_prisma_migrations`
(Prisma's ledger of applied migrations). Do not change tables by hand; edit `prisma/schema.prisma` and run `yarn db:migrate`.

## Scripts

| Script | What it does |
|---|---|
| `yarn dev` | `tsx watch src/server.ts` — runs TypeScript directly, restarts on change |
| `yarn build` | `tsc -p tsconfig.build.json` — compiles `src/` to `dist/` (no tests) |
| `yarn start` | `node dist/server.js` — runs the compiled output |
| `yarn typecheck` | `tsc --noEmit` — same rules as the FE repo |
| `yarn lint` | `oxlint` |
| `yarn test` | `vitest run` — integration tests; needs MySQL up |
| `yarn db:generate` | regenerate the Prisma client into `src/generated/prisma` (git-ignored) |
| `yarn db:migrate` | `prisma migrate dev` — create + apply a migration from schema changes |
| `yarn db:deploy` | `prisma migrate deploy` — apply committed migrations only (no shadow DB) |
| `yarn db:studio` | Prisma's own table browser, if you prefer it to TablePro |

## Docker notes

- `docker compose down` keeps the data (named volume). `docker compose down -v` wipes it.
- `docker/mysql/*.sh` runs once, when the volume is first created. It grants the app user the
  `prisma_migrate_shadow_db%` pattern so `prisma migrate dev` can create its shadow database
  without root. Changed it? `docker compose down -v && docker compose up -d`.
- The server charset is `utf8mb4` (Japanese text and emoji need 4-byte characters) and the server
  timezone is UTC on purpose — Asia/Tokyo is applied in application code.

## Layout

```
src/
  server.ts                 listen() + graceful shutdown; nothing else
  app.ts                    createApp(): middleware order, routers, error handlers
  lib/env.ts                the only reader of process.env
  lib/prisma.ts             the only PrismaClient
  lib/errors.ts             AppError + the shared error envelope
  lib/logger.ts             pino
  middleware/api-token.ts   X-APIToken check (constant-time)
  middleware/error-handler.ts   404 + thrown errors -> envelope
  modules/health/           GET /health
  modules/auto-app-push/    schema · validate · time · csv · service · router (+ tests)
  generated/prisma/         Prisma client (generated, git-ignored)
prisma/schema.prisma        PushRun, PushEdition — the source of truth for the DB
prisma/migrations/          generated SQL, committed with the schema
prisma.config.ts            Prisma 7 CLI config (reads DATABASE_URL)
docker-compose.yml          MySQL 8 for local development
```

See `CLAUDE.md` for the conventions.
