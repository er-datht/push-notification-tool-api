/**
 * The one PrismaClient for the whole process.
 *
 * Every `new PrismaClient()` opens its own connection pool. Creating one per
 * request, or per module that happens to need the database, exhausts MySQL's
 * connection limit — quietly under `tsx watch`, loudly in production. So the
 * client is built once here and imported everywhere else.
 *
 * Prisma 7 talks to the database through a driver adapter; for MySQL that is
 * @prisma/adapter-mariadb on top of the `mariadb` driver. The adapter takes the
 * same DATABASE_URL the CLI uses.
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

import { PrismaClient } from '../generated/prisma/client.js'
import { env } from './env.js'

const adapter = new PrismaMariaDb(env.DATABASE_URL)

export const prisma = new PrismaClient({
  adapter,
  // Query text at debug level is useful while learning what the ORM sends;
  // it is far too noisy for a real environment.
  log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
})
