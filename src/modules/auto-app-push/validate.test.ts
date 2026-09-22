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
