# Auto App Push Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/notifications/auto-app-pushes` validates the FE's auto-app-push payload, writes one Rails-compatible delivery CSV per edition, records the run in MySQL, and answers `201` with no body.

**Architecture:** One feature module `src/modules/auto-app-push/` split by responsibility — `schema.ts` (unknown keys), `validate.ts` (rules → `AP-xxxx` field errors, pure), `time.ts` (Asia/Tokyo helpers, pure), `csv.ts` (file content, pure), `service.ts` (orchestration + I/O), `router.ts` (HTTP) — plus a shared `requireApiToken` middleware. The clock and the file directory are injected through `createApp({ clock, fileDir })` so integration tests are deterministic.

**Tech Stack:** Express 5, zod (already present, not used by this feature), Prisma 7 + `@prisma/adapter-mariadb`, MySQL 8, Vitest + supertest, TypeScript 6 (ESM, `NodeNext`).

**Spec:** `docs/superpowers/specs/2026-09-22-auto-app-push-design.md`

## Global Constraints

- Relative imports end in `.js` (`import { env } from '../../lib/env.js'`) — `NodeNext`.
- `verbatimModuleSyntax`: types imported with `import type` or inline `type`. `erasableSyntaxOnly`: no `enum`, no `namespace`. No unused locals/params.
- Only `src/lib/env.ts` reads `process.env`. Only `src/lib/prisma.ts` calls `new PrismaClient()`.
- Business code throws `AppError` (`src/lib/errors.ts`); it never calls `res.status(4xx)` itself.
- Wire keys are `snake_case`; TypeScript identifiers are `camelCase`; Prisma fields `camelCase` with `@map` to `snake_case` columns.
- Every failure body is `{ error: { error_id, code, title, message, errors: [{ error_id, field, title, message }] } }`.
- All times are Asia/Tokyo, fixed `+09:00`. Database stores UTC.
- Tests: `yarn test` (needs `docker compose up -d`). Unit tests for pure modules must not touch the DB or the filesystem.
- Commit after every green step. Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Deviation from spec §4, agreed at plan time: `schema.ts` uses a plain function, not zod — zod's `.strict()` inside a union silently accepts unknown keys inside `editions[]`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/env.ts` (modify) | add `API_TOKEN` (required), `PUSH_FILE_DIR` (default `tmp/push_test`) |
| `src/lib/errors.ts` (modify) | `AppError` accepts `{ cause }` |
| `src/middleware/api-token.ts` (create) | `requireApiToken` — constant-time `X-APIToken` check → `401 AP-0002` |
| `src/middleware/error-handler.ts` (modify) | `express.json` parse failure → `400 AP-0003`; log `cause` on 5xx |
| `src/modules/auto-app-push/errors.ts` | `AP-xxxx` catalogue, `fieldError()`, `invalidParameter()`, `unauthorized()`, `invalidJson()`, `unknownParameters()`, `creationFailed()` |
| `src/modules/auto-app-push/time.ts` | `parseCalendarDate`, `todayInTokyo`, `tokyoDateTime`, `formatTokyoDate`, `formatTokyoDateTime` |
| `src/modules/auto-app-push/schema.ts` | `findUnknownKeys(body): string[]` |
| `src/modules/auto-app-push/validate.ts` | `validate(body, now): ValidationResult`, `SHOW_ID` |
| `src/modules/auto-app-push/csv.ts` | `buildDeliveryFile(edition, loginIds): DeliveryFile`, `reduceShowId` |
| `src/modules/auto-app-push/service.ts` | `createAutoAppPush(body, { now, fileDir }): Promise<{ runId }>` |
| `src/modules/auto-app-push/router.ts` | `createAutoAppPushRouter({ clock, fileDir })` |
| `src/app.ts` (modify) | `createApp({ clock?, fileDir? })`, mount middleware + router |
| `prisma/schema.prisma` (modify) | `PushRun`, `PushEdition` |
| `vitest.config.ts` (modify) | `test.env.API_TOKEN` |
| `.env.example`, `.gitignore`, `README.md`, `CLAUDE.md` (modify) | new variables, `tmp/`, module notes |

---

### Task 1: Env variables and the API-token middleware

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `vitest.config.ts`
- Create: `src/middleware/api-token.ts`
- Test: `src/middleware/api-token.test.ts`

**Interfaces:**
- Produces: `env.API_TOKEN: string`, `env.PUSH_FILE_DIR: string`, `requireApiToken: RequestHandler`.
- Consumes: `AppError` from `src/lib/errors.ts` (exists). `unauthorized()` is defined in Task 2; for this task the middleware builds the 401 inline and Task 2 swaps it.

- [ ] **Step 1: Add the variables to the env schema**

In `src/lib/env.ts`, inside `z.object({ ... })`, after `DATABASE_URL`:

```ts
  DATABASE_URL: z.url({ protocol: /^mysql$/ }),
  // Shared secret the FE sends as X-APIToken. Compared in constant time.
  API_TOKEN: z.string().min(1),
  // Where delivery CSV files are written, relative to the process cwd.
  PUSH_FILE_DIR: z.string().default('tmp/push_test'),
```

- [ ] **Step 2: Give the test runner and your local .env a token**

`vitest.config.ts` — add `env` under `test`:

```ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
    // Set before any test file is imported, so src/lib/env.ts sees them.
    env: {
      API_TOKEN: 'test-token',
    },
  },
})
```

Local `.env` (git-ignored, not committed): add a value for `API_TOKEN`. Without it `yarn dev` and `yarn test` now refuse to start — that is the fail-fast behaviour from `env.ts` doing its job.

Run: `yarn test`
Expected: the 4 existing health tests still pass.

- [ ] **Step 3: Write the failing middleware test**

`src/middleware/api-token.test.ts`:

```ts
/**
 * The middleware in isolation: a two-line Express app with one open route.
 * env.API_TOKEN is 'test-token' (vitest.config.ts).
 */
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { requireApiToken } from './api-token.js'
import { errorHandler } from './error-handler.js'

function appWithToken() {
  const app = express()
  app.use(requireApiToken)
  app.get('/', (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)
  return app
}

describe('requireApiToken', () => {
  it('lets a request with the right X-APIToken through', async () => {
    const res = await request(appWithToken()).get('/').set('X-APIToken', 'test-token')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('answers 401 AP-0002 when the header is missing', async () => {
    const res = await request(appWithToken()).get('/')

    expect(res.status).toBe(401)
    expect(res.body.error).toMatchObject({ error_id: 'AP-0002', code: 'UNAUTHORIZED', errors: [] })
  })

  it('answers 401 AP-0002 when the token is wrong', async () => {
    const res = await request(appWithToken()).get('/').set('X-APIToken', 'test-tokeN')

    expect(res.status).toBe(401)
    expect(res.body.error.error_id).toBe('AP-0002')
  })

  it('answers 401 AP-0002 when the token is empty', async () => {
    const res = await request(appWithToken()).get('/').set('X-APIToken', '')

    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `yarn test src/middleware/api-token.test.ts`
Expected: FAIL — `Cannot find module './api-token.js'`.

- [ ] **Step 5: Write the middleware**

`src/middleware/api-token.ts`:

```ts
/**
 * X-APIToken check for the notification endpoints.
 *
 * The token is a shared secret from env.API_TOKEN. The comparison is
 * constant-time (crypto.timingSafeEqual): a plain `===` returns as soon as the
 * first byte differs, and that timing difference is measurable enough to guess
 * a secret byte by byte. The length check before it is unavoidable — the
 * function throws on unequal lengths — and leaks only the length.
 *
 * /health stays open; app.ts mounts this on the API routers only.
 */
import { timingSafeEqual } from 'node:crypto'

import type { RequestHandler } from 'express'

import { env } from '../lib/env.js'
import { AppError } from '../lib/errors.js'

const unauthorized = () =>
  new AppError(401, {
    error_id: 'AP-0002',
    code: 'UNAUTHORIZED',
    title: 'Unauthorized',
    message: 'The X-APIToken header is missing or wrong. (AP-0002)',
  })

