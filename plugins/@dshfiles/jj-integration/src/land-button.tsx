import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { jjIntegrationApi } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'
import { announceRepositoryChange, describeLandResult, useLandToast } from './land-feedback.js'
import { threadQueryKeys } from './panel.js'
import { canRebaseThread, hasPendingUserQuestion } from './thread-rebase-eligibility.js'

export interface LandButtonProps {
  readonly sessionId: SessionSummary['id']
  readonly sessions: ISessions
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
}

const noCwd = (): null => null

/** Shown in a thread's header only when that thread runs in its own jj workspace. */
export const LandButton = (props: LandButtonProps): JSX.Element | null => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const subscribe = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const read = useCallback(() => props.sessions.list.getSnapshot().byId[props.sessionId]?.cwd ?? null, [props.sessions, props.sessionId])
  const cwd = useSyncExternalStore(subscribe, read, noCwd)
  const toast = useLandToast()
  const thread = useQuery({
    queryKey: threadQueryKeys.threadAt(cwd ?? ''),
    enabled: cwd !== null && cwd.length > 0,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.threadAt({ path: cwd ?? '' }, { signal: hostSignal }) }),
    refetchInterval: query => (query.state.data?.thread === null ? false : 5_000),
  })
  const rebase = useMutation({
    mutationFn: (path: string) => runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path, sessionId: props.sessionId }, { signal }) }),
    onSuccess: result => toast.show({ text: describeLandResult(props.t, result), success: result.status === 'landed' }),
    onError: error => toast.show({ text: errorMessage(error, props.t('loadFailed')), success: false }),
    onSettled: () => {
      announceRepositoryChange()
      return queryClient.invalidateQueries({ queryKey: ['jj-integration'] })
    },
  })
  const current = thread.data?.thread
  const sessionIds = useMemo(() => current?.sessionIds ?? [props.sessionId], [current?.sessionIds, props.sessionId])
  const readSessionRunning = useCallback(
    () => Object.values(props.sessions.list.getSnapshot().byId).some(session => session.cwd === current?.path && session.running),
    [current?.path, props.sessions],
  )
  const readClientCanRebase = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return canRebaseThread(sessionIds, sessionId => {
      const session = sessions[SessionId(sessionId)]
      return session === undefined ? undefined : { running: session.running, pendingUserQuestion: hasPendingUserQuestion(session.projectionValues) }
    })
  }, [props.sessions, sessionIds])
  const readClientQuestionPending = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return (
      sessionIds.some(sessionId => hasPendingUserQuestion(sessions[SessionId(sessionId)]?.projectionValues) === true) ||
      (current?.path !== undefined &&
        Object.values(sessions).some(session => session.cwd === current.path && hasPendingUserQuestion(session.projectionValues) === true))
    )
  }, [current?.path, props.sessions, sessionIds])
  const sessionRunning = useSyncExternalStore(subscribe, readSessionRunning, () => true)
  const clientCanRebase = useSyncExternalStore(subscribe, readClientCanRebase, () => false)
  const sessionWaitingForInput = useSyncExternalStore(subscribe, readClientQuestionPending, () => true)
  const canRebase = current?.canRebase === true && !sessionRunning && !sessionWaitingForInput
  useEffect(() => {
    if (current?.canRebase !== false || !clientCanRebase) return
    void queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(current.path) })
  }, [clientCanRebase, current?.canRebase, current?.path, queryClient])
  if (current === null || current === undefined) return toast.element
  const label = props.t('rebaseThread', { bookmark: props.bookmark })
  return (
    <>
      <Button
        className="dshx-root"
        disabled={rebase.isPending || thread.isFetching || current.unlanded.length === 0 || !canRebase}
        onClick={() => rebase.mutate(current.path)}
        size="sm"
        title={canRebase ? `${label} (${props.t('toRebase', { count: current.unlanded.length })})` : `${label} — ${props.t('rebaseBlocked')}`}
        type="button"
        variant="ghost"
        aria-label={label}
      >
        {rebase.isPending ? <Spinner /> : null}
        {props.t('rebase')}
        {current.unlanded.length > 0 ? ` · ${String(current.unlanded.length)}` : ''}
      </Button>
      {toast.element}
    </>
  )
}
