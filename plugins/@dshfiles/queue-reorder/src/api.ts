import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

/**
 * Wire contract for queue reordering.
 *
 * The Host method is the only implementation; both the dock and the
 * `queue_move` agent tool call it, so the button and the agent cannot observe
 * different behaviour.
 */

export const moveDirectionSchema = Schema.Literals(['up', 'down'])

const queueMoveInputSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  itemId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  direction: moveDirectionSchema,
})

export const queuePositionSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  itemId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  index: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  total: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  target: Schema.Literals(['next-turn', 'next-step']),
  first: Schema.Boolean,
  last: Schema.Boolean,
})

const queueEntrySchema = Schema.Struct({
  target: Schema.Literals(['next-turn', 'next-step']),
  items: Schema.Array(Schema.String).check(Schema.isMaxLength(256)),
})

/** Largest queued file the dock copies back into the composer; base64 crosses the wire as one JSON string. */
export const MAX_QUEUE_FILE_BYTES = 25 * 1024 * 1024

const queueFileAttachmentSchema = Schema.Struct({
  attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  bytes: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(MAX_QUEUE_FILE_BYTES)),
})

export type QueueMoveInput = typeof queueMoveInputSchema.Type
export type QueuePosition = typeof queuePositionSchema.Type

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const queueApi = defineApi({
  id: 'queue-order',
  version: 1,
  methods: {
    move: method({ input: queueMoveInputSchema, output: queuePositionSchema }),
    describe: method({
      input: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)) }),
      output: Schema.Array(queueEntrySchema).check(Schema.isMaxLength(4)),
      description: 'The messages queued for one thread, in order, with their previews and whether each carries attachments. Read-only.',
      tool: { name: 'queue_describe', readOnly: true, render: compactJson },
    }),
    // Added after the first release: a Host started before it answers with an unknown-endpoint error.
    readFile: method({
      input: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)), attachment: queueFileAttachmentSchema }),
      output: Schema.Struct({
        name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
        data: Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_QUEUE_FILE_BYTES / 3) * 4)),
      }),
    }),
  },
})
