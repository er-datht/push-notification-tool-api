/**
 * The key set of the request body — and nothing else.
 *
 * Same rationale as auto-app-push/schema.ts: a plain function rather than a zod schema,
 * since zod's .strict() inside a union quietly accepts unknown keys nested in arrays.
 * `login_ids` is not a key here, so sending it is a 400 like ecs-api's.
 */

const TOP_LEVEL_KEYS = new Set(['date', 'editions', 'distribute_now'])
const EDITION_KEYS = new Set(['publish_hour_min', 'shows'])
const SHOW_KEYS = new Set(['code', 'performer_id', 'hook'])

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Dotted paths of keys the endpoint does not know, top level first. */
export function findUnknownKeys(body: unknown): string[] {
  if (!isRecord(body)) return []

  const unknown = Object.keys(body).filter((k) => !TOP_LEVEL_KEYS.has(k))

  if (Array.isArray(body.editions)) {
    body.editions.forEach((edition, i) => {
      if (!isRecord(edition)) return
      for (const k of Object.keys(edition)) {
        if (!EDITION_KEYS.has(k)) unknown.push(`editions[${i}].${k}`)
      }
      if (!Array.isArray(edition.shows)) return
      edition.shows.forEach((show, j) => {
        if (!isRecord(show)) return
        for (const k of Object.keys(show)) {
          if (!SHOW_KEYS.has(k)) unknown.push(`editions[${i}].shows[${j}].${k}`)
        }
      })
    })
  }

  return unknown
}
