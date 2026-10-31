import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { LlmError, type FileBlock } from '@deepseek-ai/dsh-llm'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { MAX_QUEUE_FILE_BYTES, queueApi } from './api.js'
import { queueReorderSettings } from './settings.js'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { QueueOrderModel, QueueItemMissingError, type QueueMoveRequest } from './queue-order.js'
import '@deepseek-ai/dsh-agent'

/**
 * Queue reordering.
 *
 * DSH 0.2 ships `updateQueue` with `edit`, `remove`, and `steer`, and the Agent
 * inbox exposes `splice`, which durably records the normalized result. So a
 * reorder is a splice on the pending list rather than a remove-and-resend: the
 * message keeps its identity and the session log records the new order, so
 * replay, fork, and resume reconstruct exactly what the user saw.
 *
 * `updateQueue` cannot express a reorder, so this plugin adds one Host-side and
 * exposes it as a tool. The Client affordance calls the same function, so the
 * button and the agent can never disagree.
 */

type FileAttachmentRef = FileBlock['attachment']

interface FileReader {
  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

const isFileReader = (value: unknown): value is FileReader =>
  typeof value === 'object' && value !== null && 'readFileStream' in value && typeof value.readFileStream === 'function'

class QueueReorderRuntime extends EffectContext.Service<
  QueueReorderRuntime,
  { readonly agents: AgentRegistry | undefined; readonly attachments: FileReader | undefined }
>()('dshfiles/queue-reorder/QueueReorderRuntime') {}

class QueueReorderFailure extends Schema.TaggedError<QueueReorderFailure>()('QueueReorderFailure', {
  message: Schema.String,
  code: Schema.Literals(['MISSING_SERVICE', 'INVALID_ARGUMENT', 'NOT_FOUND']),
}) {}

const queueFailure = (message: string, code: QueueReorderFailure['code']): QueueReorderFailure => new QueueReorderFailure({ message, code })
const preserveLlmError = <A, E extends Error, R>(effect: Effect.Effect<A, E | QueueReorderFailure, R>) =>
  effect.pipe(Effect.mapError(failure => (failure instanceof QueueReorderFailure ? new LlmError(failure.message, failure.code) : failure)))

const confirmedFiles = new Map<string, Map<string, FileAttachmentRef>>()
const queueLayers = new WeakMap<CordisContext, Layer.Layer<QueueReorderRuntime>>()

const liveAgent = Effect.fn('queue-reorder agent lookup')(function* (sessionId: string) {
  const runtime = yield* QueueReorderRuntime
  if (runtime.agents === undefined) return yield* Effect.fail(queueFailure('agents service unavailable', 'MISSING_SERVICE'))
  return runtime.agents.get(SessionId(sessionId))
})

const moveQueueItem = Effect.fn('queue-reorder item move')(function* (request: QueueMoveRequest) {
  if (!QueueOrderModel.isDirection(request.direction)) {
    return yield* Effect.fail(queueFailure('queue move direction must be "up" or "down"', 'INVALID_ARGUMENT'))
  }
  const agent = yield* liveAgent(request.sessionId)
  if (agent === undefined) {
    return yield* Effect.fail(queueFailure(`Session ${request.sessionId} has no live agent, so nothing is waiting to be reordered.`, 'NOT_FOUND'))
  }
  return yield* Effect.try({
    try: () => QueueOrderModel.moveWithinInbox(agent.inbox, request),
    catch: error => {
      if (error instanceof QueueItemMissingError) return queueFailure(error.message, 'NOT_FOUND')
      throw error
    },
  })
})

const describeQueueOrder = Effect.fn('queue-reorder order describe')(function* (sessionId: string) {
  const agent = yield* liveAgent(sessionId)
  return agent === undefined ? [] : QueueOrderModel.describeInbox(agent.inbox)
})

const queuedFileRef = Effect.fn('queue-reorder file reference resolve')(function* (sessionId: string, attachmentId: string) {
  const confirmed = confirmedFiles.get(sessionId)?.get(attachmentId)
  if (confirmed !== undefined) return confirmed
  const agent = yield* liveAgent(sessionId)
  if (agent === undefined) return undefined
  for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
    for (const block of message.content) {
      if (block.type !== 'file' || block.attachment.attachmentId !== attachmentId) continue
      const session = confirmedFiles.get(sessionId) ?? new Map<string, FileAttachmentRef>()
      session.set(attachmentId, block.attachment)
      confirmedFiles.set(sessionId, session)
      return block.attachment
    }
  }
  return undefined
})

