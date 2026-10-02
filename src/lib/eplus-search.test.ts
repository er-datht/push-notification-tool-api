import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSearchKoen, SearchUnavailableError } from './eplus-search.js'

const searchKoen = createSearchKoen({ url: 'https://search.example/v3/', key: 'k3y' })

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSearchKoen', () => {
  it('asks GET /koen the way PushTest::Common.search does and returns kogyo-sub-koen ids', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(200, {
        data: {
          record_list: [
            { kogyo_code: '901450', kogyo_sub_code: '0056', koen_code: '001' },
            { kogyo_code: '901450', kogyo_sub_code: '0056', koen_code: '002' },
          ],
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchKoen('901450', '0056')).resolves.toEqual(['901450-0056-001', '901450-0056-002'])

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      'https://search.example/v3/koen?kogyo_code_list=901450&kogyo_sub_code_list=0056&shutoku_start_ichi=1&shutoku_kensu=200',
    )
    expect(init?.headers).toMatchObject({ 'X-APIToken': 'k3y', 'User-Agent': 'Epica/2.0' })
  })

  it('sends an empty kogyo_sub_code_list when the code has no sub part, as EplusSearchApiV3 writes nil', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { data: { record_list: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchKoen('901450', null)).resolves.toEqual([])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('kogyo_sub_code_list=&')
  })

  it.each([
    ['a non-200 answer', async () => json(503, { error: { code: 'X', message: 'down' } })],
    ['a body without data.record_list', async () => json(200, { data: {} })],
    ['a body that is not JSON', async () => new Response('<html>', { status: 200 })],
    [
      'a network failure',
      async () => {
        throw new TypeError('fetch failed')
      },
    ],
  ])('throws SearchUnavailableError on %s', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(impl))

    await expect(searchKoen('901450', '0056')).rejects.toBeInstanceOf(SearchUnavailableError)
  })
})
