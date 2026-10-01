/**
 * Integration: real MySQL (docker compose up -d mysql). The e+ search API is a stub — no test
 * reaches the network. No files are written for this push type, so unlike auto-app-push's
 * service test there is no temp dir to manage.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { SearchUnavailableError, type SearchKoen } from '../../lib/eplus-search.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { createNormalPush } from './service.js'

const NOW = new Date('2026-09-22T01:00:00Z') // 10:00 Tokyo

/** A code with no P021 part: expanded through the search API. */
const SUB_ONLY = '9014500001-P0030056'
/** A code naming one performance: no search call. */
const ONE_KOEN = '9011910001-P0030007P021005'

const show = { code: ONE_KOEN, performer_id: 2762, hook: 'firstcome' }
const edition = (hour = 17, shows: unknown[] = [show]) => ({ publish_hour_min: [hour, 0], shows })
const body = (editions: unknown[] = [edition()]) => ({ date: '2026-09-22', editions, distribute_now: false })

/** Answers like GET /koen with three performances under whatever it is asked about. */
const threeKoen = () =>
  vi.fn<SearchKoen>(async (kogyo, sub) => ['001', '002', '003'].map((koen) => `${kogyo}-${sub}-${koen}`))

const run = (input: unknown, searchKoen: SearchKoen = threeKoen()) => createNormalPush(input, { now: NOW, searchKoen })

afterEach(async () => {
  await prisma.normalPushTopic.deleteMany()
  await prisma.normalPushShow.deleteMany()
  await prisma.normalPushEdition.deleteMany()
  await prisma.normalPushRun.deleteMany()
})

afterAll(() => prisma.$disconnect())

/** Runs the service and returns the AppError it threw. */
async function failure(input: unknown, searchKoen?: SearchKoen): Promise<AppError> {
  try {
    await run(input, searchKoen)
  } catch (err) {
    if (err instanceof AppError) return err
    throw err
  }
  throw new Error('expected createNormalPush to throw')
}

describe('createNormalPush: rejections', () => {
  it('throws 400 NP-0004 for login_ids, before validating anything', async () => {
    const err = await failure({ ...body(), login_ids: ['502001185'] })

    expect(err.status).toBe(400)
    expect(err.body.error_id).toBe('NP-0004')
    expect(err.body.errors.map((e) => e.field)).toEqual(['login_ids'])
    expect(await prisma.normalPushRun.count()).toBe(0)
  })

  it('throws 422 NP-0001 with the field errors, without searching and without writing', async () => {
    const search = threeKoen()
    const err = await failure(body([edition(17, [{ ...show, code: SUB_ONLY, hook: 'mixed' }])]), search)

    expect(err.status).toBe(422)
    expect(err.body.errors.map((e) => e.error_id)).toEqual(['NP-0205'])
    expect(search).not.toHaveBeenCalled()
    expect(await prisma.normalPushRun.count()).toBe(0)
  })

  it('throws 422 NP-0208 when a window overlaps an edition already saved', async () => {
    await run(body([edition(17)]))
    const err = await failure(body([edition(19), { publish_hour_min: [17, 30], shows: [show] }]))

    expect(err.status).toBe(422)
    expect(err.body.errors).toEqual([expect.objectContaining({ error_id: 'NP-0208', field: 'editions[1].publish_hour_min' })])
    expect(await prisma.normalPushRun.count()).toBe(1)
  })

  it('allows a window that starts exactly when a saved one ends', async () => {
    await run(body([edition(17)]))
    await expect(run(body([edition(18)]))).resolves.toBeDefined()
  })

  it('throws 502 NP-0006 when the search API fails, and writes nothing — not even earlier editions', async () => {
    // The first edition needs no search; the second one's search fails. ecs-api would have
    // created the first edition already; here nothing is written until every search is done.
    const failing = vi.fn<SearchKoen>(async () => {
      throw new SearchUnavailableError('GET /koen answered 503')
    })
    const err = await failure(body([edition(17), edition(19, [{ ...show, code: SUB_ONLY }])]), failing)

    expect(err.status).toBe(502)
    expect(err.body).toMatchObject({ error_id: 'NP-0006', code: 'SEARCH_UNAVAILABLE', errors: [] })
    expect(err.cause).toBeInstanceOf(SearchUnavailableError)
    expect(await prisma.normalPushRun.count()).toBe(0)
    expect(await prisma.normalPushTopic.count()).toBe(0)
  })

  it('throws 500 NP-0005 when the database write fails', async () => {
    // A valid show id with a long ?query tail: SHOW_ID_FORMAT ignores the query, but the code is
    // stored as sent and overflows the VarChar(64) column.
    const tooLong = `${ONE_KOEN}?${'x'.repeat(80)}`
    const err = await failure(body([edition(17, [{ ...show, code: tooLong }])]))

    expect(err.status).toBe(500)
    expect(err.body.error_id).toBe('NP-0005')
    expect(err.cause).toBeDefined()
    expect(await prisma.normalPushRun.count()).toBe(0)
  })
})

