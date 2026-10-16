import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { threadQueueApi, type ThreadQueueAction } from './queue-api.js'

const targetSessionId = (requested: string | undefined, caller: ApiCaller): string => {
  const sessionId = requested ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
  if (sessionId === undefined) throw new PluginApiError('Pass sessionId: this tool cannot tell which thread queue to edit.', { code: 'queue-target-unknown' })
  return sessionId
}

const queueResult = (sessionId: string, itemId: string, action: ThreadQueueAction) => ({ sessionId, itemId, action })

export const threadQueueHost = threadQueueApi.host({
  remove: async ({ input, caller, ctx }) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    const controller = ctx.get('sessionController')
    if (controller === undefined)
      throw new PluginApiError('This DSH has no Session controller, so a queued message cannot be changed.', { code: 'queue-controller-missing' })
    await controller.updateQueue({ sessionId: SessionId(sessionId), itemId: MessageId(input.itemId), action: { kind: 'remove' } })
    return queueResult(sessionId, input.itemId, 'remove')
  },
  steer: async ({ input, caller, ctx }) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    const controller = ctx.get('sessionController')
    if (controller === undefined)
      throw new PluginApiError('This DSH has no Session controller, so a queued message cannot be changed.', { code: 'queue-controller-missing' })
    await controller.updateQueue({ sessionId: SessionId(sessionId), itemId: MessageId(input.itemId), action: { kind: 'steer' } })
    return queueResult(sessionId, input.itemId, 'steer')
  },
})
