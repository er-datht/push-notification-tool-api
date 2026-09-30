# Normal Push endpoint — design

**Date:** 2026-09-28, revised 2026-09-30
**Status:** implemented
**Endpoint:** `POST /api/notifications/normal-pushes`

## Why

The FE console (`fe-push-notification-tool`) sends Normal Push to either `ecs-api` or this
service. ecs-api's normal push endpoint has a written contract
(`../fe-push-notification-tool/docs/API-DOC-normal-push.md`), so this endpoint reimplements the
**same contract** — same body, same `NP-xxxx` error ids, same `201` body — the way the auto-app-push
endpoint reimplements ecs-api's auto app push. The FE then reads both servers the same way.

This endpoint's job is narrower than ecs-api's: **validate and record, nothing else.** It writes no
file, calls no downstream system and does not expand show codes. A `201` means "validated and
recorded in `normal_push_runs` / `normal_push_editions` / `normal_push_shows`".

**Revision 2026-09-30:** the first version of this pilot followed the FE's early guess (one show per
edition as `sub_type` / `target_event` / `word_id`, a required `login_ids`, `NRM-` ids, an empty
`201`). It was reshaped to ecs-api's contract before it ever shipped; the migration
`20260930062421_normal_push_shows` moves the tables to the new shape.

## Contract sources

- Body, rules, error ids and the `201` body: `../fe-push-notification-tool/docs/API-DOC-normal-push.md`.
- Which fields a Normal Push has: the e+ Cloud guideline's `PushTest::Common.create_topics_edition(publish_hour_min:, shows:)`
  (summarised in `../fe-push-notification-tool/docs/PUSH-TYPES-FIELD-REFERENCE.md`).
- Envelope: the shared one in `src/lib/errors.ts`.

## 1. HTTP surface

### Auth

Same `X-APIToken` / `requireApiToken` middleware as auto-app-push. No new env variable.

### Body

`application/json`, exactly these keys:

| key | type | required | notes |
|---|---|---|---|
| `date` | `"YYYY-MM-DD"` | no | defaults to today in Asia/Tokyo |
| `editions` | `object[]` | yes | non-empty; one per notification |
| `distribute_now` | `boolean` | no | default `false`; stored, has no effect here |

Each edition:

| key | type | notes |
|---|---|---|
| `publish_hour_min` | `[int, int]` | start of a **one-hour window**, combined with `date` |
| `shows` | `object[]` | non-empty |

Each show:

| key | type | notes |
|---|---|---|
| `code` | `string` | the 興行コード: `^\d+-P\d+(?:P\d+)?$` (a `[公演]` prefix fails) |
| `performer_id` | `number` | the ワード id: a positive safe integer, at most 16 digits |
| `hook` | `"preorder" \| "firstcome"` | two shows with different hooks make a mixed push |

There is **no `login_ids`**: any key not in these tables, at any level, is `400 NP-0004` — so is
`login_ids`. A body that is not JSON is `400`, but answers `AP-0003` (see the coupling note).

### Responses

| case | status | body |
|---|---|---|
| accepted | `201` | `{ editions: [{ id, period_start, period_end, status: "edited", topics_count }] }` |
| token missing/wrong | `401` | envelope, **`AP-0002`** (shared-middleware coupling) |
| body not JSON | `400` | envelope, **`AP-0003`** (same coupling) |
| unknown key | `400` | envelope, `NP-0004`, `errors[].field` = the key's dotted path |
| validation or overlap | `422` | envelope, top-level `NP-0001`, one `errors[]` entry per problem |
| DB write failed | `500` | envelope, `NP-0005` |

`201`: one entry per edition in the order sent. `id` is the edition's id as a number;
`period_start` / `period_end` are ISO 8601 with `+09:00`; `topics_count` is the number of shows (this
service does not expand a code into its performances the way ecs-api does).

**Shared-middleware coupling:** `requireApiToken` and `error-handler.ts` import `unauthorized()` /
`invalidJson()` from `auto-app-push/errors.ts`, so every route answers 401 and bad-JSON-400 with
`AP-0002` / `AP-0003`. Fixing it changes auto-app-push's shipped contract, so it is tracked
separately.

## 2. Validation

`validate(body, now)` in `validate.ts`. Pure; returns every problem at once. When `date` is unusable
the editions are not checked.

