import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { threadModelApi } from './thread-model-api.ts'
import { Effect } from 'effect'
import {
  ControllerUnavailable,
  SessionControllerHostRuntime,
  ThreadModelForbidden,
  ThreadModelSessionRequired,
  ThreadNotFound,
  sessionControllerHostApi,
  trySessionControllerOperation,
} from './effect-runtime.ts'

/** Agents have self-only authority; other authenticated callers name their target explicitly. */
export const threadModelSessionForCaller = (input: { sessionId?: string }, caller: ApiCaller): string => {
  if (caller.kind === 'agent') {
    if (caller.sessionId === undefined || (input.sessionId !== undefined && input.sessionId !== caller.sessionId)) {
      throw new ThreadModelForbidden({ message: 'Agents may target only their own active thread.', code: 'thread-model-forbidden' })
    }
    return caller.sessionId
  }
  if (input.sessionId === undefined) throw new ThreadModelSessionRequired({ message: 'A thread ID is required.', code: 'thread-model-session-required' })
  return input.sessionId
}

export const threadModelHost = sessionControllerHostApi(threadModelApi, {
  snapshot: Effect.fn('thread model state read')(({ input, caller }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('thread model operation', async () => {
        const sessionId = SessionId(threadModelSessionForCaller(input, caller))
        if (!runtime.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
          throw new ThreadNotFound({ message: 'No thread with that id exists.', code: 'thread-not-found' })
        }
        const controller = runtime.sessionController
        if (controller === undefined) throw new ControllerUnavailable({ message: 'The Session controller is not running.', code: 'controller-unavailable' })
        return controller.threadModelSnapshot(sessionId)
      }),
    ),
  ),
  select: Effect.fn('thread model selection set')(({ input, caller }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('thread model operation', async () => {
        const sessionId = SessionId(threadModelSessionForCaller(input, caller))
        if (!runtime.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
          throw new ThreadNotFound({ message: 'No thread with that id exists.', code: 'thread-not-found' })
        }
        const controller = runtime.sessionController
        if (controller === undefined) throw new ControllerUnavailable({ message: 'The Session controller is not running.', code: 'controller-unavailable' })
        return controller.selectThreadModel({ ...input, sessionId })
      }),
    ),
  ),
})
