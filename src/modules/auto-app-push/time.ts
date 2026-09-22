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
