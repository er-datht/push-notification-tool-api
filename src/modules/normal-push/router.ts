/**
 * POST /api/notifications/normal-pushes
 *
 * The HTTP surface only: hand the body to the service, answer 201 with the editions it created —
 * the same body ecs-api's normal push endpoint answers with. Every failure is an AppError thrown
 * by the service (or by requireApiToken before we get here), which Express 5 forwards to the
 * error handler — no try/catch needed.
 */
import { Router } from 'express'

import type { SearchKoen } from '../../lib/eplus-search.js'
import { createNormalPush } from './service.js'

export interface NormalPushRouterDeps {
  /** Injected so tests can pin "now"; app.ts passes () => new Date(). */
  clock: () => Date
  /** The e+ search API's koen list; tests pass a stub. */
  searchKoen: SearchKoen
}

export function createNormalPushRouter({ clock, searchKoen }: NormalPushRouterDeps) {
  const router = Router()

  router.post('/', async (req, res) => {
    const created = await createNormalPush(req.body, { now: clock(), searchKoen })
    res.status(201).json(created)
  })

  return router
}
