# be-push-notification-tool

Backend for the Push Notification Tool. Express 5 + Prisma 7 + MySQL 8, TypeScript.

It is the `express` dispatch target the FE console (`fe-push-notification-tool`) lists as
"not ready yet", and takes over the auto-app-push path from the Rails `ecs-api`: it validates the
same payload, writes the same delivery file, and records every run in MySQL.

## Run

```bash
cp .env.example .env          # fill in every key — see Environment below
docker compose up -d          # MySQL 8, using the MYSQL_* values from .env
yarn install
yarn db:generate              # build the Prisma client from prisma/schema.prisma
yarn db:migrate               # apply migrations
yarn dev                      # restarts on file change; the log line says the port
```

```bash
curl -i "localhost:$PORT/health"   # {"status":"ok","db":"ok"}
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | process + database check |
| `POST` | `/api/notifications/auto-app-pushes` | `X-APIToken` | validate an auto-app-push request, write one delivery CSV per edition under `PUSH_FILE_DIR`, record the run in `push_runs` / `push_editions`; `201` with no body |
| `POST` | `/api/notifications/normal-pushes` | `X-APIToken` | validate a normal-push request (ecs-api's contract) and record the run in `normal_push_runs` / `normal_push_editions` / `normal_push_shows` — no delivery file is written, no downstream system is called; `201` with the created editions |

Request body, validation rules and error ids: `docs/superpowers/specs/2026-09-22-auto-app-push-design.md`
and `docs/superpowers/specs/2026-09-28-normal-push-design.md`.
The auto-app-push delivery file matches what the Rails `ecs-api` writes; nothing is uploaded or sent.
normal-push writes no file at all — see "Out of scope" in its design doc.

```bash
curl -i -X POST "localhost:$PORT/api/notifications/auto-app-pushes" \
  -H 'Content-Type: application/json' -H "X-APIToken: $API_TOKEN" \
  -d '{"login_ids":["502001185"],"editions":[{"publish_hour_min":[11,30],"deliv_id":"H020064377","title":"テスト","link_type":"03","link_item":"https://eplus.jp/"}]}'
```

(`publish_hour_min` must be a Tokyo time between 08:00 and 22:00 and no more than 2 hours ahead.)

```bash
curl -i -X POST "localhost:$PORT/api/notifications/normal-pushes" \
  -H 'Content-Type: application/json' -H "X-APIToken: $API_TOKEN" \
  -d '{"editions":[{"publish_hour_min":[17,0],"shows":[{"code":"9014500001-P0030056","performer_id":2762,"hook":"firstcome"},{"code":"9014500001-P0030065","performer_id":2762,"hook":"preorder"}]}]}'
```

```json
{"editions":[{"id":1,"period_start":"2026-09-30T17:00:00+09:00","period_end":"2026-09-30T18:00:00+09:00","status":"edited","topics_count":2}]}
```

(`publish_hour_min` starts a one-hour window between 08:00 and 21:00 Tokyo; a start in the past is
fine and there is no 2-hour cap. There is no `login_ids` — sending it is `400 NP-0004`. Sending the
same hour again is `422 NP-0208`. The full contract is the FE's `docs/API-DOC-normal-push.md`.)

## Environment

**`.env` is the only place a value belongs.** It is git-ignored; no value is written into this
file, `.env.example`, `CLAUDE.md`, or any other committed file. `.env.example` is the list of keys
with empty values, and `src/lib/env.ts` declares and validates them. There are **no defaults**:
every key must be set, and a missing or malformed one stops the process at startup with the
variable named.

| Variable | Read by | What it is |
|---|---|---|
| `PORT` | app | Port the server listens on. |
| `NODE_ENV` | app | `development`, `test` or `production`. |
| `LOG_LEVEL` | app | pino level: `trace`, `debug`, `info`, `warn`, `error` or `fatal`. |
| `CORS_ORIGIN` | app | Origin(s) the browser may call from, comma-separated. In development, the FE dev server. |
| `API_TOKEN` | app | Shared secret the FE sends as `X-APIToken`. Any string locally; on a shared environment, whatever that environment's secret store holds. |
| `PUSH_FILE_DIR` | app | Directory the delivery CSV files are written to, relative to the process cwd. Git-ignored. |
| `DATABASE_URL` | app + Prisma CLI | `mysql://<user>:<password>@<host>:<port>/<database>`. Must agree with the `MYSQL_*` values. Use `127.0.0.1` rather than `localhost` — the MySQL driver may read `localhost` as a Unix socket, which a Docker container does not have. |
| `MYSQL_ROOT_PASSWORD` | docker-compose | Root password for the local container. |
| `MYSQL_DATABASE` | docker-compose | Database the container creates. |
| `MYSQL_USER` | docker-compose | Application user the container creates. |
| `MYSQL_PASSWORD` | docker-compose | That user's password. |
| `MYSQL_PORT` | docker-compose | Host port the container publishes. |

`yarn test` reads the same `.env`, so it needs every key set too.

## TablePro

Connect with the `MYSQL_*` values from your own `.env`: host `127.0.0.1`, and the port, user,
password and database you set there.

After `yarn db:migrate` you will see `push_runs`, `push_editions`, `normal_push_runs`,
`normal_push_editions`, `normal_push_shows` and `_prisma_migrations` (Prisma's ledger of applied migrations).
Do not change tables by hand; edit `prisma/schema.prisma` and run `yarn db:migrate`.

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
  lib/time.ts               Asia/Tokyo conversions, shared across push-type modules
  middleware/api-token.ts   X-APIToken check (constant-time)
  middleware/error-handler.ts   404 + thrown errors -> envelope
  modules/health/           GET /health
  modules/auto-app-push/    schema · validate · csv · service · router (+ tests)
  modules/normal-push/      schema · validate · service · router (+ tests) — no csv.ts, no file writing
  generated/prisma/         Prisma client (generated, git-ignored)
prisma/schema.prisma        PushRun/PushEdition, NormalPushRun/Edition/Show — the source of truth for the DB
prisma/migrations/          generated SQL, committed with the schema
prisma.config.ts            Prisma 7 CLI config (reads DATABASE_URL)
docker-compose.yml          MySQL 8 for local development
```

See `CLAUDE.md` for the conventions.
