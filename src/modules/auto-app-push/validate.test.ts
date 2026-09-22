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
