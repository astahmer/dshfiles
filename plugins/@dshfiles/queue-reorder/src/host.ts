import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Api, DshxPlugin, HostContext, Tool } from '@dshfiles/dshx/effect'
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

/**
 * Whether `caller` may touch the sends of `sessionId`. An agent reaches only its own thread and the subagent threads
 * below it, so one thread's agent cannot schedule, read or change another thread's messages; delivery then prompts
 * with Host rights, so this is the gate.
 */
const reaches = (caller: ApiCaller) =>
  Effect.map(HostContext, host => (sessionId: string): boolean => {
    if (caller.kind !== 'agent') return true
    if (caller.sessionId === undefined) return false
    const parentOf = (id: string): string | undefined => {
      const header = host.ctx.get('agents')?.get(SessionId(id))?.session.header
      return header?.origin === 'subagent' ? header.parentSession : undefined
    }
    const visited = new Set<string>()
    for (let current: string | undefined = sessionId; current !== undefined && !visited.has(current); current = parentOf(current)) {
      if (current === caller.sessionId) return true
      visited.add(current)
    }
    return false
  })

const outOfReach = (sessionId: string) =>
  new ScheduledSendRefused({ reason: `Thread ${sessionId} is not yours: an agent schedules messages only for its own thread and its subagents.` })

/** An agent's write defaults to its own thread; every other caller names the thread. */
const targetSession = (sessionId: string | undefined, caller: ApiCaller) =>
  Effect.gen(function* () {
    const resolved = sessionId ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
    if (resolved === undefined) return yield* new ScheduledSendRefused({ reason: 'Name the thread (sessionId) the message is for.' })
    if (!(yield* reaches(caller))(resolved)) return yield* outOfReach(resolved)
    return resolved
  })

/** The send `id`, refused as unknown when it belongs to a thread the caller cannot reach. */
const reachableSend = (id: string, caller: ApiCaller) =>
  Effect.gen(function* () {
    const allowed = yield* reaches(caller)
    const send = (yield* ScheduledSends.use(sends => sends.list({}))).sends.find(candidate => candidate.id === id)
    if (send !== undefined && !allowed(send.sessionId)) return yield* ScheduledSendRefused.notFound(id)
  })

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
        Effect.gen(function* () {
          const sessionId = input.sessionId ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
          const allowed = yield* reaches(caller)
          if (sessionId !== undefined && !allowed(sessionId)) return yield* outOfReach(sessionId)
          const listed = yield* ScheduledSends.use(sends => sends.list({ sessionId }))
          return { sends: listed.sends.filter(send => allowed(send.sessionId)) }
        }),
      create: (input, { caller }) =>
        Effect.flatMap(targetSession(input.sessionId, caller), sessionId =>
          ScheduledSends.use(sends => sends.create({ sessionId, text: input.text, sendAt: input.sendAt, model: input.model })),
        ),
      update: (input, { caller }) =>
        Effect.andThen(
          reachableSend(input.id, caller),
          ScheduledSends.use(sends => sends.update(input)),
        ),
      cancel: (input, { caller }) =>
        Effect.andThen(
          reachableSend(input.id, caller),
          ScheduledSends.use(sends => sends.cancel(input)),
        ),
      sendNow: (input, { caller }) =>
        Effect.andThen(
          reachableSend(input.id, caller),
          ScheduledSends.use(sends => sends.sendNow(input)),
        ),
    }),
    Api.bind(queueApi, {
      move: input => QueueOrder.use(queue => queue.move(input)),
      describe: input => QueueOrder.use(queue => queue.describe(input.sessionId)),
      readFile: input => QueueOrder.use(queue => queue.readFile({ sessionId: input.sessionId, attachmentId: input.attachment.attachmentId })),
    }),
  ],
  tools: [moveTool],
})
