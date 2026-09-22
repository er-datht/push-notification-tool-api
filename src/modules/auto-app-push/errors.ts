/**
 * The AP-xxxx ids for POST /api/notifications/auto-app-pushes.
 *
 * Ids and the shape come from the contract in
 * fe-push-notification-tool/docs/API-DOC-auto-app-push.md. The FE keys its own
 * wording off error_id, so the ids are stable and the message text is not a
 * contract — but the text still follows the contract's pattern:
 * "<what is wrong> (<id>)".
 */
import { AppError, type FieldError } from '../../lib/errors.js'

/** Ids that point at one field and appear inside `errors[]`. */
export type FieldErrorId =
  | 'AP-0101'
  | 'AP-0102'
  | 'AP-0103'
  | 'AP-0104'
  | 'AP-0201'
  | 'AP-0202'
  | 'AP-0203'
  | 'AP-0204'
  | 'AP-0205'
  | 'AP-0206'
  | 'AP-0207'
  | 'AP-0208'
  | 'AP-0209'

const FIELD_MESSAGE: Record<FieldErrorId, string> = {
  'AP-0101': 'date must be YYYY-MM-DD',
  'AP-0102': 'login_ids must be a non-empty list of strings',
  'AP-0103': 'editions must be a non-empty list',
  'AP-0104': 'distribute_now must be true or false',
  'AP-0201': 'deliv_id is required',
  'AP-0202': 'deliv_id must be 24 characters or fewer',
  'AP-0203': 'title is required',
  'AP-0204': 'link_item is required',
  'AP-0205': 'link_type must be one of 01, 02, 03',
  'AP-0206': 'link_item must be a show id when link_type is 01',
  'AP-0207': 'publish_hour_min must be [hour, minute] with hour 0-23 and minute 0-59',
  'AP-0208': 'publish_hour_min must be no more than 2 hours ahead of now',
  'AP-0209': 'publish_hour_min must be between 08:00 and 22:00',
}

const TITLE = 'Invalid parameter'

export function fieldError(id: FieldErrorId, field: string): FieldError {
  return { error_id: id, field, title: TITLE, message: `${FIELD_MESSAGE[id]} (${id})` }
}

/** 422 — the body was readable but some values break the rules. */
export const invalidParameter = (errors: FieldError[]) =>
  new AppError(422, {
    error_id: 'AP-0001',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'Some of the request parameters are wrong. See errors for each field. (AP-0001)',
    errors,
  })

/** 401 — X-APIToken missing or wrong. */
export const unauthorized = () =>
  new AppError(401, {
    error_id: 'AP-0002',
    code: 'UNAUTHORIZED',
    title: 'Unauthorized',
    message: 'The X-APIToken header is missing or wrong. (AP-0002)',
  })

/** 400 — the body is not JSON at all. */
export const invalidJson = () =>
  new AppError(400, {
    error_id: 'AP-0003',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'The request body is not valid JSON. (AP-0003)',
  })

/** 400 — a key this endpoint does not know. Extra keys are rejected, not ignored. */
export const unknownParameters = (keys: string[]) =>
  new AppError(400, {
    error_id: 'AP-0004',
    code: 'INVALID_PARAMETER',
    title: TITLE,
    message: 'The request has parameters this endpoint does not know. (AP-0004)',
    errors: keys.map((key) => ({
      error_id: 'AP-0004',
      field: key,
      title: TITLE,
      message: `${key} is not a known parameter (AP-0004)`,
    })),
  })

/** 500 — validation passed but the file or the database write failed. */
export const creationFailed = (cause: unknown) =>
  new AppError(
    500,
    {
      error_id: 'AP-0005',
      code: 'INTERNAL_ERROR',
      title: 'Internal error',
      message: 'The request was valid but the push could not be created. (AP-0005)',
    },
    { cause },
  )
