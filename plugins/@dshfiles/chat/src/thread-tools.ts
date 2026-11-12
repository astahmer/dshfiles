/**
 * How another plugin reaches the long-thread tools of the owned Chat fork, published as the `@dshfiles/chat/thread-tools`
 * dshx module. Importing it loads none of Chat's runtime.
 *
 * - {@link ThreadToolsModel.request} opens the find bar or the Turns sheet of one thread's Chat view; a thread `⋯`
 *   menu (thread-sidebar) calls it, which is how the phone, with no ⌘F and no rail, reaches both.
 * - {@link SinceYouLeftModel.note} hands Chat the unread record a surface is about to clear when the user opens a
 *   thread, so Chat can draw the "Since you left" divider at the first Turn the user has not seen. Opening a thread
 *   resolves its attention record (productivity pass Q0), so the record must be read before that, by the code that
 *   clears it.
 *
 * Pending requests live on `globalThis` because every client bundle that imports this module gets its own copy.
 */
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

const TOOLS_EVENT = 'dshfiles-chat:thread-tools'
const SINCE_EVENT = 'dshfiles-chat:since-you-left'
const TTL_MS = 30_000

export type ThreadTool = 'find' | 'turns'

const sinceSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  /** Sequence of the first finished Turn the user has not seen (its `turn/end`); null when unknown. */
  firstUnreadSeq: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  /** Sequence of the newest finished Turn the record covers. */
  finishedSeq: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
export type SinceYouLeftNote = typeof sinceSchema.Type

const decodeSince = Schema.decodeUnknownOption(sinceSchema, { onExcessProperty: 'error' })
const detailSchema = Schema.Struct({ sessionId: Schema.String })
const decodeDetail = Schema.decodeUnknownOption(detailSchema)

interface Pending<A> {
  readonly value: A
  readonly expiresAt: number
}

declare global {
  // Shared by every bundled copy of this module; see the module comment.
  var __dshfilesChatThreadTools: Map<string, Pending<ThreadTool>> | undefined
  var __dshfilesChatSinceYouLeft: Map<string, Pending<SinceYouLeftNote>> | undefined
}

const tools = (): Map<string, Pending<ThreadTool>> => {
  globalThis.__dshfilesChatThreadTools ??= new Map()
  return globalThis.__dshfilesChatThreadTools
}

const notes = (): Map<string, Pending<SinceYouLeftNote>> => {
  globalThis.__dshfilesChatSinceYouLeft ??= new Map()
  return globalThis.__dshfilesChatSinceYouLeft
}

const dispatch = (event: string, sessionId: string): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(event, { detail: { sessionId } }))
}

const takeFrom = <A>(map: Map<string, Pending<A>>, sessionId: string, now: number): A | null => {
  const pending = map.get(sessionId)
  map.delete(sessionId)
  return pending === undefined || pending.expiresAt < now ? null : pending.value
}

/** Subscribe to requests for one thread; calls `listener` for each request addressed to it. */
const listen = (event: string, sessionId: string, listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {}
  const handler = (raw: Event): void => {
    const detail = decodeDetail(raw instanceof CustomEvent ? raw.detail : undefined)
    if (Option.isSome(detail) && detail.value.sessionId === sessionId) listener()
  }
  window.addEventListener(event, handler)
  return () => window.removeEventListener(event, handler)
}

export class ThreadToolsModel {
  static readonly event = TOOLS_EVENT
  /** Ask one thread's Chat view to open its find bar or Turns sheet, whether or not it is mounted yet. */
  static readonly request = (input: { readonly sessionId: string; readonly tool: ThreadTool; readonly now?: number }): void => {
    tools().set(input.sessionId, { value: input.tool, expiresAt: (input.now ?? Date.now()) + TTL_MS })
    dispatch(TOOLS_EVENT, input.sessionId)
  }
  /** Remove and return the thread's pending request, or null when there is none or it expired. */
  static readonly take = (sessionId: string, now: number = Date.now()): ThreadTool | null => takeFrom(tools(), sessionId, now)
  static readonly listen = (sessionId: string, listener: () => void): (() => void) => listen(TOOLS_EVENT, sessionId, listener)
}

export class SinceYouLeftModel {
  static readonly event = SINCE_EVENT
  /** Hand Chat the unread record of a thread being opened, before the record is cleared. Malformed input is ignored. */
  static readonly note = (input: SinceYouLeftNote & { readonly now?: number }): void => {
    const { now, ...value } = input
    const decoded = decodeSince(value)
    if (Option.isNone(decoded)) return
    notes().set(decoded.value.sessionId, { value: decoded.value, expiresAt: (now ?? Date.now()) + TTL_MS })
    dispatch(SINCE_EVENT, decoded.value.sessionId)
  }
  static readonly take = (sessionId: string, now: number = Date.now()): SinceYouLeftNote | null => takeFrom(notes(), sessionId, now)
  static readonly listen = (sessionId: string, listener: () => void): (() => void) => listen(SINCE_EVENT, sessionId, listener)
}
