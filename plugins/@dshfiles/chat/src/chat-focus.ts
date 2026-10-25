/**
 * How another plugin asks the owned Chat fork to scroll to and highlight one Turn, Step or tool call.
 *
 * Published as its own contract module (`@dshfiles/chat/chat-focus`). Two routes, both carrying a {@link ChatFocus}:
 *
 * - Inside a thread, a Conversation View calls the native `openView(ChatFocusModel.viewId, ChatFocusModel.encode(focus))`
 *   it is handed: the shell selects Chat and Chat consumes the `viewRequest`.
 * - From outside the thread (a sidebar panel that opens it), call {@link ChatFocusModel.request} right after
 *   `uiWorkspace.openSession`: Chat takes the request when it mounts for that thread, or at once when it already is.
 *   A thread that reopens on another view keeps the request for `ChatFocusModel.ttlMs`; a view of ours forwards it
 *   with {@link ChatFocusModel.take} and `openView`.
 *
 * The pending requests live on `globalThis` because every client bundle that imports this module gets its own copy.
 */
import { z } from 'zod/mini'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'

const CHAT_VIEW_ID = 'chat'
const CHAT_FOCUS_EVENT = 'dshfiles-chat:focus'
const CHAT_FOCUS_TTL_MS = 30_000
const FOCUS_PREFIX = 'dshfiles-chat-focus:'

const chatFocusSchema = z.strictObject({
  turn: z.int().check(z.nonnegative()),
  step: z.optional(z.int().check(z.nonnegative())),
  toolCallId: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
})

export type ChatFocus = z.infer<typeof chatFocusSchema>

interface PendingFocus {
  readonly focus: ChatFocus
  readonly expiresAt: number
}

declare global {
  // Shared by every bundled copy of this module; see the module comment.
  var __dshfilesChatFocusRequests: Map<string, PendingFocus> | undefined
}

const pendingRequests = (): Map<string, PendingFocus> => {
  globalThis.__dshfilesChatFocusRequests ??= new Map()
  return globalThis.__dshfilesChatFocusRequests
}

/** The opaque `focus` string of a Conversation View request addressed to Chat. */
const encode = (focus: ChatFocus): string => `${FOCUS_PREFIX}${JSON.stringify(chatFocusSchema.parse(focus))}`

const decode = (value: string): ChatFocus | null => {
  if (!value.startsWith(FOCUS_PREFIX)) return null
  try {
    const parsed = chatFocusSchema.safeParse(JSON.parse(value.slice(FOCUS_PREFIX.length)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Address one focus to a thread's Chat view, whether or not it is mounted yet. */
const request = (input: { readonly sessionId: string; readonly focus: ChatFocus; readonly now?: number }): void => {
  const focus = chatFocusSchema.parse(input.focus)
  pendingRequests().set(input.sessionId, { focus, expiresAt: (input.now ?? Date.now()) + CHAT_FOCUS_TTL_MS })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHAT_FOCUS_EVENT, { detail: { sessionId: input.sessionId } }))
}

/** Remove and return the thread's pending focus, or null when there is none or it expired. */
const take = (sessionId: string, now: number = Date.now()): ChatFocus | null => {
  const requests = pendingRequests()
  const pending = requests.get(sessionId)
  requests.delete(sessionId)
  return pending === undefined || pending.expiresAt < now ? null : pending.focus
}

export class ChatFocusModel {
  /** The `conversation.view` entry id of the Chat view. */
  static readonly viewId = CHAT_VIEW_ID
  /** Window event Chat listens to for a request addressed to the thread it shows. */
  static readonly event = CHAT_FOCUS_EVENT
  static readonly ttlMs = CHAT_FOCUS_TTL_MS
  static readonly schema = chatFocusSchema
  static readonly encode = encode
  static readonly decode = decode
  static readonly request = request
  static readonly take = take
}

/**
 * What the Chat fork adds to each `conversation.chat.turnTail` entry's owner props: the native Conversation View
 * opener of the thread, so a Turn-footer action can select another view and address a focus to it. Absent on a
 * detached or read-only transcript.
 */
export interface ChatTurnTailExtras {
  readonly openView?: ((view: string, focus: string) => void) | undefined
}

/** Turn identity and view opener shared by controls in the completed-Turn action row. */
export interface ChatTurnActionExtras extends ChatTurnTailExtras {
  readonly turn?: TurnLocation | undefined
}
