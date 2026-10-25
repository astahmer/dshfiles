import { describe, expect, it } from 'vitest'
import { type RawSourceMap, SourceMap } from '../src/sourcemap.js'

describe('decodeVlq', () => {
  it('decodes a zero segment', () => {
    expect(SourceMap.decodeVlq('AAAA')).toEqual([0, 0, 0, 0])
  })

  it('decodes a negative delta', () => {
    expect(SourceMap.decodeVlq('D')).toEqual([-1])
  })

  it('rejects a character outside the base64 alphabet', () => {
    expect(() => SourceMap.decodeVlq('!')).toThrow()
  })
})

describe('findGeneratedPosition', () => {
  it('returns the one-based line and zero-based column', () => {
    expect(SourceMap.findGeneratedPosition({ text: 'aaa\nbbbccc', needle: 'ccc' })).toEqual({ line: 2, column: 3 })
  })

  it('returns undefined when the needle is absent', () => {
    expect(SourceMap.findGeneratedPosition({ text: 'abc', needle: 'zzz' })).toBeUndefined()
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
    const found = SourceMap.originalPositionFor({ map: map('AAAA,IACA'), position: { line: 1, column: 5 } })
    expect(found).toEqual({ source: 'src/a.ts', line: 2, column: 0 })
  })

  it('uses the last segment before the column', () => {
    const found = SourceMap.originalPositionFor({ map: map('AAAA,IACA'), position: { line: 1, column: 1 } })
    expect(found).toEqual({ source: 'src/a.ts', line: 1, column: 0 })
  })

  it('returns undefined past the mapped lines', () => {
    expect(SourceMap.originalPositionFor({ map: map('AAAA'), position: { line: 3, column: 0 } })).toBeUndefined()
  })
})

describe('sourceContentPosition', () => {
  it('finds a text occurrence in sourcesContent', () => {
    expect(SourceMap.sourceContentPosition({ map: map('AAAA'), needle: 'second' })).toEqual({ source: 'src/a.ts', line: 2, column: 0 })
  })

  it('returns undefined when the source content is absent', () => {
    expect(SourceMap.sourceContentPosition({ map: map('AAAA', ['src/a.ts'], [null]), needle: 'second' })).toBeUndefined()
  })
})
