import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ChatPresentationPolicy } from '../presentation-policy.ts'
import type { ChatFlowDataInjected, ChatViewInjected } from '../contract/slots.ts'

/**
 * Injected faces used while a Session has no retained binding.
 *
 * `ctx.sessions.binding()` is documented as undefined "without a retained
 * generation": true while a Session is being opened or released, and while the
 * plugin that provides bindings (`@dshfiles/session-controller`) is between hot
 * replacements. A slot `inject` callback that throws there takes the whole Chat
 * view down, so the gap renders an empty transcript instead; the next render,
 * once the binding is back, replaces it with the real sources.
 */

const noop = (): void => {}

const EMPTY_NODE = { getSnapshot: () => undefined, subscribe: () => () => {} }
const EMPTY_BOTTOM = { getSnapshot: () => false, subscribe: () => () => {} }
const EMPTY_PROCESS = { getSnapshot: () => undefined, subscribe: () => () => {} }

/** Empty node sources for a detached flow: every key resolves to nothing. */
export const detachedFlow = (presentation: ObservableSnapshot<ChatPresentationPolicy>): ChatFlowDataInjected => ({
  hooks: { presentation },
  keyedHooks: {
    chatNode: () => EMPTY_NODE,
    chatNodeBottom: () => EMPTY_BOTTOM,
    chatNodeProcess: () => EMPTY_PROCESS,
    chatGroup: () => undefined,
  },
})

/** Detached view: empty sources plus inert actions, so nothing renders and nothing throws. */
export const detachedView = (presentation: ObservableSnapshot<ChatPresentationPolicy>): ChatViewInjected => ({
  ...detachedFlow(presentation),
  openExternalLink: noop,
  openFile: async () => {},
  loadOlder: noop,
  loadThrough: async () => {},
  loadImage: Object.assign(async () => '', { peek: () => undefined }),
  chatScroll: { save: noop, read: () => null },
  forkAt: noop,
  fileMentions: () => undefined,
})