function tokenMatches(given: string | undefined): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(env.API_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const requireApiToken: RequestHandler = (req, _res, next) => {
  if (!tokenMatches(req.get('X-APIToken'))) {
    next(unauthorized())
    return
  }
  next()
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn test`
Expected: 8 passed (4 health + 4 token). Then `yarn typecheck && yarn lint` clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/env.ts vitest.config.ts src/middleware/api-token.ts src/middleware/api-token.test.ts
git commit -m "feat: API_TOKEN env and constant-time X-APIToken middleware

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: AP error catalogue, AppError cause, JSON-parse mapping

**Files:**
- Create: `src/modules/auto-app-push/errors.ts`
- Test: `src/modules/auto-app-push/errors.test.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/middleware/error-handler.ts`
- Modify: `src/middleware/api-token.ts` (use `unauthorized()` from the catalogue)
- Test: `src/middleware/error-handler.test.ts`

**Interfaces:**
- Produces:
  - `type FieldErrorId = 'AP-0101' | 'AP-0102' | 'AP-0103' | 'AP-0104' | 'AP-0201' | … | 'AP-0209'`
  - `fieldError(id: FieldErrorId, field: string): FieldError`
  - `invalidParameter(errors: FieldError[]): AppError` (422, `AP-0001`)
  - `unauthorized(): AppError` (401, `AP-0002`)
  - `invalidJson(): AppError` (400, `AP-0003`)
  - `unknownParameters(keys: string[]): AppError` (400, `AP-0004`, one `errors[]` entry per key)
  - `creationFailed(cause: unknown): AppError` (500, `AP-0005`)
  - `AppError` constructor: `new AppError(status, body, { cause })`.

- [ ] **Step 1: Write the failing catalogue test**

`src/modules/auto-app-push/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { AppError } from '../../lib/errors.js'
import {
  creationFailed,
  fieldError,
  invalidJson,
  invalidParameter,
  unauthorized,
  unknownParameters,
} from './errors.js'

describe('fieldError', () => {
  it('builds an entry with the contract wording and the id appended', () => {
    expect(fieldError('AP-0201', 'editions[0].deliv_id')).toEqual({
      error_id: 'AP-0201',
      field: 'editions[0].deliv_id',
      title: 'Invalid parameter',
      message: 'deliv_id is required (AP-0201)',
    })
  })
})

describe('envelope builders', () => {
  it('invalidParameter is a 422 AP-0001 carrying the field errors', () => {
    const err = invalidParameter([fieldError('AP-0102', 'login_ids')])

    expect(err).toBeInstanceOf(AppError)
    expect(err.status).toBe(422)
    expect(err.body).toMatchObject({ error_id: 'AP-0001', code: 'INVALID_PARAMETER' })
    expect(err.body.errors).toHaveLength(1)
    expect(err.body.errors[0]?.error_id).toBe('AP-0102')
  })

  it('unauthorized is a 401 AP-0002', () => {
    expect(unauthorized()).toMatchObject({ status: 401, body: { error_id: 'AP-0002', code: 'UNAUTHORIZED', errors: [] } })
  })

  it('invalidJson is a 400 AP-0003', () => {
    expect(invalidJson()).toMatchObject({ status: 400, body: { error_id: 'AP-0003', code: 'INVALID_PARAMETER' } })
  })

  it('unknownParameters is a 400 AP-0004 with one entry per key', () => {
    const err = unknownParameters(['foo', 'editions[1].bar'])

    expect(err.status).toBe(400)
    expect(err.body.error_id).toBe('AP-0004')
    expect(err.body.errors).toEqual([
      { error_id: 'AP-0004', field: 'foo', title: 'Invalid parameter', message: 'foo is not a known parameter (AP-0004)' },
      { error_id: 'AP-0004', field: 'editions[1].bar', title: 'Invalid parameter', message: 'editions[1].bar is not a known parameter (AP-0004)' },
    ])
  })

  it('creationFailed is a 500 AP-0005 that keeps the cause', () => {
    const cause = new Error('disk full')
    const err = creationFailed(cause)

    expect(err.status).toBe(500)
    expect(err.body).toMatchObject({ error_id: 'AP-0005', code: 'INTERNAL_ERROR' })
    expect(err.cause).toBe(cause)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test src/modules/auto-app-push/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Let AppError carry a cause**

`src/lib/errors.ts` — replace the constructor:

```ts
  constructor(
    status: number,
    body: Omit<ErrorBody, 'errors'> & { errors?: FieldError[] },
    options?: { cause?: unknown },
  ) {
    super(body.message, options)
    this.name = 'AppError'
    this.status = status
    this.body = { ...body, errors: body.errors ?? [] }
  }
```

(`ErrorOptions.cause` exists in `lib: ["ES2022"]`, which `tsconfig.json` already sets.)

- [ ] **Step 4: Write the catalogue**

`src/modules/auto-app-push/errors.ts`:

```ts
/**
 * The AP-xxxx ids for POST /api/notifications/auto-app-pushes.
 *
 * Ids and the shape come from the contract in
 * fe-push-notification-tool/docs/API-DOC-auto-app-push.md. The FE keys its own
 * wording off error_id, so the ids are stable and the message text is not a
 * contract — but the text still follows the contract's pattern:
 * "<what is wrong> (<id>)".
 */
import { AppError, type FieldError } from '../../lib/errors.js'

/** Ids that point at one field and appear inside `errors[]`. */
export type FieldErrorId =
  | 'AP-0101'
  | 'AP-0102'
  | 'AP-0103'
  | 'AP-0104'
  | 'AP-0201'
  | 'AP-0202'
  | 'AP-0203'
  | 'AP-0204'
  | 'AP-0205'
  | 'AP-0206'
  | 'AP-0207'
  | 'AP-0208'
  | 'AP-0209'

const FIELD_MESSAGE: Record<FieldErrorId, string> = {
  'AP-0101': 'date must be YYYY-MM-DD',
  'AP-0102': 'login_ids must be a non-empty list of strings',
  'AP-0103': 'editions must be a non-empty list',
  'AP-0104': 'distribute_now must be true or false',
  'AP-0201': 'deliv_id is required',
  'AP-0202': 'deliv_id must be 24 characters or fewer',
  'AP-0203': 'title is required',
  'AP-0204': 'link_item is required',
  'AP-0205': 'link_type must be one of 01, 02, 03',
  'AP-0206': 'link_item must be a show id when link_type is 01',
  'AP-0207': 'publish_hour_min must be [hour, minute] with hour 0-23 and minute 0-59',
  'AP-0208': 'publish_hour_min must be no more than 2 hours ahead of now',
  'AP-0209': 'publish_hour_min must be between 08:00 and 22:00',
}

const TITLE = 'Invalid parameter'

export function fieldError(id: FieldErrorId, field: string): FieldError {
  return { error_id: id, field, title: TITLE, message: `${FIELD_MESSAGE[id]} (${id})` }
}

/** 422 — the body was readable but some values break the rules. */
export const invalidParameter = (errors: FieldError[]) =>
  new AppError(422, {
    error_id: 'AP-0001',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'Some of the request parameters are wrong. See errors for each field. (AP-0001)',
    errors,
  })

/** 401 — X-APIToken missing or wrong. */
export const unauthorized = () =>
  new AppError(401, {
    error_id: 'AP-0002',
    code: 'UNAUTHORIZED',
    title: 'Unauthorized',
    message: 'The X-APIToken header is missing or wrong. (AP-0002)',
  })

/** 400 — the body is not JSON at all. */
export const invalidJson = () =>
  new AppError(400, {
    error_id: 'AP-0003',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'The request body is not valid JSON. (AP-0003)',
  })

/** 400 — a key this endpoint does not know. Extra keys are rejected, not ignored. */
export const unknownParameters = (keys: string[]) =>
  new AppError(400, {
    error_id: 'AP-0004',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'The request has parameters this endpoint does not know. (AP-0004)',
    errors: keys.map((key) => ({
      error_id: 'AP-0004',
      field: key,
      title: TITLE,
      message: `${key} is not a known parameter (AP-0004)`,
    })),
  })

/** 500 — validation passed but the file or the database write failed. */
export const creationFailed = (cause: unknown) =>
  new AppError(
    500,
    {
      error_id: 'AP-0005',
      code: 'INTERNAL_ERROR',
      title: 'Internal error',
      message: 'The request was valid but the push could not be created. (AP-0005)',
    },
    { cause },
  )
```

- [ ] **Step 5: Run the catalogue test to verify it passes**

Run: `yarn test src/modules/auto-app-push/errors.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Point the middleware at the catalogue**

`src/middleware/api-token.ts` — delete the local `unauthorized` const and the `AppError` import; import instead:

```ts
import { env } from '../lib/env.js'
import { unauthorized } from '../modules/auto-app-push/errors.js'
```

Run: `yarn test src/middleware/api-token.test.ts` — still 4 passed.

- [ ] **Step 7: Write the failing error-handler test**

`src/middleware/error-handler.test.ts`:

```ts
/**
 * The error handler's two new behaviours: express.json's parse failure
 * becomes 400 AP-0003, and an AppError's cause is what gets logged (checked
 * indirectly: the response must not leak it).
 */
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { creationFailed } from '../modules/auto-app-push/errors.js'
import { errorHandler } from './error-handler.js'

function app() {
  const a = express()
  a.use(express.json())
  a.post('/echo', (req, res) => {
    res.json(req.body)
  })
  a.get('/boom', () => {
    throw creationFailed(new Error('disk full'))
  })
  a.use(errorHandler)
  return a
}

describe('errorHandler', () => {
  it('turns a body that is not JSON into 400 AP-0003', async () => {
    const res = await request(app()).post('/echo').set('Content-Type', 'application/json').send('{not json')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ error_id: 'AP-0003', code: 'INVALID_PARAMETER', errors: [] })
  })

  it('answers an AppError with its own status and body, without the cause', async () => {
    const res = await request(app()).get('/boom')

    expect(res.status).toBe(500)
    expect(res.body.error.error_id).toBe('AP-0005')
    expect(JSON.stringify(res.body)).not.toContain('disk full')
  })
})
```

- [ ] **Step 8: Run it to verify it fails**

Run: `yarn test src/middleware/error-handler.test.ts`
Expected: first test FAILS — status 400 but body is `{ error: { error_id: 'CM-0500' … } }` (or similar; today a parse error is "unexpected") — the assertion on `AP-0003` fails. Second test passes already.

- [ ] **Step 9: Map the parse error and log the cause**

`src/middleware/error-handler.ts` — replace the `errorHandler` export:

```ts
/**
 * express.json() rejects a body it cannot parse with an error tagged
 * `type: 'entity.parse.failed'` (from the body-parser package). It is the one
 * framework error with a contract-defined answer: 400 AP-0003.
 */
const isJsonParseError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.parse.failed'

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }

  const appError = err instanceof AppError ? err : isJsonParseError(err) ? invalidJson() : null

  if (appError) {
    // Expected: something the app chose to raise. 4xx is the client's problem
    // and is logged quietly; 5xx is ours, logged as an error with its cause.
    const fields = { req_id: req.id, status: appError.status, error_id: appError.body.error_id }
    if (appError.status >= 500) logger.error({ ...fields, err: appError.cause ?? appError }, appError.message)
    else logger.info(fields, appError.message)
    res.status(appError.status).json(appError.toJSON())
    return
  }

  logger.error({ req_id: req.id, err }, 'unhandled error')
  const fallback = internalError()
  res.status(fallback.status).json(fallback.toJSON())
}
```

Add the import at the top of the file:

```ts
import { invalidJson } from '../modules/auto-app-push/errors.js'
```

- [ ] **Step 10: Run all tests, typecheck, lint**

Run: `yarn test && yarn typecheck && yarn lint`
Expected: 14 passed; clean.

- [ ] **Step 11: Commit**

```bash
git add src/lib/errors.ts src/middleware src/modules/auto-app-push/errors.ts src/modules/auto-app-push/errors.test.ts
git commit -m "feat: AP-xxxx error catalogue; AppError cause; JSON parse -> 400 AP-0003

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Tokyo time helpers

**Files:**
- Create: `src/modules/auto-app-push/time.ts`
- Test: `src/modules/auto-app-push/time.test.ts`

**Interfaces:**
- Produces:
  - `parseCalendarDate(s: string): { year: number; month: number; day: number } | null`
  - `todayInTokyo(now: Date): string` — `'YYYY-MM-DD'`
  - `tokyoDateTime(date: string, hour: number, minute: number): Date` — the instant; throws on a bad `date`
  - `formatTokyoDate(instant: Date): string` — `'YYYYMMDD'`
  - `formatTokyoDateTime(instant: Date): string` — `'YYYYMMDDHHMMSS'`

- [ ] **Step 1: Write the failing tests**

`src/modules/auto-app-push/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { formatTokyoDate, formatTokyoDateTime, parseCalendarDate, todayInTokyo, tokyoDateTime } from './time.js'

describe('parseCalendarDate', () => {
  it('accepts a real YYYY-MM-DD', () => {
    expect(parseCalendarDate('2026-09-22')).toEqual({ year: 2026, month: 9, day: 22 })
  })

  it('rejects a date that does not exist', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull()
  })

  it('rejects other shapes', () => {
    expect(parseCalendarDate('2026-9-2')).toBeNull()
    expect(parseCalendarDate('22/09/2026')).toBeNull()
    expect(parseCalendarDate('2026-09-22T00:00:00Z')).toBeNull()
    expect(parseCalendarDate('')).toBeNull()
  })
})

describe('tokyoDateTime', () => {
  it('turns a Tokyo wall-clock time into the UTC instant 9 hours earlier', () => {
    expect(tokyoDateTime('2026-09-22', 10, 30).toISOString()).toBe('2026-09-22T01:30:00.000Z')
  })

  it('crosses midnight UTC correctly', () => {
    expect(tokyoDateTime('2026-09-22', 8, 0).toISOString()).toBe('2026-09-21T23:00:00.000Z')
  })

  it('throws on a date that is not a calendar date', () => {
    expect(() => tokyoDateTime('2026-02-30', 10, 0)).toThrow()
  })
})

describe('todayInTokyo', () => {
  it('is already tomorrow in Tokyo at 15:00 UTC', () => {
    expect(todayInTokyo(new Date('2026-09-21T15:00:00Z'))).toBe('2026-09-22')
  })

  it('is still today in Tokyo at 14:59:59 UTC', () => {
    expect(todayInTokyo(new Date('2026-09-21T14:59:59Z'))).toBe('2026-09-21')
  })
})

describe('formatting', () => {
  const instant = new Date('2026-09-21T15:30:05Z') // 00:30:05 on the 22nd in Tokyo

  it('formatTokyoDate gives YYYYMMDD in Tokyo', () => {
    expect(formatTokyoDate(instant)).toBe('20260922')
  })

  it('formatTokyoDateTime gives YYYYMMDDHHMMSS in Tokyo', () => {
    expect(formatTokyoDateTime(instant)).toBe('20260922003005')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test src/modules/auto-app-push/time.test.ts`
Expected: FAIL — `Cannot find module './time.js'`.

- [ ] **Step 3: Write the helpers**

`src/modules/auto-app-push/time.ts`:

```ts
/**
 * Asia/Tokyo without a timezone library.
 *
 * Japan has no daylight-saving time, so Tokyo is always UTC+9. That turns
 * every conversion into "shift by nine hours and read the UTC fields", which
 * is exact and needs no tz database. The FE does the same (todayInTokyo,
 * tokyoEpoch in fe-push-notification-tool/src/lib/types.ts).
 *
 * Everything returned as a Date is a real instant (UTC inside); everything
 * returned as a string is Tokyo wall-clock time.
 */

const OFFSET_MS = 9 * 60 * 60 * 1000

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
}

/** Strict YYYY-MM-DD that also exists on the calendar (no 2026-02-30). */
export function parseCalendarDate(s: string): CalendarDate | null {
  const m = DATE_RE.exec(s)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  // Date.UTC normalises overflow (Feb 30 -> Mar 2); reading the fields back
  // tells us whether anything moved.
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return { year, month, day }
}

/** A Date whose UTC fields read as Tokyo wall-clock time for `instant`. */
const asTokyoWallClock = (instant: Date): Date => new Date(instant.getTime() + OFFSET_MS)

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The instant at `hour:minute` Tokyo time on `date` (YYYY-MM-DD). */
export function tokyoDateTime(date: string, hour: number, minute: number): Date {
  const d = parseCalendarDate(date)
  if (!d) throw new Error(`not a calendar date: ${date}`)
  return new Date(Date.UTC(d.year, d.month - 1, d.day, hour, minute) - OFFSET_MS)
}

/** Today's date in Tokyo as YYYY-MM-DD. */
export function todayInTokyo(now: Date): string {
  const w = asTokyoWallClock(now)
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}`
}

/** YYYYMMDD in Tokyo — the delivery-file directory name. */
export function formatTokyoDate(instant: Date): string {
  const w = asTokyoWallClock(instant)
  return `${w.getUTCFullYear()}${pad2(w.getUTCMonth() + 1)}${pad2(w.getUTCDate())}`
}

/** YYYYMMDDHHMMSS in Tokyo — the delivery-file name prefix. */
export function formatTokyoDateTime(instant: Date): string {
  const w = asTokyoWallClock(instant)
  return `${formatTokyoDate(instant)}${pad2(w.getUTCHours())}${pad2(w.getUTCMinutes())}${pad2(w.getUTCSeconds())}`
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test src/modules/auto-app-push/time.test.ts`
Expected: 10 passed. `yarn typecheck && yarn lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auto-app-push/time.ts src/modules/auto-app-push/time.test.ts
git commit -m "feat(auto-app-push): Asia/Tokyo time helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Unknown-key detection

**Files:**
- Create: `src/modules/auto-app-push/schema.ts`
- Test: `src/modules/auto-app-push/schema.test.ts`

**Interfaces:**
- Produces: `findUnknownKeys(body: unknown): string[]` — dotted paths, in document order; `[]` when clean or when `body` is not an object.

- [ ] **Step 1: Write the failing tests**

`src/modules/auto-app-push/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { findUnknownKeys } from './schema.js'

const edition = { publish_hour_min: [11, 0], deliv_id: 'D1', title: 't', link_type: '03', link_item: 'https://eplus.jp/' }

describe('findUnknownKeys', () => {
  it('returns [] for a body with only the documented keys', () => {
    expect(findUnknownKeys({ date: '2026-09-22', login_ids: ['1'], editions: [edition], distribute_now: false })).toEqual([])
  })

  it('reports a top-level key it does not know', () => {
    expect(findUnknownKeys({ login_ids: ['1'], editions: [edition], id: 7 })).toEqual(['id'])
  })

  it('reports a key inside an edition with its index', () => {
    expect(findUnknownKeys({ login_ids: ['1'], editions: [edition, { ...edition, sub_type: 'x' }] })).toEqual(['editions[1].sub_type'])
  })

  it('reports several keys in document order', () => {
    expect(findUnknownKeys({ foo: 1, editions: [{ ...edition, bar: 2 }], baz: 3 })).toEqual(['foo', 'baz', 'editions[0].bar'])
  })

  it('returns [] when the body is not an object (validate reports that)', () => {
    expect(findUnknownKeys(null)).toEqual([])
    expect(findUnknownKeys([1, 2])).toEqual([])
    expect(findUnknownKeys('x')).toEqual([])
  })

  it('ignores editions that are not objects (validate reports those)', () => {
    expect(findUnknownKeys({ editions: [1, 'x', null] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test src/modules/auto-app-push/schema.test.ts`
Expected: FAIL — `Cannot find module './schema.js'`.

- [ ] **Step 3: Write the function**

`src/modules/auto-app-push/schema.ts`:

```ts
/**
 * The key set of the request body — and nothing else.
 *
 * The contract rejects a parameter it does not know (400 AP-0004) rather than
 * ignoring it, so a stale UI-only field or a typo is caught. This module only
 * answers "which keys are not documented?"; types and values are validate.ts's
 * job. It is a plain function rather than a zod schema on purpose: zod's
 * .strict() inside a union quietly accepts unknown keys in nested arrays.
 */

const TOP_LEVEL_KEYS = new Set(['date', 'login_ids', 'editions', 'distribute_now'])
const EDITION_KEYS = new Set(['publish_hour_min', 'deliv_id', 'title', 'link_type', 'link_item'])

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Dotted paths of keys the endpoint does not know, top level first. */
export function findUnknownKeys(body: unknown): string[] {
  if (!isRecord(body)) return []

  const unknown = Object.keys(body).filter((k) => !TOP_LEVEL_KEYS.has(k))

  if (Array.isArray(body.editions)) {
    body.editions.forEach((edition, i) => {
      if (!isRecord(edition)) return
      for (const k of Object.keys(edition)) {
        if (!EDITION_KEYS.has(k)) unknown.push(`editions[${i}].${k}`)
      }
    })
  }

  return unknown
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test src/modules/auto-app-push/schema.test.ts`
Expected: 6 passed. `yarn typecheck && yarn lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auto-app-push/schema.ts src/modules/auto-app-push/schema.test.ts
git commit -m "feat(auto-app-push): report unknown request keys

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Validation — top-level rules

**Files:**
- Create: `src/modules/auto-app-push/validate.ts`
- Test: `src/modules/auto-app-push/validate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LinkType = '01' | '02' | '03'
  export interface ValidEdition { hour: number; minute: number; delivId: string; title: string; linkType: LinkType; linkItem: string; publishAt: Date }
  export interface ValidInput { date: string; loginIds: string[]; distributeNow: boolean; editions: ValidEdition[] }
  export type ValidationResult = { ok: true; value: ValidInput } | { ok: false; errors: FieldError[] }
  export const SHOW_ID: RegExp
  export function validate(body: unknown, now: Date): ValidationResult
  ```
- Consumes: `fieldError` (Task 2), `parseCalendarDate`, `todayInTokyo`, `tokyoDateTime` (Task 3).

In this task the edition rules are a stub that accepts any edition object; Task 6 fills them in.

- [ ] **Step 1: Write the failing tests**

`src/modules/auto-app-push/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { validate } from './validate.js'

// 10:00 on 2026-09-22 in Tokyo. Every edition time below is relative to this.
const NOW = new Date('2026-09-22T01:00:00Z')

const edition = {
  publish_hour_min: [11, 0],
  deliv_id: 'H020064377',
  title: 'イープラスのWEBページへ遷移します。',
  link_type: '03',
  link_item: 'https://eplus.jp/',
}

const body = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-09-22',
  login_ids: ['502001185', '602028303'],
  editions: [edition],
  distribute_now: false,
  ...overrides,
})

