import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const queueInputSchema = z.object({
  sessionId: z.string().min(1).max(256).optional(),
  itemId: z.string().min(1).max(256),
})

const queueResultSchema = z.object({
  sessionId: z.string().min(1).max(256),
  itemId: z.string().min(1).max(256),
  action: z.enum(['remove', 'steer']),
})

export const threadQueueApi = defineApi({
  id: 'thread-queue',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    remove: method({
      input: queueInputSchema,
      output: queueResultSchema,
      description:
        'Remove one message that is still waiting in a thread message queue, before it is sent. Defaults to the calling thread. Call only when the user asked to drop that queued message.',
      tool: { name: 'thread_queue_remove', render: output => `Removed queued message ${output.itemId} from ${output.sessionId}.` },
    }),
    steer: method({
      input: queueInputSchema,
      output: queueResultSchema,
      description:
        'Turn one queued message into steering guidance for the turn already running instead of waiting for it to finish. Defaults to the calling thread. Call only when the user asked to steer with that message.',
      tool: { name: 'thread_queue_steer', render: output => `Queued message ${output.itemId} now steers ${output.sessionId}.` },
    }),
  },
})

export type ThreadQueueAction = z.infer<typeof queueResultSchema>['action']
