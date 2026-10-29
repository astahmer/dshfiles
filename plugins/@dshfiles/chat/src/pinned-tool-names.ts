import type { ConversationEventRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PinnedToolCall } from './pinned-tool-calls.ts'

/** The tool names PinnedToolCalls providers registered, read synchronously while Chat builds tool nodes. */
let pinnedToolNames: ReadonlySet<string> = new Set()

const sameNames = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => left.size === right.size && [...left].every(name => right.has(name))

/** Replace the pinned names; true when the set changed. */
const setPinnedToolNames = (names: Iterable<string>): boolean => {
  const next = new Set(names)
  if (sameNames(pinnedToolNames, next)) return false
  pinnedToolNames = next
  return true
}

const isPinnedToolName = (name: string): boolean => pinnedToolNames.has(name)

const INVALIDATION_KIND = 'dshfiles-chat.pinned-tool-calls'

/**
 * Matches no event and builds no node. Registering or removing it refreshes the native event registry, and
 * uiConversation rebuilds every bound Conversation on a registry change, so already built tool nodes re-read the
 * pinned names. That rebuild is the native path for a low-frequency plugin change; Chat has no narrower one.
 */
const invalidationDefinition = {
  kind: INVALIDATION_KIND,
  match: {},
  start: () => undefined,
  update: (context: { readonly state: unknown }) => context.state,
}

/**
 * Keep the pinned names in step with the PinnedToolCalls providers and re-group built nodes when they change, so a
 * provider that loads after a thread rendered still pins its calls without a reopen.
 */
const followPinnedToolCalls = (input: {
  readonly providers: { get(): readonly PinnedToolCall[]; subscribe(listener: () => void): () => void }
  readonly events: Pick<ConversationEventRegistry, 'register'>
}): (() => void) => {
  let invalidation: (() => void) | undefined
  const sync = (): boolean => setPinnedToolNames(input.providers.get().map(entry => entry.toolName))
  sync()
  const unsubscribe = input.providers.subscribe(() => {
    if (!sync()) return
    if (invalidation === undefined) {
      invalidation = input.events.register(invalidationDefinition)
      return
    }
    invalidation()
    invalidation = undefined
  })
  return () => {
    unsubscribe()
    invalidation?.()
    invalidation = undefined
  }
}

export class PinnedToolNames {
  static readonly set = setPinnedToolNames
  static readonly has = isPinnedToolName
  static readonly follow = followPinnedToolCalls
}