/** The ids in errors[], in order — what most assertions care about. */
const idsOf = (r: ReturnType<typeof validate>) => (r.ok ? [] : r.errors.map((e) => `${e.error_id} ${e.field}`))

describe('validate: a good body', () => {
  it('is ok and returns the normalised input', () => {
    const r = validate(body(), NOW)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.date).toBe('2026-09-22')
    expect(r.value.loginIds).toEqual(['502001185', '602028303'])
    expect(r.value.distributeNow).toBe(false)
    expect(r.value.editions).toHaveLength(1)
  })

  it('defaults date to today in Tokyo when omitted', () => {
    const { date: _drop, ...noDate } = body()
    const r = validate(noDate, NOW)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.date).toBe('2026-09-22')
  })

  it('defaults distribute_now to false when omitted', () => {
    const { distribute_now: _drop, ...noFlag } = body()
    const r = validate(noFlag, NOW)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.distributeNow).toBe(false)
  })
})

describe('validate: date (AP-0101)', () => {
  it('rejects a malformed date', () => {
    expect(idsOf(validate(body({ date: '22/09/2026' }), NOW))).toEqual(['AP-0101 date'])
  })

  it('rejects a non-string date', () => {
    expect(idsOf(validate(body({ date: 20260922 }), NOW))).toEqual(['AP-0101 date'])
  })

  it('does not check editions when the date is unusable', () => {
    const r = validate(body({ date: 'nope', editions: [{ ...edition, deliv_id: '' }] }), NOW)

    expect(idsOf(r)).toEqual(['AP-0101 date'])
  })
})

