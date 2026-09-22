# Auto App Push endpoint — design

**Date:** 2026-09-22
**Status:** approved in discussion, pending written review
**Endpoint:** `POST /api/notifications/auto-app-pushes`

## Why

The FE console (`fe-push-notification-tool`) lets a tester submit auto-app-push notifications
for the staging environment. Today it can only send them to the Rails `ecs-api`, whose endpoint
needs SSH + rails console to set up and answers with no record of what it received. This service
is the FE's `express` dispatch target. The first endpoint accepts the same payload, applies the
same rules, writes the same delivery file the Rails code writes, and additionally keeps a record
of every run in MySQL.

Delivery itself (upload to S3, pickup by the batch worker) is out of scope: the Rails code has
that upload commented out too. A `201` here means "validated, file written, run recorded".

## Contract sources

- Request/response rules and error ids: `../fe-push-notification-tool/docs/API-DOC-auto-app-push.md`.
  Response shapes are binding; the path is not (see below).
- Delivery file format: `create_auto_app_push_edition` in the Rails `lib/push_test/common.rb`
  (copy at `../common.rb`, lines 250–276).
- Naming: `../API naming convention rules.pdf`.

## 1. HTTP surface

### Path

`POST /api/notifications/auto-app-pushes` — chosen over the Rails path
`/api/test_notification/auto_app_pushes` because this is a new service and the naming rules
apply: kebab-case, plural, resource-oriented. `notifications` is the group segment for the
other push kinds that will follow (`score-pushes`, `order-pushes`, …). A later history endpoint
is `GET /api/notifications/auto-app-pushes` / `GET /api/notifications/auto-app-pushes/:id`.

The FE's route handler (`src/app/api/push/auto-app-push/route.ts`) will pick base URL + path by
dispatch target. That FE change is a separate task.

### Auth

`X-APIToken: <secret>` header, compared with the new required env variable `API_TOKEN` using a
constant-time comparison (`crypto.timingSafeEqual`). Missing, empty or wrong → `401` with
`AP-0002`. Implemented as `src/middleware/api-token.ts`, mounted on this router only; `/health`
stays open.

### Body

`application/json`, exactly these keys:

| key | type | required | notes |
|---|---|---|---|
| `date` | `"YYYY-MM-DD"` | no | defaults to today in Asia/Tokyo |
| `login_ids` | `string[]` | yes | non-empty |
| `editions` | `object[]` | yes | non-empty |
| `distribute_now` | `boolean` | no | default `false`; stored, has no effect |

Each edition:

| key | type | notes |
|---|---|---|
| `publish_hour_min` | `[int, int]` | hour 0–23, minute 0–59, combined with `date` |
| `deliv_id` | `string` | 1–24 chars |
| `title` | `string` | non-empty, UTF-8 |
| `link_type` | `"01" \| "02" \| "03"` | |
| `link_item` | `string` | non-empty; for `"01"` must match the show-id pattern |

Any key not in these tables, at either level → `400 AP-0004`. A body that is not JSON →
`400 AP-0003`.

### Responses

| case | status | body |
|---|---|---|
| accepted | `201` | empty (zero bytes). The FE branches on `res.ok` and never reads a body. |
| token missing/wrong | `401` | envelope, `AP-0002` / `UNAUTHORIZED` |
| body not JSON | `400` | envelope, `AP-0003` / `INVALID_PARAMETER` |
| unknown key | `400` | envelope, `AP-0004` / `INVALID_PARAMETER`, `errors[].field` = the key |
| validation | `422` | envelope, top-level `AP-0001` / `INVALID_PARAMETER`, one `errors[]` entry per problem |
| file or DB write failed | `500` | envelope, `AP-0005` / `INTERNAL_ERROR` |

Envelope is the one in `src/lib/errors.ts`. `errors[]` entries are
`{ error_id, field, title, message }`; `field` is the dotted path (`editions[0].deliv_id`).
Messages follow the contract's wording, id appended: `deliv_id is required (AP-0201)`.

