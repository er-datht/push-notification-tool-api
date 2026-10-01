# Normal Push endpoint — design

**Date:** 2026-09-28, revised 2026-09-30 and 2026-10-01
**Status:** implemented
**Endpoint:** `POST /api/notifications/normal-pushes`

## Why

The FE console (`fe-push-notification-tool`) sends Normal Push to either `ecs-api` or this
service. ecs-api's normal push endpoint has a written contract
(`../fe-push-notification-tool/docs/API-DOC-normal-push.md`), so this endpoint reimplements the
**same contract** — same body, same `NP-xxxx` error ids, same `201` body — the way the auto-app-push
endpoint reimplements ecs-api's auto app push. The FE then reads both servers the same way.

This endpoint builds what ecs-api's endpoint builds — the edition and the topics of
`PushTest::Common.create_topics_edition` (`docs/create_topics_edition_flow.md`) — and stops there:
it writes no file, creates no notifications and delivers nothing. A `201` means "the editions and
their topics are in `normal_push_editions` / `normal_push_topics`".

**Revision 2026-10-01:** the endpoint now follows `create_topics_edition` instead of only recording
the request. `code` is read with a port of `SHOW_ID_FORMAT`; a code with no `P021` part is expanded
through the e+ search API (`GET /koen`, up to 200, `502 NP-0006` on failure); each performance
becomes a `normal_push_topics` row with ecs-api's `subject_uri` / `object_uri` / `hook` /
`will_publish_at` / `area: anywhere`; the edition gains `period_end`, `status` and `edited_at`, and
`publish_at` is renamed `period_start`. `topics_count` is now the number of topics. Migration:
`20261001090000_normal_push_topics`. The sections below are updated to match.

**Revision 2026-09-30:** the first version of this pilot followed the FE's early guess (one show per
edition as `sub_type` / `target_event` / `word_id`, a required `login_ids`, `NRM-` ids, an empty
`201`). It was reshaped to ecs-api's contract before it ever shipped; the migration
`20260930062421_normal_push_shows` moves the tables to the new shape.

## Contract sources

