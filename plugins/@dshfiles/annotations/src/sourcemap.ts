const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_INDEX = new Map<string, number>(Array.from(BASE64).map((character, index) => [character, index]))

const VLQ_CONTINUATION = 32
const VLQ_SHIFT = 5
const VLQ_MASK = 31

const decodeVlq = (segment: string): number[] => {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const character of segment) {
    const digit = BASE64_INDEX.get(character)
    if (digit === undefined) throw new Error('Invalid source map segment')
    value += (digit & VLQ_MASK) << shift
    if ((digit & VLQ_CONTINUATION) === 0) {
      const negative = (value & 1) === 1
      const magnitude = value >>> 1
      values.push(negative ? -magnitude : magnitude)
      value = 0
      shift = 0
    } else {
      shift += VLQ_SHIFT
    }
  }
  return values
}

export interface RawSourceMap {
  readonly version: number
  readonly sources: readonly string[]
  readonly sourceRoot?: string
  readonly mappings: string
  readonly sourcesContent?: readonly (string | null)[]
}

export interface OriginalPosition {
  readonly source: string
  readonly line: number
  readonly column: number
}

export interface GeneratedPosition {
  readonly line: number
  readonly column: number
}

const findGeneratedPosition = ({ text, needle }: { readonly text: string; readonly needle: string }): GeneratedPosition | undefined => {
  const at = text.indexOf(needle)
  if (at < 0) return undefined
  let line = 1
  let lineStart = 0
  for (let index = 0; index < at; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: at - lineStart }
}

const originalPositionFor = ({ map, position }: { readonly map: RawSourceMap; readonly position: GeneratedPosition }): OriginalPosition | undefined => {
  const lines = map.mappings.split(';')
  const generatedLine = lines[position.line - 1]
  if (generatedLine === undefined || generatedLine.length === 0) return undefined
  let sourceIndex = 0
  let sourceLine = 0
  let sourceColumn = 0
  let generatedColumn = 0
  let best: OriginalPosition | undefined
  for (const segment of generatedLine.split(',')) {
    if (segment.length === 0) continue
    let fields: number[]
    try {
      fields = decodeVlq(segment)
    } catch {
      return undefined
    }
    generatedColumn += fields[0] ?? 0
    if (fields.length >= 4) {
      sourceIndex += fields[1] ?? 0
      sourceLine += fields[2] ?? 0
      sourceColumn += fields[3] ?? 0
      if (generatedColumn <= position.column) {
        const source = map.sources[sourceIndex]
        if (source !== undefined) best = { source, line: sourceLine + 1, column: sourceColumn }
      }
    }
  }
  return best
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sourceContentPosition = ({ map, needle }: { readonly map: RawSourceMap; readonly needle: string }): OriginalPosition | undefined => {
  const contents = map.sourcesContent
  if (contents === undefined) return undefined
  const pattern = new RegExp(escapeRegExp(needle))
  for (let index = 0; index < contents.length; index += 1) {
    const content = contents[index]
    const source = map.sources[index]
    if (content === undefined || content === null || source === undefined) continue
    const match = pattern.exec(content)
    if (match === null) continue
    const before = content.slice(0, match.index)
    const line = before.split('\n').length
    const column = match.index - before.lastIndexOf('\n') - 1
    return { source, line, column: Math.max(0, column) }
  }
  return undefined
}

export class SourceMaps {
  static readonly decodeVlq = decodeVlq
  static readonly findGeneratedPosition = findGeneratedPosition
  static readonly originalPositionFor = originalPositionFor
  static readonly sourceContentPosition = sourceContentPosition
}