describe('validate: login_ids (AP-0102)', () => {
  it.each([
    ['missing', undefined],
    ['empty', []],
    ['not an array', '502001185'],
    ['an element is not a string', ['502001185', 502001222]],
    ['an element is blank', ['502001185', ' ']],
  ])('rejects login_ids that are %s', (_label, value) => {
    const b = value === undefined ? (({ login_ids: _l, ...rest }) => rest)(body()) : body({ login_ids: value })

    expect(idsOf(validate(b, NOW))).toEqual(['AP-0102 login_ids'])
  })
})

describe('validate: editions (AP-0103)', () => {
  it.each([
    ['missing', undefined],
    ['empty', []],
    ['not an array', edition],
  ])('rejects editions that are %s', (_label, value) => {
    const b = value === undefined ? (({ editions: _e, ...rest }) => rest)(body()) : body({ editions: value })

    expect(idsOf(validate(b, NOW))).toEqual(['AP-0103 editions'])
  })
})

describe('validate: distribute_now (AP-0104)', () => {
  it('rejects a non-boolean', () => {
    expect(idsOf(validate(body({ distribute_now: 'true' }), NOW))).toEqual(['AP-0104 distribute_now'])
  })
})

describe('validate: everything at once', () => {
  it('reports every top-level problem in one result', () => {
    const r = validate({ date: 'x', login_ids: [], distribute_now: 1 }, NOW)

    expect(idsOf(r)).toEqual(['AP-0101 date', 'AP-0102 login_ids', 'AP-0104 distribute_now', 'AP-0103 editions'])
  })

  it('treats a body that is not an object as empty', () => {
    expect(idsOf(validate(null, NOW))).toEqual(['AP-0102 login_ids', 'AP-0103 editions'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test src/modules/auto-app-push/validate.test.ts`
Expected: FAIL — `Cannot find module './validate.js'`.

- [ ] **Step 3: Write validate.ts with the top-level rules and a stub edition check**

`src/modules/auto-app-push/validate.ts`:

```ts
/**
 * The rule table from the design spec (§2), as one pure function.
 *
 * validate() never throws and never touches I/O or the clock — `now` comes in
 * as a parameter, which is what makes the timing rules testable. It reports
 * every problem it can find in one pass, so the tester fixes a form once, not
 * one field per round trip. When `date` is unusable the editions are skipped:
 * their delivery times cannot be computed without it.
 *
 * On success it returns the normalised input (trimmed strings, resolved
 * defaults, publishAt as an instant) so the service never re-parses the body.
 */
import type { FieldError } from '../../lib/errors.js'
import { fieldError } from './errors.js'
import { parseCalendarDate, todayInTokyo, tokyoDateTime } from './time.js'

export type LinkType = '01' | '02' | '03'

export interface ValidEdition {
  hour: number
  minute: number
  delivId: string
  title: string
  linkType: LinkType
  linkItem: string
  /** The delivery instant: `date` + hour:minute in Asia/Tokyo. */
  publishAt: Date
}

export interface ValidInput {
  /** YYYY-MM-DD, Tokyo. */
  date: string
  loginIds: string[]
  distributeNow: boolean
  editions: ValidEdition[]
}

export type ValidationResult = { ok: true; value: ValidInput } | { ok: false; errors: FieldError[] }

/**
 * A show id: 6-digit kogyo code, more digits, "-P003", 4-digit kogyo sub code.
 * `9041480001-P0030001P021001` -> groups `904148` and `0001`. Same regex as the
 * FE's shortShowId.
 */
export const SHOW_ID = /^(\d{6})\d*-P003(\d{4})/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

export function validate(body: unknown, now: Date): ValidationResult {
  const b = isRecord(body) ? body : {}
  const errors: FieldError[] = []

  // date — optional, defaults to today in Tokyo.
  let date: string | null
  if (b.date === undefined) {
    date = todayInTokyo(now)
  } else if (typeof b.date === 'string' && parseCalendarDate(b.date)) {
    date = b.date
  } else {
    date = null
    errors.push(fieldError('AP-0101', 'date'))
  }

  // login_ids — non-empty list of non-blank strings.
  const loginIds =
    Array.isArray(b.login_ids) && b.login_ids.length > 0 && b.login_ids.every(isNonEmptyString) ? b.login_ids : null
  if (loginIds === null) errors.push(fieldError('AP-0102', 'login_ids'))

  // distribute_now — optional boolean.
  let distributeNow = false
  if (b.distribute_now !== undefined) {
    if (typeof b.distribute_now === 'boolean') distributeNow = b.distribute_now
    else errors.push(fieldError('AP-0104', 'distribute_now'))
  }

  // editions — non-empty list; each entry checked only when the date is usable.
  const rawEditions = Array.isArray(b.editions) && b.editions.length > 0 ? b.editions : null
  if (rawEditions === null) errors.push(fieldError('AP-0103', 'editions'))

  const editions: ValidEdition[] = []
  if (rawEditions !== null && date !== null) {
    rawEditions.forEach((raw, index) => {
      const r = validateEdition(raw, index, date, now)
      if (r.ok) editions.push(r.value)
      else errors.push(...r.errors)
    })
  }

  if (errors.length > 0 || date === null || loginIds === null) return { ok: false, errors }
  return { ok: true, value: { date, loginIds, distributeNow, editions } }
}

type EditionResult = { ok: true; value: ValidEdition } | { ok: false; errors: FieldError[] }

// Task 6 replaces this stub with the AP-02xx rules.
function validateEdition(raw: unknown, _index: number, date: string, _now: Date): EditionResult {
  const e = isRecord(raw) ? raw : {}
  const [hour, minute] = e.publish_hour_min as [number, number]
  return {
    ok: true,
    value: {
      hour,
      minute,
      delivId: String(e.deliv_id),
      title: String(e.title),
      linkType: e.link_type as LinkType,
      linkItem: String(e.link_item),
      publishAt: tokyoDateTime(date, hour, minute),
    },
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test src/modules/auto-app-push/validate.test.ts`
Expected: 17 passed. `yarn typecheck && yarn lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auto-app-push/validate.ts src/modules/auto-app-push/validate.test.ts
git commit -m "feat(auto-app-push): validate top-level fields (AP-0101..0104)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Validation — edition rules

**Files:**
- Modify: `src/modules/auto-app-push/validate.ts` (replace `validateEdition`)
- Modify: `src/modules/auto-app-push/validate.test.ts` (append)

**Interfaces:** unchanged from Task 5.

- [ ] **Step 1: Append the failing tests**

Append to `src/modules/auto-app-push/validate.test.ts`:

```ts
describe('validate: edition strings (AP-0201..0205)', () => {
  const withEdition = (patch: Record<string, unknown>) => body({ editions: [{ ...edition, ...patch }] })

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['not a string', 123],
  ])('AP-0201 when deliv_id is %s', (_label, value) => {
    const e: Record<string, unknown> = { ...edition }
    if (value === undefined) delete e.deliv_id
    else e.deliv_id = value

    expect(idsOf(validate(body({ editions: [e] }), NOW))).toEqual(['AP-0201 editions[0].deliv_id'])
  })

  it('AP-0202 when deliv_id is longer than 24 characters', () => {
    expect(idsOf(validate(withEdition({ deliv_id: 'A'.repeat(25) }), NOW))).toEqual(['AP-0202 editions[0].deliv_id'])
  })

  it('accepts a deliv_id of exactly 24 characters', () => {
    expect(validate(withEdition({ deliv_id: 'A'.repeat(24) }), NOW).ok).toBe(true)
  })

  it('AP-0203 when title is blank', () => {
    expect(idsOf(validate(withEdition({ title: '' }), NOW))).toEqual(['AP-0203 editions[0].title'])
  })

  it('AP-0204 when link_item is blank', () => {
    expect(idsOf(validate(withEdition({ link_item: '' }), NOW))).toEqual(['AP-0204 editions[0].link_item'])
  })

  it('AP-0205 when link_type is not 01, 02 or 03', () => {
    expect(idsOf(validate(withEdition({ link_type: '04' }), NOW))).toEqual(['AP-0205 editions[0].link_type'])
    expect(idsOf(validate(withEdition({ link_type: 1 }), NOW))).toEqual(['AP-0205 editions[0].link_type'])
  })

  it('AP-0206 when link_type is 01 and link_item is not a show id', () => {
    expect(idsOf(validate(withEdition({ link_type: '01', link_item: '904148' }), NOW))).toEqual(['AP-0206 editions[0].link_item'])
  })

  it('accepts a show id for link_type 01', () => {
    expect(validate(withEdition({ link_type: '01', link_item: '9041480001-P0030001P021001' }), NOW).ok).toBe(true)
  })

  it('does not apply the show-id rule to link_type 02', () => {
    expect(validate(withEdition({ link_type: '02', link_item: '23542' }), NOW).ok).toBe(true)
  })

  it('trims deliv_id, title and link_item in the result', () => {
    const r = validate(withEdition({ deliv_id: ' D1 ', title: ' t ', link_item: ' https://eplus.jp/ ' }), NOW)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.editions[0]).toMatchObject({ delivId: 'D1', title: 't', linkItem: 'https://eplus.jp/' })
  })
})

describe('validate: publish_hour_min (AP-0207..0209)', () => {
  const at = (hm: unknown) => body({ editions: [{ ...edition, publish_hour_min: hm }] })

  it.each([
    ['missing', undefined],
    ['not an array', '11:00'],
    ['wrong length', [11]],
    ['not integers', [11.5, 0]],
    ['hour out of range', [24, 0]],
    ['minute out of range', [11, 60]],
    ['negative', [-1, 0]],
  ])('AP-0207 when publish_hour_min is %s', (_label, value) => {
    const e: Record<string, unknown> = { ...edition }
    if (value === undefined) delete e.publish_hour_min
    else e.publish_hour_min = value

    expect(idsOf(validate(body({ editions: [e] }), NOW))).toEqual(['AP-0207 editions[0].publish_hour_min'])
  })

  it('AP-0208 when the time is more than 2 hours after now', () => {
    // NOW is 10:00 Tokyo; 12:01 is 2h01m ahead.
    expect(idsOf(validate(at([12, 1]), NOW))).toEqual(['AP-0208 editions[0].publish_hour_min'])
  })

  it('accepts exactly 2 hours ahead', () => {
    expect(validate(at([12, 0]), NOW).ok).toBe(true)
  })

  it('accepts a time in the past', () => {
    expect(validate(at([9, 0]), NOW).ok).toBe(true)
  })

  it('AP-0209 before 08:00', () => {
    expect(idsOf(validate(at([7, 59]), NOW))).toEqual(['AP-0209 editions[0].publish_hour_min'])
  })

  it('accepts 08:00 and 22:00 (both ends inclusive)', () => {
    const morning = new Date('2026-09-21T22:00:00Z') // 07:00 Tokyo
    expect(validate(at([8, 0]), morning).ok).toBe(true)
    const evening = new Date('2026-09-22T12:00:00Z') // 21:00 Tokyo
    expect(validate(at([22, 0]), evening).ok).toBe(true)
  })

  it('AP-0209 after 22:00 (and AP-0208 too when it is also too far ahead)', () => {
    const evening = new Date('2026-09-22T12:00:00Z') // 21:00 Tokyo
    expect(idsOf(validate(at([22, 1]), evening))).toEqual(['AP-0209 editions[0].publish_hour_min'])
    expect(idsOf(validate(at([23, 30]), evening))).toEqual([
      'AP-0208 editions[0].publish_hour_min',
      'AP-0209 editions[0].publish_hour_min',
    ])
  })

  it('computes publishAt as the Tokyo instant', () => {
    const r = validate(at([11, 30]), NOW)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.editions[0]?.publishAt.toISOString()).toBe('2026-09-22T02:30:00.000Z')
  })
})

describe('validate: several editions', () => {
  it('reports problems from every edition with the right index', () => {
    const r = validate(body({ editions: [{ ...edition, deliv_id: '' }, edition, { ...edition, link_type: 'x' }] }), NOW)

    expect(idsOf(r)).toEqual(['AP-0201 editions[0].deliv_id', 'AP-0205 editions[2].link_type'])
  })

  it('reports several problems on one edition', () => {
    const r = validate(body({ editions: [{ ...edition, deliv_id: '', title: '' }] }), NOW)

    expect(idsOf(r)).toEqual(['AP-0201 editions[0].deliv_id', 'AP-0203 editions[0].title'])
  })

  it('accepts a repeated deliv_id (the contract treats it as the same delivery)', () => {
    expect(validate(body({ editions: [edition, edition] }), NOW).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `yarn test src/modules/auto-app-push/validate.test.ts`
Expected: most new tests FAIL (the stub accepts everything; several throw inside the stub on a missing `publish_hour_min`). The Task 5 tests still pass.

- [ ] **Step 3: Replace the stub**

In `src/modules/auto-app-push/validate.ts`, replace everything from `type EditionResult` to the end of the file with:

```ts
type EditionResult = { ok: true; value: ValidEdition } | { ok: false; errors: FieldError[] }

const LINK_TYPES: readonly string[] = ['01', '02', '03']
const DELIV_ID_MAX = 24
const MAX_AHEAD_MS = 2 * 60 * 60 * 1000
const WINDOW_START_MIN = 8 * 60 // 08:00
const WINDOW_END_MIN = 22 * 60 // 22:00, inclusive

const isHourMin = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  Number.isInteger(v[0]) &&
  Number.isInteger(v[1]) &&
  v[0] >= 0 &&
  v[0] <= 23 &&
  v[1] >= 0 &&
  v[1] <= 59

function validateEdition(raw: unknown, index: number, date: string, now: Date): EditionResult {
  const e = isRecord(raw) ? raw : {}
  const field = (key: string) => `editions[${index}].${key}`
  const errors: FieldError[] = []

  const delivId = isNonEmptyString(e.deliv_id) ? e.deliv_id.trim() : null
  if (delivId === null) errors.push(fieldError('AP-0201', field('deliv_id')))
  else if (delivId.length > DELIV_ID_MAX) errors.push(fieldError('AP-0202', field('deliv_id')))

  const title = isNonEmptyString(e.title) ? e.title.trim() : null
  if (title === null) errors.push(fieldError('AP-0203', field('title')))

  const linkType = typeof e.link_type === 'string' && LINK_TYPES.includes(e.link_type) ? (e.link_type as LinkType) : null
  if (linkType === null) errors.push(fieldError('AP-0205', field('link_type')))

  const linkItem = isNonEmptyString(e.link_item) ? e.link_item.trim() : null
  if (linkItem === null) errors.push(fieldError('AP-0204', field('link_item')))
  else if (linkType === '01' && !SHOW_ID.test(linkItem)) errors.push(fieldError('AP-0206', field('link_item')))

  // Timing rules only make sense once the pair itself is well-formed.
  let publishAt: Date | null = null
  let hour = 0
  let minute = 0
  if (!isHourMin(e.publish_hour_min)) {
    errors.push(fieldError('AP-0207', field('publish_hour_min')))
  } else {
    ;[hour, minute] = e.publish_hour_min
    publishAt = tokyoDateTime(date, hour, minute)
    if (publishAt.getTime() - now.getTime() > MAX_AHEAD_MS) errors.push(fieldError('AP-0208', field('publish_hour_min')))
    const minutesOfDay = hour * 60 + minute
    if (minutesOfDay < WINDOW_START_MIN || minutesOfDay > WINDOW_END_MIN) errors.push(fieldError('AP-0209', field('publish_hour_min')))
  }

  if (errors.length > 0 || delivId === null || title === null || linkType === null || linkItem === null || publishAt === null) {
    return { ok: false, errors }
  }
  return { ok: true, value: { hour, minute, delivId, title, linkType, linkItem, publishAt } }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test src/modules/auto-app-push/validate.test.ts`
Expected: all pass (≈45). `yarn typecheck && yarn lint` clean. (If oxlint objects to the leading `;[hour, minute] = …`, write `const hm = e.publish_hour_min; hour = hm[0]; minute = hm[1]` instead.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/auto-app-push/validate.ts src/modules/auto-app-push/validate.test.ts
git commit -m "feat(auto-app-push): validate editions (AP-0201..0209)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Delivery file content

**Files:**
- Create: `src/modules/auto-app-push/csv.ts`
- Test: `src/modules/auto-app-push/csv.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DeliveryFile { relativePath: string; content: string }
  export function reduceShowId(item: string): string
  export function buildDeliveryFile(edition: ValidEdition, loginIds: string[]): DeliveryFile
  ```
- Consumes: `ValidEdition`, `SHOW_ID` (Task 5), `formatTokyoDate`, `formatTokyoDateTime` (Task 3).

- [ ] **Step 1: Write the failing tests**

`src/modules/auto-app-push/csv.test.ts`:

```ts
/**
 * Byte-for-byte what Rails writes with
 *   CSV.open(path, "w", quote_char: '"', force_quotes: true)
 * in lib/push_test/common.rb#create_auto_app_push_edition.
 */
import { describe, expect, it } from 'vitest'

import { buildDeliveryFile, reduceShowId } from './csv.js'
import type { ValidEdition } from './validate.js'

const edition: ValidEdition = {
  hour: 11,
  minute: 30,
  delivId: 'H020064377',
  title: 'イープラスのWEBページへ遷移します。',
  linkType: '03',
  linkItem: 'https://eplus.jp/',
  publishAt: new Date('2026-09-22T02:30:00Z'), // 11:30 Tokyo
}

describe('reduceShowId', () => {
  it('keeps the 6-digit kogyo code and the 4 digits after P003', () => {
    expect(reduceShowId('9041480001-P0030001P021001')).toBe('904148-0001')
  })

  it('returns anything else unchanged', () => {
    expect(reduceShowId('23542')).toBe('23542')
  })
})

describe('buildDeliveryFile', () => {
  it('names the file from the Tokyo delivery time and the deliv_id', () => {
    expect(buildDeliveryFile(edition, ['1']).relativePath).toBe('20260922/app_push/20260922113000_H020064377_app_push.csv')
  })

  it('writes the header row, the item row and one row per login id, all quoted', () => {
    const { content } = buildDeliveryFile(edition, ['502001185', '602028303'])

    expect(content).toBe(
      '"H020064377","イープラスのWEBページへ遷移します。","","03"\n' + '"https://eplus.jp/"\n' + '"502001185"\n' + '"602028303"\n',
    )
  })

  it('reduces a link_type 01 show id in the item row', () => {
    const { content } = buildDeliveryFile({ ...edition, linkType: '01', linkItem: '9041480001-P0030001P021001' }, ['1'])

    expect(content.split('\n')[1]).toBe('"904148-0001"')
  })

  it('leaves a link_type 02 item unchanged', () => {
    const { content } = buildDeliveryFile({ ...edition, linkType: '02', linkItem: '23542' }, ['1'])

    expect(content.split('\n')[1]).toBe('"23542"')
  })

  it('doubles a double quote inside a value', () => {
    const { content } = buildDeliveryFile({ ...edition, title: 'say "hi"' }, ['1'])

    expect(content.split('\n')[0]).toBe('"H020064377","say ""hi""","","03"')
  })

  it('puts the directory on the Tokyo date even when UTC is still the day before', () => {
    const late = { ...edition, hour: 8, minute: 0, publishAt: new Date('2026-09-21T23:00:00Z') } // 08:00 on the 22nd

    expect(buildDeliveryFile(late, ['1']).relativePath).toBe('20260922/app_push/20260922080000_H020064377_app_push.csv')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test src/modules/auto-app-push/csv.test.ts`
Expected: FAIL — `Cannot find module './csv.js'`.

- [ ] **Step 3: Write csv.ts**

`src/modules/auto-app-push/csv.ts`:

```ts
/**
 * The delivery file, exactly as the Rails batch expects it.
 *
 * Source of truth: lib/push_test/common.rb#create_auto_app_push_edition —
 *   CSV.open(path, "w", quote_char: '"', force_quotes: true) do |file|
 *     file << [deliv_id, title, "", link_type]
 *     file << [item]
 *     @login_ids.each { |login_id| file << [login_id] }
 *   end
 * force_quotes wraps every field in double quotes, a quote inside a value is
 * doubled, rows end with "\n". For link_type "01" the show id is reduced to
 * "<kogyo_code>-<kogyo_sub_code>".
 *
 * Pure: returns the path and the bytes; service.ts does the writing.
 */
import { formatTokyoDate, formatTokyoDateTime } from './time.js'
import { SHOW_ID, type ValidEdition } from './validate.js'

export interface DeliveryFile {
  /** Relative to PUSH_FILE_DIR: <YYYYMMDD>/app_push/<YYYYMMDDHHMMSS>_<deliv_id>_app_push.csv */
  relativePath: string
  content: string
}

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`
const row = (fields: string[]): string => `${fields.map(quote).join(',')}\n`

/** `9041480001-P0030001P021001` -> `904148-0001`; anything else unchanged. */
export function reduceShowId(item: string): string {
  const m = SHOW_ID.exec(item)
  return m ? `${m[1]}-${m[2]}` : item
}

export function buildDeliveryFile(edition: ValidEdition, loginIds: string[]): DeliveryFile {
  const day = formatTokyoDate(edition.publishAt)
  const stamp = formatTokyoDateTime(edition.publishAt)
  const item = edition.linkType === '01' ? reduceShowId(edition.linkItem) : edition.linkItem

  const content = row([edition.delivId, edition.title, '', edition.linkType]) + row([item]) + loginIds.map((id) => row([id])).join('')

  return {
    relativePath: `${day}/app_push/${stamp}_${edition.delivId}_app_push.csv`,
    content,
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test src/modules/auto-app-push/csv.test.ts`
Expected: 8 passed. `yarn typecheck && yarn lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auto-app-push/csv.ts src/modules/auto-app-push/csv.test.ts
git commit -m "feat(auto-app-push): build the Rails-compatible delivery file

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Prisma models and the first migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated by the CLI): `prisma/migrations/<timestamp>_create_push_runs/migration.sql`

**Interfaces:**
- Produces: `prisma.pushRun`, `prisma.pushEdition` with the fields below. Columns are snake_case; the client is camelCase.

No test of its own — Task 9's service test is the first consumer. Verification here is the migration applying and the generated client typechecking.

- [ ] **Step 1: Add the models**

Replace the trailing comment in `prisma/schema.prisma` ("No models yet …") with:

```prisma
/// One accepted POST /api/notifications/auto-app-pushes.
model PushRun {
  id            BigInt        @id @default(autoincrement())
  /// The `date` of the request (Tokyo calendar date), stored as a DATE.
  date          DateTime      @db.Date
  distributeNow Boolean       @map("distribute_now")
  /// The login_ids as sent. JSON: never queried by element.
  loginIds      Json          @map("login_ids")
  createdAt     DateTime      @default(now()) @map("created_at")
  editions      PushEdition[]

  @@map("push_runs")
}

/// One edition of a run — one delivery file.
model PushEdition {
  id        BigInt   @id @default(autoincrement())
  runId     BigInt   @map("run_id")
  run       PushRun  @relation(fields: [runId], references: [id])
  delivId   String   @map("deliv_id") @db.VarChar(24)
  title     String   @db.Text
  linkType  String   @map("link_type") @db.Char(2)
  linkItem  String   @map("link_item") @db.VarChar(255)
  /// The delivery instant, UTC. Tokyo wall-clock time is derived on read.
  publishAt DateTime @map("publish_at")
  /// Path of the delivery file relative to PUSH_FILE_DIR.
  filePath  String   @map("file_path") @db.VarChar(255)
  createdAt DateTime @default(now()) @map("created_at")

  @@index([runId])
  @@map("push_editions")
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `yarn db:migrate --name create_push_runs`
Expected: a new folder `prisma/migrations/<timestamp>_create_push_runs/` with `migration.sql` containing `CREATE TABLE \`push_runs\`` and `CREATE TABLE \`push_editions\``; "Your database is now in sync with your schema"; the client regenerated.

Check in TablePro: both tables exist, `push_editions.run_id` has an index and a foreign key.

- [ ] **Step 3: Confirm the generated client typechecks**

Run: `yarn typecheck && yarn test`
Expected: clean; all existing tests still pass.

- [ ] **Step 4: Commit the schema and the migration together**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): push_runs and push_editions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Service — write files, record the run

**Files:**
- Create: `src/modules/auto-app-push/service.ts`
- Test: `src/modules/auto-app-push/service.test.ts`
- Modify: `.gitignore` (add `tmp/`)

**Interfaces:**
- Produces:
  ```ts
  export interface CreateDeps { now: Date; fileDir: string }
  export function createAutoAppPush(body: unknown, deps: CreateDeps): Promise<{ runId: bigint }>
  ```
  Throws `AppError` from the catalogue: `unknownParameters` (400), `invalidParameter` (422), `creationFailed` (500).
- Consumes: `findUnknownKeys` (Task 4), `validate` (Tasks 5–6), `buildDeliveryFile` (Task 7), `prisma.pushRun` (Task 8), `prisma` from `src/lib/prisma.ts`.

- [ ] **Step 1: Write the failing tests**

`src/modules/auto-app-push/service.test.ts`:

```ts
/**
 * Integration: real MySQL (docker compose up -d), real files in a temp dir.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { createAutoAppPush } from './service.js'

const NOW = new Date('2026-09-22T01:00:00Z') // 10:00 Tokyo

const edition = {
  publish_hour_min: [11, 30],
  deliv_id: 'H020064377',
  title: 'イープラスのWEBページへ遷移します。',
  link_type: '03',
  link_item: 'https://eplus.jp/',
}
const body = () => ({ date: '2026-09-22', login_ids: ['502001185', '602028303'], editions: [edition], distribute_now: false })

let fileDir: string

beforeEach(async () => {
  fileDir = await mkdtemp(path.join(tmpdir(), 'push-test-'))
})

afterEach(async () => {
  await prisma.pushEdition.deleteMany()
  await prisma.pushRun.deleteMany()
  await rm(fileDir, { recursive: true, force: true })
})

afterAll(() => prisma.$disconnect())

/** Runs the service and returns the AppError it threw. */
async function failure(input: unknown): Promise<AppError> {
  try {
    await createAutoAppPush(input, { now: NOW, fileDir })
  } catch (err) {
    if (err instanceof AppError) return err
    throw err
  }
  throw new Error('expected createAutoAppPush to throw')
}

describe('createAutoAppPush: rejections', () => {
  it('throws 400 AP-0004 for an unknown key, before validating anything', async () => {
    const err = await failure({ ...body(), login_ids: [], extra: 1 })

    expect(err.status).toBe(400)
    expect(err.body.error_id).toBe('AP-0004')
    expect(await prisma.pushRun.count()).toBe(0)
  })

  it('throws 422 AP-0001 with the field errors and writes nothing', async () => {
    const err = await failure({ ...body(), login_ids: [] })

    expect(err.status).toBe(422)
    expect(err.body.errors.map((e) => e.error_id)).toEqual(['AP-0102'])
    expect(await prisma.pushRun.count()).toBe(0)
  })

  it('throws 500 AP-0005 when the file cannot be written', async () => {
    // A directory path that is a file: mkdir -p fails on it.
    await rm(fileDir, { recursive: true, force: true })
    fileDir = path.join(tmpdir(), `push-test-file-${Date.now()}`)
    await (await import('node:fs/promises')).writeFile(fileDir, 'not a dir')

    const err = await failure(body())

    expect(err.status).toBe(500)
    expect(err.body.error_id).toBe('AP-0005')
    expect(err.cause).toBeDefined()
    expect(await prisma.pushRun.count()).toBe(0)
  })
})

describe('createAutoAppPush: success', () => {
  it('writes one file per edition with the exact content', async () => {
    await createAutoAppPush(body(), { now: NOW, fileDir })

    const written = await readFile(path.join(fileDir, '20260922/app_push/20260922113000_H020064377_app_push.csv'), 'utf8')
    expect(written).toBe('"H020064377","イープラスのWEBページへ遷移します。","","03"\n"https://eplus.jp/"\n"502001185"\n"602028303"\n')
  })

  it('records the run and its editions', async () => {
    const { runId } = await createAutoAppPush(
      { ...body(), editions: [edition, { ...edition, publish_hour_min: [12, 0], deliv_id: 'H020064378' }] },
      { now: NOW, fileDir },
    )

    const run = await prisma.pushRun.findUniqueOrThrow({ where: { id: runId }, include: { editions: { orderBy: { id: 'asc' } } } })
    expect(run.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
    expect(run.distributeNow).toBe(false)
    expect(run.loginIds).toEqual(['502001185', '602028303'])
    expect(run.editions).toHaveLength(2)
    expect(run.editions[0]).toMatchObject({
      delivId: 'H020064377',
      title: 'イープラスのWEBページへ遷移します。',
      linkType: '03',
      linkItem: 'https://eplus.jp/',
      filePath: '20260922/app_push/20260922113000_H020064377_app_push.csv',
    })
    expect(run.editions[0]?.publishAt.toISOString()).toBe('2026-09-22T02:30:00.000Z')
    expect(run.editions[1]?.filePath).toBe('20260922/app_push/20260922120000_H020064378_app_push.csv')
  })

  it('overwrites an existing file for the same time and deliv_id', async () => {
    await createAutoAppPush(body(), { now: NOW, fileDir })
    await createAutoAppPush({ ...body(), login_ids: ['999'] }, { now: NOW, fileDir })

    const written = await readFile(path.join(fileDir, '20260922/app_push/20260922113000_H020064377_app_push.csv'), 'utf8')
    expect(written.endsWith('"999"\n')).toBe(true)
    expect(await prisma.pushRun.count()).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test src/modules/auto-app-push/service.test.ts`
Expected: FAIL — `Cannot find module './service.js'`.

- [ ] **Step 3: Write the service**

`src/modules/auto-app-push/service.ts`:

```ts
/**
 * What happens to an accepted request, in order:
 *   1. unknown keys?            -> 400 AP-0004, nothing written
 *   2. rules (validate.ts)      -> 422 AP-0001, nothing written
 *   3. one delivery file per edition under fileDir
 *   4. one push_runs row with its push_editions rows (one nested create,
 *      so both land or neither does)
 * A failure in 3 or 4 is 500 AP-0005 with the original error as `cause`.
 * Files already written when 3 or 4 fails stay on disk — Rails has no rollback
 * either, and the log names the run that failed.
 *
 * No req/res here: the router passes the parsed body and the two things that
 * make this function deterministic in tests, the clock and the directory.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { prisma } from '../../lib/prisma.js'
import { buildDeliveryFile } from './csv.js'
import { creationFailed, invalidParameter, unknownParameters } from './errors.js'
import { findUnknownKeys } from './schema.js'
import { validate } from './validate.js'

export interface CreateDeps {
  now: Date
  /** PUSH_FILE_DIR — absolute, or relative to the process cwd. */
  fileDir: string
}

export async function createAutoAppPush(body: unknown, deps: CreateDeps): Promise<{ runId: bigint }> {
  const unknown = findUnknownKeys(body)
  if (unknown.length > 0) throw unknownParameters(unknown)

  const result = validate(body, deps.now)
  if (!result.ok) throw invalidParameter(result.errors)
  const input = result.value

  const files = input.editions.map((edition) => buildDeliveryFile(edition, input.loginIds))

  try {
    for (const file of files) {
      const absolute = path.join(deps.fileDir, file.relativePath)
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, file.content, 'utf8')
    }
  } catch (cause) {
    throw creationFailed(cause)
  }

  try {
    const run = await prisma.pushRun.create({
      data: {
        // A calendar date with no time; stored as DATE, read back as UTC midnight.
        date: new Date(`${input.date}T00:00:00Z`),
        distributeNow: input.distributeNow,
        loginIds: input.loginIds,
        editions: {
          create: input.editions.map((edition, i) => ({
            delivId: edition.delivId,
            title: edition.title,
            linkType: edition.linkType,
            linkItem: edition.linkItem,
            publishAt: edition.publishAt,
            filePath: files[i]?.relativePath ?? '',
          })),
        },
      },
      select: { id: true },
    })
    return { runId: run.id }
  } catch (cause) {
    throw creationFailed(cause)
  }
}
```

Add to `.gitignore`, under the build-output block:

```
# Delivery files written by the auto-app-push endpoint in development
tmp/
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test src/modules/auto-app-push/service.test.ts`
Expected: 6 passed. Then `yarn test && yarn typecheck && yarn lint` — all green.

If `run.loginIds` comes back as a Prisma `JsonValue` and `toEqual` complains about the type, the assertion is still valid at runtime; add `as unknown` on the left side only if TypeScript refuses to compile the test.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auto-app-push/service.ts src/modules/auto-app-push/service.test.ts .gitignore
git commit -m "feat(auto-app-push): service writes delivery files and records the run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Router, app wiring, end-to-end tests

**Files:**
- Create: `src/modules/auto-app-push/router.ts`
- Modify: `src/app.ts`
- Test: `src/modules/auto-app-push/router.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AutoAppPushRouterDeps { clock: () => Date; fileDir: string }
  export function createAutoAppPushRouter(deps: AutoAppPushRouterDeps): Router
  // app.ts
  export interface AppOptions { clock?: () => Date; fileDir?: string }
  export function createApp(options?: AppOptions): Express
  ```
- Consumes: `createAutoAppPush` (Task 9), `requireApiToken` (Task 1), `env.PUSH_FILE_DIR` (Task 1).

- [ ] **Step 1: Write the failing end-to-end tests**

`src/modules/auto-app-push/router.test.ts`:

```ts
/**
 * The HTTP surface, end to end: real app (createApp with a fixed clock and a
 * temp dir), real MySQL, real files. Token is 'test-token' (vitest.config.ts).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'

const PATH = '/api/notifications/auto-app-pushes'
const NOW = new Date('2026-09-22T01:00:00Z') // 10:00 Tokyo

const edition = {
  publish_hour_min: [11, 30],
  deliv_id: 'H020064377',
  title: 'イープラスのWEBページへ遷移します。',
  link_type: '03',
  link_item: 'https://eplus.jp/',
}
const body = () => ({ date: '2026-09-22', login_ids: ['502001185', '602028303'], editions: [edition], distribute_now: false })

let fileDir: string

beforeEach(async () => {
  fileDir = await mkdtemp(path.join(tmpdir(), 'push-test-'))
})

afterEach(async () => {
  await prisma.pushEdition.deleteMany()
  await prisma.pushRun.deleteMany()
  await rm(fileDir, { recursive: true, force: true })
})

afterAll(() => prisma.$disconnect())

const app = () => createApp({ clock: () => NOW, fileDir })
const post = () => request(app()).post(PATH).set('X-APIToken', 'test-token')

describe(`POST ${PATH}: auth`, () => {
  it('401 AP-0002 without a token', async () => {
    const res = await request(app()).post(PATH).send(body())

    expect(res.status).toBe(401)
    expect(res.body.error.error_id).toBe('AP-0002')
  })

  it('401 AP-0002 with a wrong token', async () => {
    const res = await request(app()).post(PATH).set('X-APIToken', 'nope').send(body())

    expect(res.status).toBe(401)
  })
})

describe(`POST ${PATH}: bad requests`, () => {
  it('400 AP-0003 when the body is not JSON', async () => {
    const res = await post().set('Content-Type', 'application/json').send('{"date": ')

    expect(res.status).toBe(400)
    expect(res.body.error.error_id).toBe('AP-0003')
  })

  it('400 AP-0004 naming the unknown key', async () => {
    const res = await post().send({ ...body(), sub_type: 'auto_app_push' })

    expect(res.status).toBe(400)
    expect(res.body.error.error_id).toBe('AP-0004')
    expect(res.body.error.errors).toEqual([expect.objectContaining({ error_id: 'AP-0004', field: 'sub_type' })])
  })

  it('422 AP-0001 with one entry per problem across editions', async () => {
    const res = await post().send({
      ...body(),
      editions: [{ ...edition, deliv_id: '' }, { ...edition, link_type: '09' }],
    })

    expect(res.status).toBe(422)
    expect(res.body.error).toMatchObject({ error_id: 'AP-0001', code: 'INVALID_PARAMETER', title: 'Invalid parameter' })
    expect(res.body.error.errors).toEqual([
      { error_id: 'AP-0201', field: 'editions[0].deliv_id', title: 'Invalid parameter', message: 'deliv_id is required (AP-0201)' },
      { error_id: 'AP-0205', field: 'editions[1].link_type', title: 'Invalid parameter', message: 'link_type must be one of 01, 02, 03 (AP-0205)' },
    ])
    expect(await prisma.pushRun.count()).toBe(0)
  })
})

describe(`POST ${PATH}: accepted`, () => {
  it('201 with an empty body, the file written and the run recorded', async () => {
    const res = await post().send(body())

    expect(res.status).toBe(201)
    expect(res.text).toBe('')

    const written = await readFile(path.join(fileDir, '20260922/app_push/20260922113000_H020064377_app_push.csv'), 'utf8')
    expect(written).toBe('"H020064377","イープラスのWEBページへ遷移します。","","03"\n"https://eplus.jp/"\n"502001185"\n"602028303"\n')

    const runs = await prisma.pushRun.findMany({ include: { editions: true } })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.editions).toHaveLength(1)
    expect(runs[0]?.editions[0]?.delivId).toBe('H020064377')
  })

  it('uses today in Tokyo when date is omitted', async () => {
    const { date: _drop, ...noDate } = body()
    const res = await post().send(noDate)

    expect(res.status).toBe(201)
    const run = await prisma.pushRun.findFirstOrThrow()
    expect(run.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test src/modules/auto-app-push/router.test.ts`
Expected: FAIL — `createApp` does not accept options (typecheck) and every request answers 404 `CM-0404`.

- [ ] **Step 3: Write the router**

`src/modules/auto-app-push/router.ts`:

```ts
/**
 * POST /api/notifications/auto-app-pushes
 *
 * The HTTP surface only: hand the body to the service, answer 201 with no
 * body. Every failure is an AppError thrown by the service (or by
 * requireApiToken before we get here), which Express 5 forwards to the error
 * handler — no try/catch needed.
 *
 * A 201 means "validated, delivery file written, run recorded". Nothing is
 * sent to a phone; the upload that would start delivery is out of scope, as it
 * is in the Rails original.
 */
import { Router } from 'express'

import { createAutoAppPush } from './service.js'

export interface AutoAppPushRouterDeps {
  /** Injected so tests can pin "now"; app.ts passes () => new Date(). */
  clock: () => Date
  /** PUSH_FILE_DIR. */
  fileDir: string
}

export function createAutoAppPushRouter({ clock, fileDir }: AutoAppPushRouterDeps) {
  const router = Router()

  router.post('/', async (req, res) => {
    await createAutoAppPush(req.body, { now: clock(), fileDir })
    // Empty on purpose: the contract says success has no body, and the FE
    // branches on res.ok without reading one.
    res.status(201).end()
  })

  return router
}
```

- [ ] **Step 4: Wire it into the app**

`src/app.ts` — change the imports and the signature, and add the mount after `/health`:

```ts
import { requireApiToken } from './middleware/api-token.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { createAutoAppPushRouter } from './modules/auto-app-push/router.js'
import { healthRouter } from './modules/health/router.js'

export interface AppOptions {
  /** Source of "now" for every request. Tests pin it; production reads the clock. */
  clock?: () => Date
  /** Where delivery files go. Defaults to env.PUSH_FILE_DIR. */
  fileDir?: string
}

export function createApp({ clock = () => new Date(), fileDir = env.PUSH_FILE_DIR }: AppOptions = {}) {
```

and, replacing the `// 5. Routers.` block:

```ts
  // 5. Routers. One mount per feature module. /health is open; the API
  //    routers sit behind the X-APIToken check.
  app.use('/health', healthRouter)
  app.use('/api/notifications/auto-app-pushes', requireApiToken, createAutoAppPushRouter({ clock, fileDir }))
```

- [ ] **Step 5: Run everything**

Run: `yarn test && yarn typecheck && yarn lint && yarn build`
Expected: all test files pass (health, api-token, error-handler, errors, time, schema, validate, csv, service, router); typecheck, lint, build clean.

- [ ] **Step 6: Try it by hand once**

Run `yarn dev` and, with `API_TOKEN` set in `.env`:

```bash
curl -i -X POST "localhost:$PORT/api/notifications/auto-app-pushes" \
  -H 'Content-Type: application/json' -H "X-APIToken: $API_TOKEN" \
  -d '{"login_ids":["502001185"],"editions":[{"publish_hour_min":[HH,MM],"deliv_id":"H020064377","title":"テスト","link_type":"03","link_item":"https://eplus.jp/"}]}'
```

with `HH:MM` a Tokyo time inside 08:00–22:00 and within 2 hours of now. Expected: `HTTP/1.1 201 Created`, a file under `tmp/push_test/<today>/app_push/`, one row in `push_runs` in TablePro. Then the same call with `"link_type":"09"` → `422` with `AP-0205`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auto-app-push/router.ts src/modules/auto-app-push/router.test.ts src/app.ts
git commit -m "feat: POST /api/notifications/auto-app-pushes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: .env.example — keys only, no values**

Under `# --- App ---`, after `CORS_ORIGIN=`:

```
# Shared secret the FE sends as X-APIToken on the API routes.
API_TOKEN=
# Where delivery CSV files are written (default tmp/push_test).
PUSH_FILE_DIR=
```

- [ ] **Step 2: README — environment table and the endpoint**

Add to the Environment table:

```
| `API_TOKEN` | Required. The shared secret the FE sends as `X-APIToken`. |
| `PUSH_FILE_DIR` | `tmp/push_test` | Where delivery CSV files are written. Default if empty. Git-ignored. |
```

Add a section after "## Run":

```markdown
## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | process + database check |
| `POST` | `/api/notifications/auto-app-pushes` | `X-APIToken` | validate an auto-app-push request, write one delivery CSV per edition under `PUSH_FILE_DIR`, record the run in `push_runs` / `push_editions`; `201` with no body |

Request body, validation rules and error ids: `docs/superpowers/specs/2026-09-22-auto-app-push-design.md`.
The delivery file matches what the Rails `ecs-api` writes; nothing is uploaded or sent.
```

Update the Layout block: add `modules/auto-app-push/   schema · validate · time · csv · service · router (+ tests)` and `middleware/api-token.ts   X-APIToken check`.

- [ ] **Step 3: CLAUDE.md — what the next person needs**

Under "## What this service is", replace the sentence "Today it is a scaffold … `POST /api/test_notification/auto_app_pushes`." with:

```markdown
Endpoints: `GET /health` (open) and `POST /api/notifications/auto-app-pushes` (behind
`requireApiToken`). The path follows the naming rules rather than the Rails path the contract
document shows; the response rules and `AP-xxxx` ids of that document still apply.
```

Add a section after "## Errors":

```markdown
## The auto-app-push module

`src/modules/auto-app-push/`, designed in `docs/superpowers/specs/2026-09-22-auto-app-push-design.md`:

- `schema.ts` only answers "which keys are unknown?" (→ `400 AP-0004`). It is a plain
  function on purpose — zod `.strict()` inside a union swallows unknown keys in nested arrays.
- `validate.ts` is the rule table: `validate(body, now)` returns every `AP-01xx`/`AP-02xx`
  problem at once, or the normalised `ValidInput`. It never throws and never reads the clock —
  `now` is a parameter. Add a rule = add a row to the spec table, a test, then the check.
- `time.ts` is Asia/Tokyo as a fixed +09:00 shift. No tz library; Japan has no DST.
- `csv.ts` builds the delivery file byte-for-byte like Rails `common.rb`
  (`force_quotes`, `""` escaping, `\n`). Change it only against that file.
- `service.ts` is the only place with I/O: unknown keys → validate → write files → one nested
  `prisma.pushRun.create`. Failures after validation are `500 AP-0005` with `cause`.
- `router.ts` is two lines. `createApp({ clock, fileDir })` injects the clock and the
  directory; tests pin both.

The `AP-xxxx` catalogue and the envelope builders live in the module's `errors.ts`; the
error handler imports `invalidJson` from there to map `express.json` parse failures.
```

- [ ] **Step 4: Verify and commit**

Run: `yarn test && yarn lint && yarn typecheck`
Expected: green.

```bash
git add .env.example README.md CLAUDE.md
git commit -m "docs: auto-app-push endpoint, API_TOKEN and PUSH_FILE_DIR

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1 path `/api/notifications/auto-app-pushes` | 10 |
| §1 auth, constant-time, `401 AP-0002`, `/health` open | 1, 2 |
| §1 body keys, `400 AP-0004`, `400 AP-0003` | 4, 2, 9, 10 |
| §1 responses table (`201` empty, 401/400/422/500) | 2, 9, 10 |
| §2 every rule row incl. `AP-0104`, date-skips-editions, duplicates allowed, past allowed, 08:00/22:00 inclusive, 2h boundary | 5, 6 |
| §3 file path/name/content, quoting, show-id reduction, overwrite | 7, 9 |
| §3 `PUSH_FILE_DIR` default, git-ignored | 1, 9, 11 |
| §3 Prisma models, snake_case maps, UTC `publish_at` | 8 |
| §3 failure ordering (files then DB, `AP-0005` with cause, no rollback) | 9 |
| §4 module layout, `env.ts` additions, error-handler mapping | 1, 2, 10 |
| §5 unit tests per module, integration tests, temp dir, `afterEach` cleanup, `test.env.API_TOKEN` | 1, 3–7, 9, 10 |
| Out of scope items | not planned (correct) |

**Placeholder scan:** none — every code step has its code; the one "if TypeScript refuses" note in Task 9 names the exact fix.

**Type consistency:** `ValidEdition` / `ValidInput` / `ValidationResult` (Task 5) are what Tasks 7 and 9 import; `buildDeliveryFile(edition, loginIds)` signature matches Tasks 7 and 9; `createAutoAppPush(body, { now, fileDir })` matches Tasks 9 and 10; `createApp({ clock, fileDir })` matches Task 10's tests; `fieldError(id, field)` (Task 2) matches every call in Tasks 5–6; `SHOW_ID` is exported from `validate.ts` and imported by `csv.ts`.
