import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueAction } from '@deepseek-ai/dsh-api-session-controller/types'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { type DockProps, DraggableQueueDock } from './client.js'
import { SessionQueueEditorModel } from './session-queue-editor.js'
import { QUEUE_REORDER_LOCALE_NAMESPACE, queueReorderLocale } from './locales.js'

/**
 * Replaces the shipped `queue` dock with a draggable one.
 *
 * The seat is a `list` slot keyed by `id`, so a different id renders as its own
 * dock beside the shipped one — which is how two stacked queues appeared.
 *
 * Reusing the shipped `queue` id puts both entries in one cell, where the list
 * renderer keeps one head and drops the rest. Declaring `priority` states that
 * this replacement is deliberate — it is DSH's cell shadowing rank, where the
 * lowest entry for an id renders — and is what DSHX's build guard requires
 * before it permits reusing a shipped id.
 *
 * Registration is imperative because reaching the session's conversation
 * service needs the Host-side `sessions` scope, which a declarative
 * `defineSlot` cannot supply. That makes the second argument of `setup` load
 * bearing: it is DSHX's component decorator, and without passing the row
 * through it the row's `useApi()` call throws
 * `API "…" is unavailable outside a DSHX Client Slot component` on first render.
 */
interface ConversationService {
  updateQueue(itemId: MessageId, action: QueueAction): Promise<void>
}

/** Shown when the dock's conversation provider is between hot replacements. */
export const QUEUE_RECONNECTING_MESSAGE = 'The queue is reconnecting; try again in a moment.'

const QueueDockSlot = (props: DockProps): JSX.Element => (
  <PluginQueryProvider>
    <DraggableQueueDock {...props} />
  </PluginQueryProvider>
)

export default defineClient({
  name: '@dshfiles/queue-reorder',
  locales: [queueReorderLocale],
  // setup(ctx) reads ctx.slots and ctx.sessions; declaring them here is what
  // activates those services. Without this the plugin loads but never mounts.
  inject: ['slots', 'sessions', 'uiWorkspace'],
  setup(ctx, decorate) {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'queue',
          order: 20,
          // DSH resolves one head per cell id, so this takes the shipped dock's
          // place instead of stacking a second one. `priority` is that documented
          // cell shadowing rank: the lowest entry for an id renders.
          priority: -1,
          locale: QUEUE_REORDER_LOCALE_NAMESPACE,
          inject: sessionId => ({
            updateQueue: (itemId: MessageId, action: QueueAction): Promise<void> => {
              // Resolved per call, never at inject time: a hot replacement tears the
              // old conversation provider down before the new one applies, and a throw
              // from `inject` takes the whole composer slot with it. The transient
              // state surfaces through the action's own error path instead.
              // SAFETY: the session scope serves the conversation controller registered by
              // `@dshfiles/rich-composer` under the `conversation` key; this cast narrows the
              // shared service map to the single member the dock calls.
              const conversation = ctx.sessions.scope(sessionId)?.get('conversation') as ConversationService | undefined
              if (conversation === undefined) return Promise.reject(new Error(QUEUE_RECONNECTING_MESSAGE))
              return conversation.updateQueue(itemId, action)
            },
            queueEditor: SessionQueueEditorModel.editor(ctx, sessionId),
            queueTransfer: SessionQueueEditorModel.transfer(ctx, sessionId),
            readImage: SessionQueueEditorModel.imageReader(ctx, sessionId),
            threads: ctx.sessions.list,
          }),
        },
        decorate(QueueDockSlot),
      ),
    )
  },
})