- Body, rules, error ids and the `201` body: `../fe-push-notification-tool/docs/API-DOC-normal-push.md`.
- What the endpoint builds, and how a code is read and expanded: `docs/create_topics_edition_flow.md`
  (ecs-api's `create_topics_edition`), ported from ecs-api's
  `app/controllers/epica/api/test_notification/normal_pushes_controller.rb`.
- Which fields a Normal Push has: the e+ Cloud guideline's `PushTest::Common.create_topics_edition(publish_hour_min:, shows:)`
  (summarised in `../fe-push-notification-tool/docs/PUSH-TYPES-FIELD-REFERENCE.md`).
- Envelope: the shared one in `src/lib/errors.ts`.

## 1. HTTP surface

### Auth

Same `X-APIToken` / `requireApiToken` middleware as auto-app-push. The e+ search API needs
`EPLUS_SEARCH_API_URL` / `EPLUS_SEARCH_API_KEY` (ecs-api's `eplus_search_api_v3_url` / `_key`).

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
| `code` | `string` | the 興行コード, read like ecs-api's `SHOW_ID_FORMAT` (`show-code.ts`): 6-digit kogyo + 4-digit tour, optional `-P003xxxx` / `P021xxx` parts, optional `?query`. A `[公演]` prefix fails |
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
| e+ search API failed | `502` | envelope, `NP-0006`, `errors: []` — nothing written |
| DB write failed | `500` | envelope, `NP-0005` |

`201`: one entry per edition in the order sent. `id` is the edition's id as a number;
`period_start` / `period_end` are ISO 8601 with `+09:00`; `topics_count` is the number of topics
created — one per performance after expansion, so it can be 0 (the search found none) or far more
than the number of shows.

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
18:00 are fine together. Against saved editions this is ecs-api's query,
`period_start < new end AND period_end > new start`.

ecs-api checks the 08:00–21:00 window against **today**, not the requested `date`
(`publish_window_from` is `now.change(hour: 8)`), so it rejects any other day. That looks like an
ecs-api bug; this service checks against `date`.

## 3. Success path

`service.ts`, in `create_topics_edition`'s order (flow doc steps 1-5):

1. unknown keys → `400 NP-0004`; validate → `422 NP-0001`
2. overlap against saved editions — ecs-api's `period_start < new end AND period_end > new start`
   → `422 NP-0208`
3. **expand every show**, one after another in request order: a code with a `P021` part is one
   performance (`<kogyo6>-<sub>-<koen>`); one without it is `searchKoen(kogyo6, sub)` — the e+ search
   API's `GET /koen`, up to 200 and no paging, as ecs-api's `PushTest::Common.search`. Any failure
   → `502 NP-0006`. **All searches finish before anything is written**, so a failure leaves no rows
   (ecs-api creates editions one by one and leaves the earlier ones).
4. one nested `prisma.normalPushRun.create`: run → editions (`period_end = period_start + 1h`,
   `status: edited`, `edited_at`) → the shows as sent, and one topic per performance:
   `subject_uri = tag:eplus.jp,2010:performers/<performer_id padded to 10>`,
   `object_uri = tag:eplus.jp,2010:shows/<id>`, `hook`, `will_publish_at = period_start`,
   `area = anywhere` → the `201` body. A failure here is `500 NP-0005` with the original error as
   `cause`.

Not carried over from `create_topics_edition`: `Epica::Performer.find_or_create_by!` (only the URI is
kept), `set_notifications_async` and everything after it (no subscriptions, Sidekiq or SNS here), and
the `distribute_now` queuer call (the flag is stored only). Two requests at the same moment can both
pass the overlap check; that is accepted (ecs-api's doc already says one tester at a time).

### Database

Mirrors ecs-api's `epica_topics_editions_v2` and `epica_topics_v2` (+ its one
`epica_topic_areas_v2` row, folded into `area`). See `prisma/schema.prisma` for the comments.

```prisma
model NormalPushRun {
  id            BigInt              @id @default(autoincrement())
  date          DateTime            @db.Date
  distributeNow Boolean             @map("distribute_now")
  createdAt     DateTime            @default(now()) @map("created_at")
  editions      NormalPushEdition[]
  @@map("normal_push_runs")
}

enum NormalPushEditionStatus { created edited set }   // this service only reaches `edited`

model NormalPushEdition {
  id          BigInt                  @id @default(autoincrement())
  runId       BigInt                  @map("run_id")
  periodStart DateTime                @map("period_start")   // window start, UTC
  periodEnd   DateTime                @map("period_end")     // + 1 hour
  status      NormalPushEditionStatus @default(created)
  editedAt    DateTime?               @map("edited_at")
  createdAt   DateTime                @default(now()) @map("created_at")
  shows       NormalPushShow[]
  topics      NormalPushTopic[]
  @@index([runId])
  @@index([periodStart])
  @@index([periodEnd])
  @@map("normal_push_editions")
}

model NormalPushShow {                                      // the request as sent
  id          BigInt   @id @default(autoincrement())
  editionId   BigInt   @map("edition_id")
  code        String   @db.VarChar(64)
  performerId BigInt   @map("performer_id")                 // up to 16 digits
  hook        String   @db.VarChar(16)
  createdAt   DateTime @default(now()) @map("created_at")
  @@index([editionId])
  @@map("normal_push_shows")
}

model NormalPushTopic {                                     // what was built: one per performance
  id            BigInt   @id @default(autoincrement())
  editionId     BigInt   @map("edition_id")
  subjectUri    String   @map("subject_uri") @db.VarChar(191)
  objectUri     String   @map("object_uri") @db.VarChar(191)
  hook          String   @db.VarChar(16)
  willPublishAt DateTime @map("will_publish_at")
  area          String   @default("anywhere") @db.VarChar(32)
  createdAt     DateTime @default(now()) @map("created_at")
  @@index([editionId])
  @@map("normal_push_topics")
}
```

Separate tables from `PushRun` / `PushEdition` on purpose — one table set per feature module.

## 4. Module layout

```
src/modules/normal-push/
  router.ts     POST handler: service -> 201 with the created editions
  schema.ts     findUnknownKeys — the exact key set at three levels (drives NP-0004)
  show-code.ts  parseShowCode — ecs-api's SHOW_ID_FORMAT
  validate.ts   the rule table above -> FieldError[] or ValidInput
  errors.ts     NP-xxxx catalogue and envelope builders (NP-0002/0003 deliberately absent)
  service.ts    createNormalPush(body, { now, searchKoen }) -> overlap, expansion, nested create, 201 body
  *.test.ts     next to each file
src/lib/time.ts formatTokyoIso — ISO 8601 with +09:00 for period_start / period_end
src/lib/eplus-search.ts createSearchKoen — GET /koen, SearchUnavailableError
```

## 5. Testing

**Unit (no DB):** `schema.test.ts` (unknown keys at each level, `login_ids`), `validate.test.ts`
(one case per rule-table row, window edges 07:59 / 08:00 / 21:00 / 21:01, past start allowed, no
lead cap, 16-digit `performer_id`, overlap within the request, touching windows allowed, every
`SHOW_ID_FORMAT` shape), `show-code.test.ts` (the parts, their order, `?query`, rejected shapes),
`src/lib/eplus-search.test.ts` (the exact `GET /koen` URL and headers, `nil` sub, each failure →
`SearchUnavailableError`, with `fetch` stubbed), `errors.test.ts`.

**Integration (real MySQL, stubbed `searchKoen` — nothing reaches the network):** `service.test.ts`
(400 / 422 without searching / overlap with a saved edition / touching windows / 502 with no rows
even when an earlier edition needed no search / 500 / success: topics per performance with their
URIs, `area`, `will_publish_at`, `period_end`, `edited_at`, `topics_count`; an empty search → 0
topics) and `router.test.ts` (401 `AP-0002`, bad JSON `AP-0003`, `login_ids` → `NP-0004`, 422 down
to a show's dotted path, 502 `NP-0006` envelope, repeated hour → `NP-0208`, 201 body, default date).
Both delete topics, shows → editions → runs in `afterEach` (the foreign keys are `RESTRICT`).

## Out of scope

- Writing a file, calling ecs-api, creating notifications or delivering a push — everything after
  `create_topics_edition`'s `edited!`.
- Looking up or creating performers: a topic keeps the performer's URI only.
- Fixing the `AP-0002` / `AP-0003` shared-middleware coupling (tracked separately).
- The other push types.
