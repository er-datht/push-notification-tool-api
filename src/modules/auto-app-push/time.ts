/**
 * Asia/Tokyo conversions, on date-fns + @date-fns/tz.
 *
 * Two directions:
 *   - Tokyo wall-clock time -> instant:  new TZDate(y, m, d, h, min, ZONE)
 *   - instant -> Tokyo strings:           format(instant, pattern, { in: tz(ZONE) })
 *
 * Everything returned as a Date is a real instant (UTC inside); everything
 * returned as a string is Tokyo wall-clock time. The zone is one constant, so
 * a different business timezone is a one-line change.
 */
import { TZDate, tz } from '@date-fns/tz'
import { format, isValid, parse } from 'date-fns'

import { BUSINESS_TIMEZONE } from '../../lib/env.js'

const ZONE = BUSINESS_TIMEZONE
const inZone = { in: tz(ZONE) }

/** The contract's date shape. date-fns' parse alone would accept "2026-9-2". */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
}

/** Strict YYYY-MM-DD that also exists on the calendar (no 2026-02-30). */
export function parseCalendarDate(s: string): CalendarDate | null {
  if (!DATE_RE.test(s)) return null
  const d = parse(s, 'yyyy-MM-dd', new Date(0))
  if (!isValid(d)) return null
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** The instant at `hour:minute` Tokyo time on `date` (YYYY-MM-DD). */
export function tokyoDateTime(date: string, hour: number, minute: number): Date {
  const d = parseCalendarDate(date)
  if (!d) throw new Error(`not a calendar date: ${date}`)
  // TZDate is a Date subclass that prints with its zone; hand back a plain
  // Date so the rest of the app only ever sees an instant.
  return new Date(new TZDate(d.year, d.month - 1, d.day, hour, minute, ZONE).getTime())
}

/** Today's date in Tokyo as YYYY-MM-DD. */
export function todayInTokyo(now: Date): string {
  return format(now, 'yyyy-MM-dd', inZone)
}

/** YYYYMMDD in Tokyo — the delivery-file directory name. */
export function formatTokyoDate(instant: Date): string {
  return format(instant, 'yyyyMMdd', inZone)
}

/** YYYYMMDDHHMMSS in Tokyo — the delivery-file name prefix. */
export function formatTokyoDateTime(instant: Date): string {
  return format(instant, 'yyyyMMddHHmmss', inZone)
}
