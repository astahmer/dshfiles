/**
 * dshfiles (productivity pass T4.1): how the find bar reaches `@dshfiles/session-search`'s `findInThread`.
 *
 * Chat calls it by registered identity (`createRegisteredApiClient` in client-entry), not by importing the contract:
 * session-search is a Host-only plugin with no client half to provide a Chat contract from, and an import would make
 * Chat's build depend on it. The answer is decoded here, at Chat's boundary. Without session-search (or with another
 * search backend), the find bar searches the loaded rows and says so.
 */
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

const findHitSchema = Schema.Struct({
  seq: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  type: Schema.String,
  snippet: Schema.String,
})

/** session-search's answer (upstream's findInThread, merged 2026-11-11): matches in seq order and whether more exist. */
const findInThreadSchema = Schema.Struct({
  ownsService: Schema.Boolean,
  matches: Schema.Array(findHitSchema),
  hasMore: Schema.Boolean,
})

/** What the find bar reads. `total` is the hits returned, or one more than that when the index holds more. */
export interface ThreadFindAnswer {
  readonly state: 'ready' | 'unavailable'
  readonly total: number
  readonly hits: readonly (typeof findHitSchema.Type)[]
}

/** The find bar shows the newest 500 matches and "500+" past them rather than paging. */
export const THREAD_FIND_LIMIT = 500

const decode = Schema.decodeUnknownOption(findInThreadSchema)

/** The registered API identity the port calls. */
export const SESSION_SEARCH_FIND_API = { owner: '@dshfiles/session-search', id: 'session-search', version: 1, methods: ['findInThread'] } as const

export type ThreadFindCall = (
  input: { readonly sessionId: string; readonly text: string; readonly limit: number; readonly newest: boolean },
  signal: AbortSignal,
) => Promise<unknown>

/** The search could not run; `missing` means no plugin serves it (the loaded-window fallback applies). */
export class ThreadFindUnavailable extends Error {
  constructor(
    readonly missing: boolean,
    message: string,
  ) {
    super(message)
  }
}

declare global {
  // Set by client-entry, read by the find bar; the two may load separate copies of this module.
  var __dshfilesChatThreadFind: ThreadFindCall | null | undefined
}

export class ThreadFindPort {
  /** Client-entry wires the registered API client once. */
  static readonly set = (next: ThreadFindCall | null): void => {
    globalThis.__dshfilesChatThreadFind = next
  }

  /**
   * Ask the index.
   * @throws ThreadFindUnavailable with `missing` when no plugin serves find; any other failure is a real error.
   */
  static readonly search = async (input: { readonly sessionId: string; readonly query: string }, signal: AbortSignal): Promise<ThreadFindAnswer> => {
    const call = globalThis.__dshfilesChatThreadFind
    if (call === null || call === undefined) throw new ThreadFindUnavailable(true, 'Thread search is not installed.')
    const raw = await call({ sessionId: input.sessionId, text: input.query, limit: THREAD_FIND_LIMIT, newest: true }, signal)
    const decoded = decode(raw)
    if (Option.isNone(decoded))
      throw new ThreadFindUnavailable(false, 'Thread search answered in a shape this view does not read. Update @dshfiles/session-search and restart DSH.')
    const answer = decoded.value
    return {
      state: answer.ownsService ? 'ready' : 'unavailable',
      total: answer.matches.length + (answer.hasMore ? 1 : 0),
      hits: answer.matches,
    }
  }
}
