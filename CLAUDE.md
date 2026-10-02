# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
docker compose up -d mysql  # MySQL 8 only — tests and yarn dev on the host both need it
docker compose up -d   # or the whole stack: MySQL + api + the FE console (web) — see Docker below
yarn install
yarn dev               # tsx watch; the startup log line names the port
yarn typecheck         # tsc --noEmit
yarn lint              # oxlint, not eslint
yarn test              # vitest run — integration tests against the compose MySQL
yarn build             # tsc -p tsconfig.build.json -> dist/
yarn db:generate       # after every schema.prisma change
yarn db:migrate        # prisma migrate dev; commit the migration folder with the schema
```

Use yarn (1.22.22). Versions in `package.json` are exact, no `^`. `package-lock.json` and
`pnpm-lock.yaml` are git-ignored on purpose.

## What this service is

The backend the FE console (`../fe-push-notification-tool`) calls when its dispatch target is
`express`. It replaces the Rails `ecs-api` path for push-notification test runs.

Endpoints: `GET /health` (open), `POST /api/notifications/auto-app-pushes` and
`POST /api/notifications/normal-pushes` (both behind `requireApiToken`). The paths follow the
naming rules rather than the Rails paths the contract documents show; the response rules and
error ids of those documents still apply.

These documents are binding for the endpoints here:

- `../fe-push-notification-tool/docs/API-DOC-auto-app-push.md` — the auto-app-push contract the FE
  is built against: `X-APIToken` header, request body, the `AP-xxxx` error ids, and the response
  rules (`201` with **no body**; failures in the shared error envelope; `422` for validation, `400`
  for an unreadable body or an unknown key, `401` with a body, `404` empty).
- `../fe-push-notification-tool/docs/API-DOC-normal-push.md` — the normal-push contract (ecs-api's):
  `editions[].shows[]` of `{ code, performer_id, hook }`, **no `login_ids`**, the `NP-xxxx` ids, and a
  `201` that lists the created editions.
- `docs/create_topics_edition_flow.md` — what ecs-api's `PushTest::Common.create_topics_edition`
  does step by step. normal-push builds the same edition and topics; read it before changing
  how a show code is read or expanded.
- `../API naming convention rules.pdf` — property names `snake_case`, endpoints `kebab-case`
  and plural, one identifier called `id`, booleans not `"0"`/`"1"`, no romanised Japanese.

## How the code is put together

**Feature modules.** Each feature lives in `src/modules/<feature>/` with `router.ts` (the HTTP
surface, mounted once in `app.ts`), and, when it needs them, `service.ts` (logic with no
`req`/`res`) and `schema.ts` (zod schemas for the body). Tests sit next to the code as
`*.test.ts`. There are no `controllers/` or `repositories/` folders; do not add them.

**`src/lib/` is the shared layer, and each file has one owner rule:**

- `env.ts` is the **only** file that reads `process.env`. Everything else imports `env`. A new
  variable is added to the zod schema there, nowhere else. It has **no defaults**: every variable
  must be set, and its value lives only in `.env` (or the platform's configuration) — never in
  `.env.example`, this file, the README, or any other committed file. An empty value (`PORT=`)
  counts as unset and fails at startup, naming the variable.
- `prisma.ts` is the **only** place `new PrismaClient()` is called. Import `prisma` from it.
- `errors.ts` owns the response shape for failures. Business code throws `AppError`; it never
  builds an error body by hand and never calls `res.status(4xx)` itself.
- `logger.ts` is pino. No `console.log` (oxlint warns). Objects first, message second:
  `logger.info({ run_id }, 'run created')`. Inside a request use `req.log`, which carries the
  request id.

**Middleware order in `app.ts` is load-bearing.** helmet → cors → pino-http → `express.json` →
routers → `notFoundHandler` → `errorHandler`. CORS must precede routers or the browser's
preflight 404s; the JSON parser must precede any router that reads `req.body`; the two error
handlers must stay last or they catch nothing. `errorHandler` has four parameters — that arity
is how Express recognises it. Express 5 sends rejected `async` handlers there on its own, so
route handlers do not need `try/catch` just to forward errors.

**`app.ts` never calls `listen()`.** `server.ts` does, and owns the process lifecycle
(SIGTERM/SIGINT → close server → `prisma.$disconnect()` → exit). Tests call `createApp()` and
hand it to supertest, which needs no port.

## Errors

Every failure leaves the server as

```json
{ "error": { "error_id": "…", "code": "…", "title": "…", "message": "… (id)", "errors": [ { "error_id", "field", "title", "message" } ] } }
```

That is the shared error envelope the FE already parses (`fe-push-notification-tool/src/lib/api.ts`).
`errors[].field` is the dotted path of the input (`editions[0].deliv_id`) or `null`. Framework
ids use the `CM-` prefix (`CM-0404`, `CM-0500`); feature ids keep the prefix the contract gives
them (`AP-` for auto-app-push, `NP-` for normal-push — ecs-api's own ids, so the FE reads both
servers the same way). The FE keys its wording off `error_id`, so ids
are stable and message text is not a contract.

Unknown errors become a `CM-0500` with a generic message; the stack goes to the log only.
An `AppError` can carry `{ cause }`; the error handler logs the cause on 5xx and never sends it.

**A real coupling, not yet fixed:** `requireApiToken` and `error-handler.ts` import their 401
and bad-JSON-400 builders (`unauthorized()`, `invalidJson()`) from `auto-app-push/errors.ts`
specifically, and that's global middleware — so every route mounted behind it, including
`normal-push`, currently answers those two cases with `AP-0002`/`AP-0003`, not its own prefix.
Fixing this (extracting both into `src/lib/errors.ts` under new `CM-04xx` ids) changes
auto-app-push's already-shipped wire contract, so it needs its own sign-off rather than being
folded into whichever feature branch next notices it.

## The auto-app-push module

`src/modules/auto-app-push/`, designed in `docs/superpowers/specs/2026-09-22-auto-app-push-design.md`
and built with `docs/superpowers/plans/2026-09-22-auto-app-push.md`:

- `schema.ts` only answers "which keys are unknown?" (→ `400 AP-0004`). It is a plain
  function on purpose — zod `.strict()` inside a union swallows unknown keys in nested arrays.
- `validate.ts` is the rule table: `validate(body, now)` returns every `AP-01xx`/`AP-02xx`
  problem at once, or the normalised `ValidInput`. It never throws and never reads the clock —
  `now` is a parameter. Add a rule = add a row to the spec table, a test, then the check.
- `csv.ts` builds the delivery file byte-for-byte like Rails `common.rb`
  (`force_quotes`, `""` escaping, `\n`). Change it only against that file.
- `service.ts` is the only place with I/O: unknown keys → validate → write files → one nested
  `prisma.pushRun.create`. Failures after validation are `500 AP-0005` with `cause`.
- `router.ts` is two lines. `createApp({ clock, fileDir })` injects the clock and the
  directory; tests pin both.

The `AP-xxxx` catalogue and the envelope builders live in the module's `errors.ts`; the
error handler and `requireApiToken` import from there (see the coupling note above).

Asia/Tokyo time helpers used to live here as `time.ts` but had no auto-app-push-specific logic,
so they moved to `src/lib/time.ts` when `normal-push` was added — date-fns + `@date-fns/tz`
(`TZDate`, `format(..., { in: tz(ZONE) })`), zone `BUSINESS_TIMEZONE` from `env.ts`.
`parseCalendarDate` keeps its own regex because date-fns' `parse` accepts `2026-9-2`.

## The normal-push module

`src/modules/normal-push/`, designed in `docs/superpowers/specs/2026-09-28-normal-push-design.md`:

It implements ecs-api's normal push contract (`../fe-push-notification-tool/docs/API-DOC-normal-push.md`):
`{ date?, editions: [{ publish_hour_min, shows: [{ code, performer_id, hook }] }], distribute_now? }`,
and builds what ecs-api's `create_topics_edition` builds (`docs/create_topics_edition_flow.md`).

- `schema.ts` only answers "which keys are unknown?" (→ `400 NP-0004`), at all three levels —
  top, edition, show. `login_ids` is not a key, so sending it is a 400, like ecs-api.
- `validate.ts` is the rule table: `validate(body, now)` returns every `NP-01xx`/`NP-02xx`
  problem at once, or the normalised `ValidInput`. `publish_hour_min` starts a **one-hour
  window**: it must start between 08:00 and 21:00, a start in the past is fine, and there is no
  lead-time cap. `hook` is `preorder` or `firstcome` only (a mixed push is two shows with
  different hooks). `performer_id` is a positive safe integer of at most 16 digits, kept as a
  `bigint`. `code` must match ecs-api's `SHOW_ID_FORMAT`, ported in `show-code.ts`
  (`parseShowCode`: 6-digit kogyo, 4-digit tour, optional `-P003xxxx` / `P021xxx` parts, optional
  `?query`). Two editions in the same request less than an hour apart are `NP-0208`.
- `service.ts` is the only place with I/O, in `create_topics_edition`'s order: unknown keys →
  validate → overlap against saved editions (`NP-0208`, ecs-api's
  `period_start < new end AND period_end > new start`) → **expand every show into its
  performances**: a code with a `P021` part is one; one without it goes to the e+ search API
  (`src/lib/eplus-search.ts`, `GET /koen`, up to 200, `502 NP-0006` on failure) → one nested
  `prisma.normalPushRun.create` (run → editions with `period_end` / `status: edited` /
  `edited_at` → shows as sent + one topic per performance with ecs-api's `subject_uri` /
  `object_uri` / `area: anywhere`). Every search happens before anything is written, so a failure
  leaves nothing behind (ecs-api leaves the earlier editions). Nothing after `edited!` happens —
  no notifications, no delivery; `distribute_now` is recorded only. The `201` is ecs-api's:
  `{ editions: [{ id, period_start, period_end, status, topics_count }] }` with `+09:00` ISO times
  and `topics_count` = topics actually created. A failed write is `500 NP-0005` with `cause`.
- `router.ts` — `createNormalPushRouter({ clock, searchKoen })`, **no `fileDir`**. `createApp`
  builds the real `searchKoen` from `EPLUS_SEARCH_API_URL` / `EPLUS_SEARCH_API_KEY`; **tests always
  pass a stub** — nothing in the suite reaches the network.

The `NP-xxxx` catalogue and envelope builders live in the module's `errors.ts`. `NP-0104`
(non-boolean `distribute_now`) is ours only. `NP-0002`/`NP-0003` are intentionally not defined
there — see the coupling note above.

## Database

- Models: `PushRun`/`PushEdition` (auto-app-push) and `NormalPushRun`/`NormalPushEdition`/
  `NormalPushShow`/`NormalPushTopic` (normal-push; the edition and topic mirror ecs-api's
  `epica_topics_editions_v2` / `epica_topics_v2`) — separate table sets per feature module, not a
  shared/generalized schema. Integration tests delete child rows first (topics, shows → editions
  → runs): the foreign keys are `RESTRICT`.
- `prisma migrate dev` refuses to run without a terminal (as from Claude Code). Write the
  migration SQL by hand in a new `prisma/migrations/<timestamp>_<name>/` folder, apply it with
  `yarn db:deploy`, and check `yarn prisma migrate diff --from-config-datasource --to-schema
  prisma/schema.prisma --script` prints an empty migration. Hand-written SQL is also how a
  column is renamed rather than dropped (`20261001090000_normal_push_topics`).
- `prisma/schema.prisma` is the source of truth. Change a model → `yarn db:migrate --name x` →
  **`yarn db:generate`** (`migrate dev` did not regenerate the client for us) → commit the schema
  and the new `prisma/migrations/*` folder together. Never alter tables in TablePro on a shared
  environment.
- The client is generated into `src/generated/prisma` (git-ignored) so `tsc` ships it in `dist/`.
  Import it as `../generated/prisma/client.js`. Run `yarn db:generate` after pulling a schema change.
- Prisma 7: the URL is in `prisma.config.ts`, not the schema, and the client needs the
  `@prisma/adapter-mariadb` adapter (`lib/prisma.ts`). The CLI does not load `.env` by itself;
  `prisma.config.ts` imports `dotenv/config` for that.
- The `mariadb` driver returns MySQL integers as `BigInt` (`1n`). `JSON.stringify` throws on
  BigInt — convert before sending a count to the client.
- MySQL runs on UTC. `DateTime` columns are UTC; Asia/Tokyo (`BUSINESS_TIMEZONE` in `env.ts`,
  fixed +09:00, no DST) is applied in code, the way the FE does with `todayInTokyo`.
- `prisma migrate dev` needs a shadow database; the compose init script grants the app user the
  `prisma_migrate_shadow_db%` pattern so root is never used.

## TypeScript / ESM

- `"type": "module"` + `moduleResolution: NodeNext`: relative imports **end in `.js`** even
  though the file is `.ts` (`import { env } from './lib/env.js'`). That is how Node's ESM loader
  resolves them after compilation.
- Same strictness as the FE: `verbatimModuleSyntax` (types via `import type` or inline
  `type`), `erasableSyntaxOnly` (no `enum`, no `namespace`, no parameter properties),
  `noUnusedLocals`/`noUnusedParameters`. These fail `yarn build`, not just lint.
- `tsconfig.json` is for the editor, `yarn typecheck` and Vitest (includes tests and root
  configs). `tsconfig.build.json` extends it and compiles `src/` only.
- A script outside the package that needs top-level `await` must be `.mts` — a bare `.ts` with
  no nearby `"type": "module"` is treated as CommonJS by tsx.

## Tests

Vitest + supertest. Pure modules (`validate`, `csv`, `time`, `schema`, `errors`) have unit tests
with no I/O; `service.test.ts` and `router.test.ts` are integration tests against the compose
MySQL, and truncate their module's own tables in `afterEach` — auto-app-push also manages a
`mkdtemp` directory for its file-writing tests; normal-push has no files, so its integration
tests only touch the database.

`fileParallelism: false` in `vitest.config.ts` is load-bearing: the integration files share one
database, and running them in parallel made one file's `deleteMany` race another's assertions.
`NODE_ENV=test` (set by Vitest) silences the logger and Prisma's query log; `test.env` supplies
`API_TOKEN`. `afterAll(() => prisma.$disconnect())` in any test file that touches the database,
so the worker exits. Keep router tests to the HTTP surface (status, headers, envelope) and put
rule-by-rule cases in the unit tests.

## Docker

`docker-compose.yml` is the local dev stack for both repos: `mysql`, `api` (this repo's
`Dockerfile.dev`) and `web` (built from `../fe-push-notification-tool/Dockerfile.dev`, so the two
repos must sit side by side).

- The `Dockerfile.dev` images hold only `node_modules` (Linux binaries — esbuild, Prisma's engines,
  oxlint). Source is bind-mounted at `/app`, and an anonymous volume keeps the host's macOS
  `node_modules` out. A dependency change needs `docker compose up -d --build`.
- `api` runs `yarn db:generate && yarn db:deploy && yarn dev` on start. `migrate deploy` needs no
  shadow database; write new migrations with `docker compose exec api yarn db:migrate --name …`.
- No value is written into the compose file: everything is interpolated from `.env` or loaded with
  `env_file`. `api` overrides `DATABASE_URL` to the `mysql` host; dotenv never overrides a variable
  already set, so `env.ts` and `prisma.config.ts` read the compose one in the container and
  `.env`'s `127.0.0.1` one on the host.
- `PORT` is repeated under `environment` so `PORT=8081 docker compose up -d` moves the server, the
  published port and `web`'s `NEXT_PUBLIC_EXPRESS_API_URL` (`http://localhost:${PORT}` — the
  browser calls the API directly, so it is the host port, never `http://api:…`) together. Use it
  when a local `ecs-api` already holds 8080.

## Scope notes

Docker is dev-only (`Dockerfile.dev`, bind mounts, `tsx watch`). No production image, CI or
deployment until asked.
