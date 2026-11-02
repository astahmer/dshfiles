import * as Schema from 'effect/Schema'

const memoryCitationPattern = /\bmemory:\s*((?:`?(?:t:[A-Za-z0-9_-]+(?:#\d+)?|n:[1-9]\d*)`?)(?:\s*[,;]\s*`?(?:t:[A-Za-z0-9_-]+(?:#\d+)?|n:[1-9]\d*)`?)*)/giu
const memoryIdPattern = /(?:t:[A-Za-z0-9_-]+(?:#\d+)?|n:[1-9]\d*)/giu

export type MemoryReferenceMatch = {
  readonly id: string
  readonly range?: string
  /** Where the `memory:` citation carrying this reference starts, so the link can cover the whole token. */
  readonly citationStart: number
  readonly start: number
  readonly end: number
}

export const memoryReferenceMatches = (text: string): readonly MemoryReferenceMatch[] => {
  const matches: MemoryReferenceMatch[] = []
  for (const citation of text.matchAll(memoryCitationPattern)) {
    const references = citation[1] ?? ''
    const citationStart = citation.index ?? 0
    const referencesStart = citationStart + citation[0].indexOf(references)
    let position = 0
    for (const reference of references.matchAll(memoryIdPattern)) {
      const raw = reference[0]
      const start = referencesStart + (reference.index ?? 0)
      // Only the first reference reaches back over `memory:`: overlapping links would cross each other's spans.
      const anchor = position === 0 ? citationStart : start
      const separator = raw.indexOf('#')
      const id = (separator < 0 ? raw : raw.slice(0, separator)).toLowerCase()
      const end = start + raw.length
      if (separator < 0) matches.push({ id, citationStart: anchor, start, end })
      else matches.push({ id, range: raw.slice(separator + 1), citationStart: anchor, start, end })
      position += 1
    }
  }
  return matches
}

const referenceId = Schema.String.check(
  Schema.isPattern(/^(?:t:[A-Za-z0-9_-]+|n:[1-9]\d*)$/u),
  Schema.makeFilter((id: string) => (!id.startsWith('n:') || Number.isSafeInteger(Number(id.slice(2))) ? undefined : 'The note id is not a safe integer.')),
)
const eventSequence = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9]\d*)$/u),
  Schema.makeFilter((sequence: string) => (Number.isSafeInteger(Number(sequence)) ? undefined : 'The event sequence is not a safe integer.')),
)
const coordinate = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(-100_000), Schema.isLessThanOrEqualTo(100_000))
const extent = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100_000))

export const memoryReferencePreviewEvent = 'dshfiles:memory-reference-preview'

export const memoryReferencePreviewRequestSchema = Schema.Struct({
  id: referenceId,
  range: Schema.optional(eventSequence),
  /** The decorated element the card follows: it re-measures this anchor instead of closing when the page scrolls. */
  anchorId: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  anchor: Schema.Struct({ left: coordinate, top: coordinate, width: extent, height: extent }),
})

export type MemoryReferencePreviewRequest = typeof memoryReferencePreviewRequestSchema.Type

export class MemoryReferenceModel {
  /** Decodes one page event; unknown keys and an out-of-range anchor both discard it. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the page event carries unknown data
  static readonly decodePreviewRequest = (value: unknown): MemoryReferencePreviewRequest | null => {
    const parsed = Schema.decodeUnknownResult(memoryReferencePreviewRequestSchema, { onExcessProperty: 'error' })(value)
    return parsed._tag === 'Success' ? parsed.success : null
  }
}

/** The stored item a citation names, whether or not it still exists; a range only names part of a thread's log. */
export type MemoryReferenceKey =
  | { readonly kind: 'note'; readonly noteId: number }
  | { readonly kind: 'digest'; readonly threadKey: string }
  | { readonly kind: 'excerpt'; readonly threadKey: string; readonly range: string }

const referenceIdPattern = /^n:(\d+)$/iu

/**
 * Split a citation into the note or thread it points at, the one place both the model-facing read and the panel's
 * preview decide what `n:1`, a backticked `t:abc`, and `t:abc#12` mean.
 */
export const memoryReferenceKey = (reference: { readonly id: string; readonly range?: string | undefined }): MemoryReferenceKey | null => {
  const id = reference.id.trim().replace(/^`|`$/gu, '')
  const note = referenceIdPattern.exec(id)
  if (note !== null) return { kind: 'note', noteId: Number.parseInt(note[1] ?? '', 10) }
  const threadKey = id.replace(/^t:/iu, '').replace(/#\d+$/u, '')
  if (threadKey.length === 0) return null
  const range = reference.range?.trim() ?? ''
  return range.length === 0 ? { kind: 'digest', threadKey } : { kind: 'excerpt', threadKey, range }
}
