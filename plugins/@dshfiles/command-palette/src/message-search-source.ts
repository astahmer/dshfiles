import { isApiError, isApiOwnerMissing } from '@dshfiles/dshx/api'
import { searchMessagesOutputSchema, type SearchMessagesOutput, type SearchMessagesRole } from '@dshfiles/session-search/search-api'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'

export type MessageSearchRole = SearchMessagesRole

export type MessageHit = SearchMessagesOutput['matches'][number]

/** Why the Messages tab cannot search: session-search (or its `searchMessages`) is not loaded, or it does not own thread search. */
export type MessageSearchUnavailable = 'missing' | 'not-owner'

export type MessageSearchOutcome =
  | { readonly kind: 'ready'; readonly hits: readonly MessageHit[]; readonly hasMore: boolean }
  | { readonly kind: 'unavailable'; readonly reason: MessageSearchUnavailable }

export type MessageSearch = (input: { readonly query: string; readonly role: MessageSearchRole }, signal: AbortSignal) => Promise<MessageSearchOutcome>

/** The API's own bound on `text`; longer typing is cut here instead of failing the call. */
const MESSAGE_SEARCH_TEXT_MAX = 512
const MESSAGE_SEARCH_LIMIT = 25
/** One-character prefix queries scan most of the index (0.7–1 s on 237 000 messages) and rarely find what was meant. */
const MESSAGE_SEARCH_MIN_CHARS = 2

const decodePage = Schema.decodeUnknownOption(searchMessagesOutputSchema)

export interface MessageSearchDeps {
  /** Call `searchMessages` on the `@dshfiles/session-search` API; the palette wires `createApiClient` here. Its typed answer is still decoded. */
  readonly call: (
    input: { readonly text: string; readonly role: MessageSearchRole; readonly limit: number },
    signal: AbortSignal,
  ) => Promise<SearchMessagesOutput>
}

/** Trimmed and cut to the API's UTF-16 bound without splitting a surrogate pair. */
const queryOf = (text: string): string => {
  let kept = ''
  for (const character of text.trim()) {
    if (kept.length + character.length > MESSAGE_SEARCH_TEXT_MAX) break
    kept += character
  }
  return kept.trim()
}

const isSearchable = (text: string): boolean => Array.from(text.trim()).length >= MESSAGE_SEARCH_MIN_CHARS

/** A Host without session-search answers 404; one whose session-search predates `searchMessages` answers bad-request. */
const isMissingMethod = (error: unknown): boolean =>
  (error instanceof Error && isApiOwnerMissing(error)) || (isApiError(error) && error.remoteCode === 'bad-request')

/**
 * Search through `@dshfiles/session-search`'s published contract. A missing plugin or method reads as `missing`; any
 * other failure throws, so the tab can tell a broken call from an absent feature.
 */
const create =
  (deps: MessageSearchDeps): MessageSearch =>
  async ({ query, role }, signal) => {
    const text = queryOf(query)
    if (!isSearchable(text)) return { kind: 'ready', hits: [], hasMore: false }
    let raw: SearchMessagesOutput
    try {
      raw = await deps.call({ text, role, limit: MESSAGE_SEARCH_LIMIT }, signal)
    } catch (error) {
      if (isMissingMethod(error)) return { kind: 'unavailable', reason: 'missing' }
      throw error
    }
    const page = decodePage(raw)
    if (Option.isNone(page)) throw new Error('session-search answered searchMessages with an unexpected shape.')
    if (!page.value.ownsService) return { kind: 'unavailable', reason: 'not-owner' }
    return { kind: 'ready', hits: page.value.matches, hasMore: page.value.hasMore }
  }

export type MessageSelectBehavior = 'reveal' | 'open'

export interface ApplyMessageSelectionInput {
  readonly behavior: MessageSelectBehavior
  readonly sessionId: string
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly query: string
  readonly openSession: () => void
  readonly requestFocus: (focus: { readonly seq: number; readonly type: 'user/message' | 'assistant/message'; readonly query?: string }) => void
}

/** Apply the user's chosen `messageSelectBehavior` when picking a hit in the Messages tab. */
const applySelection = (input: ApplyMessageSelectionInput): void => {
  input.openSession()
  if (input.behavior !== 'reveal') return
  const query = queryOf(input.query)
  const type = input.role === 'user' ? ('user/message' as const) : ('assistant/message' as const)
  input.requestFocus(query.length > 0 ? { seq: input.seq, type, query } : { seq: input.seq, type })
}

export class MessageSearchSource {
  static readonly minChars = MESSAGE_SEARCH_MIN_CHARS
  static readonly isSearchable = isSearchable
  static readonly create = create
  static readonly applySelection = applySelection
}
