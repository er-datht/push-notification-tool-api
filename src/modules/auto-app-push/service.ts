/**
 * What happens to an accepted request, in order:
 *   1. unknown keys?            -> 400 AP-0004, nothing written
 *   2. rules (validate.ts)      -> 422 AP-0001, nothing written
 *   3. one delivery file per edition under fileDir
 *   4. one push_runs row with its push_editions rows (one nested create,
 *      so both land or neither does)
 * A failure in 3 or 4 is 500 AP-0005 with the original error as `cause`.
 * Files already written when 3 or 4 fails stay on disk — Rails has no rollback
 * either, and the error handler logs the cause.
 *
 * No req/res here: the router passes the parsed body and the two things that
 * make this function deterministic in tests, the clock and the directory.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { prisma } from '../../lib/prisma.js'
import { buildDeliveryFile } from './csv.js'
import { creationFailed, invalidParameter, unknownParameters } from './errors.js'
import { findUnknownKeys } from './schema.js'
import { validate } from './validate.js'

export interface CreateDeps {
  now: Date
  /** PUSH_FILE_DIR — absolute, or relative to the process cwd. */
  fileDir: string
}

export async function createAutoAppPush(body: unknown, deps: CreateDeps): Promise<{ runId: bigint }> {
  const unknown = findUnknownKeys(body)
  if (unknown.length > 0) throw unknownParameters(unknown)

  const result = validate(body, deps.now)
  if (!result.ok) throw invalidParameter(result.errors)
  const input = result.value

  const files = input.editions.map((edition) => buildDeliveryFile(edition, input.loginIds))

  try {
    for (const file of files) {
      const absolute = path.join(deps.fileDir, file.relativePath)
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, file.content, 'utf8')
    }
  } catch (cause) {
    throw creationFailed(cause)
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
