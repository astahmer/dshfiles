import { useApiEvent, useResource } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
import { FAILED_FINISH_REASONS, threadSidebarAttentionApi, type FailedTurn, type ThreadAttentionView } from './attention-api.js'

/**
 * Which threads show Failed, for every surface that marks one (the thread list, a tab strip). Published as the
 * `@dshfiles/thread-sidebar/failed-turns-client` dshx module, so a surface reads the Host's failed-turn record through
 * this hook instead of restating the read, its cache times and the old-Host fallback.
 */

const FAILED_TURNS_READ = { staleTime: 30_000, pollInterval: 60_000 } as const
const NONE: ReadonlyMap<string, FailedTurn> = new Map()
const ALWAYS = { enabled: true } as const

export class FailedThreadsModel {
  /**
   * Threads whose last finished turn failed: the Host's failed-turn record (it survives reading the thread), plus an
   * unread finish that failed, which is all a Host from before that record can say.
   */
  static ids(views: readonly Pick<ThreadAttentionView, 'sessionId' | 'finishedReason'>[], failedTurnSessionIds: Iterable<string>): ReadonlySet<string> {
    const unreadFailures = views.flatMap(view => (FAILED_FINISH_REASONS.some(reason => reason === view.finishedReason) ? [view.sessionId] : []))
    return new Set([...failedTurnSessionIds, ...unreadFailures])
  }
}

/**
 * Threads whose last finished turn failed, read from the Host and re-read when it announces an attention change (every
 * finished turn does). A Host that predates the method answers an error: the list is then empty, as before it existed.
 */
export const useFailedTurns = (options: { readonly enabled: boolean } = ALWAYS): ReadonlyMap<string, FailedTurn> => {
  const resource = useResource(threadSidebarAttentionApi, 'failedTurns', undefined, { ...FAILED_TURNS_READ, enabled: options.enabled })
  useApiEvent(threadSidebarAttentionApi, 'changed', () => {
    if (options.enabled) resource.refetch()
  })
  const sessions = resource.data?.sessions
  return useMemo(() => (sessions === undefined || sessions.length === 0 ? NONE : new Map(sessions.map(turn => [turn.sessionId, turn]))), [sessions])
}

/**
 * The ids of the failed threads among `views` (a surface's attention records), from the same Host record the thread
 * list reads, so a thread shows one status in the list and wherever else it is drawn.
 */
export const useFailedThreadIds = (
  views: readonly Pick<ThreadAttentionView, 'sessionId' | 'finishedReason'>[],
  options: { readonly enabled: boolean } = ALWAYS,
): ReadonlySet<string> => {
  const failedTurns = useFailedTurns(options)
  return useMemo(() => FailedThreadsModel.ids(views, failedTurns.keys()), [failedTurns, views])
}
