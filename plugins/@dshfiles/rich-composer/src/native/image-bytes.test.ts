import { describe, expect, it } from 'vitest'

import { sniffImageType } from './image-bytes.ts'

const bytes = (...values: readonly (number | string)[]): Uint8Array =>
  Uint8Array.from(values.flatMap(value => typeof value === 'string' ? [...value].map(character => character.charCodeAt(0)) : [value]))

describe('sniffImageType', () => {
  it.each([
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe1, 0, 0, 'Exif'), 'image/jpeg'],
    ['PNG', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d), 'image/png'],
    ['GIF', bytes('GIF89a', 0, 0, 0, 0, 0, 0), 'image/gif'],
    ['WebP', bytes('RIFF', 0, 0, 0, 0, 'WEBP'), 'image/webp'],
  ])('names %s by its bytes', (_name, data, expected) => {
    expect(sniffImageType(data)).toBe(expected)
  })

  it('names nothing for a HEIF photo a phone gallery labelled as JPEG', () => {
    expect(sniffImageType(bytes(0, 0, 0, 0x18, 'ftypheic'))).toBeUndefined()
  })

  it('names nothing for truncated data', () => {
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeUndefined()
  })
})
