/**
 * The one place that reads process.env.
 *
 * Every variable the app needs is declared in the schema below, parsed once at
 * startup, and exported as a typed object. A missing or malformed value stops
 * the process before it listens, with a message naming the variable — a
 * configuration mistake surfaces in the first second, not on the first request
 * that happens to need it.
 *
 * Everything else imports `env` from here. Nothing else touches process.env.
 */
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

// .env is a local convenience. Real environments inject variables from the
// platform (task definition, SSM, ...) and have no .env file at all.
if (process.env.NODE_ENV !== 'production') {
  loadDotenv({ quiet: true })
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // env values are always strings; coerce turns "8080" into 8080 before checking it.
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  // "http://a.com,http://b.com" -> ["http://a.com", "http://b.com"]
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  DATABASE_URL: z.url({ protocol: /^mysql$/ }),
  // Shared secret the FE sends as X-APIToken. Compared in constant time.
  API_TOKEN: z.string().min(1),
  // Where delivery CSV files are written, relative to the process cwd.
  PUSH_FILE_DIR: z.string().default('tmp/push_test'),
})

// `PORT=` in a .env file arrives as "" rather than undefined, which would defeat
// the defaults above. Treat an empty value as "not set".
const raw = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
)

const parsed = schema.safeParse(raw)

if (!parsed.success) {
  // Written straight to stderr rather than through the logger: the logger's own
  // level comes from this file, so it cannot exist yet.
  process.stderr.write(`Invalid environment:\n${z.prettifyError(parsed.error)}\n`)
  process.exit(1)
}

export const env = parsed.data

export type Env = typeof env

/**
 * The business timezone. Delivery windows (08:00–22:00), "today", and every
 * timestamp shown to a tester are in Japan time. The database stays on UTC;
 * conversion happens in application code. Japan has no DST, so a fixed +09:00
 * is exact.
 */
export const BUSINESS_TIMEZONE = 'Asia/Tokyo'
