import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { ChatFocusModel } from '@dshfiles/chat/chat-focus'
import type { ThreadTarget } from './thread-links.js'

/** Opens a span's thread and asks its Chat to land on the span's turn, step or tool call; returns why it could not. */
export type OpenThread = (target: ThreadTarget) => string | null

export const createThreadOpener = (input: {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly uiWorkspace: UiWorkspace
  readonly unavailable: () => string
}): OpenThread => {
  return target => {
    const workspaceList = input.workspaces.list.getSnapshot()
    if (workspaceList.phase === 'ready' && workspaceList.archivedSessionIds.some(archivedId => archivedId === target.sessionId)) return input.unavailable()
    const sessionList = input.sessions.list.getSnapshot()
    const availableId = sessionList.ids.find(candidate => candidate === target.sessionId)
    const session = availableId === undefined ? undefined : sessionList.byId[availableId]
    if (session === undefined) return input.unavailable()
    input.uiWorkspace.openSession(session.id)
    if (target.focus !== null) ChatFocusModel.request({ sessionId: session.id, focus: target.focus })
    return null
  }
}
