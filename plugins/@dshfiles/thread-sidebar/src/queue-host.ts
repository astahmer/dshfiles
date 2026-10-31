import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import type { Context } from '@deepseek-ai/cordis'
import { Effect } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { threadQueueApi, type ThreadQueueAction } from './queue-api.js'

const targetSessionId = (requested: string | undefined, caller: ApiCaller): string => {
  const sessionId = requested ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
  if (sessionId === undefined) throw new PluginApiError('Pass sessionId: this tool cannot tell which thread queue to edit.', { code: 'queue-target-unknown' })
  return sessionId
}

const controllerOf = (ctx: Context) => {
  const controller = ctx.sessionController
  if (controller === undefined)
    throw new PluginApiError('This DSH has no Session controller, so a queued message cannot be changed.', { code: 'queue-controller-missing' })
  return controller
}

const queueResult = (sessionId: string, itemId: string, action: ThreadQueueAction) => ({ sessionId, itemId, action })

export const threadQueueHost = DshxEffect.host(threadQueueApi, {
  remove: Effect.fn('thread queue remove')(({ input, caller, ctx }) =>
    Effect.tryPromise({
      try: async () => {
        const sessionId = targetSessionId(input.sessionId, caller)
        await controllerOf(ctx).updateQueue({ sessionId: SessionId(sessionId), itemId: MessageId(input.itemId), action: { kind: 'remove' } })
        return queueResult(sessionId, input.itemId, 'remove')
      },
      catch: error => error,
    }),
  ),
  steer: Effect.fn('thread queue steer')(({ input, caller, ctx }) =>
    Effect.tryPromise({
      try: async () => {
        const sessionId = targetSessionId(input.sessionId, caller)
        await controllerOf(ctx).updateQueue({ sessionId: SessionId(sessionId), itemId: MessageId(input.itemId), action: { kind: 'steer' } })
        return queueResult(sessionId, input.itemId, 'steer')
      },
      catch: error => error,
    }),
  ),
  edit: Effect.fn('thread queue edit')(({ input, caller, ctx }) =>
    Effect.tryPromise({
      try: async () => {
        const sessionId = targetSessionId(input.sessionId, caller)
        await controllerOf(ctx).updateQueue({
          sessionId: SessionId(sessionId),
          itemId: MessageId(input.itemId),
          action: { kind: 'edit', content: [{ type: 'text', text: input.text }] },
        })
        return queueResult(sessionId, input.itemId, 'edit')
      },
      catch: error => error,
    }),
  ),
})
