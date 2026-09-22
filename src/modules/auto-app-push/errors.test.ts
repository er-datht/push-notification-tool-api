import { describe, expect, it } from 'vitest'

import { AppError } from '../../lib/errors.js'
import {
  creationFailed,
  fieldError,
  invalidJson,
  invalidParameter,
  unauthorized,
  unknownParameters,
} from './errors.js'

describe('fieldError', () => {
  it('builds an entry with the contract wording and the id appended', () => {
    expect(fieldError('AP-0201', 'editions[0].deliv_id')).toEqual({
      error_id: 'AP-0201',
      field: 'editions[0].deliv_id',
      title: 'Invalid parameter',
      message: 'deliv_id is required (AP-0201)',
    })
  })
})

describe('envelope builders', () => {
  it('invalidParameter is a 422 AP-0001 carrying the field errors', () => {
    const err = invalidParameter([fieldError('AP-0102', 'login_ids')])

    expect(err).toBeInstanceOf(AppError)
    expect(err.status).toBe(422)
    expect(err.body).toMatchObject({ error_id: 'AP-0001', code: 'INVALID_PARAMETER' })
    expect(err.body.errors).toHaveLength(1)
    expect(err.body.errors[0]?.error_id).toBe('AP-0102')
  })

  it('unauthorized is a 401 AP-0002', () => {
    expect(unauthorized()).toMatchObject({ status: 401, body: { error_id: 'AP-0002', code: 'UNAUTHORIZED', errors: [] } })
  })

  it('invalidJson is a 400 AP-0003', () => {
    expect(invalidJson()).toMatchObject({ status: 400, body: { error_id: 'AP-0003', code: 'INVALID_PARAMETER' } })
  })

  it('unknownParameters is a 400 AP-0004 with one entry per key', () => {
    const err = unknownParameters(['foo', 'editions[1].bar'])

    expect(err.status).toBe(400)
    expect(err.body.error_id).toBe('AP-0004')
    expect(err.body.errors).toEqual([
      { error_id: 'AP-0004', field: 'foo', title: 'Invalid parameter', message: 'foo is not a known parameter (AP-0004)' },
      { error_id: 'AP-0004', field: 'editions[1].bar', title: 'Invalid parameter', message: 'editions[1].bar is not a known parameter (AP-0004)' },
    ])
  })

  it('creationFailed is a 500 AP-0005 that keeps the cause', () => {
    const cause = new Error('disk full')
    const err = creationFailed(cause)

    expect(err.status).toBe(500)
    expect(err.body).toMatchObject({ error_id: 'AP-0005', code: 'INTERNAL_ERROR' })
    expect(err.cause).toBe(cause)
  })
})
