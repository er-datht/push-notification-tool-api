import { describe, expect, it } from 'vitest'

import { validate } from './validate.js'

const NOW = new Date('2026-09-22T01:00:00Z') // 10:00 Tokyo

const show = (over: Record<string, unknown> = {}) => ({ code: '9014500001-P0030056', performer_id: 2762, hook: 'firstcome', ...over })
const edition = (over: Record<string, unknown> = {}) => ({ publish_hour_min: [17, 0], shows: [show()], ...over })
const body = (over: Record<string, unknown> = {}) => ({ date: '2026-09-22', editions: [edition()], distribute_now: false, ...over })

/** The error ids a body produces, in order — [] when it is valid. */
function errorIds(input: unknown): string[] {
  const r = validate(input, NOW)
  return r.ok ? [] : r.errors.map((e) => e.error_id)
}

function fields(input: unknown): (string | null)[] {
  const r = validate(input, NOW)
  return r.ok ? [] : r.errors.map((e) => e.field)
}

describe('validate: a valid body', () => {
  it('accepts the API doc example and normalises it', () => {
    const r = validate(
      body({
        editions: [
          edition({ shows: [show(), show({ code: '9014500001-P0030065', hook: 'preorder' })] }),
          edition({ publish_hour_min: [18, 0], shows: [show({ code: '9011910001-P0030007P021005', performer_id: 75223 })] }),
        ],
      }),
      NOW,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.editions).toHaveLength(2)
    expect(r.value.editions[0].periodStart.toISOString()).toBe('2026-09-22T08:00:00.000Z')
    expect(r.value.editions[0].shows[1]).toEqual({
      code: '9014500001-P0030065',
      parsed: { kogyoCode: '901450', tourCode: '0001', kogyoSubCode: '0065', koenCode: null },
      performerId: 2762n,
      hook: 'preorder',
    })
    expect(r.value.editions[1].shows[0].performerId).toBe(75223n)
  })

  it('defaults date to today in Tokyo and distribute_now to false', () => {
    const r = validate({ editions: [edition()] }, NOW)
    expect(r.ok && r.value).toMatchObject({ date: '2026-09-22', distributeNow: false })
  })

  it('allows a window that has already started (distribute_now use case)', () => {
    expect(errorIds(body({ editions: [edition({ publish_hour_min: [8, 0] })] }))).toEqual([])
  })

  it('has no lead-time cap: 21:00 is fine at 10:00', () => {
    expect(errorIds(body({ editions: [edition({ publish_hour_min: [21, 0] })] }))).toEqual([])
  })

  it('accepts a 16-digit performer_id that is still a safe integer', () => {
    expect(errorIds(body({ editions: [edition({ shows: [show({ performer_id: 1234567890123456 })] })] }))).toEqual([])
  })
})

describe('validate: run-level rules', () => {
  it('NP-0101 for a date that is not a real day, and skips the editions', () => {
    expect(errorIds(body({ date: '2026-02-30', editions: [edition({ shows: [] })] }))).toEqual(['NP-0101'])
  })

  it('NP-0103 for missing or empty editions', () => {
    expect(errorIds(body({ editions: [] }))).toEqual(['NP-0103'])
    expect(errorIds({ date: '2026-09-22' })).toEqual(['NP-0103'])
  })

  it('NP-0104 for a non-boolean distribute_now', () => {
    expect(errorIds(body({ distribute_now: 'yes' }))).toEqual(['NP-0104'])
  })
})

describe('validate: edition and show rules', () => {
  it('NP-0201 for missing or empty shows', () => {
    expect(fields(body({ editions: [edition({ shows: [] })] }))).toEqual(['editions[0].shows'])
    expect(errorIds(body({ editions: [{ publish_hour_min: [17, 0] }] }))).toEqual(['NP-0201'])
  })

  it('NP-0202 for a blank code, NP-0203 for a malformed one (including the [公演] prefix)', () => {
    expect(errorIds(body({ editions: [edition({ shows: [show({ code: '  ' })] })] }))).toEqual(['NP-0202'])
    expect(errorIds(body({ editions: [edition({ shows: [show({ code: '[公演]9014500001-P0030056' })] })] }))).toEqual(['NP-0203'])
    // SHOW_ID_FORMAT wants exactly 6 + 4 digits in front.
    expect(errorIds(body({ editions: [edition({ shows: [show({ code: '901450001-P0030056' })] })] }))).toEqual(['NP-0203'])
    expect(errorIds(body({ editions: [edition({ shows: [show({ code: '12-P34' })] })] }))).toEqual(['NP-0203'])
  })

  it('accepts every shape SHOW_ID_FORMAT accepts, a bare kogyo + tour included', () => {
    for (const code of ['9014500001', '9014500001-P0030056', '9011910001-P0030007P021005', '9014500001-P0030056?x=1']) {
      expect(errorIds(body({ editions: [edition({ shows: [show({ code })] })] }))).toEqual([])
    }
  })

  it.each([0, -1, 1.5, '2762', 2 ** 60])('NP-0204 for performer_id %s', (performer_id) => {
    expect(errorIds(body({ editions: [edition({ shows: [show({ performer_id })] })] }))).toEqual(['NP-0204'])
  })

  it.each(['mixed', 'in_store', 'firstcom', ''])('NP-0205 for hook %j', (hook) => {
    expect(errorIds(body({ editions: [edition({ shows: [show({ hook })] })] }))).toEqual(['NP-0205'])
  })

  it('points a show error at its dotted path', () => {
    expect(fields(body({ editions: [edition({ shows: [show(), show({ hook: 'x' })] })] }))).toEqual(['editions[0].shows[1].hook'])
  })

  it('NP-0206 for a malformed publish_hour_min', () => {
    expect(errorIds(body({ editions: [edition({ publish_hour_min: [24, 0] })] }))).toEqual(['NP-0206'])
    expect(errorIds(body({ editions: [edition({ publish_hour_min: '17:00' })] }))).toEqual(['NP-0206'])
  })

  it('NP-0207 when the window starts before 08:00 or after 21:00', () => {
    expect(errorIds(body({ editions: [edition({ publish_hour_min: [7, 59] })] }))).toEqual(['NP-0207'])
    expect(errorIds(body({ editions: [edition({ publish_hour_min: [21, 1] })] }))).toEqual(['NP-0207'])
  })

  it('NP-0208 on the later of two editions less than an hour apart', () => {
    const r = body({ editions: [edition(), edition({ publish_hour_min: [17, 59] })] })
    expect(errorIds(r)).toEqual(['NP-0208'])
    expect(fields(r)).toEqual(['editions[1].publish_hour_min'])
  })

  it('no overlap when windows touch: 17:00 and 18:00', () => {
    expect(errorIds(body({ editions: [edition(), edition({ publish_hour_min: [18, 0] })] }))).toEqual([])
  })

  it('reports every problem at once', () => {
    const r = body({ editions: [edition({ shows: [show({ code: '', performer_id: 0, hook: 'x' })] }), edition({ publish_hour_min: [6, 0] })] })
    expect(errorIds(r)).toEqual(['NP-0202', 'NP-0204', 'NP-0205', 'NP-0207'])
  })
})
