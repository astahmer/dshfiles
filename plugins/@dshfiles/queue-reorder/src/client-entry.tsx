import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { DraggableQueueDock, type QueueDockInjected } from './client.js'
import { QUEUE_REORDER_LOCALE_NAMESPACE, queueReorderLocale } from './locales.js'

/**
 * Replaces the shipped queue dock rather than adding a second one beside it, so
 * the composer keeps a single queue surface.
 *
 * This registers natively rather than through `defineSlot` because the dock seat
 * supplies no mutation callback of its own. The shipped entry injects the
 * session id, scopes the conversation service, and hands `updateQueue` to the
 * row; this does the same, so edit, remove and steer stay on the official path
 * and only reordering reaches for our own API, because `updateQueue` has no
 * verb for it.
 */
interface ConversationService {
  updateQueue(itemId: string, action: unknown): Promise<void>
}

export default defineClient({
  name: '@dshfiles/queue-reorder',
  locales: [queueReorderLocale],
  setup(ctx) {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          // The shipped entry's id and order, so this replaces that occupant
          // instead of joining it and rendering a second queue.
          id: 'queue',
          order: 20,
          locale: QUEUE_REORDER_LOCALE_NAMESPACE,
          inject: sessionId => {
            const scoped = ctx.sessions.scope(sessionId)
            if (scoped === undefined) {
              throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
            }
            const conversation = scoped.get('conversation') as
              | ConversationService
              | undefined
            if (conversation === undefined) {
              throw new Error('queue dock: conversation service unavailable')
            }
            return {
              updateQueue: (itemId: string, action: unknown): Promise<void> =>
                conversation.updateQueue(itemId, action),
            }
          },
        },
        DraggableQueueDock,
      ),
    )
  },
})