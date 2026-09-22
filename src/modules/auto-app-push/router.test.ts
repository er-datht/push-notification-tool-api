/**
 * The HTTP surface, end to end: real app (createApp with a fixed clock and a
 * temp dir), real MySQL, real files. Token is TEST_API_TOKEN (vitest.config.ts).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { TEST_API_TOKEN } from '../../test/fixtures.js'

const PATH = '/api/notifications/auto-app-pushes'
const NOW = new Date('2026-09-22T01:00:00Z') // 10:00 Tokyo

const edition = {
  publish_hour_min: [11, 30],
  deliv_id: 'H020064377',
  title: 'イープラスのWEBページへ遷移します。',
  link_type: '03',
  link_item: 'https://eplus.jp/',
}
const body = () => ({ date: '2026-09-22', login_ids: ['502001185', '602028303'], editions: [edition], distribute_now: false })

let fileDir: string

beforeEach(async () => {
  fileDir = await mkdtemp(path.join(tmpdir(), 'push-test-'))
})

afterEach(async () => {
  await prisma.pushEdition.deleteMany()
  await prisma.pushRun.deleteMany()
  await rm(fileDir, { recursive: true, force: true })
})

afterAll(() => prisma.$disconnect())

const app = () => createApp({ clock: () => NOW, fileDir })
const post = () => request(app()).post(PATH).set('X-APIToken', TEST_API_TOKEN)

describe(`POST ${PATH}: auth`, () => {
  it('401 AP-0002 without a token', async () => {
    const res = await request(app()).post(PATH).send(body())

    expect(res.status).toBe(401)
    expect(res.body.error.error_id).toBe('AP-0002')
  })

  it('401 AP-0002 with a wrong token', async () => {
    const res = await request(app()).post(PATH).set('X-APIToken', 'nope').send(body())

    expect(res.status).toBe(401)
  })
})

describe(`POST ${PATH}: bad requests`, () => {
  it('400 AP-0003 when the body is not JSON', async () => {
    const res = await post().set('Content-Type', 'application/json').send('{"date": ')

    expect(res.status).toBe(400)
    expect(res.body.error.error_id).toBe('AP-0003')
  })

  it('400 AP-0004 naming the unknown key', async () => {
    const res = await post().send({ ...body(), sub_type: 'auto_app_push' })

    expect(res.status).toBe(400)
    expect(res.body.error.error_id).toBe('AP-0004')
    expect(res.body.error.errors).toEqual([expect.objectContaining({ error_id: 'AP-0004', field: 'sub_type' })])
  })

  it('422 AP-0001 with one entry per problem across editions', async () => {
    const res = await post().send({
      ...body(),
      editions: [{ ...edition, deliv_id: '' }, { ...edition, link_type: '09' }],
    })

    expect(res.status).toBe(422)
    expect(res.body.error).toMatchObject({ error_id: 'AP-0001', code: 'INVALID_PARAMETER', title: 'Invalid parameter' })
    expect(res.body.error.errors).toEqual([
      { error_id: 'AP-0201', field: 'editions[0].deliv_id', title: 'Invalid parameter', message: 'deliv_id is required (AP-0201)' },
      { error_id: 'AP-0205', field: 'editions[1].link_type', title: 'Invalid parameter', message: 'link_type must be one of 01, 02, 03 (AP-0205)' },
    ])
    expect(await prisma.pushRun.count()).toBe(0)
  })
})

describe(`POST ${PATH}: accepted`, () => {
  it('201 with an empty body, the file written and the run recorded', async () => {
    const res = await post().send(body())

    expect(res.status).toBe(201)
    expect(res.text).toBe('')

    const written = await readFile(path.join(fileDir, '20260922/app_push/20260922113000_H020064377_app_push.csv'), 'utf8')
    expect(written).toBe('"H020064377","イープラスのWEBページへ遷移します。","","03"\n"https://eplus.jp/"\n"502001185"\n"602028303"\n')

    const runs = await prisma.pushRun.findMany({ include: { editions: true } })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.editions).toHaveLength(1)
    expect(runs[0]?.editions[0]?.delivId).toBe('H020064377')
  })

  it('uses today in Tokyo when date is omitted', async () => {
    const { date: _drop, ...noDate } = body()
    const res = await post().send(noDate)

    expect(res.status).toBe(201)
    const run = await prisma.pushRun.findFirstOrThrow()
    expect(run.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
  })
})
