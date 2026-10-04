import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { DraggableQueueDock } from './client.js'
import { QUEUE_REORDER_LOCALE_NAMESPACE, queueReorderLocale } from './locales.js'

/**
 * Adds a drag handle and reordering to the composer's queue dock, beside the
 * shipped dock rather than in place of it.
 *
 * The dock seat is a `list` slot: entries are keyed by `id` and stacked by
 * `order`, and a second entry with a different id renders as its own dock
 * instead of replacing the first. Reusing the shipped `queue` id would put two
 * occupants in one cell, and the loser silently never renders, so the reorder
 * affordances would be absent with no visible error.
 *
 * Registration is imperative because reaching the session's conversation
 * service needs the Host-side `sessions` scope, which a declarative
 * `defineSlot` cannot supply. That makes the second argument of `setup` load
 * bearing: it is DSHX's component decorator, and without passing the row
 * through it the row's `useApi()` call throws
 * `API "…" is unavailable outside a DSHX Client Slot component` on first render.
 */
interface ConversationService {
  updateQueue(itemId: string, action: unknown): Promise<void>
}

export default defineClient({
  name: '@dshfiles/queue-reorder',
  locales: [queueReorderLocale],
  // setup(ctx) reads ctx.slots and ctx.sessions; declaring them here is what
  // activates those services. Without this the plugin loads but never mounts.
  inject: ['slots', 'sessions'],
  setup(ctx, decorate) {
    document.documentElement.dataset['dshfilesQueueReorder'] = 'setup-ran'
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'queue-reorder',
          order: 21,
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
              updateQueue: (itemId: string, action: unknown): Promise<void> => conversation.updateQueue(itemId, action),
            }
          },
        },
        decorate(DraggableQueueDock),
      ),
    )
  },
})
