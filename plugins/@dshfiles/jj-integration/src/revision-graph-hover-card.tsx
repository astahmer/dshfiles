import { HoverCard, HoverCardContent, HoverCardTrigger } from '@dshfiles/plugin-ui/components/ui/hover-card'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useState, type ReactElement } from 'react'
import { jjIntegrationApi } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

export const revisionGraphQueryKey = (path: string) => ['jj-integration', 'revision-graph', path] as const

export const RevisionGraphHoverCard = (props: {
  readonly path: string
  readonly bookmark: string
  readonly t: JjIntegrationTranslate
  readonly disabled: boolean
  readonly trigger: ReactElement
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const api = useApi(jjIntegrationApi)
  const graph = useQuery({
    queryKey: revisionGraphQueryKey(props.path),
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 30_000,
        request: hostSignal => api.revisionGraph({ path: props.path }, { signal: hostSignal }),
      }),
    enabled: open && !props.disabled,
    retry: false,
    staleTime: 2_000,
  })

  return (
    <HoverCard open={open && !props.disabled} onOpenChange={nextOpen => setOpen(nextOpen && !props.disabled)} closeDelay={120} openDelay={180}>
      <HoverCardTrigger asChild>{props.trigger}</HoverCardTrigger>
      <HoverCardContent align="start" className="dshx-root dshx:w-[32rem] dshx:max-w-[calc(100vw-1rem)] dshx:p-3" side="bottom" sideOffset={8}>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <h2 className="dshx:text-sm dshx:font-medium">{props.t('revisionGraph')}</h2>
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('revisionGraphLegend', { bookmark: props.bookmark })}</p>
            <p className="dshx:break-all dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{props.path}</p>
          </div>
          {graph.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('revisionGraphLoading')}</p> : null}
          {graph.isError ? (
            <p className="dshx:text-xs dshx:text-destructive" role="alert">
              {props.t('revisionGraphFailed')}
            </p>
          ) : null}
          {graph.data === undefined ? null : graph.data.graph.length === 0 ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('revisionGraphEmpty')}</p>
          ) : (
            <pre aria-label={props.t('revisionGraph')} className="dshx:max-h-72 dshx:overflow-auto dshx:font-mono dshx:text-xs dshx:leading-4">
              {graph.data.graph}
            </pre>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
