import { Option } from 'effect'
import * as Schema from 'effect/Schema'

export type MessageSearchRole = 'all' | 'user' | 'assistant'

export interface MessageHit {
  readonly sessionId: string
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly time: number
  readonly snippet: string
  readonly cwd?: string | undefined
}

export type MessageSearchOutcome =
  | { readonly kind: 'ready'; readonly hits: readonly MessageHit[]; readonly hasMore: boolean }
  | { readonly kind: 'unavailable' }

export type MessageSearch = (input: { readonly query: string; readonly role: MessageSearchRole }, signal: AbortSignal) => Promise<MessageSearchOutcome>

type RegistryApiView = {
  readonly owner: string
  readonly id: string
  readonly version: number
  readonly methods: readonly { readonly name: string }[]
}

export type RegisteredMessageApi = { readonly owner: string; readonly id: string; readonly version: number }

const SESSION_SEARCH_OWNER = '@dshfiles/session-search'
const SESSION_SEARCH_API_ID = 'session-search'
const MESSAGE_SEARCH_LIMIT = 25

const messageHitSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1)),
  seq: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  role: Schema.Literals(['user', 'assistant']),
  time: Schema.Number.check(Schema.isFinite()),
  snippet: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
})

const messageSearchPageSchema = Schema.Struct({
  ownsService: Schema.Boolean,
  matches: Schema.Array(messageHitSchema),
  hasMore: Schema.Boolean,
})

export type MessageSearchPage = typeof messageSearchPageSchema.Type

const decodePageOption = Schema.decodeUnknownOption(messageSearchPageSchema)

const decodePage = (raw: unknown): MessageSearchPage | undefined => Option.getOrUndefined(decodePageOption(raw))

export interface MessageSearchDeps {
  readonly listApis: () => Promise<readonly RegistryApiView[]>
  readonly callSearch: (
    api: RegisteredMessageApi,
    input: { readonly text: string; readonly role: MessageSearchRole; readonly limit: number },
    signal: AbortSignal,
  ) => Promise<MessageSearchPage | undefined>
}

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

/**
 * Discovers `@dshfiles/session-search`'s `searchMessages` method through the Host registry so the palette stays
 * independent of session-search's build and degrades cleanly on a Host without the plugin or with an older version.
 */
const create = (deps: MessageSearchDeps): MessageSearch => {
  let discovered: RegisteredMessageApi | undefined | null
  return async ({ query, role }, signal): Promise<MessageSearchOutcome> => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return { kind: 'ready', hits: [], hasMore: false }
    if (discovered === undefined) {
      const apis = await deps.listApis().catch(() => undefined)
      if (apis === undefined) return { kind: 'unavailable' }
      const api = apis.find(
        candidate =>
          candidate.owner === SESSION_SEARCH_OWNER &&
          candidate.id === SESSION_SEARCH_API_ID &&
          candidate.methods.some(method => method.name === 'searchMessages'),
      )
      discovered = api === undefined ? null : { owner: api.owner, id: api.id, version: api.version }
    }
    if (discovered === null) return { kind: 'unavailable' }
    let page: MessageSearchPage | undefined
    try {
      page = await deps.callSearch(discovered, { text: trimmed, role, limit: MESSAGE_SEARCH_LIMIT }, signal)
    } catch (error) {
      if (isAbortError(error)) throw error
      discovered = undefined
      throw error
    }
    if (page === undefined || !page.ownsService) return { kind: 'unavailable' }
    return { kind: 'ready', hits: page.matches, hasMore: page.hasMore }
  }
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
  const query = input.query.trim()
  const type = input.role === 'user' ? ('user/message' as const) : ('assistant/message' as const)
  input.requestFocus(query.length > 0 ? { seq: input.seq, type, query } : { seq: input.seq, type })
}

export class MessageSearchSource {
  static readonly decodePage = decodePage
  static readonly create = create
  static readonly applySelection = applySelection
}
