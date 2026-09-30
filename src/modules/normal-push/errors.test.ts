import { describe, expect, it } from 'vitest'

import { creationFailed, fieldError, invalidParameter, unknownParameters } from './errors.js'

describe('normal-push errors', () => {
  it('fieldError appends the id to the message', () => {
    expect(fieldError('NP-0205', 'editions[0].shows[1].hook')).toEqual({
      error_id: 'NP-0205',
      field: 'editions[0].shows[1].hook',
      title: 'Invalid parameter',
      message: 'hook must be one of preorder, firstcome (NP-0205)',
    })
  })

  it('invalidParameter is a 422 NP-0001 carrying the field errors', () => {
    const e = invalidParameter([fieldError('NP-0101', 'date')])
    expect(e.status).toBe(422)
    expect(e.body).toMatchObject({ error_id: 'NP-0001', code: 'INVALID_PARAMETER', errors: [{ error_id: 'NP-0101' }] })
  })

  it('unknownParameters is a 400 NP-0004 with one entry per key', () => {
    const e = unknownParameters(['login_ids'])
    expect(e.status).toBe(400)
    expect(e.body).toMatchObject({
      error_id: 'NP-0004',
      errors: [{ error_id: 'NP-0004', field: 'login_ids', message: 'login_ids is not a known parameter (NP-0004)' }],
    })
  })

  it('creationFailed is a 500 NP-0005 that keeps the cause', () => {
    const cause = new Error('db down')
    const e = creationFailed(cause)
    expect(e.status).toBe(500)
    expect(e.body).toMatchObject({ error_id: 'NP-0005', code: 'INTERNAL_ERROR' })
    expect(e.cause).toBe(cause)
  })
})
