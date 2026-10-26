import { describe, expect, it } from 'vitest'
import { SourceMaps, type RawSourceMap } from '../src/sourcemap.js'

describe('decodeVlq', () => {
  it('decodes a zero segment', () => {
    expect(SourceMaps.decodeVlq('AAAA')).toEqual([0, 0, 0, 0])
  })

  it('decodes a negative delta', () => {
    expect(SourceMaps.decodeVlq('D')).toEqual([-1])
  })

  it('rejects a character outside the base64 alphabet', () => {
    expect(() => SourceMaps.decodeVlq('!')).toThrow()
  })
})

describe('findGeneratedPosition', () => {
  it('returns the one-based line and zero-based column', () => {
    expect(SourceMaps.findGeneratedPosition({ text: 'aaa\nbbbccc', needle: 'ccc' })).toEqual({ line: 2, column: 3 })
  })

  it('returns undefined when the needle is absent', () => {
    expect(SourceMaps.findGeneratedPosition({ text: 'abc', needle: 'zzz' })).toBeUndefined()
  })
})

const map = (mappings: string, sources: string[] = ['src/a.ts'], contents: (string | null)[] = ['first\nsecond']): RawSourceMap => ({
  version: 3,
  sources,
  mappings,
  sourcesContent: contents,
})

describe('originalPositionFor', () => {
  it('maps a generated position to its original source', () => {
    const found = SourceMaps.originalPositionFor({ map: map('AAAA,IACA'), position: { line: 1, column: 5 } })
    expect(found).toEqual({ source: 'src/a.ts', line: 2, column: 0 })
  })

  it('uses the last segment before the column', () => {
    const found = SourceMaps.originalPositionFor({ map: map('AAAA,IACA'), position: { line: 1, column: 1 } })
    expect(found).toEqual({ source: 'src/a.ts', line: 1, column: 0 })
  })

  it('returns undefined past the mapped lines', () => {
    expect(SourceMaps.originalPositionFor({ map: map('AAAA'), position: { line: 3, column: 0 } })).toBeUndefined()
  })
})

describe('sourceContentPosition', () => {
  it('finds a text occurrence in sourcesContent', () => {
    expect(SourceMaps.sourceContentPosition({ map: map('AAAA'), needle: 'second' })).toEqual({ source: 'src/a.ts', line: 2, column: 0 })
  })

  it('returns undefined when the source content is absent', () => {
    expect(SourceMaps.sourceContentPosition({ map: map('AAAA', ['src/a.ts'], [null]), needle: 'second' })).toBeUndefined()
  })
})
