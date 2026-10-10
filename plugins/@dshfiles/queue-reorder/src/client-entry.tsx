import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueAction } from '@deepseek-ai/dsh-api-session-controller/types'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { type DockProps, DraggableQueueDock } from './client.js'
import { sessionQueueEditor } from './session-queue-editor.js'
import { QUEUE_REORDER_LOCALE_NAMESPACE, queueReorderLocale } from './locales.js'
import './client.css'

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
  inject: ['slots', 'sessions'],
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
          inject: sessionId => {
            const scoped = ctx.sessions.scope(sessionId)
            if (scoped === undefined) {
              throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
            }
            const conversation = scoped.get('conversation') as ConversationService | undefined
            if (conversation === undefined) {
              throw new Error('queue dock: conversation service unavailable')
            }
            return {
              updateQueue: (itemId: MessageId, action: QueueAction): Promise<void> => conversation.updateQueue(itemId, action),
              queueEditor: sessionQueueEditor(ctx, sessionId),
            }
          },
        },
        decorate(QueueDockSlot),
      ),
    )
  },
})