const readQueuedFileEffect = Effect.fn('queue-reorder file read')(function* (request: { readonly sessionId: string; readonly attachmentId: string }) {
  const ref = yield* queuedFileRef(request.sessionId, request.attachmentId)
  if (ref === undefined) return yield* Effect.fail(queueFailure('That file is not attached to a message queued in this session.', 'NOT_FOUND'))
  if (ref.bytes > MAX_QUEUE_FILE_BYTES) return yield* Effect.fail(queueFailure('That file is too large to edit in the composer.', 'INVALID_ARGUMENT'))
  const runtime = yield* QueueReorderRuntime
  const attachments = runtime.attachments
  if (attachments === undefined) return yield* Effect.fail(queueFailure('attachments service unavailable', 'MISSING_SERVICE'))
  return yield* Effect.tryPromise({
    try: async abortSignal => {
      const chunks: Uint8Array[] = []
      let total = 0
      for await (const chunk of attachments.readFileStream(ref, abortSignal)) {
        total += chunk.byteLength
        if (total > MAX_QUEUE_FILE_BYTES) throw queueFailure('That file is too large to edit in the composer.', 'INVALID_ARGUMENT')
        chunks.push(chunk)
      }
      return { name: ref.name, data: Buffer.concat(chunks).toString('base64') }
    },
    catch: error => {
      if (error instanceof QueueReorderFailure) return error
      throw error
    },
  })
})

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: (ctx: CordisContext) => {
    const attachments = ctx.get('attachments')
    const layer = Layer.succeed(QueueReorderRuntime, {
      agents: ctx.get('agents'),
      attachments: isFileReader(attachments) ? attachments : undefined,
    })
    queueLayers.set(ctx, layer)
    return layer
  },
  setup: (ctx: CordisContext) =>
    Effect.sync(() => {
      hostContext = ctx
      ctx.provide('queueOrder', {
        move: (request: QueueMoveRequest) => runQueueEffect(preserveLlmError(moveQueueItem(request)), ctx),
        describe: (sessionId: string) => runQueueEffect(describeQueueOrder(sessionId), ctx),
      })
    }),
})

const runQueueEffect = <A, E>(effect: Effect.Effect<A, E, QueueReorderRuntime>, ctx: CordisContext, signal?: AbortSignal): Promise<A> => {
  const layer = queueLayers.get(ctx)
  if (layer === undefined) return Promise.reject(new LlmError('queue-reorder is not active yet', 'MISSING_SERVICE'))
  const runnable = Effect.provide(effect, Layer.merge(layer, DshxEffect.tracerLayer))
  if (signal === undefined) return Effect.runPromise(runnable)
  return Effect.runPromise(runnable, { signal })
}

const readQueuedFilePromise = (ctx: CordisContext, request: { readonly sessionId: string; readonly attachmentId: string }, signal?: AbortSignal) =>
  runQueueEffect(preserveLlmError(readQueuedFileEffect(request)), ctx, signal)

let hostContext: CordisContext | undefined

const moveTool = defineTool({
  name: 'queue_move',
  description:
    'Move one message waiting in a session queue up or down by one position. Use it when the user asks to reorder the queue, or to put a queued message before or after another.',
  parameters: {
    sessionId: { type: 'string', required: true, description: 'Session whose queue is being reordered.' },
    itemId: { type: 'string', required: true, description: 'Id of the queued message to move.' },
    direction: { type: 'string', required: true, description: '"up" moves it earlier, "down" moves it later.' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string' },
        itemId: { type: 'string' },
        index: { type: 'number' },
        total: { type: 'number' },
        target: { type: 'string' },
        first: { type: 'boolean' },
        last: { type: 'boolean' },
      },
    },
    render(_args, value) {
      const index = value.index ?? 0
      const total = value.total ?? 0
      const where = value.first === true ? 'first' : value.last === true ? 'last' : `position ${index + 1} of ${total}`
      return [{ type: 'text', text: `Moved ${value.itemId ?? 'item'} to ${where} in the ${value.target ?? 'queue'} queue.` }]
    },
  },
  execute: async args => {
    if (hostContext === undefined) {
      throw new LlmError('queue-reorder is not active yet', 'MISSING_SERVICE')
    }
    const direction = args.direction
    if (!QueueOrderModel.isDirection(direction)) throw new LlmError('queue move direction must be "up" or "down"', 'INVALID_ARGUMENT')
    return runQueueEffect(preserveLlmError(moveQueueItem({ sessionId: args.sessionId, itemId: args.itemId, direction })), hostContext)
  },
})

const queueHostApi = hostApi(queueApi, {
  move: ({ input }) => preserveLlmError(moveQueueItem(input)),
  describe: ({ input }) => describeQueueOrder(input.sessionId),
  readFile: ({ input }) => preserveLlmError(readQueuedFileEffect({ sessionId: input.sessionId, attachmentId: input.attachment.attachmentId })),
})

export const readQueuedFile = readQueuedFilePromise

export default defineHost({
  ...effectPlugin,
  name: 'llm-queue-reorder',
  apis: [queueHostApi],
  inject: ['agents'],
  tools: [moveTool],
  settings: [queueReorderSettings],
})
