/**
 * The NP-xxxx ids for POST /api/notifications/normal-pushes — the same catalogue as ecs-api's
 * normal push endpoint (fe-push-notification-tool/docs/API-DOC-normal-push.md), so the frontend
 * reads both servers the same way. NP-0104 is ours only (ecs-api documents no id for a
 * non-boolean distribute_now), the same way auto-app-push added AP-0104.
 *
 * NP-0002 (401) and NP-0003 (bad JSON) are deliberately NOT defined here: the shared
 * middleware (src/middleware/api-token.ts, src/middleware/error-handler.ts) imports its error
 * builders from auto-app-push/errors.ts regardless of which router is hit, so those two cases
 * answer with AP-0002/AP-0003 on this route too. Defining them here would be dead code.
 */
import { AppError, type FieldError } from '../../lib/errors.js'

/** Ids that point at one field and appear inside `errors[]`. */
export type FieldErrorId =
  | 'NP-0101'
  | 'NP-0103'
  | 'NP-0104'
  | 'NP-0201'
  | 'NP-0202'
  | 'NP-0203'
  | 'NP-0204'
  | 'NP-0205'
  | 'NP-0206'
  | 'NP-0207'
  | 'NP-0208'

const FIELD_MESSAGE: Record<FieldErrorId, string> = {
  'NP-0101': 'date must be YYYY-MM-DD',
  'NP-0103': 'editions must be a non-empty list',
  'NP-0104': 'distribute_now must be true or false',
  'NP-0201': 'shows must be a non-empty list',
  'NP-0202': 'code is required',
  'NP-0203': 'code is not a valid show id',
  'NP-0204': 'performer_id must be a positive whole number of at most 16 digits',
  'NP-0205': 'hook must be one of preorder, firstcome',
  'NP-0206': 'publish_hour_min must be [hour, minute] with hour 0-23 and minute 0-59',
  'NP-0207': 'the one-hour window must start between 08:00 and 21:00',
  'NP-0208': 'the window overlaps an edition that already exists',
}

const TITLE = 'Invalid parameter'

export function fieldError(id: FieldErrorId, field: string): FieldError {
  return { error_id: id, field, title: TITLE, message: `${FIELD_MESSAGE[id]} (${id})` }
}

/** 422 — the body was readable but some values break the rules. */
export const invalidParameter = (errors: FieldError[]) =>
  new AppError(422, {
    error_id: 'NP-0001',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'Some of the request parameters are wrong. See errors for each field. (NP-0001)',
    errors,
  })

/** 400 — a key this endpoint does not know (login_ids included). Extra keys are rejected, not ignored. */
export const unknownParameters = (keys: string[]) =>
  new AppError(400, {
    error_id: 'NP-0004',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'The request has parameters this endpoint does not know. (NP-0004)',
    errors: keys.map((key) => ({
      error_id: 'NP-0004',
      field: key,
      title: TITLE,
      message: `${key} is not a known parameter (NP-0004)`,
    })),
  })

/** 500 — validation passed but the database write failed. */
export const creationFailed = (cause: unknown) =>
  new AppError(
    500,
    {
      error_id: 'NP-0005',
      code: 'INTERNAL_ERROR',
      title: 'Internal error',
      message: 'The request was valid but the push could not be created. (NP-0005)',
    },
    { cause },
  )
