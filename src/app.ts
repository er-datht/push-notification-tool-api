/**
 * Builds the Express application: middleware, routers, error handling.
 *
 * It does NOT listen on a port — server.ts does that. Keeping the two apart is
 * what makes the app testable: a test calls createApp() and hands the result
 * to supertest, which drives it in-process without a socket.
 *
 * Express runs middleware in the order it is registered. The order below is
 * deliberate; each comment says why that line sits where it does.
 */
import { randomUUID } from 'node:crypto'

import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'

import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { requireApiToken } from './middleware/api-token.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { createAutoAppPushRouter } from './modules/auto-app-push/router.js'
import { healthRouter } from './modules/health/router.js'

export interface AppOptions {
  /** Source of "now" for every request. Tests pin it; production reads the clock. */
  clock?: () => Date
  /** Where delivery files go. Defaults to env.PUSH_FILE_DIR. */
  fileDir?: string
}

export function createApp({ clock = () => new Date(), fileDir = env.PUSH_FILE_DIR }: AppOptions = {}) {
  const app = express()

  // 1. Security headers on every response, including errors — so it goes first.
  app.use(helmet())

  // 2. CORS before any router: the browser's OPTIONS preflight must be answered
  //    here, or it falls through to the 404 handler and the real request never
  //    gets sent. Only the FE origin(s) from env are allowed.
  app.use(cors({ origin: env.CORS_ORIGIN }))

  // 3. Request logging. Assigns req.id (echoed back as X-Request-Id so a tester
  //    can quote it) and attaches req.log; writes one line when the response
  //    finishes with status and duration. /health is excluded to keep the log
  //    free of load-balancer noise.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id']?.toString() ?? randomUUID()
        res.setHeader('X-Request-Id', id)
        return id
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
      // pino-http's default serializers dump every request header. That is
      // noisy and, once auth exists, would write the X-APIToken into the log.
      // Log the few fields that identify a request and nothing more.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ status: res.statusCode }),
      },
    }),
  )

  // 4. Body parsing, before any router that reads req.body. The size limit is
  //    the first line of defence against an oversized payload.
  app.use(express.json({ limit: '1mb' }))

  // 5. Routers. One mount per feature module. /health is open; the API
  //    routers sit behind the X-APIToken check.
  app.use('/health', healthRouter)
  app.use('/api/notifications/auto-app-pushes', requireApiToken, createAutoAppPushRouter({ clock, fileDir }))

  // 6. Nothing matched -> 404 envelope. 7. Anything thrown -> error envelope.
  //    Both must stay last.
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
