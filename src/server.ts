/**
 * Process entry point: start listening, stop cleanly.
 *
 * Everything about *what* the app does lives in app.ts. This file only owns the
 * lifecycle of the process, which is why it is the one place with listen(),
 * signal handlers and process.exit().
 */
import { createApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'

const app = createApp()

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, node_env: env.NODE_ENV }, 'listening')
})

/**
 * Graceful shutdown. Docker / ECS / PM2 send SIGTERM and wait a grace period
 * before SIGKILL. In that window:
 *   1. server.close()       stop accepting connections, let in-flight requests finish
 *   2. prisma.$disconnect() return pooled connections to MySQL
 *   3. exit(0)
 * Skipping this cuts requests off mid-response and leaves MySQL holding
 * connections until they time out.
 */
async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'shutting down')

  // If something hangs (a request that never ends), do not wait forever.
  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out, exiting')
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  server.close(async (closeErr) => {
    if (closeErr) logger.error({ err: closeErr }, 'error closing server')
    await prisma.$disconnect()
    logger.info('bye')
    process.exit(closeErr ? 1 : 0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown) // Ctrl+C in a terminal
