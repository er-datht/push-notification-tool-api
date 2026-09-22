/**
 * Integration tests: real Express app, real MySQL (docker compose up -d).
 *
 * supertest takes the app object, spins up a throw-away server on a random
 * port for each request and tears it down — it never binds the app's own port.
 */
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'

import { createApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'

const app = createApp()

// Return the pooled connections so the test process can exit promptly.
afterAll(() => prisma.$disconnect())

describe('GET /health', () => {
  it('answers 200 with db: ok when the database is reachable', async () => {
    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', db: 'ok' })
  })

  it('tags the response with an X-Request-Id', async () => {
    const res = await request(app).get('/health')

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('echoes a caller-supplied X-Request-Id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'tester-123')

    expect(res.headers['x-request-id']).toBe('tester-123')
  })
})

describe('unknown route', () => {
  it('answers 404 with the shared error envelope, not HTML', async () => {
    const res = await request(app).get('/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual({
      error: {
        error_id: 'CM-0404',
        code: 'NOT_FOUND',
        title: 'Not found',
        message: 'No route for /does-not-exist. (CM-0404)',
        errors: [],
      },
    })
  })
})
