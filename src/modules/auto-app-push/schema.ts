/**
 * The key set of the request body — and nothing else.
 *
 * The contract rejects a parameter it does not know (400 AP-0004) rather than
 * ignoring it, so a stale UI-only field or a typo is caught. This module only
 * answers "which keys are not documented?"; types and values are validate.ts's
 * job. It is a plain function rather than a zod schema on purpose: zod's
 * .strict() inside a union quietly accepts unknown keys in nested arrays.
 */

const TOP_LEVEL_KEYS = new Set(['date', 'login_ids', 'editions', 'distribute_now'])
const EDITION_KEYS = new Set(['publish_hour_min', 'deliv_id', 'title', 'link_type', 'link_item'])

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
    })
  }

  return unknown
}
