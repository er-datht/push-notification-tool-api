/**
 * GET /health — is the process up, and can it reach the database?
 *
 * This is what a load balancer, Docker healthcheck or a person with curl asks.
 * It checks the database on purpose: "the app answers but every request fails
 * on the DB" is the failure mode a plain { status: "ok" } would hide.
 *
 * The first feature module. The layout every module follows:
 *   modules/<feature>/router.ts   the HTTP surface, mounted in app.ts
 *   modules/<feature>/service.ts  business logic, no req/res (when there is any)
 *   modules/<feature>/schema.ts   zod schemas for the request body (when there is one)
 */
import { Router } from 'express'

import { prisma } from '../../lib/prisma.js'

export const healthRouter = Router()

healthRouter.get('/', async (req, res) => {
  try {
    // The cheapest query that still proves a connection works.
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'ok' })
  } catch (err) {
    // 503 Service Unavailable, not 500: the app is fine, a dependency is not.
    // Logged through req.log (attached by pino-http) so the line carries this
    // request's id.
    req.log.error({ err }, 'health: database unreachable')
    res.status(503).json({ status: 'degraded', db: 'error' })
  }
})
