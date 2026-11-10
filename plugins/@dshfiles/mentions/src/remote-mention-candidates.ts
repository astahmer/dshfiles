import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference'
import type { RemoteThreadSummary } from '@dshfiles/multi-host/api'

type MentionSessions = Readonly<Record<SessionSummary['id'], Pick<SessionSummary, 'id' | 'blank'>>>

/** Indexed once per lookup: the thread list reaches 1000 rows, so scanning every summary per row is quadratic. */
const summariesBySessionId = (sessions: MentionSessions): ReadonlyMap<string, Pick<SessionSummary, 'id' | 'blank'>> => {
  const bySessionId = new Map<string, Pick<SessionSummary, 'id' | 'blank'>>()
  for (const summary of Object.values(sessions)) {
    const sessionId = String(summary.id)
    if (!bySessionId.has(sessionId)) bySessionId.set(sessionId, summary)
  }
  return bySessionId
}

export const remoteMentionCandidates = (input: {
  readonly threads: readonly RemoteThreadSummary[]
  readonly sessions: MentionSessions
  readonly currentSessionId: SessionSummary['id']
  readonly currentCwd: string | undefined
}): readonly SessionReferenceMentionCandidate[] => {
  const bySessionId = summariesBySessionId(input.sessions)
  return input.threads.flatMap(thread => {
    if (thread.mention === undefined) return []
    const summary = bySessionId.get(thread.sessionId)
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
}
