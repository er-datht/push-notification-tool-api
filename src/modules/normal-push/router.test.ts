/**
 * The HTTP surface, end to end: real app (createApp with a fixed clock and a stubbed e+ search
 * API), real MySQL. Token is TEST_API_TOKEN (vitest.config.ts). No files are involved — unlike
 * auto-app-push's router test, there is no temp dir to manage.
 */
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { createApp } from '../../app.js'
import { SearchUnavailableError, type SearchKoen } from '../../lib/eplus-search.js'
import { prisma } from '../../lib/prisma.js'
import { TEST_API_TOKEN } from '../../test/fixtures.js'

const PATH = '/api/notifications/normal-pushes'
const NOW = new Date('2026-09-22T01:00:00Z') // 10:00 Tokyo

const show = { code: '9014500001-P0030056', performer_id: 2762, hook: 'firstcome' }
const edition = { publish_hour_min: [17, 0], shows: [show, { ...show, code: '9014500001-P0030065', hook: 'preorder' }] }
const body = () => ({ date: '2026-09-22', editions: [edition], distribute_now: false })

afterEach(async () => {
  await prisma.normalPushTopic.deleteMany()
  await prisma.normalPushShow.deleteMany()
  await prisma.normalPushEdition.deleteMany()
  await prisma.normalPushRun.deleteMany()
})

afterAll(() => prisma.$disconnect())

/** Two performances under whatever sub code is asked about. */
const twoKoen: SearchKoen = async (kogyo, sub) => [`${kogyo}-${sub}-001`, `${kogyo}-${sub}-002`]

const app = (searchKoen: SearchKoen = twoKoen) => createApp({ clock: () => NOW, searchKoen })
const post = (searchKoen?: SearchKoen) => request(app(searchKoen)).post(PATH).set('X-APIToken', TEST_API_TOKEN)

describe(`POST ${PATH}: auth`, () => {
  // requireApiToken/errorHandler currently import their error builders from
  // auto-app-push/errors.ts regardless of which router is hit, so these responses carry AP-
  // ids, not NP- ids — a documented pre-existing coupling, not a bug in this test.
  it('401 AP-0002 without a token', async () => {
    const res = await request(app()).post(PATH).send(body())

    expect(res.status).toBe(401)
    expect(res.body.error.error_id).toBe('AP-0002')
  })

  it('401 with a wrong token', async () => {
    const res = await request(app()).post(PATH).set('X-APIToken', 'nope').send(body())

    expect(res.status).toBe(401)
  })
})

describe(`POST ${PATH}: bad requests`, () => {
  it('400 AP-0003 when the body is not JSON (same shared-middleware coupling as the 401 case)', async () => {
    const res = await post().set('Content-Type', 'application/json').send('{"date": ')

    expect(res.status).toBe(400)
    expect(res.body.error.error_id).toBe('AP-0003')
  })

  it('400 NP-0004 when login_ids is sent', async () => {
    const res = await post().send({ ...body(), login_ids: ['502001185'] })

    expect(res.status).toBe(400)
    expect(res.body.error.error_id).toBe('NP-0004')
    expect(res.body.error.errors).toEqual([expect.objectContaining({ error_id: 'NP-0004', field: 'login_ids' })])
  })

  it('422 NP-0001 with one entry per problem, down to the show', async () => {
    const res = await post().send({
      ...body(),
      editions: [{ publish_hour_min: [21, 30], shows: [show, { ...show, hook: 'mixed' }] }],
    })

    expect(res.status).toBe(422)
    expect(res.body.error).toMatchObject({ error_id: 'NP-0001', code: 'INVALID_PARAMETER', title: 'Invalid parameter' })
    expect(res.body.error.errors).toEqual([
      expect.objectContaining({ error_id: 'NP-0207', field: 'editions[0].publish_hour_min' }),
      expect.objectContaining({ error_id: 'NP-0205', field: 'editions[0].shows[1].hook' }),
    ])
    expect(await prisma.normalPushRun.count()).toBe(0)
  })

  it('502 NP-0006 when a code needs expanding and the e+ search API fails', async () => {
    const res = await post(async () => {
      throw new SearchUnavailableError('GET /koen answered 503')
    }).send(body())

    expect(res.status).toBe(502)
    expect(res.body.error).toEqual({
      error_id: 'NP-0006',
      code: 'SEARCH_UNAVAILABLE',
      title: 'Search API unavailable',
      message: 'The e+ search API could not be reached, so the show codes could not be expanded. (NP-0006)',
      errors: [],
    })
    expect(await prisma.normalPushRun.count()).toBe(0)
  })

  it('422 NP-0208 when the same hour is sent again', async () => {
    expect((await post().send(body())).status).toBe(201)
    const res = await post().send(body())

    expect(res.status).toBe(422)
    expect(res.body.error.errors).toEqual([expect.objectContaining({ error_id: 'NP-0208', field: 'editions[0].publish_hour_min' })])
  })
})

describe(`POST ${PATH}: accepted`, () => {
  it('201 with the created editions, as ecs-api answers — topics_count after expansion', async () => {
    // Two sub-only codes, each expanded into two performances by the stub.
    const res = await post().send(body())

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      editions: [
        {
          id: expect.any(Number),
          period_start: '2026-09-22T17:00:00+09:00',
          period_end: '2026-09-22T18:00:00+09:00',
          status: 'edited',
          topics_count: 4,
        },
      ],
    })
    expect(await prisma.normalPushShow.count()).toBe(2)
    expect(await prisma.normalPushTopic.count()).toBe(4)
  })

  it('uses today in Tokyo when date is omitted', async () => {
    const { date: _drop, ...noDate } = body()
    const res = await post().send(noDate)

    expect(res.status).toBe(201)
    expect(res.body.editions[0].period_start).toBe('2026-09-22T17:00:00+09:00')
  })
})
