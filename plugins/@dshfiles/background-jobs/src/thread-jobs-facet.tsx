import { useApi, useApiEvent, useRegistry } from '@dshfiles/dshx/client'
import { EntityList } from '@dshfiles/plugin-ui/components/entity-row'
import { RollingNumber } from '@dshfiles/plugin-ui/components/motion/text'
import { PageSection } from '@dshfiles/plugin-ui/components/page'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { backgroundJobsApi } from './api.js'
import type { BackgroundJobsTranslate } from './locales.js'
import { JobLine } from './panel.js'
import { ProcessViews } from './process-views.js'
import { Processes } from './processes-page.js'
import type { JobRow } from './types.js'

const LIMIT = 50

/**
 * The thread panel's Jobs facet (plans/ade-ux §4.4): this thread's background jobs, then each Processes view that can
 * filter to one thread (dev servers from @dshfiles/preview, RAM from @dshfiles/worktree-memory). The whole host's
 * picture stays Observe › Processes.
 */
export const ThreadJobsFacet = (props: {
  readonly sessionId: string
  readonly t: BackgroundJobsTranslate
  readonly sessionLabel: (sessionId: string) => string
  readonly onOpenProcesses: () => void
}): JSX.Element => {
  const t = props.t
  const api = useApi(backgroundJobsApi)
  const queryClient = useQueryClient()
  const views = Processes.threadViews(useRegistry(ProcessViews))
  const key = ['background-jobs', 'board', 'thread', props.sessionId] as const
  const [now, setNow] = useState(() => Date.now())
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const events = useApiEvent(backgroundJobsApi, 'changed', () => void queryClient.invalidateQueries({ queryKey: key }))
  const board = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.board({ scope: 'all', sessionId: props.sessionId, limit: LIMIT }, { signal }),
    refetchInterval: events === 'live' ? false : 10_000,
  })
  const stop = useMutation({
    mutationFn: (row: JobRow) => api.kill({ jobId: row.id, confirm: true }),
    onSettled: () => {
      setArmed(null)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const rows = board.data?.rows ?? []
  const running = rows.filter(row => row.finishedAt === null).length
  return (
    <div
      className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:p-3"
      data-thread-facet="jobs"
    >
      <PageSection
        heading={t('tabJobs')}
        meta={
          board.data === undefined ? undefined : (
            <>
              <RollingNumber value={running} /> {t('running')} · <RollingNumber value={rows.length - running} /> {t('finished')}
            </>
          )
        }
        actions={
          <Button size="xs" variant="ghost" onClick={props.onOpenProcesses}>
            {t('processesTitle')}
          </Button>
        }
      >
        {board.isPending ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
            <Spinner className="dshx:size-3.5" /> {t('loading')}
          </p>
        ) : null}
        {board.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(board.error, t('loadFailed'))}</AlertDescription>
          </Alert>
        ) : null}
        {stop.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(stop.error, t('stopFailed'))}</AlertDescription>
          </Alert>
        ) : null}
        {board.isSuccess && rows.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">{t('threadNoJobs')}</p> : null}
        {rows.length === 0 ? null : (
          <EntityList>
            {rows.map(row => (
              <JobLine
                key={row.id}
                row={row}
                now={now}
                t={t}
                armed={armed === row.id}
                stopping={stop.isPending && stop.variables?.id === row.id}
                selected={false}
                selectable={false}
                onToggleSelection={() => undefined}
                onRangeSelection={() => undefined}
                sessionLabel={props.sessionLabel}
                onArm={target => setArmed(target.id)}
                onStop={target => stop.mutate(target)}
              />
            ))}
          </EntityList>
        )}
      </PageSection>
      {views.map(view => {
        const Thread = view.Thread
        return Thread === undefined ? null : <Thread key={view.id} sessionId={props.sessionId} />
      })}
    </div>
  )
}
