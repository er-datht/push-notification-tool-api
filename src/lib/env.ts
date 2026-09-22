/**
 * The one place that reads process.env.
 *
 * Every variable the app needs is declared in the schema below, parsed once at
 * startup, and exported as a typed object. A missing or malformed value stops
 * the process before it listens, with a message naming the variable — a
 * configuration mistake surfaces in the first second, not on the first request
 * that happens to need it.
 *
 * **No defaults.** Every variable must be set, and its value lives only in the
 * environment (`.env` locally, the platform's own configuration elsewhere).
 * A fallback here would be a second, invisible place to look for a value, and
 * would let a forgotten variable ship silently as "whatever the code assumed".
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
  NODE_ENV: z.enum(['development', 'test', 'production']),
  // env values are always strings; coerce turns the text into a number before
  // checking it.
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  // "http://a.com,http://b.com" -> ["http://a.com", "http://b.com"]
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  DATABASE_URL: z.url({ protocol: /^mysql$/ }),
  // Shared secret the FE sends as X-APIToken. Compared in constant time.
  API_TOKEN: z.string().min(1),
  // Where delivery CSV files are written, relative to the process cwd.
  PUSH_FILE_DIR: z.string().min(1),
})

// A key with no value in .env (`PORT=`) arrives as "" rather than undefined.
// Both mean "not set", and the error should say so rather than complain about
// an empty string.
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
