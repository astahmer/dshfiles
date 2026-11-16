import { useApiEvent, useResource } from '@dshfiles/dshx/client'
import { FAILED_FINISH_REASONS, threadSidebarAttentionApi, type ThreadAttentionView } from '@dshfiles/thread-sidebar/attention-api'
import { useMemo } from 'react'

const FAILED_TURNS_READ = { staleTime: 30_000, pollInterval: 60_000 } as const

export class FailedThreads {
  /**
   * Threads whose last finished turn failed: the Host's failed-turn record (it survives reading the thread), plus an
   * unread finish that failed, which is all an older Host without that record can say.
   */
  static ids(views: readonly Pick<ThreadAttentionView, 'sessionId' | 'finishedReason'>[], failedTurnSessionIds: readonly string[]): ReadonlySet<string> {
    const unreadFailures = views.flatMap(view => (FAILED_FINISH_REASONS.some(reason => reason === view.finishedReason) ? [view.sessionId] : []))
    return new Set([...failedTurnSessionIds, ...unreadFailures])
  }
}

/**
 * The failed threads a tab marks with the red cross, read from the same Host record the thread list reads, so a
 * thread shows one status in the list and on its tab. Re-read when the Host announces an attention change.
 */
export const useFailedThreadIds = (views: readonly ThreadAttentionView[]): ReadonlySet<string> => {
  const resource = useResource(threadSidebarAttentionApi, 'failedTurns', undefined, FAILED_TURNS_READ)
  useApiEvent(threadSidebarAttentionApi, 'changed', () => resource.refetch())
  const sessions = resource.data?.sessions
  return useMemo(() => FailedThreads.ids(views, sessions?.map(turn => turn.sessionId) ?? []), [sessions, views])
}
