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

/** Largest queued file the dock copies back into the composer; base64 crosses the wire as one JSON string. */
export const MAX_QUEUE_FILE_BYTES = 25 * 1024 * 1024

export const queueFileAttachmentSchema = z.object({
  attachmentId: z.string().min(1).max(256),
  name: z.string().min(1).max(512),
  bytes: z.number().int().min(0).max(MAX_QUEUE_FILE_BYTES),
})

export type QueueMoveInput = z.infer<typeof queueMoveInputSchema>
export type QueuePosition = z.infer<typeof queuePositionSchema>

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const queueApi = defineApi({
  id: 'queue-order',
  version: 1,
  methods: {
    move: method({ input: queueMoveInputSchema, output: queuePositionSchema }),
    describe: method({
      input: z.object({ sessionId: z.string().min(1).max(128) }),
      output: z.array(queueEntrySchema).max(4),
      description: 'The messages queued for one thread, in order, with their previews and whether each carries attachments. Read-only.',
      tool: { name: 'queue_describe', readOnly: true, render: compactJson },
    }),
    // Added after the first release: a Host started before it answers with an unknown-endpoint error.
    readFile: method({
      input: z.object({ sessionId: z.string().min(1).max(128), attachment: queueFileAttachmentSchema }),
      output: z.object({ name: z.string().min(1).max(512), data: z.string().max(Math.ceil(MAX_QUEUE_FILE_BYTES / 3) * 4) }),
    }),
  },
})
