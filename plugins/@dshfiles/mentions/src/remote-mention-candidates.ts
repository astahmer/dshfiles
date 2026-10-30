import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference'
import type { RemoteThreadSummary } from '@dshfiles/multi-host/api'

export const remoteMentionCandidates = (input: {
  readonly threads: readonly RemoteThreadSummary[]
  readonly sessions: Readonly<Record<SessionSummary['id'], Pick<SessionSummary, 'id' | 'blank'>>>
  readonly currentSessionId: SessionSummary['id']
  readonly currentCwd: string | undefined
}): readonly SessionReferenceMentionCandidate[] =>
  input.threads.flatMap(thread => {
    if (thread.mention === undefined) return []
    const summary = Object.values(input.sessions).find(candidate => String(candidate.id) === thread.sessionId)
    if (summary === undefined || summary.blank || summary.id === input.currentSessionId) return []
    const sessionId = summary.id
    const label = thread.title.trim() || thread.sessionId
    const createdAt = Date.parse(thread.createdAt)
    if (!Number.isFinite(createdAt)) return []
    return [
      {
        sessionId,
        label,
        displayTitle: label,
        cwd: thread.cwd,
        sameWorkspace: input.currentCwd !== undefined && thread.cwd === input.currentCwd,
        createdAt,
        mention: thread.mention,
      },
    ]
  })
