/**
 * The error shape every failure response uses.
 *
 * It is the envelope from the company-wide API specification sheet, the same
 * one the Rails ecs-api answers with and the one the FE console already parses
 * (fe-push-notification-tool/src/lib/api.ts). Success responses do not use it.
 *
 *   {
 *     "error": {
 *       "error_id": "AP-0001",
 *       "code":     "INVALID_PARAMETER",
 *       "title":    "Invalid parameter",
 *       "message":  "Some of the request parameters are wrong. (AP-0001)",
 *       "errors":   [ { "error_id", "field", "title", "message" }, ... ]
 *     }
 *   }
 *
 * Keys are snake_case on the wire (API naming rules). This module knows nothing
 * about Express; business code throws AppError and the error-handler middleware
 * turns it into a response.
 */

/** One entry in `error.errors[]` — a problem with a single field. */
export interface FieldError {
  error_id: string
  /** Dotted path of the input, e.g. `editions[0].deliv_id`, or null when there is none. */
  field: string | null
  title: string
  message: string
}

export interface ErrorBody {
  error_id: string
  code: string
  title: string
  message: string
  errors: FieldError[]
}

export interface ErrorEnvelope {
  error: ErrorBody
}

/**
 * An error the app chose to raise: carries the HTTP status and the envelope
 * body. Anything else that reaches the error handler is a bug and becomes a 500.
 */
export class AppError extends Error {
  readonly status: number
  readonly body: ErrorBody

  constructor(
    status: number,
    body: Omit<ErrorBody, 'errors'> & { errors?: FieldError[] },
    // `cause` is the underlying error (a failed write, a driver error). It is
    // logged, never sent to the client.
    options?: { cause?: unknown },
  ) {
    super(body.message, options)
    this.name = 'AppError'
    this.status = status
    this.body = { ...body, errors: body.errors ?? [] }
  }

  toJSON(): ErrorEnvelope {
    return { error: this.body }
  }
}

// Errors the framework itself raises. Feature-specific ids (AP-01xx, AP-02xx for
// auto-app-push) live with their feature; these are the two every app has.

export const notFound = (path: string) =>
  new AppError(404, {
    error_id: 'CM-0404',
    code: 'NOT_FOUND',
    title: 'Not found',
    message: `No route for ${path}. (CM-0404)`,
  })

export const internalError = () =>
  new AppError(500, {
    error_id: 'CM-0500',
    code: 'INTERNAL_ERROR',
    title: 'Internal error',
    message: 'Something went wrong on the server. (CM-0500)',
  })
