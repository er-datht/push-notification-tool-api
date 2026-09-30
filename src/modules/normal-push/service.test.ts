/**
 * Integration: real MySQL (docker compose up -d). No files are written for this push type, so
 * unlike auto-app-push's service test there is no temp dir to manage.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { createNormalPush } from './service.js'

const NOW = new Date('2026-09-22T01:00:00Z') // 10:00 Tokyo

const show = { code: '9014500001-P0030056', performer_id: 2762, hook: 'firstcome' }
const edition = (hour = 17, shows: unknown[] = [show]) => ({ publish_hour_min: [hour, 0], shows })
const body = (editions: unknown[] = [edition()]) => ({ date: '2026-09-22', editions, distribute_now: false })

afterEach(async () => {
  await prisma.normalPushShow.deleteMany()
  await prisma.normalPushEdition.deleteMany()
  await prisma.normalPushRun.deleteMany()
})

afterAll(() => prisma.$disconnect())

/** Runs the service and returns the AppError it threw. */
async function failure(input: unknown): Promise<AppError> {
  try {
    await createNormalPush(input, { now: NOW })
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

  it('throws 422 NP-0001 with the field errors and writes nothing', async () => {
    const err = await failure(body([edition(17, [{ ...show, hook: 'mixed' }])]))

    expect(err.status).toBe(422)
    expect(err.body.errors.map((e) => e.error_id)).toEqual(['NP-0205'])
    expect(await prisma.normalPushRun.count()).toBe(0)
  })

  it('throws 422 NP-0208 when a window overlaps an edition already saved', async () => {
    await createNormalPush(body([edition(17)]), { now: NOW })
    const err = await failure(body([edition(19), { publish_hour_min: [17, 30], shows: [show] }]))

    expect(err.status).toBe(422)
    expect(err.body.errors).toEqual([expect.objectContaining({ error_id: 'NP-0208', field: 'editions[1].publish_hour_min' })])
    expect(await prisma.normalPushRun.count()).toBe(1)
  })

  it('throws 500 NP-0005 when the database write fails', async () => {
    // Passes the code pattern (digits + "-P" + digits) but exceeds the VarChar(64) column, so it
    // clears validate() and fails only at the write.
    const tooLong = `${'1'.repeat(80)}-P${'2'.repeat(10)}`
    const err = await failure(body([edition(17, [{ ...show, code: tooLong }])]))

    expect(err.status).toBe(500)
    expect(err.body.error_id).toBe('NP-0005')
    expect(err.cause).toBeDefined()
    expect(await prisma.normalPushRun.count()).toBe(0)
  })
})

describe('createNormalPush: success', () => {
  it('records the run, its editions and their shows, and returns the created editions', async () => {
    const result = await createNormalPush(
      body([edition(17, [show, { ...show, code: '9014500001-P0030065', hook: 'preorder' }]), edition(18, [{ ...show, performer_id: 75223 }])]),
      { now: NOW },
    )

    expect(result.editions).toEqual([
      {
        id: expect.any(Number),
        period_start: '2026-09-22T17:00:00+09:00',
        period_end: '2026-09-22T18:00:00+09:00',
        status: 'edited',
        topics_count: 2,
      },
      {
        id: expect.any(Number),
        period_start: '2026-09-22T18:00:00+09:00',
        period_end: '2026-09-22T19:00:00+09:00',
        status: 'edited',
        topics_count: 1,
      },
    ])

    const run = await prisma.normalPushRun.findFirstOrThrow({
      include: { editions: { orderBy: { id: 'asc' }, include: { shows: { orderBy: { id: 'asc' } } } } },
    })
    expect(run.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
    expect(run.editions.map((e) => Number(e.id))).toEqual(result.editions.map((e) => e.id))
    expect(run.editions[0]?.shows.map((s) => [s.code, s.performerId, s.hook])).toEqual([
      ['9014500001-P0030056', 2762n, 'firstcome'],
      ['9014500001-P0030065', 2762n, 'preorder'],
    ])
    expect(run.editions[1]?.shows[0]?.performerId).toBe(75223n)
  })

  it('uses today in Tokyo when date is omitted', async () => {
    const { date: _drop, ...noDate } = body()
    await createNormalPush(noDate, { now: NOW })

    const run = await prisma.normalPushRun.findFirstOrThrow()
    expect(run.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
  })
})
