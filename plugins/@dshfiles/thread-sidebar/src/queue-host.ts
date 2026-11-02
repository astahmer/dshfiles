import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api } from '@dshfiles/dshx/effect'
import { Effect, Schema } from 'effect'
import { threadQueueApi, type ThreadQueueAction } from './queue-api.js'
import { SidebarHost, type QueueAction } from './sidebar-host-promise.js'

/** The queue verb names no thread and the caller is not an Agent, so there is no thread to default to. */
export class QueueTargetUnknown extends Schema.TaggedError<QueueTargetUnknown>()(
  'QueueTargetUnknown',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'queue-target-unknown' },
) {
  override get message(): string {
    return 'Pass sessionId: this tool cannot tell which thread queue to edit.'
  }
}

/** The running DSH has no Session controller to change a queued message. */
export class QueueControllerMissing extends Schema.TaggedError<QueueControllerMissing>()(
  'QueueControllerMissing',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'queue-controller-missing' },
) {
  override get message(): string {
    return 'This DSH has no Session controller, so a queued message cannot be changed.'
  }
}

const targetSessionId = (requested: string | undefined, caller: ApiCaller) => {
  const sessionId = requested ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
  return sessionId === undefined ? Effect.fail(new QueueTargetUnknown()) : Effect.succeed(sessionId)
}

const change = Effect.fn('thread queue change')(function* (input: {
  readonly sessionId: string | undefined
  readonly itemId: string
  readonly caller: ApiCaller
  readonly action: QueueAction
}) {
  const sessionId = yield* targetSessionId(input.sessionId, input.caller)
  const host = yield* SidebarHost
  yield* host
    .updateQueue({ sessionId, itemId: input.itemId, action: input.action })
    .pipe(Effect.catchTag('HostCapabilityMissing', cause => Effect.fail(new QueueControllerMissing({ cause }))))
  const action: ThreadQueueAction = input.action.kind
  return { sessionId, itemId: input.itemId, action }
})

export const threadQueueHandlers = Api.handlers(threadQueueApi, {
  remove: (input, call) => change({ sessionId: input.sessionId, itemId: input.itemId, caller: call.caller, action: { kind: 'remove' } }),
  steer: (input, call) => change({ sessionId: input.sessionId, itemId: input.itemId, caller: call.caller, action: { kind: 'steer' } }),
  edit: (input, call) => change({ sessionId: input.sessionId, itemId: input.itemId, caller: call.caller, action: { kind: 'edit', text: input.text } }),
})
