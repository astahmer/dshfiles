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

/**
 * What the find bar reads. `total` is the hits returned, or one more than that when the index holds more.
 * `filteredHere` means the Host refused `types` (a session-search older than the filters), so the newest matches were
 * filtered in the browser instead and older filtered matches may be missing.
 */
export interface ThreadFindAnswer {
  readonly state: 'ready' | 'unavailable'
  readonly total: number
  readonly hits: readonly (typeof findHitSchema.Type)[]
  readonly filteredHere: boolean
}

/** The find bar shows the newest 500 matches and "500+" past them rather than paging. */
export const THREAD_FIND_LIMIT = 500

/** session-search's decoded answer. */
export type ThreadFindReply = typeof findInThreadSchema.Type

const decode = Schema.decodeUnknownOption(findInThreadSchema)

/** The registered call's answer read at Chat's boundary; undefined when it is not the shape this view reads. */
const decodeReply = (raw: unknown): ThreadFindReply | undefined => Option.getOrUndefined(decode(raw))

/** The registered API identity the port calls. */
export const SESSION_SEARCH_FIND_API = { owner: '@dshfiles/session-search', id: 'session-search', version: 1, methods: ['findInThread'] } as const

export type ThreadFindCall = (
  input: {
    readonly sessionId: string
    readonly text: string
    readonly limit: number
    readonly newest: boolean
    readonly types?: readonly string[]
  },
  signal: AbortSignal,
) => Promise<ThreadFindReply | undefined>

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
  static readonly decodeReply = decodeReply

  static readonly set = (next: ThreadFindCall | null): void => {
    globalThis.__dshfilesChatThreadFind = next
  }

  /**
   * Ask the index.
   * @throws ThreadFindUnavailable with `missing` when no plugin serves find; any other failure is a real error.
   */
  static readonly search = async (
    input: { readonly sessionId: string; readonly query: string; readonly types?: readonly string[] },
    signal: AbortSignal,
  ): Promise<ThreadFindAnswer> => {
    const call = globalThis.__dshfilesChatThreadFind
    if (call === null || call === undefined) throw new ThreadFindUnavailable(true, 'Thread search is not installed.')
    const types = input.types !== undefined && input.types.length > 0 ? input.types : undefined
    const request = { sessionId: input.sessionId, text: input.query, limit: THREAD_FIND_LIMIT, newest: true }
    const reply =
      types === undefined ? { answer: await call(request, signal), filteredHere: false } : await ThreadFindPort.filtered({ call, request, types, signal })
    const answer = reply.answer
    if (answer === undefined)
      throw new ThreadFindUnavailable(false, 'Thread search answered in a shape this view does not read. Update @dshfiles/session-search and restart DSH.')
    const hits = types === undefined ? answer.matches : answer.matches.filter(match => types.includes(match.type))
    return {
      state: answer.ownsService ? 'ready' : 'unavailable',
      total: hits.length + (answer.hasMore ? 1 : 0),
      hits,
      filteredHere: reply.filteredHere,
    }
  }

  /**
   * Ask with `types`; a Host that refuses them (strict decoding on a session-search older than the filters) is asked
   * again without, and the caller filters the newest matches it returns. A failure of the unfiltered call is the real one.
   */
  private static readonly filtered = async (input: {
    readonly call: ThreadFindCall
    readonly request: Parameters<ThreadFindCall>[0]
    readonly types: readonly string[]
    readonly signal: AbortSignal
  }): Promise<{ readonly answer: ThreadFindReply | undefined; readonly filteredHere: boolean }> => {
    try {
      return { answer: await input.call({ ...input.request, types: input.types }, input.signal), filteredHere: false }
    } catch (error) {
      if (input.signal.aborted) throw error
      return { answer: await input.call(input.request, input.signal), filteredHere: true }
    }
  }
}
