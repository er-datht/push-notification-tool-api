/**
 * Byte-for-byte what Rails writes with
 *   CSV.open(path, "w", quote_char: '"', force_quotes: true)
 * in lib/push_test/common.rb#create_auto_app_push_edition.
 */
import { describe, expect, it } from 'vitest'

import { buildDeliveryFile, reduceShowId } from './csv.js'
import type { ValidEdition } from './validate.js'

const edition: ValidEdition = {
  hour: 11,
  minute: 30,
  delivId: 'H020064377',
  title: 'イープラスのWEBページへ遷移します。',
  linkType: '03',
  linkItem: 'https://eplus.jp/',
  publishAt: new Date('2026-09-22T02:30:00Z'), // 11:30 Tokyo
}

describe('reduceShowId', () => {
  it('keeps the 6-digit kogyo code and the 4 digits after P003', () => {
    expect(reduceShowId('9041480001-P0030001P021001')).toBe('904148-0001')
  })

  it('returns anything else unchanged', () => {
    expect(reduceShowId('23542')).toBe('23542')
  })
})

describe('buildDeliveryFile', () => {
  it('names the file from the Tokyo delivery time and the deliv_id', () => {
    expect(buildDeliveryFile(edition, ['1']).relativePath).toBe('20260922/app_push/20260922113000_H020064377_app_push.csv')
  })

  it('writes the header row, the item row and one row per login id, all quoted', () => {
    const { content } = buildDeliveryFile(edition, ['502001185', '602028303'])

    expect(content).toBe(
      '"H020064377","イープラスのWEBページへ遷移します。","","03"\n' + '"https://eplus.jp/"\n' + '"502001185"\n' + '"602028303"\n',
    )
  })

  it('reduces a link_type 01 show id in the item row', () => {
    const { content } = buildDeliveryFile({ ...edition, linkType: '01', linkItem: '9041480001-P0030001P021001' }, ['1'])

    expect(content.split('\n')[1]).toBe('"904148-0001"')
  })

  it('leaves a link_type 02 item unchanged', () => {
    const { content } = buildDeliveryFile({ ...edition, linkType: '02', linkItem: '23542' }, ['1'])

    expect(content.split('\n')[1]).toBe('"23542"')
  })

  it('doubles a double quote inside a value', () => {
    const { content } = buildDeliveryFile({ ...edition, title: 'say "hi"' }, ['1'])

    expect(content.split('\n')[0]).toBe('"H020064377","say ""hi""","","03"')
  })

  it('puts the directory on the Tokyo date even when UTC is still the day before', () => {
    const late = { ...edition, hour: 8, minute: 0, publishAt: new Date('2026-09-21T23:00:00Z') } // 08:00 on the 22nd

    expect(buildDeliveryFile(late, ['1']).relativePath).toBe('20260922/app_push/20260922080000_H020064377_app_push.csv')
  })
})
