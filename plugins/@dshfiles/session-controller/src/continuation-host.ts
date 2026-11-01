import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { Effect } from 'effect'
import { continuationApi } from './continuation-api.ts'
import {
  ControllerUnavailable,
  SessionControllerHostRuntime,
  ThreadNotFound,
  sessionControllerHostApi,
  trySessionControllerOperation,
} from './effect-runtime.ts'

export const continuationHost = sessionControllerHostApi(continuationApi, {
  continueIn: Effect.fn('session continuation continue')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('continue in workspace', async () => {
        const sessionId = SessionId(input.sessionId)
        if (!runtime.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
          throw new ThreadNotFound({ message: 'No thread with that id exists.', code: 'thread-not-found' })
        }
        const controller = runtime.sessionController
        if (controller === undefined) throw new ControllerUnavailable({ message: 'The Session controller is not running.', code: 'controller-unavailable' })
        const forked = await controller.continueIn({ sessionId }, { workspaceId: WorkspaceId(input.workspaceId), includeOpenTurn: input.includeOpenTurn })
        return { sessionId: forked.sessionId }
      }),
    ),
  ),
})
