/**
 * What happens to an accepted request, in order:
 *   1. unknown keys?            -> 400 NP-0004, nothing written (login_ids lands here)
 *   2. rules (validate.ts)      -> 422 NP-0001, nothing written
 *   3. overlap with editions already in the database -> 422 NP-0001 / NP-0208, nothing written
 *   4. one normal_push_runs row with its editions and their shows (one nested create, so all
 *      land or none do)
 * A failure in 4 is 500 NP-0005 with the original error as `cause`.
 *
 * No file is written and nothing is delivered: a 201 here means "validated and recorded".
 * Real delivery for Normal Push is ecs-api's job. The 201 body mirrors ecs-api's, except
 * `topics_count` is simply the number of shows — this service does not expand a code into its
 * performances.
 */
import { formatTokyoIso } from '../../lib/time.js'
import { prisma } from '../../lib/prisma.js'
import { creationFailed, fieldError, invalidParameter, unknownParameters } from './errors.js'
import { findUnknownKeys } from './schema.js'
import { validate, WINDOW_MS } from './validate.js'

export interface CreateDeps {
  now: Date
}

/** One entry of the 201 body, in the order the editions were sent. */
export interface CreatedEdition {
  id: number
  period_start: string
  period_end: string
  status: 'edited'
  topics_count: number
}

export async function createNormalPush(body: unknown, deps: CreateDeps): Promise<{ editions: CreatedEdition[] }> {
  const unknown = findUnknownKeys(body)
  if (unknown.length > 0) throw unknownParameters(unknown)

  const result = validate(body, deps.now)
  if (!result.ok) throw invalidParameter(result.errors)
  const input = result.value

  // A window overlaps an existing one when their starts are less than an hour apart.
  const taken = await Promise.all(
    input.editions.map((edition) =>
      prisma.normalPushEdition.findFirst({
        where: {
          publishAt: {
            gt: new Date(edition.publishAt.getTime() - WINDOW_MS),
            lt: new Date(edition.publishAt.getTime() + WINDOW_MS),
          },
        },
        select: { id: true },
      }),
    ),
  )
  const overlaps = taken.flatMap((hit, i) => (hit ? [fieldError('NP-0208', `editions[${i}].publish_hour_min`)] : []))
  if (overlaps.length > 0) throw invalidParameter(overlaps)

  try {
    const run = await prisma.normalPushRun.create({
      data: {
        // A calendar date with no time; stored as DATE, read back as UTC midnight.
        date: new Date(`${input.date}T00:00:00Z`),
        distributeNow: input.distributeNow,
        editions: {
          create: input.editions.map((edition) => ({
            publishAt: edition.publishAt,
            shows: { create: edition.shows },
          })),
        },
      },
      select: {
        editions: {
          select: { id: true, publishAt: true, _count: { select: { shows: true } } },
          orderBy: { id: 'asc' },
        },
      },
    })
    return {
      editions: run.editions.map((edition) => ({
        // The mariadb driver hands back BigInt, which JSON.stringify refuses.
        id: Number(edition.id),
        period_start: formatTokyoIso(edition.publishAt),
        period_end: formatTokyoIso(new Date(edition.publishAt.getTime() + WINDOW_MS)),
        status: 'edited',
        topics_count: edition._count.shows,
      })),
    }
  } catch (cause) {
    throw creationFailed(cause)
  }
}
