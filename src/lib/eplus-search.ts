/**
 * The e+ search API, for the one call this service makes: list the performances (koen) under a
 * kogyo + sub code.
 *
 * A port of ecs-api's `PushTest::Common.search` (lib/push_test/common.rb:30) on top of
 * `EplusSearchApiV3#get` (lib/eplus_search_api_v3.rb): the same endpoint, the same query, the same
 * `X-APIToken` header and agent name, and the same answer — one `"<kogyo>-<sub>-<koen>"` string
 * per performance, at most 200 of them with no paging (docs/create_topics_edition_flow.md,
 * "Things that catch people out").
 *
 * Any answer other than 200 with the expected shape, and any failure to reach the API at all,
 * throws SearchUnavailableError. The normal-push service turns that into 502 NP-0006.
 */

/** Performances under one code: `"901450-0010-001"`, … */
export type SearchKoen = (kogyoCode: string, kogyoSubCode: string | null) => Promise<string[]>

export class SearchUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SearchUnavailableError'
  }
}

/** ecs-api asks for this many and never pages. */
const PAGE_SIZE = 200
const AGENT_NAME = 'Epica/2.0'
/** HTTPClient's default receive timeout, which is what ecs-api runs with. */
const TIMEOUT_MS = 60_000

interface KoenRecord {
  kogyo_code: string
  kogyo_sub_code: string
  koen_code: string
}

const isKoenRecord = (v: unknown): v is KoenRecord =>
  typeof v === 'object' &&
  v !== null &&
  ['kogyo_code', 'kogyo_sub_code', 'koen_code'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string')

export function createSearchKoen({ url, key }: { url: string; key: string }): SearchKoen {
  return async (kogyoCode, kogyoSubCode) => {
    // EplusSearchApiV3 writes a list as repeated `key=value` (no brackets), and a nil as `key=`.
    const query = new URLSearchParams({
      kogyo_code_list: kogyoCode,
      kogyo_sub_code_list: kogyoSubCode ?? '',
      shutoku_start_ichi: '1',
      shutoku_kensu: String(PAGE_SIZE),
    })
    const target = `${url.replace(/\/+$/, '')}/koen?${query}`

    let res: Response
    try {
      res = await fetch(target, {
        headers: { 'X-APIToken': key, 'User-Agent': AGENT_NAME, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (cause) {
      throw new SearchUnavailableError(`GET /koen could not be sent`, { cause })
    }

    if (res.status !== 200) {
      throw new SearchUnavailableError(`GET /koen answered ${res.status}`)
    }

    let body: unknown
    try {
      body = await res.json()
    } catch (cause) {
      throw new SearchUnavailableError('GET /koen answered with a body that is not JSON', { cause })
    }

    const list = (body as { data?: { record_list?: unknown } } | null)?.data?.record_list
    if (!Array.isArray(list) || !list.every(isKoenRecord)) {
      throw new SearchUnavailableError('GET /koen answered without data.record_list')
    }
    return list.map((k) => `${k.kogyo_code}-${k.kogyo_sub_code}-${k.koen_code}`)
  }
}