describe('createNormalPush: success', () => {
  it('builds the edition and one topic per performance, as create_topics_edition does', async () => {
    const search = threeKoen()
    const result = await run(
      body([
        edition(17, [{ ...show, code: SUB_ONLY }, { ...show, hook: 'preorder' }]),
        edition(18, [{ ...show, performer_id: 75223 }]),
      ]),
      search,
    )

    // The P021 code is used as is; only the sub-only code is searched, by its 6-digit kogyo.
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('901450', '0056')

    expect(result.editions).toEqual([
      {
        id: expect.any(Number),
        period_start: '2026-09-22T17:00:00+09:00',
        period_end: '2026-09-22T18:00:00+09:00',
        status: 'edited',
        topics_count: 4,
      },
      {
        id: expect.any(Number),
        period_start: '2026-09-22T18:00:00+09:00',
        period_end: '2026-09-22T19:00:00+09:00',
        status: 'edited',
        topics_count: 1,
      },
    ])

    const saved = await prisma.normalPushRun.findFirstOrThrow({
      include: {
        editions: {
          orderBy: { id: 'asc' },
          include: { shows: { orderBy: { id: 'asc' } }, topics: { orderBy: { id: 'asc' } } },
        },
      },
    })
    expect(saved.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
    expect(saved.editions.map((e) => Number(e.id))).toEqual(result.editions.map((e) => e.id))

    const [first, second] = saved.editions
    expect(first?.periodEnd.toISOString()).toBe('2026-09-22T09:00:00.000Z')
    expect(first?.editedAt?.toISOString()).toBe(NOW.toISOString())
    // The shows are kept as sent…
    expect(first?.shows.map((s) => [s.code, s.performerId, s.hook])).toEqual([
      [SUB_ONLY, 2762n, 'firstcome'],
      [ONE_KOEN, 2762n, 'preorder'],
    ])
    // …and the topics are what was built from them.
    expect(first?.topics.map((t) => [t.subjectUri, t.objectUri, t.hook])).toEqual([
      ['tag:eplus.jp,2010:performers/0000002762', 'tag:eplus.jp,2010:shows/901450-0056-001', 'firstcome'],
      ['tag:eplus.jp,2010:performers/0000002762', 'tag:eplus.jp,2010:shows/901450-0056-002', 'firstcome'],
      ['tag:eplus.jp,2010:performers/0000002762', 'tag:eplus.jp,2010:shows/901450-0056-003', 'firstcome'],
      ['tag:eplus.jp,2010:performers/0000002762', 'tag:eplus.jp,2010:shows/901191-0007-005', 'preorder'],
    ])
    expect(first?.topics.every((t) => t.area === 'anywhere' && t.willPublishAt.getTime() === first.periodStart.getTime())).toBe(true)
    expect(second?.topics.map((t) => t.subjectUri)).toEqual(['tag:eplus.jp,2010:performers/0000075223'])
  })

  it('creates an edition with no topics when the search finds no performance, as ecs-api does', async () => {
    const result = await run(body([edition(17, [{ ...show, code: SUB_ONLY }])]), vi.fn<SearchKoen>(async () => []))

    expect(result.editions[0]?.topics_count).toBe(0)
  })

  it('uses today in Tokyo when date is omitted', async () => {
    const { date: _drop, ...noDate } = body()
    await run(noDate)

    const saved = await prisma.normalPushRun.findFirstOrThrow()
    expect(saved.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
  })
})
