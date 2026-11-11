import { Api, DshxPlugin, Tool } from '@dshfiles/dshx/effect'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Effect, Layer, Schema } from 'effect'
import { moveDirectionSchema, queueApi, queuePositionSchema } from './api.js'
import { QueuedFiles, QueueOrder } from './queue-order-service.js'
import { scheduledSendApi } from './scheduled-send-api.js'
import { ScheduledSendDeliveryLive } from './scheduled-send-delivery.js'
import { ScheduledSendStore } from './scheduled-send-store.js'
import { runScheduledSends, ScheduledSendRefused, ScheduledSends } from './scheduled-sends.js'
import { queueReorderSettings } from './settings.js'

/** An agent's write defaults to its own thread; every other caller names the thread. */
const targetSession = (sessionId: string | undefined, caller: ApiCaller) => {
  const resolved = sessionId ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
  return resolved === undefined
    ? Effect.fail(new ScheduledSendRefused({ reason: 'Name the thread (sessionId) the message is for.' }))
    : Effect.succeed(resolved)
}

const ScheduledSendsLive = ScheduledSends.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(ScheduledSendStore.layer, ScheduledSendDeliveryLive.pipe(Layer.provide(HostApis.layer)))),
)

const moveToolInput = Schema.Struct({
  sessionId: Schema.String.annotate({ description: 'Session whose queue is being reordered.' }),
  itemId: Schema.String.annotate({ description: 'Id of the queued message to move.' }),
  direction: moveDirectionSchema.annotate({ description: '"up" moves it earlier, "down" moves it later.' }),
})

const moveTool = Tool.make({
  name: 'queue_move',
  description:
    'Move one message waiting in a session queue up or down by one position. Use it when the user asks to reorder the queue, or to put a queued message before or after another.',
  input: moveToolInput,
  output: queuePositionSchema,
  render: position => {
    const where = position.first ? 'first' : position.last ? 'last' : `position ${position.index + 1} of ${position.total}`
    return `Moved ${position.itemId} to ${where} in the ${position.target} queue.`
  },
  execute: input => QueueOrder.use(queue => queue.move(input)),
})

export default DshxPlugin.make({
  name: 'llm-queue-reorder',
  inject: ['agents'],
  settings: [queueReorderSettings],
  layer: Layer.mergeAll(QueueOrder.layer.pipe(Layer.provide(QueuedFiles.layer)), ScheduledSendsLive),
  main: runScheduledSends,
  apis: [
    Api.bind(scheduledSendApi, {
      list: (input, { caller }) =>
        ScheduledSends.use(sends => sends.list({ sessionId: input.sessionId ?? (caller.kind === 'agent' ? caller.sessionId : undefined) })),
      create: (input, { caller }) =>
        Effect.flatMap(targetSession(input.sessionId, caller), sessionId =>
          ScheduledSends.use(sends => sends.create({ sessionId, text: input.text, sendAt: input.sendAt, model: input.model })),
        ),
      update: input => ScheduledSends.use(sends => sends.update(input)),
      cancel: input => ScheduledSends.use(sends => sends.cancel(input)),
      sendNow: input => ScheduledSends.use(sends => sends.sendNow(input)),
    }),
    Api.bind(queueApi, {
      move: input => QueueOrder.use(queue => queue.move(input)),
      describe: input => QueueOrder.use(queue => queue.describe(input.sessionId)),
      readFile: input => QueueOrder.use(queue => queue.readFile({ sessionId: input.sessionId, attachmentId: input.attachment.attachmentId })),
    }),
  ],
  tools: [moveTool],
})
