/**
 * The last two middlewares in the chain. Together they guarantee that no
 * response ever leaves this server in Express's default HTML shape — every
 * failure is the JSON envelope from src/lib/errors.ts.
 *
 * Order matters: app.ts registers them AFTER every router. Express runs
 * middleware in registration order, so a request only reaches notFoundHandler
 * when no route claimed it, and errorHandler only runs when something before it
 * threw or called next(err).
 */
import type { ErrorRequestHandler, RequestHandler } from 'express'
// Side-effect import for its types only: pino-http augments IncomingMessage
// with `id` (the request id it assigns). Without this, `req.id` does not exist
// as far as TypeScript is concerned.
import type {} from 'pino-http'

import { AppError, internalError, notFound } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { invalidJson } from '../modules/auto-app-push/errors.js'

/** No route matched. Three parameters: an ordinary middleware. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  // Hand it to the error handler rather than answering here, so 404s go
  // through the same logging and shaping as every other failure.
  next(notFound(req.path))
}

/**
 * express.json() rejects a body it cannot parse with an error tagged
 * `type: 'entity.parse.failed'` (from the body-parser package). It is the one
 * framework error with a contract-defined answer: 400 AP-0003.
 */
const isJsonParseError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.parse.failed'

/**
 * Express identifies an error handler by its arity: exactly four parameters,
 * (err, req, res, next). Express 5 routes rejected async handlers here too.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Headers already sent means a handler started streaming and then failed.
  // The response cannot be reshaped at this point; let Express close it.
  if (res.headersSent) {
    next(err)
    return
  }

  const appError = err instanceof AppError ? err : isJsonParseError(err) ? invalidJson() : null

  if (appError) {
    // Expected: something the app chose to raise. 4xx is the client's problem
    // and is logged quietly; 5xx is ours, logged as an error with its cause.
    const fields = { req_id: req.id, status: appError.status, error_id: appError.body.error_id }
    if (appError.status >= 500) logger.error({ ...fields, err: appError.cause ?? appError }, appError.message)
    else logger.info(fields, appError.message)
    res.status(appError.status).json(appError.toJSON())
    return
  }

  // Unexpected: a bug, a driver failure, anything not wrapped in AppError.
  // The stack goes to the log; the client gets a generic 500 and nothing
  // about our internals.
  logger.error({ req_id: req.id, err }, 'unhandled error')
  const fallback = internalError()
  res.status(fallback.status).json(fallback.toJSON())
}
