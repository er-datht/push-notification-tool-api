/**
 * POST /api/notifications/auto-app-pushes
 *
 * The HTTP surface only: hand the body to the service, answer 201 with no
 * body. Every failure is an AppError thrown by the service (or by
 * requireApiToken before we get here), which Express 5 forwards to the error
 * handler — no try/catch needed.
 *
 * A 201 means "validated, delivery file written, run recorded". Nothing is
 * sent to a phone; the upload that would start delivery is out of scope, as it
 * is in the Rails original.
 */
import { Router } from 'express'

import { createAutoAppPush } from './service.js'

export interface AutoAppPushRouterDeps {
  /** Injected so tests can pin "now"; app.ts passes () => new Date(). */
  clock: () => Date
  /** PUSH_FILE_DIR. */
  fileDir: string
}

export function createAutoAppPushRouter({ clock, fileDir }: AutoAppPushRouterDeps) {
  const router = Router()

  router.post('/', async (req, res) => {
    await createAutoAppPush(req.body, { now: clock(), fileDir })
    // Empty on purpose: the contract says success has no body, and the FE
    // branches on res.ok without reading one.
    res.status(201).end()
  })

  return router
}
