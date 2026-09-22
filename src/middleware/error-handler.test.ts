/**
 * The error handler's two new behaviours: express.json's parse failure
 * becomes 400 AP-0003, and an AppError's cause is what gets logged (checked
 * indirectly: the response must not leak it).
 */
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { creationFailed } from '../modules/auto-app-push/errors.js'
import { errorHandler } from './error-handler.js'

function app() {
  const a = express()
  a.use(express.json())
  a.post('/echo', (req, res) => {
    res.json(req.body)
  })
  a.get('/boom', () => {
    throw creationFailed(new Error('disk full'))
  })
  a.use(errorHandler)
  return a
}

describe('errorHandler', () => {
  it('turns a body that is not JSON into 400 AP-0003', async () => {
    const res = await request(app()).post('/echo').set('Content-Type', 'application/json').send('{not json')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ error_id: 'AP-0003', code: 'INVALID_PARAMETER', errors: [] })
  })

  it('answers an AppError with its own status and body, without the cause', async () => {
    const res = await request(app()).get('/boom')

    expect(res.status).toBe(500)
    expect(res.body.error.error_id).toBe('AP-0005')
    expect(JSON.stringify(res.body)).not.toContain('disk full')
  })
})
