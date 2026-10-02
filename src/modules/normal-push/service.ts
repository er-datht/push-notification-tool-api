/**
 * Builds what ecs-api's `PushTest::Common.create_topics_edition` builds — an edition per entry of
 * `editions`, and a topic per performance of each show — step by step as
 * docs/create_topics_edition_flow.md describes it. What happens to a request, in order:
 *   1. unknown keys?            -> 400 NP-0004, nothing written (login_ids lands here)
 *   2. rules (validate.ts)      -> 422 NP-0001, nothing written
 *   3. overlap with editions already in the database -> 422 NP-0001 / NP-0208, nothing written
 *   4. turn every show into its performances (flow doc, step 3): a code with a P021 part is one;
 *      one without it is expanded through the e+ search API, up to 200 -> 502 NP-0006 if that
 *      API fails, nothing written
 *   5. one normal_push_runs row with its editions (period_start/period_end, status `edited`),
 *      their shows as sent and their topics (one nested create, so all land or none do)
 * A failure in 5 is 500 NP-0005 with the original error as `cause`.
 *
 * Where this differs from ecs-api on purpose:
 * - Every search call happens before anything is written. ecs-api creates the editions one by
 *   one, so a search failure on the second leaves the first behind.
 * - Nothing after `edited!` is done: no `set_notifications_async`, no subscriptions, no Sidekiq,
 *   no SNS. `distribute_now` is recorded only. The status therefore stays `edited`.
 * - Performers are not looked up or created; the topic keeps the performer's URI only.
 */
import { SearchUnavailableError, type SearchKoen } from '../../lib/eplus-search.js'
import { formatTokyoIso } from '../../lib/time.js'
import { prisma } from '../../lib/prisma.js'
import { creationFailed, fieldError, invalidParameter, searchUnavailable, unknownParameters } from './errors.js'
import { findUnknownKeys } from './schema.js'
import { validate, WINDOW_MS, type ValidShow } from './validate.js'

export interface CreateDeps {
  now: Date
  /** The e+ search API's koen list. Injected so tests never reach the network. */
  searchKoen: SearchKoen
}

/** One entry of the 201 body, in the order the editions were sent. */
export interface CreatedEdition {
  id: number
  period_start: string
  period_end: string
  status: string
  topics_count: number
}

/** URI::EplusTag's prefix, as in `tag:eplus.jp,2010:shows/901450-0010-001`. */
const TAG = 'tag:eplus.jp,2010:'
/** create_topics_edition gives every topic this one area (全国): no filtering by prefecture. */
const AREA_ANYWHERE = 'anywhere'

/** `"%010d" % performer_id` — the performer's id_str — inside its URI. */
const performerUri = (performerId: bigint) => `${TAG}performers/${performerId.toString().padStart(10, '0')}`

/**
 * The show ids one show stands for (flow doc, step 3): itself when the code names a koen,
 * otherwise every koen the e+ search API lists under its kogyo + sub code.
 */
async function showIds({ parsed }: ValidShow, searchKoen: SearchKoen): Promise<string[]> {
  if (parsed.koenCode !== null) return [`${parsed.kogyoCode}-${parsed.kogyoSubCode ?? ''}-${parsed.koenCode}`]
  return searchKoen(parsed.kogyoCode, parsed.kogyoSubCode)
}

export async function createNormalPush(body: unknown, deps: CreateDeps): Promise<{ editions: CreatedEdition[] }> {
  const unknown = findUnknownKeys(body)
  if (unknown.length > 0) throw unknownParameters(unknown)

  const result = validate(body, deps.now)
  if (!result.ok) throw invalidParameter(result.errors)
  const input = result.value

  // ecs-api's overlapping_window?: an existing edition that covers any moment of the new window.
  const taken = await Promise.all(
    input.editions.map(({ periodStart }) =>
      prisma.normalPushEdition.findFirst({
        where: {
          periodStart: { lt: new Date(periodStart.getTime() + WINDOW_MS) },
          periodEnd: { gt: periodStart },
        },
        select: { id: true },
      }),
    ),
  )
  const overlaps = taken.flatMap((hit, i) => (hit ? [fieldError('NP-0208', `editions[${i}].publish_hour_min`)] : []))
  if (overlaps.length > 0) throw invalidParameter(overlaps)

  // One after another, in request order, like create_topics_edition's `shows.map`.
  const topicsByEdition: { subjectUri: string; objectUri: string; hook: string }[][] = []
  try {
    for (const edition of input.editions) {
      const topics: { subjectUri: string; objectUri: string; hook: string }[] = []
      for (const show of edition.shows) {
        for (const id of await showIds(show, deps.searchKoen)) {
          topics.push({ subjectUri: performerUri(show.performerId), objectUri: `${TAG}shows/${id}`, hook: show.hook })
        }
      }
      topicsByEdition.push(topics)
    }
  } catch (cause) {
    if (cause instanceof SearchUnavailableError) throw searchUnavailable(cause)
    throw cause
  }

  try {
    const run = await prisma.normalPushRun.create({
      data: {
        // A calendar date with no time; stored as DATE, read back as UTC midnight.
        date: new Date(`${input.date}T00:00:00Z`),
        distributeNow: input.distributeNow,
        editions: {
          create: input.editions.map((edition, i) => ({
            periodStart: edition.periodStart,
            periodEnd: new Date(edition.periodStart.getTime() + WINDOW_MS),
            // create_topics_edition ends with `edited!` once its topics are saved.
            status: 'edited',
            editedAt: deps.now,
            shows: {
              create: edition.shows.map(({ code, performerId, hook }) => ({ code, performerId, hook })),
            },
            topics: {
              create: (topicsByEdition[i] ?? []).map((topic) => ({
                ...topic,
                willPublishAt: edition.periodStart,
                area: AREA_ANYWHERE,
              })),
            },
          })),
        },
      },
      select: {
        editions: {
          select: { id: true, periodStart: true, periodEnd: true, status: true, _count: { select: { topics: true } } },
          orderBy: { id: 'asc' },
        },
      },
    })
    return {
      editions: run.editions.map((edition) => ({
        // The mariadb driver hands back BigInt, which JSON.stringify refuses.
        id: Number(edition.id),
        period_start: formatTokyoIso(edition.periodStart),
        period_end: formatTokyoIso(edition.periodEnd),
        status: edition.status,
        topics_count: edition._count.topics,
      })),
    }
  } catch (cause) {
    throw creationFailed(cause)
  }
}
