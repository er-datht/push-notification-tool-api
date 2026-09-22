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
    hour = e.publish_hour_min[0]
    minute = e.publish_hour_min[1]
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
