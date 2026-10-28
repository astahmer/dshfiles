import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { threadModelApi } from './thread-model-api.ts'
import type {} from './native/index.ts'

/** Agents have self-only authority; other authenticated callers name their target explicitly. */
export function threadModelSessionForCaller(input: { sessionId?: string }, caller: ApiCaller): string {
  if (caller.kind === 'agent') {
    if (caller.sessionId === undefined || (input.sessionId !== undefined && input.sessionId !== caller.sessionId)) {
      throw new PluginApiError('Agents may target only their own active thread.', { code: 'thread-model-forbidden' })
    }
    return caller.sessionId
  }
  if (input.sessionId === undefined) throw new PluginApiError('A thread ID is required.', { code: 'thread-model-session-required' })
  return input.sessionId
}

export const threadModelHost = threadModelApi.host({
  snapshot: ({ ctx, input, caller }) => {
    const sessionId = SessionId(threadModelSessionForCaller(input, caller))
    if (!ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
      throw new PluginApiError('No thread with that id exists.', { code: 'thread-not-found' })
    }
    const controller = ctx.get('sessionController')
    if (controller === undefined) throw new PluginApiError('The Session controller is not running.', { code: 'controller-unavailable' })
    return controller.threadModelSnapshot(sessionId)
  },
  select: ({ ctx, input, caller }) => {
    const sessionId = SessionId(threadModelSessionForCaller(input, caller))
    if (!ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
      throw new PluginApiError('No thread with that id exists.', { code: 'thread-not-found' })
    }
    const controller = ctx.get('sessionController')
    if (controller === undefined) throw new PluginApiError('The Session controller is not running.', { code: 'controller-unavailable' })
    return controller.selectThreadModel({ ...input, sessionId })
  },
})
