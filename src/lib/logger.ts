/**
 * Structured logging with pino.
 *
 * Every line is a JSON object ({ level, time, msg, ...fields }), so a log
 * aggregator can filter on fields instead of grepping text. In development the
 * same lines go through pino-pretty for a readable console; that package is a
 * devDependency, so production never loads it.
 *
 * Use this instead of console.log: `logger.info({ user_id }, 'run created')`.
 * Objects first, message second — that is pino's calling convention.
 */
import { pino } from 'pino'

import { env } from './env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
})
