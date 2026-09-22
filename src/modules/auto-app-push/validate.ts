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