## 2. Validation

`validate(body, now: Date): FieldError[]` in `modules/auto-app-push/validate.ts`. Pure: no I/O,
no clock of its own. Returns every problem at once. When `date` is unusable (`AP-0101`), the
editions are not checked, so that error can arrive alone.

| id | field | rule |
|---|---|---|
| `AP-0101` | `date` | present but not a real `YYYY-MM-DD` calendar date |
| `AP-0102` | `login_ids` | missing, not an array, empty, or an element is not a non-empty string |
| `AP-0103` | `editions` | missing, not an array, or empty |
| `AP-0104` | `distribute_now` | present but not a boolean — *not in the contract; added here, documented in the FE contract doc when the FE switches over* |
| `AP-0201` | `editions[n].deliv_id` | missing, not a string, or blank after trim |
| `AP-0202` | `editions[n].deliv_id` | longer than 24 characters |
| `AP-0203` | `editions[n].title` | missing, not a string, or blank after trim |
| `AP-0204` | `editions[n].link_item` | missing, not a string, or blank after trim |
| `AP-0205` | `editions[n].link_type` | not one of `"01"`, `"02"`, `"03"` |
| `AP-0206` | `editions[n].link_item` | `link_type` is `"01"` and the value does not match `^(\d{6})\d*-P003(\d{4})` |
| `AP-0207` | `editions[n].publish_hour_min` | not a 2-element array of integers, hour outside 0–23, or minute outside 0–59 |
| `AP-0208` | `editions[n].publish_hour_min` | delivery time is more than 2 hours after `now` |
| `AP-0209` | `editions[n].publish_hour_min` | delivery time outside 08:00–22:00 Tokyo, both ends inclusive: 08:00 and 22:00 are accepted, 07:59 and 22:01 are not |

Rules within one edition are independent: a blank `deliv_id` and a bad `link_type` on the same
edition produce two entries. `AP-0208`/`AP-0209` are only evaluated when `AP-0207` did not fire
for that edition. A repeated `deliv_id` across editions is **not** an error (the contract treats it
as the same delivery; the later file overwrites the earlier one).

Time: `date` + `publish_hour_min` is interpreted in Asia/Tokyo (fixed +09:00, no DST). "Today"
for the `date` default and "now" for `AP-0208` are the same `now` instant converted to Tokyo.
A delivery time in the past is allowed (the contract only bounds the future).

## 3. Success path

`service.ts` orchestrates: `validate` → build and write one file per edition → insert the run and
its editions in one transaction → return. The router answers `201` with no body.

### Delivery file (`csv.ts`, pure)

`buildDeliveryFile(edition, loginIds, publishAt): { relativePath, content }`, byte-for-byte what
Rails `CSV.open(path, "w", quote_char: '"', force_quotes: true)` writes:

```
<PUSH_FILE_DIR>/<YYYYMMDD>/app_push/<YYYYMMDDHHMMSS>_<deliv_id>_app_push.csv
```

```
"<deliv_id>","<title>","","<link_type>"
"<item>"
"<login_id>"
"<login_id>"
```

