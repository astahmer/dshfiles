import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import type { TraceSummary } from './types.js'

export const ServiceDot = (props: { readonly service: string; readonly error?: boolean }): JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'dshx:inline-block dshx:h-2 dshx:w-2 dshx:shrink-0 dshx:rounded-full',
      props.error === true ? 'dshx:bg-destructive' : TraceFormat.serviceTone(props.service),
    )}
  />
)

export const TraceList = (props: {
  readonly traces: readonly TraceSummary[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly onLoadMore: () => void
  readonly onOpen: (traceId: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  const longest = Math.max(1, ...props.traces.map(trace => trace.durationMs))
  // An older Host omits costUsd until it restarts.
  const priced = props.traces.some(trace => typeof trace.costUsd === 'number')
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      <Table aria-label={props.t('tabTraces')}>
        <TableHeader>
          <TableRow>
            <TableHead className="dshx:w-28 dshx:@max-pane-narrow:hidden">{props.t('started')}</TableHead>
            <TableHead>{props.t('root')}</TableHead>
            <TableHead className="dshx:w-40 dshx:@max-pane-narrow:w-20">{props.t('duration')}</TableHead>
            {priced ? <TableHead className="dshx:w-20 dshx:text-right">{props.t('cost')}</TableHead> : null}
            <TableHead className="dshx:w-16 dshx:text-right dshx:@max-pane-narrow:hidden">{props.t('spanCount')}</TableHead>
            <TableHead className="dshx:w-16 dshx:text-right">{props.t('errorCount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.traces.map(trace => (
            <TableRow
              key={trace.traceId}
              data-trace-id={trace.traceId}
              className="dshx:cursor-pointer"
              tabIndex={0}
              aria-label={`${trace.rootService} ${trace.rootName}`}
              title={`${new Date(trace.startMs).toLocaleString()} · ${trace.rootService} ${trace.rootName}`}
              onClick={() => props.onOpen(trace.traceId)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  props.onOpen(trace.traceId)
                }
              }}
            >
              <TableCell
                className="dshx:font-mono dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden"
                title={new Date(trace.startMs).toLocaleString()}
              >
                {TraceFormat.clock(trace.startMs)}
              </TableCell>
              <TableCell className="dshx:max-w-0">
                <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  <ServiceDot service={trace.rootService} error={trace.errorCount > 0} />
                  <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{trace.rootService}</span>
                  <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{trace.rootName}</span>
                  {trace.services.length > 1 ? (
                    <Badge variant="outline" className="dshx:shrink-0 dshx:@max-pane-compact:hidden">
                      {trace.services.length} {props.t('service').toLowerCase()}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="dshx:flex dshx:items-center dshx:gap-2">
                  <div className="dshx:h-1.5 dshx:flex-1 dshx:rounded-full dshx:bg-muted dshx:@max-pane-narrow:hidden">
                    <div
                      className={cn('dshx:h-full dshx:rounded-full', trace.errorCount > 0 ? 'dshx:bg-destructive' : TraceFormat.serviceTone(trace.rootService))}
                      style={{ width: `${String(Math.max(2, (trace.durationMs / longest) * 100))}%` }}
                    />
                  </div>
                  <span className="dshx:w-16 dshx:shrink-0 dshx:text-right dshx:font-mono dshx:text-xs">{TraceFormat.duration(trace.durationMs)}</span>
                </div>
              </TableCell>
              {priced ? (
                <TableCell className="dshx:text-right dshx:font-mono dshx:text-xs" data-trace-cost={trace.costUsd ?? undefined}>
                  {TraceFormat.usd(trace.costUsd ?? null)}
                </TableCell>
              ) : null}
              <TableCell className="dshx:text-right dshx:font-mono dshx:text-xs dshx:@max-pane-narrow:hidden">{trace.spanCount}</TableCell>
              <TableCell className="dshx:text-right">
                {trace.errorCount > 0 ? (
                  <Badge variant="destructive">{trace.errorCount}</Badge>
                ) : (
                  <span className="dshx:text-xs dshx:text-muted-foreground">0</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {props.hasMore ? (
        <Button variant="outline" size="sm" className="dshx:self-center" disabled={props.loadingMore} onClick={props.onLoadMore}>
          {props.t('loadMore')}
        </Button>
      ) : null}
    </div>
  )
}
