/**
 * Integration: real MySQL (docker compose up -d), real files in a temp dir.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { noopUploadToS3 } from '../../test/fixtures.js'
import { createAutoAppPush } from './service.js'

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
/** Fake by default so tests never touch real AWS; individual tests override it. */
let uploadToS3: (key: string, content: string) => Promise<void>

beforeEach(async () => {
  fileDir = await mkdtemp(path.join(tmpdir(), 'push-test-'))
  uploadToS3 = noopUploadToS3
})

afterEach(async () => {
  await prisma.pushEdition.deleteMany()
  await prisma.pushRun.deleteMany()
  await rm(fileDir, { recursive: true, force: true })
})

afterAll(() => prisma.$disconnect())

/** Runs the service and returns the AppError it threw. */
async function failure(input: unknown): Promise<AppError> {
  try {
    await createAutoAppPush(input, { now: NOW, fileDir, uploadToS3 })
  } catch (err) {
    if (err instanceof AppError) return err
    throw err
  }
  throw new Error('expected createAutoAppPush to throw')
}

describe('createAutoAppPush: rejections', () => {
  it('throws 400 AP-0004 for an unknown key, before validating anything', async () => {
    const err = await failure({ ...body(), login_ids: [], extra: 1 })

    expect(err.status).toBe(400)
    expect(err.body.error_id).toBe('AP-0004')
    expect(await prisma.pushRun.count()).toBe(0)
  })

  it('throws 422 AP-0001 with the field errors and writes nothing', async () => {
    const err = await failure({ ...body(), login_ids: [] })

    expect(err.status).toBe(422)
    expect(err.body.errors.map((e) => e.error_id)).toEqual(['AP-0102'])
    expect(await prisma.pushRun.count()).toBe(0)
  })

  it('throws 500 AP-0005 when the file cannot be written', async () => {
    // A path that is a file where a directory is needed: mkdir -p fails on it.
    await rm(fileDir, { recursive: true, force: true })
    fileDir = path.join(tmpdir(), `push-test-file-${Date.now()}`)
    await writeFile(fileDir, 'not a dir')

    const err = await failure(body())

    expect(err.status).toBe(500)
    expect(err.body.error_id).toBe('AP-0005')
    expect(err.cause).toBeDefined()
    expect(await prisma.pushRun.count()).toBe(0)
  })

  it('throws 500 AP-0006 when the S3 upload fails', async () => {
    uploadToS3 = async () => {
      throw new Error('S3 is down')
    }

    const err = await failure(body())

    expect(err.status).toBe(500)
    expect(err.body.error_id).toBe('AP-0006')
    expect(err.cause).toBeDefined()
    expect(await prisma.pushRun.count()).toBe(0)
  })
})

describe('createAutoAppPush: success', () => {
  it('writes one file per edition with the exact content', async () => {
    await createAutoAppPush(body(), { now: NOW, fileDir, uploadToS3 })

    const written = await readFile(path.join(fileDir, '20260922/app_push/20260922113000_H020064377_app_push.csv'), 'utf8')
    expect(written).toBe('"H020064377","イープラスのWEBページへ遷移します。","","03"\n"https://eplus.jp/"\n"502001185"\n"602028303"\n')
  })

  it('records the run and its editions', async () => {
    const { runId } = await createAutoAppPush(
      { ...body(), editions: [edition, { ...edition, publish_hour_min: [12, 0], deliv_id: 'H020064378' }] },
      { now: NOW, fileDir, uploadToS3 },
    )

    const run = await prisma.pushRun.findUniqueOrThrow({ where: { id: runId }, include: { editions: { orderBy: { id: 'asc' } } } })
    expect(run.date.toISOString()).toBe('2026-09-22T00:00:00.000Z')
    expect(run.distributeNow).toBe(false)
    expect(run.loginIds).toEqual(['502001185', '602028303'])
    expect(run.editions).toHaveLength(2)
    expect(run.editions[0]).toMatchObject({
      delivId: 'H020064377',
      title: 'イープラスのWEBページへ遷移します。',
      linkType: '03',
      linkItem: 'https://eplus.jp/',
      filePath: '20260922/app_push/20260922113000_H020064377_app_push.csv',
    })
    expect(run.editions[0]?.publishAt.toISOString()).toBe('2026-09-22T02:30:00.000Z')
    expect(run.editions[1]?.filePath).toBe('20260922/app_push/20260922120000_H020064378_app_push.csv')
  })

  it('overwrites an existing file for the same time and deliv_id', async () => {
    await createAutoAppPush(body(), { now: NOW, fileDir, uploadToS3 })
    await createAutoAppPush({ ...body(), login_ids: ['999'] }, { now: NOW, fileDir, uploadToS3 })

    const written = await readFile(path.join(fileDir, '20260922/app_push/20260922113000_H020064377_app_push.csv'), 'utf8')
    expect(written.endsWith('"999"\n')).toBe(true)
    expect(await prisma.pushRun.count()).toBe(2)
  })
})