- Every field is quoted, including the empty third field (`""`).
- A `"` inside a value becomes `""` (CSV escaping, as Ruby's CSV does).
- Lines end with `\n`; the file ends with `\n`. UTF-8, no BOM.
- `<item>`: for `link_type "01"`, `<kogyo_code>-<kogyo_sub_code>` from the show id
  (`9041480001-P0030001P021001` → `904148-0001`); for `"02"`/`"03"`, `link_item` unchanged.
- Timestamps in the path are the Tokyo wall-clock time of the delivery.
- An existing file at the same path is overwritten silently (same as Rails).

`PUSH_FILE_DIR` is a new env variable, default `tmp/push_test` (relative to the process cwd),
added to `.gitignore`.

### Database (first migration of the repo)

```prisma
model PushRun {
  id            BigInt        @id @default(autoincrement())
  date          DateTime      @db.Date
  distributeNow Boolean       @map("distribute_now")
  loginIds      Json          @map("login_ids")
  createdAt     DateTime      @default(now()) @map("created_at")
  editions      PushEdition[]
  @@map("push_runs")
}

model PushEdition {
  id        BigInt   @id @default(autoincrement())
  runId     BigInt   @map("run_id")
  run       PushRun  @relation(fields: [runId], references: [id])
  delivId   String   @map("deliv_id") @db.VarChar(24)
  title     String   @db.Text
  linkType  String   @map("link_type") @db.Char(2)
  linkItem  String   @map("link_item") @db.VarChar(255)
  publishAt DateTime @map("publish_at")        // UTC
  filePath  String   @map("file_path") @db.VarChar(255)
  createdAt DateTime @default(now()) @map("created_at")
  @@index([runId])
  @@map("push_editions")
}
```

Table and column names are snake_case (`@@map` / `@map`); Prisma field names stay camelCase as
the client convention. `login_ids` is JSON because it is never queried by element. `publish_at`
is stored in UTC; the Tokyo time is derived on read.

### Failure ordering

- Any file write fails → nothing is inserted → `500 AP-0005`. Files already written for earlier
  editions are left in place (Rails has no rollback either); the log line says which.
- The transaction fails → files stay, no rows → `500 AP-0005`.
- Nothing is written before validation passes.

## 4. Module layout

```
src/modules/auto-app-push/
  router.ts        POST handler: parse → validate → service → 201; throws AppError otherwise
  schema.ts        zod: the exact key set at both levels (drives AP-0004); no business rules
  validate.ts      the rule table above → FieldError[]
  csv.ts           buildDeliveryFile — pure
  time.ts          Tokyo helpers: todayInTokyo(now), tokyoDateTime(date, h, m) → Date, format YYYYMMDD / YYYYMMDDHHMMSS
  errors.ts        AP-xxxx catalogue: id → { code, title, message(field?) }; invalidParameter(errors[]) → AppError(422)
  service.ts       createAutoAppPush(input, { now, fileDir }) → writes files, inserts rows
  *.test.ts        next to each file
src/middleware/api-token.ts
src/lib/env.ts     + API_TOKEN (required), PUSH_FILE_DIR (default tmp/push_test)
src/middleware/error-handler.ts
                   + maps express.json parse failures to 400 AP-0003
```

`app.ts` mounts `apiTokenMiddleware` and the router at `/api/notifications/auto-app-pushes`.

## 5. Testing

TDD throughout: each rule and each file-format detail is a failing test first.

**Unit (no DB, no filesystem):**
- `validate.test.ts` — one test per row of the rule table, plus: all errors reported at once;
  editions skipped when `date` is bad; duplicate `deliv_id` accepted; boundaries (08:00, 22:00,
  exactly 2h ahead) with a fixed `now`.
- `csv.test.ts` — exact string equality for: the four-field header with the empty third field,
  quote escaping, Japanese title, show-id reduction for `01`, unchanged item for `02`/`03`, path
  and filename from a Tokyo timestamp.
- `time.test.ts` — Tokyo conversions around midnight UTC.
- `schema.test.ts` — unknown key at top level and inside an edition reported with the right `field`.

**Integration (`router.test.ts`, real app, real MySQL, real files under a temp dir):**
- 401 without token, 401 with wrong token.
- 400 for non-JSON body; 400 for an unknown key.
- 422 with two errors from two different editions in one response.
- 201: body empty; the file exists with the exact expected content; one `push_runs` row and N
  `push_editions` rows with the expected values.
- `afterEach` truncates the two tables and removes the temp dir. `vitest.config.ts` sets
  `API_TOKEN` and `PUSH_FILE_DIR` through `test.env` so `env.ts` sees them at import.

## Out of scope

- Uploading the file to S3, or forwarding the request to `ecs-api`.
- `404` on production (no production yet).
- A history endpoint (`GET …`), pagination, per-run status.
- Enabling the `express` option and the new path in the FE.
- Any other push kind.
