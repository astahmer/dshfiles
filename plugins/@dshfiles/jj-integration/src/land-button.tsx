import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useSyncExternalStore } from 'react'
import { jjIntegrationApi } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'
import { announceRepositoryChange, describeLandResult, useLandToast } from './land-feedback.js'
import { threadQueryKeys } from './panel.js'

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
  })
  const land = useMutation({
    mutationFn: (path: string) => runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path, sessionId: props.sessionId }, { signal }) }),
    onSuccess: result => toast.show({ text: describeLandResult(props.t, result), success: result.status === 'landed' }),
    onError: error => toast.show({ text: errorMessage(error, props.t('loadFailed')), success: false }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['jj-integration'] })
      announceRepositoryChange()
    },
  })
  const current = thread.data?.thread
  if (current === null || current === undefined) return toast.element
  const label = props.t('landThread', { bookmark: props.bookmark })
  return (
    <>
      <Button
        className="dshx-root"
        disabled={land.isPending || current.unlanded.length === 0}
        onClick={() => land.mutate(current.path)}
        size="sm"
        title={`${label} (${props.t('unlanded', { count: current.unlanded.length })})`}
        type="button"
        variant="ghost"
        aria-label={label}
      >
        {land.isPending ? <Spinner /> : null}
        {props.t('land')}
        {current.unlanded.length > 0 ? ` · ${String(current.unlanded.length)}` : ''}
      </Button>
      {toast.element}
    </>
  )
}
