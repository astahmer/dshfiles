import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { PluginApiError } from '@dshfiles/dshx/api'
import { continuationApi } from './continuation-api.ts'

export const continuationHost = continuationApi.host({
  continueIn: async ({ ctx, input }) => {
    const sessionId = SessionId(input.sessionId)
    if (!ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
      throw new PluginApiError('No thread with that id exists.', { code: 'thread-not-found' })
    }
    const controller = ctx.get('sessionController')
    if (controller === undefined) throw new PluginApiError('The Session controller is not running.', { code: 'controller-unavailable' })
    const forked = await controller.continueIn({ sessionId }, { workspaceId: WorkspaceId(input.workspaceId), includeOpenTurn: input.includeOpenTurn })
    return { sessionId: forked.sessionId }
  },
})
