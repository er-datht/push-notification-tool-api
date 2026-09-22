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
