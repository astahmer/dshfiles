import type { FileDragActions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatFlowDataInjected, ChatViewInjected } from './native/contract/slots.ts'

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

const EMPTY_KEYED_HOOKS: ChatFlowDataInjected['keyedHooks'] = {
  chatNode: () => EMPTY_NODE,
  chatNodeBottom: () => EMPTY_BOTTOM,
  chatNodeProcess: () => EMPTY_PROCESS,
  chatGroup: () => undefined,
}

/** Empty node sources for a detached flow: every key resolves to nothing. */
export const detachedFlow = (hooks: ChatFlowDataInjected['hooks']): ChatFlowDataInjected => ({
  hooks,
  keyedHooks: EMPTY_KEYED_HOOKS,
})

/** Detached view: empty sources plus inert actions, so nothing renders and nothing throws. */
export const detachedView = (hooks: ChatViewInjected['hooks'], fileDrag: FileDragActions): ChatViewInjected => ({
  hooks,
  keyedHooks: EMPTY_KEYED_HOOKS,
  fileDrag,
  resolveFilePath: path => path,
  dispatchInteraction: () => null,
  openExternalLink: noop,
  openFile: async () => {},
  loadOlder: noop,
  consumeOlder: () => false,
  loadThrough: async () => {},
  loadImage: Object.assign(async () => '', { peek: () => undefined }),
  chatScroll: { save: noop, read: () => null },
  seenAnswer: { read: () => null, markSeen: noop },
  forkAt: noop,
})
