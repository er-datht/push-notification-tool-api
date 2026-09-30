import { describe, expect, it } from 'vitest'

import { findUnknownKeys } from './schema.js'

const show = { code: '9014500001-P0030056', performer_id: 2762, hook: 'firstcome' }
const valid = { date: '2026-09-22', editions: [{ publish_hour_min: [17, 0], shows: [show] }], distribute_now: false }

describe('findUnknownKeys', () => {
  it('finds nothing in a body with only known keys', () => {
    expect(findUnknownKeys(valid)).toEqual([])
  })

  it('rejects login_ids, which this endpoint does not take', () => {
    expect(findUnknownKeys({ ...valid, login_ids: ['502001185'] })).toEqual(['login_ids'])
  })

  it('names an unknown key inside an edition with its dotted path', () => {
    const body = { ...valid, editions: [{ publish_hour_min: [17, 0], shows: [show], sub_type: 'preorder' }] }
    expect(findUnknownKeys(body)).toEqual(['editions[0].sub_type'])
  })

  it('names an unknown key inside a show with its dotted path', () => {
    const body = { ...valid, editions: [{ publish_hour_min: [17, 0], shows: [show, { ...show, word_id: 2762 }] }] }
    expect(findUnknownKeys(body)).toEqual(['editions[0].shows[1].word_id'])
  })

  it('lists top-level keys before nested ones', () => {
    const body = { extra: 1, editions: [{ publish_hour_min: [17, 0], shows: [{ ...show, x: 1 }], y: 2 }] }
    expect(findUnknownKeys(body)).toEqual(['extra', 'editions[0].y', 'editions[0].shows[0].x'])
  })

  it('ignores shapes it cannot walk (validate reports those)', () => {
    expect(findUnknownKeys(null)).toEqual([])
    expect(findUnknownKeys({ editions: 'nope' })).toEqual([])
    expect(findUnknownKeys({ editions: [{ shows: 'nope' }] })).toEqual([])
  })
})
