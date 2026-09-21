/**
 * Read by the Prisma CLI (migrate, generate, studio) — not by the app.
 *
 * Prisma 7 moved the datasource URL out of schema.prisma and into this file.
 * The CLI does not load .env on its own, hence the dotenv import. `env()` is
 * Prisma's reader for the variable; the app reads the same one through
 * src/lib/env.ts.
 */
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
