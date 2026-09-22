/**
 * The middleware in isolation: a two-line Express app with one open route.
 * env.API_TOKEN is TEST_API_TOKEN (vitest.config.ts).
 */
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { TEST_API_TOKEN } from '../test/fixtures.js'
import { requireApiToken } from './api-token.js'
import { errorHandler } from './error-handler.js'

function appWithToken() {
  const app = express()
  app.use(requireApiToken)
  app.get('/', (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)
  return app
}

describe('requireApiToken', () => {
  it('lets a request with the right X-APIToken through', async () => {
    const res = await request(appWithToken()).get('/').set('X-APIToken', TEST_API_TOKEN)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('answers 401 AP-0002 when the header is missing', async () => {
    const res = await request(appWithToken()).get('/')

    expect(res.status).toBe(401)
    expect(res.body.error).toMatchObject({ error_id: 'AP-0002', code: 'UNAUTHORIZED', errors: [] })
  })

  it('answers 401 AP-0002 when the token is wrong', async () => {
    // Same length, last byte different: exercises timingSafeEqual itself,
    // not the length short-circuit before it.
    const wrong = `${TEST_API_TOKEN.slice(0, -1)}X`
    const res = await request(appWithToken()).get('/').set('X-APIToken', wrong)

    expect(res.status).toBe(401)
    expect(res.body.error.error_id).toBe('AP-0002')
  })

  it('answers 401 AP-0002 when the token is empty', async () => {
    const res = await request(appWithToken()).get('/').set('X-APIToken', '')

    expect(res.status).toBe(401)
  })
})
