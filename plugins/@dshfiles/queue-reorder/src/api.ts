import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/**
 * Wire contract for queue reordering.
 *
 * The Host method is the only implementation; both the dock and the
 * `queue_move` agent tool call it, so the button and the agent cannot observe
 * different behaviour.
 */

export const moveDirectionSchema = z.enum(['up', 'down'])

export const queueMoveInputSchema = z.object({
  sessionId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
  direction: moveDirectionSchema,
})

export const queuePositionSchema = z.object({
  sessionId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
  index: z.number().int().min(0),
  total: z.number().int().min(0),
  target: z.enum(['next-turn', 'next-step']),
  first: z.boolean(),
  last: z.boolean(),
})

export const queueEntrySchema = z.object({
  target: z.enum(['next-turn', 'next-step']),
  items: z.array(z.string()).max(256),
})

export type QueueMoveInput = z.infer<typeof queueMoveInputSchema>
export type QueuePosition = z.infer<typeof queuePositionSchema>

export const queueApi = defineApi({
  id: 'queue-order',
  version: 1,
  methods: {
    move: method({ input: queueMoveInputSchema, output: queuePositionSchema }),
    describe: method({
      input: z.object({ sessionId: z.string().min(1).max(128) }),
      output: z.array(queueEntrySchema).max(4),
    }),
  },
})