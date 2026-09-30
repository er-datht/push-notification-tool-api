/**
 * The rule table for POST /api/notifications/normal-pushes, as one pure function — the rules of
 * ecs-api's normal push endpoint (fe-push-notification-tool/docs/API-DOC-normal-push.md).
 *
 * Same shape as auto-app-push/validate.ts: never throws, never touches I/O or the clock (`now`
 * comes in as a parameter). Reports every problem it can find in one pass. When `date` is
 * unusable the editions are skipped: their windows cannot be computed without it.
 *
 * Timing: `publish_hour_min` starts a ONE-HOUR window, so it must start between 08:00 and 21:00
 * (the server publishes only until 22:00). A start in the past is fine — that is how
 * distribute_now is used — and there is no lead-time cap. Two windows in the same request that
 * overlap are NP-0208 here; overlaps with editions already in the database are checked by the
 * service, which can see them.
 */
import type { FieldError } from '../../lib/errors.js'
import { parseCalendarDate, todayInTokyo, tokyoDateTime } from '../../lib/time.js'
import { fieldError } from './errors.js'

export type Hook = 'preorder' | 'firstcome'

export interface ValidShow {
  code: string
  /** Up to 16 digits, so it is kept as a bigint all the way to the database. */
  performerId: bigint
  hook: Hook
}

export interface ValidEdition {
  /** The start of the one-hour window: `date` + hour:minute in Asia/Tokyo. */
  publishAt: Date
  shows: ValidShow[]
}

export interface ValidInput {
  /** YYYY-MM-DD, Tokyo. */
  date: string
  distributeNow: boolean
  editions: ValidEdition[]
}

export type ValidationResult = { ok: true; value: ValidInput } | { ok: false; errors: FieldError[] }

/** One edition covers this long; two starts closer than this overlap. */
export const WINDOW_MS = 60 * 60 * 1000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

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
    errors.push(fieldError('NP-0101', 'date'))
  }

  // distribute_now — optional boolean.
  let distributeNow = false
  if (b.distribute_now !== undefined) {
    if (typeof b.distribute_now === 'boolean') distributeNow = b.distribute_now
    else errors.push(fieldError('NP-0104', 'distribute_now'))
  }

  // editions — non-empty list; each entry checked only when the date is usable.
  const rawEditions = Array.isArray(b.editions) && b.editions.length > 0 ? b.editions : null
  if (rawEditions === null) errors.push(fieldError('NP-0103', 'editions'))

  const editions: ValidEdition[] = []
  if (rawEditions !== null && date !== null) {
    // Window starts seen so far, by index — the later edition of an overlapping pair gets NP-0208.
    const starts: (Date | null)[] = []
    rawEditions.forEach((raw, index) => {
      const r = validateEdition(raw, index, date)
      starts.push(r.publishAt)
      const at = r.publishAt
      if (at !== null && starts.slice(0, index).some((s) => s !== null && Math.abs(s.getTime() - at.getTime()) < WINDOW_MS)) {
        r.errors.push(fieldError('NP-0208', `editions[${index}].publish_hour_min`))
      }
      if (r.errors.length === 0 && r.value) editions.push(r.value)
      else errors.push(...r.errors)
    })
  }

  if (errors.length > 0 || date === null) return { ok: false, errors }
  return { ok: true, value: { date, distributeNow, editions } }
}

interface EditionResult {
  value: ValidEdition | null
  errors: FieldError[]
  /** Known as soon as the time is well-formed, even if other fields fail — the overlap check needs it. */
  publishAt: Date | null
}

const HOOKS: readonly string[] = ['preorder', 'firstcome']
/** A show code, optionally followed by one `P021…` performance part. A `[公演]` prefix fails this. */
const CODE_RE = /^\d+-P\d+(?:P\d+)?$/
const WINDOW_START_MIN = 8 * 60 // 08:00
const WINDOW_LAST_START_MIN = 21 * 60 // 21:00, inclusive — the window then ends at 22:00

const isHourMin = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  Number.isInteger(v[0]) &&
  Number.isInteger(v[1]) &&
  v[0] >= 0 &&
  v[0] <= 23 &&
  v[1] >= 0 &&
  v[1] <= 59

/** A positive whole number of at most 16 digits that JSON carried without rounding. */
const isPerformerId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && String(v).length <= 16

function validateEdition(raw: unknown, index: number, date: string): EditionResult {
  const e = isRecord(raw) ? raw : {}
  const field = (key: string) => `editions[${index}].${key}`
  const errors: FieldError[] = []

  let publishAt: Date | null = null
  if (!isHourMin(e.publish_hour_min)) {
    errors.push(fieldError('NP-0206', field('publish_hour_min')))
  } else {
    const [hour, minute] = e.publish_hour_min
    publishAt = tokyoDateTime(date, hour, minute)
    const start = hour * 60 + minute
    if (start < WINDOW_START_MIN || start > WINDOW_LAST_START_MIN) errors.push(fieldError('NP-0207', field('publish_hour_min')))
  }

  const shows: ValidShow[] = []
  if (!Array.isArray(e.shows) || e.shows.length === 0) {
    errors.push(fieldError('NP-0201', field('shows')))
  } else {
    e.shows.forEach((rawShow, j) => {
      const s = isRecord(rawShow) ? rawShow : {}
      const showField = (key: string) => field(`shows[${j}].${key}`)
      let ok = true

      const code = typeof s.code === 'string' ? s.code.trim() : ''
      if (code === '') {
        errors.push(fieldError('NP-0202', showField('code')))
        ok = false
      } else if (!CODE_RE.test(code)) {
        errors.push(fieldError('NP-0203', showField('code')))
        ok = false
      }

      if (!isPerformerId(s.performer_id)) {
        errors.push(fieldError('NP-0204', showField('performer_id')))
        ok = false
      }

      if (typeof s.hook !== 'string' || !HOOKS.includes(s.hook)) {
        errors.push(fieldError('NP-0205', showField('hook')))
        ok = false
      }

      if (ok) shows.push({ code, performerId: BigInt(s.performer_id as number), hook: s.hook as Hook })
    })
  }

  if (errors.length > 0 || publishAt === null) return { value: null, errors, publishAt }
  return { value: { publishAt, shows }, errors, publishAt }
}
