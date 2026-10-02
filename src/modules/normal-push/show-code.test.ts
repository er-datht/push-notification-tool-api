import { describe, expect, it } from 'vitest'

import { parseShowCode } from './show-code.js'

describe('parseShowCode', () => {
  it('reads a full code that points at one performance', () => {
    expect(parseShowCode('9028330001-P0030007P021001')).toEqual({
      kogyoCode: '902833',
      tourCode: '0001',
      kogyoSubCode: '0007',
      koenCode: '001',
    })
  })

  it('reads a code with no koen part — the one the e+ search API expands', () => {
    expect(parseShowCode('9014500001-P0030010')).toEqual({
      kogyoCode: '901450',
      tourCode: '0001',
      kogyoSubCode: '0010',
      koenCode: null,
    })
  })

  it('accepts a bare kogyo + tour, as SHOW_ID_FORMAT does', () => {
    expect(parseShowCode('9014500001')).toEqual({ kogyoCode: '901450', tourCode: '0001', kogyoSubCode: null, koenCode: null })
  })

  it('takes the parts in either order, a later one of the same kind winning', () => {
    expect(parseShowCode('9014500001-P021005P0030010')).toMatchObject({ kogyoSubCode: '0010', koenCode: '005' })
    expect(parseShowCode('9014500001-P0030010P0030020')).toMatchObject({ kogyoSubCode: '0020', koenCode: null })
  })

  it('ignores a ?query tail', () => {
    expect(parseShowCode('9014500001-P0030010P021001?foo=bar')).toMatchObject({ kogyoSubCode: '0010', koenCode: '001' })
  })

  it.each([
    ['[公演]9014500001-P0030056', 'a pasted prefix'],
    ['901450001-P0030056', 'one digit short of kogyo + tour'],
    ['9014500001-P003056', 'a sub code of 3 digits'],
    ['9014500001-P0030056P02101', 'a koen code of 2 digits'],
    ['9014500001-', 'a dash with no part'],
    ['9014500001-P0030056 ', 'trailing space'],
  ])('rejects %s (%s)', (code) => {
    expect(parseShowCode(code)).toBeNull()
  })
})
