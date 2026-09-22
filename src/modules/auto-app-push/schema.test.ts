import { describe, expect, it } from 'vitest'

import { findUnknownKeys } from './schema.js'

const edition = { publish_hour_min: [11, 0], deliv_id: 'D1', title: 't', link_type: '03', link_item: 'https://eplus.jp/' }

describe('findUnknownKeys', () => {
  it('returns [] for a body with only the documented keys', () => {
    expect(findUnknownKeys({ date: '2026-09-22', login_ids: ['1'], editions: [edition], distribute_now: false })).toEqual([])
  })

  it('reports a top-level key it does not know', () => {
    expect(findUnknownKeys({ login_ids: ['1'], editions: [edition], id: 7 })).toEqual(['id'])
  })

  it('reports a key inside an edition with its index', () => {
    expect(findUnknownKeys({ login_ids: ['1'], editions: [edition, { ...edition, sub_type: 'x' }] })).toEqual(['editions[1].sub_type'])
  })

  it('reports several keys in document order', () => {
    expect(findUnknownKeys({ foo: 1, editions: [{ ...edition, bar: 2 }], baz: 3 })).toEqual(['foo', 'baz', 'editions[0].bar'])
  })

  it('returns [] when the body is not an object (validate reports that)', () => {
    expect(findUnknownKeys(null)).toEqual([])
    expect(findUnknownKeys([1, 2])).toEqual([])
    expect(findUnknownKeys('x')).toEqual([])
  })

  it('ignores editions that are not objects (validate reports those)', () => {
    expect(findUnknownKeys({ editions: [1, 'x', null] })).toEqual([])
  })
})
