/**
 * X-APIToken check for the notification endpoints.
 *
 * The token is a shared secret from env.API_TOKEN. The comparison is
 * constant-time (crypto.timingSafeEqual): a plain `===` returns as soon as the
 * first byte differs, and that timing difference is measurable enough to guess
 * a secret byte by byte. The length check before it is unavoidable — the
 * function throws on unequal lengths — and leaks only the length.
 *
 * /health stays open; app.ts mounts this on the API routers only.
 */
import { timingSafeEqual } from 'node:crypto'

import type { RequestHandler } from 'express'

import { env } from '../lib/env.js'
import { AppError } from '../lib/errors.js'

const unauthorized = () =>
  new AppError(401, {
    error_id: 'AP-0002',
    code: 'UNAUTHORIZED',
    title: 'Unauthorized',
    message: 'The X-APIToken header is missing or wrong. (AP-0002)',
  })

function tokenMatches(given: string | undefined): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(env.API_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const requireApiToken: RequestHandler = (req, _res, next) => {
  if (!tokenMatches(req.get('X-APIToken'))) {
    next(unauthorized())
    return
  }
  next()
}
