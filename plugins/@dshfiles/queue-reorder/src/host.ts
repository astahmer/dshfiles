import { Api, DshxPlugin, Tool } from '@dshfiles/dshx/effect'
import { Layer, Schema } from 'effect'
import { moveDirectionSchema, queueApi, queuePositionSchema } from './api.js'
import { QueuedFiles, QueueOrder } from './queue-order-service.js'
import { queueReorderSettings } from './settings.js'

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
  layer: QueueOrder.layer.pipe(Layer.provide(QueuedFiles.layer)),
  apis: [
    Api.bind(queueApi, {
      move: input => QueueOrder.use(queue => queue.move(input)),
      describe: input => QueueOrder.use(queue => queue.describe(input.sessionId)),
      readFile: input => QueueOrder.use(queue => queue.readFile({ sessionId: input.sessionId, attachmentId: input.attachment.attachmentId })),
    }),
  ],
  tools: [moveTool],
})
