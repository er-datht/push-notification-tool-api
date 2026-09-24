/**
 * What happens to an accepted request, in order:
 *   1. unknown keys?            -> 400 AP-0004, nothing written
 *   2. rules (validate.ts)      -> 422 AP-0001, nothing written
 *   3. every edition's delivery file written under fileDir AND uploaded to
 *      S3, all in parallel — one object per edition, one call per edition
 *   4. one push_runs row with its push_editions rows (one nested create,
 *      so both land or neither does)
 * A local-write failure in 3 is 500 AP-0005; an S3 failure in 3 is 500
 * AP-0006 (checked after every write/upload has settled — a write failure
 * wins if both kinds happen in the same request); a DB failure in 4 is also
 * AP-0005. All three carry the original error as `cause`. Files already
 * written, or objects already uploaded, when a later step fails stay put —
 * Rails has no rollback either, and the error handler logs the cause.
 *
 * No req/res here: the router passes the parsed body and the things that
 * make this function deterministic in tests: the clock, the directory, and
 * the S3 upload function.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { prisma } from '../../lib/prisma.js'
import { buildDeliveryFile } from './csv.js'
import { creationFailed, invalidParameter, s3UploadFailed, unknownParameters } from './errors.js'
import { findUnknownKeys } from './schema.js'
import { validate } from './validate.js'

export interface CreateDeps {
  now: Date
  /** PUSH_FILE_DIR — absolute, or relative to the process cwd. */
  fileDir: string
  /** Uploads one delivery file's content to S3, keyed by its relative path. */
  uploadToS3: (key: string, content: string) => Promise<void>
}

export async function createAutoAppPush(body: unknown, deps: CreateDeps): Promise<{ runId: bigint }> {
  const unknown = findUnknownKeys(body)
  if (unknown.length > 0) throw unknownParameters(unknown)

  const result = validate(body, deps.now)
  if (!result.ok) throw invalidParameter(result.errors)
  const input = result.value

  const files = input.editions.map((edition) => buildDeliveryFile(edition, input.loginIds))

  // Started together so the local write and the S3 upload of every edition
  // run concurrently rather than as two back-to-back passes; each settles
  // independently so one file's failure doesn't cancel the others.
  const writeSettled = Promise.allSettled(
    files.map(async (file) => {
      const absolute = path.join(deps.fileDir, file.relativePath)
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, file.content, 'utf8')
    }),
  )
  const uploadSettled = Promise.allSettled(files.map((file) => deps.uploadToS3(file.relativePath, file.content)))

  for (const outcome of await writeSettled) {
    if (outcome.status === 'rejected') throw creationFailed(outcome.reason)
  }
  for (const outcome of await uploadSettled) {
    if (outcome.status === 'rejected') throw s3UploadFailed(outcome.reason)
  }

  try {
    const run = await prisma.pushRun.create({
      data: {
        // A calendar date with no time; stored as DATE, read back as UTC midnight.
        date: new Date(`${input.date}T00:00:00Z`),
        distributeNow: input.distributeNow,
        loginIds: input.loginIds,
        editions: {
          create: input.editions.map((edition, i) => ({
            delivId: edition.delivId,
            title: edition.title,
            linkType: edition.linkType,
            linkItem: edition.linkItem,
            publishAt: edition.publishAt,
            filePath: files[i]?.relativePath ?? '',
          })),
        },
      },
      select: { id: true },
    })
    return { runId: run.id }
  } catch (cause) {
    throw creationFailed(cause)
  }
}
