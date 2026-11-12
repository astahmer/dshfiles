/** Semantic draft snapshots shared by storage, programmatic input, and editor restoration. */
import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DraftInput, DraftQuote, DraftReference, DraftSnapshot, Occurrence } from './contract/draft-editor.ts'

const referenceSchema = Schema.Struct({
  source: Schema.String,
  ref: Schema.String,
  offset: Schema.Natural,
  length: Schema.Int.check(Schema.isGreaterThan(0)),
  label: Schema.String,
  appearance: Schema.optional(Schema.Literals(['session', 'file', 'folder'])),
  clipboardText: Schema.String,
  invalid: Schema.optional(Schema.Boolean),
})

const commandSchema = Schema.Struct({
  token: Schema.String,
})

// Lists every QuoteSummary field: decoding strips unknown keys, so a field missing here is dropped from restored drafts.
const quoteSummarySchema = Schema.Struct({
  label: Schema.String,
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  body: Schema.String,
})

const quoteSchema = Schema.Struct({
  offset: Schema.Natural,
  length: Schema.Int.check(Schema.isGreaterThan(0)),
  text: Schema.String.check(Schema.makeFilter((text: string) => text.trim() !== '')),
  summary: Schema.optionalKey(quoteSummarySchema),
})

const draftSchema = Schema.Struct({
  text: Schema.String,
  references: Schema.Array(referenceSchema),
  command: Schema.optional(commandSchema),
  quotes: Schema.optionalKey(Schema.Array(quoteSchema)),
})

/**
 * Whether every reference names a span after the leading command token, in order, and matches the draft text, and
 * every quote matches its formatted text without overlapping another span.
 */
const hasOrderedReferenceSpans = (draft: typeof draftSchema.Type): boolean => {
  const spelling = draft.command?.token.trimEnd()
  if (spelling !== undefined && (!/^\/\S/u.test(spelling) || !draft.text.startsWith(spelling))) return false
  let end = spelling?.length ?? 0
  for (const reference of draft.references) {
    if (reference.offset < end || reference.length !== reference.clipboardText.length) return false
    end = reference.offset + reference.length
    if (end > draft.text.length || draft.text.slice(reference.offset, end) !== reference.clipboardText) return false
  }
  for (const quote of draft.quotes ?? []) {
    if (quote.length !== formatQuoteText(quote.text).length
      || draft.text.slice(quote.offset, quote.offset + quote.length) !== formatQuoteText(quote.text)) return false
  }
  end = spelling?.length ?? 0
  for (const span of [...draft.references, ...draft.quotes ?? []].sort((a, b) => a.offset - b.offset)) {
    if (span.offset < end) return false
    end = span.offset + span.length
    if (end > draft.text.length) return false
  }
  return true
}

const snapshotSchema = draftSchema.check(
  Schema.makeFilter(draft =>
    (hasOrderedReferenceSpans(draft) ? true : 'Draft references must identify ordered, non-overlapping text spans after the leading command token')),
)

/**
 * Copy input into the semantic draft representation without editor runtime identities.
 * @param input - plain text or caller-owned structured content.
 * @returns an owned snapshot ready for editor import.
 */
export function resolveDraftInput(input: DraftInput): DraftSnapshot {
  if (typeof input === 'string') return { text: input, references: [] }
  return {
    text: input.text,
    references: input.references.map(copyReference),
    ...(input.command === undefined ? {} : { command: { token: input.command.token } }),
    ...(input.quotes === undefined ? {} : { quotes: input.quotes.map(quote => ({ ...quote })) }),
  }
}

/**
 * Decode persisted drafts, accepting the earlier plain-string representation.
 * @param value - JSON value read from browser storage.
 * @returns the decoded draft, or undefined for invalid data.
 */
export function parseStoredDraft(value: unknown): DraftSnapshot | undefined {
  if (typeof value === 'string') return resolveDraftInput(value)
  const parsed = Schema.decodeUnknownOption(snapshotSchema)(value)
  if (Option.isNone(parsed)) return undefined
  return {
    text: parsed.value.text,
    ...parsed.value.quotes === undefined ? {} : { quotes: parsed.value.quotes },
    references: parsed.value.references.map(({ appearance, invalid, ...reference }) => ({
      ...reference,
      ...(appearance === undefined ? {} : { appearance }),
      ...(invalid === undefined ? {} : { invalid }),
    })),
    ...(parsed.value.command === undefined ? {} : { command: { token: parsed.value.command.token } }),
  }
}

/**
 * Export reference identities without their editor-local occurrence ids.
 * @param text - current clipboard projection.
 * @param occurrences - matching reference projections from the same document revision.
 * @param commandToken - claim token of the command chip opening the document, if any.
 * @param quotes - atomic quotes from the same document revision.
 * @returns an editor-independent snapshot.
 */
export function snapshotDraft(
  text: string, occurrences: readonly Occurrence[], commandToken?: string, quotes: readonly DraftQuote[] = [],
): DraftSnapshot {
  return {
    text,
    references: occurrences.map(copyReference),
    ...(commandToken === undefined ? {} : { command: { token: commandToken } }),
    ...(quotes.length === 0 ? {} : { quotes: quotes.map(quote => ({ ...quote })) }),
  }
}

function copyReference(reference: DraftReference): DraftReference {
  return {
    source: reference.source,
    ref: reference.ref,
    offset: reference.offset,
    length: reference.length,
    label: reference.label,
    clipboardText: reference.clipboardText,
    ...(reference.appearance === undefined ? {} : { appearance: reference.appearance }),
    ...(reference.invalid === undefined ? {} : { invalid: reference.invalid }),
  }
}