| id | field | rule |
|---|---|---|
| `NP-0101` | `date` | present but not a real `YYYY-MM-DD` day |
| `NP-0103` | `editions` | missing, not an array, or empty |
| `NP-0104` | `distribute_now` | present but not a boolean — ours only, not in ecs-api's catalogue |
| `NP-0201` | `editions[n].shows` | missing, not an array, or empty |
| `NP-0202` | `editions[n].shows[m].code` | blank |
| `NP-0203` | `editions[n].shows[m].code` | not a valid show id |
| `NP-0204` | `editions[n].shows[m].performer_id` | not a positive safe integer of at most 16 digits |
| `NP-0205` | `editions[n].shows[m].hook` | not `preorder` or `firstcome` |
| `NP-0206` | `editions[n].publish_hour_min` | not a 2-element array of integers in range |
| `NP-0207` | `editions[n].publish_hour_min` | window starts before 08:00 or after 21:00 |
| `NP-0208` | `editions[n].publish_hour_min` | window overlaps another edition in the request (the later one is named) or one already saved |

Timing: a start in the past is allowed (that is how `distribute_now` is used), and there is no
lead-time cap. Two windows overlap when their starts are **less** than 60 minutes apart, so 17:00 and
18:00 are fine together.

## 3. Success path

`service.ts`: unknown keys → validate → overlap against saved editions (`publishAt` strictly within
±60 min, compared as UTC instants) → one nested `prisma.normalPushRun.create` (run → editions →
shows, all or nothing) → the `201` body. A failure at the write is `500 NP-0005` with the original
error as `cause`. Two requests at the same moment can both pass the overlap check; that is accepted
(ecs-api's doc already says one tester at a time).

### Database

```prisma
model NormalPushRun {
  id            BigInt              @id @default(autoincrement())
  date          DateTime            @db.Date
  distributeNow Boolean             @map("distribute_now")
  createdAt     DateTime            @default(now()) @map("created_at")
  editions      NormalPushEdition[]
  @@map("normal_push_runs")
}

model NormalPushEdition {
  id        BigInt           @id @default(autoincrement())
  runId     BigInt           @map("run_id")
  run       NormalPushRun    @relation(fields: [runId], references: [id])
  publishAt DateTime         @map("publish_at")   // window start, UTC
  createdAt DateTime         @default(now()) @map("created_at")
  shows     NormalPushShow[]
  @@index([runId])
  @@index([publishAt])                              // the overlap check
  @@map("normal_push_editions")
}

model NormalPushShow {
  id          BigInt            @id @default(autoincrement())
  editionId   BigInt            @map("edition_id")
  edition     NormalPushEdition @relation(fields: [editionId], references: [id])
  code        String            @db.VarChar(64)
  performerId BigInt            @map("performer_id")   // up to 16 digits
  hook        String            @db.VarChar(16)
  createdAt   DateTime          @default(now()) @map("created_at")
  @@index([editionId])
  @@map("normal_push_shows")
}
```

Separate tables from `PushRun` / `PushEdition` on purpose — one table set per feature module.

## 4. Module layout

```
src/modules/normal-push/
  router.ts     POST handler: service -> 201 with the created editions
  schema.ts     findUnknownKeys — the exact key set at three levels (drives NP-0004)
  validate.ts   the rule table above -> FieldError[] or ValidInput
  errors.ts     NP-xxxx catalogue and envelope builders (NP-0002/0003 deliberately absent)
  service.ts    createNormalPush(body, { now }) -> overlap check, nested create, 201 body
  *.test.ts     next to each file
src/lib/time.ts formatTokyoIso — ISO 8601 with +09:00 for period_start / period_end
```

## 5. Testing

**Unit (no DB):** `schema.test.ts` (unknown keys at each level, `login_ids`), `validate.test.ts`
(one case per rule-table row, window edges 07:59 / 08:00 / 21:00 / 21:01, past start allowed, no
lead cap, 16-digit `performer_id`, overlap within the request, touching windows allowed),
`errors.test.ts`.

**Integration (real MySQL):** `service.test.ts` (400 / 422 / overlap with a saved edition / 500 /
success with rows and the returned body) and `router.test.ts` (401 `AP-0002`, bad JSON `AP-0003`,
`login_ids` → `NP-0004`, 422 down to a show's dotted path, repeated hour → `NP-0208`, 201 body,
default date). Both delete shows → editions → runs in `afterEach` (the foreign keys are `RESTRICT`).

## Out of scope

- Writing a file, calling ecs-api, delivering a push, or expanding a `code` into performances
  (`topics_count` counts shows instead).
- `NP-0006` (e+ search API failure) — only ecs-api calls that API.
- Fixing the `AP-0002` / `AP-0003` shared-middleware coupling (tracked separately).
- The other push types.
