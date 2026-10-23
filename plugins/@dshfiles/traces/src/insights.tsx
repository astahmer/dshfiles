import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import { ServiceDot } from './trace-list.js'
import type { ErrorGroup, TraceStats } from './types.js'

const numeric = 'dshx:text-right dshx:font-mono dshx:text-xs'

/** One compact card per service: volume, error rate and p95, the strip above every tab. */
export const ServiceStrip = (props: {
  readonly stats: TraceStats
  readonly onPick: (service: string) => void
  readonly t: TracesTranslate
}): JSX.Element | null => {
  if (props.stats.services.length === 0) return null
  return (
    <div className="dshx:flex dshx:gap-2 dshx:overflow-x-auto dshx:pb-1" aria-label={props.t('tabOperations')}>
      {props.stats.services.slice(0, 12).map(service => (
        <button
          key={service.service}
          type="button"
          onClick={() => props.onPick(service.service)}
          className="dshx:flex dshx:min-w-36 dshx:shrink-0 dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:px-3 dshx:py-2 dshx:text-left dshx:hover:bg-accent/40"
        >
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:font-medium">
            <ServiceDot service={service.service} />
            <span className="dshx:min-w-0 dshx:truncate">{service.service}</span>
          </span>
          <span className="dshx:flex dshx:items-baseline dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
            <span>
              <span className="dshx:font-mono dshx:text-sm dshx:text-foreground">{service.count}</span> {props.t('spans')}
            </span>
            <span className={service.errorCount > 0 ? 'dshx:text-destructive' : ''}>{TraceFormat.percent(service.errorRate)}</span>
            <span>p95 {TraceFormat.duration(service.p95Ms)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export const OperationsTable = (props: {
  readonly stats: TraceStats
  readonly onPick: (service: string, operation: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  if (props.stats.operations.length === 0) return <p className="dshx:text-sm dshx:text-muted-foreground">{props.t('noOperations')}</p>
  return (
    <Table aria-label={props.t('tabOperations')}>
      <TableHeader>
        <TableRow>
          <TableHead>{props.t('operation')}</TableHead>
          <TableHead className="dshx:w-16 dshx:text-right">{props.t('count')}</TableHead>
          <TableHead className="dshx:w-20 dshx:text-right">{props.t('errorRate')}</TableHead>
          <TableHead className="dshx:w-20 dshx:text-right">p50</TableHead>
          <TableHead className="dshx:w-20 dshx:text-right dshx:@max-pane-narrow:hidden">p95</TableHead>
          <TableHead className="dshx:w-20 dshx:text-right dshx:@max-pane-compact:hidden">p99</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.stats.operations.map(operation => (
          <TableRow
            key={`${operation.service}\u0000${operation.name}`}
            className="dshx:cursor-pointer"
            tabIndex={0}
            onClick={() => props.onPick(operation.service, operation.name)}
            onKeyDown={event => {
              if (event.key === 'Enter') props.onPick(operation.service, operation.name)
            }}
          >
            <TableCell className="dshx:max-w-0">
              <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                <ServiceDot service={operation.service} />
                <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{operation.service}</span>
                <span className="dshx:min-w-0 dshx:truncate">{operation.name}</span>
              </div>
            </TableCell>
            <TableCell className={numeric}>{operation.count}</TableCell>
            <TableCell className={numeric}>
              {operation.errorCount > 0 ? <span className="dshx:text-destructive">{TraceFormat.percent(operation.errorRate)}</span> : TraceFormat.percent(0)}
            </TableCell>
            <TableCell className={numeric}>{TraceFormat.duration(operation.p50Ms)}</TableCell>
            <TableCell className={`${numeric} dshx:@max-pane-narrow:hidden`}>{TraceFormat.duration(operation.p95Ms)}</TableCell>
            <TableCell className={`${numeric} dshx:@max-pane-compact:hidden`}>{TraceFormat.duration(operation.p99Ms)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export const ErrorGroups = (props: {
  readonly groups: readonly ErrorGroup[]
  readonly onOpenTrace: (traceId: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  if (props.groups.length === 0) return <p className="dshx:text-sm dshx:text-muted-foreground">{props.t('noErrors')}</p>
  return (
    <ul className="dshx:flex dshx:flex-col dshx:gap-2" aria-label={props.t('tabErrors')}>
      {props.groups.map(group => (
        <li
          key={`${group.service}-${group.name}-${group.errorType ?? ''}-${group.sampleSpanId}`}
          className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:p-3"
        >
          <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Badge variant="destructive">{group.count}×</Badge>
            <ServiceDot service={group.service} />
            <span className="dshx:text-xs dshx:text-muted-foreground">{group.service}</span>
            <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{group.name}</span>
            {group.errorType === null ? null : <Badge variant="outline">{group.errorType}</Badge>}
          </div>
          {group.message === null ? null : <p className="dshx:break-words dshx:font-mono dshx:text-xs dshx:text-destructive">{group.message}</p>}
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3 dshx:text-[11px] dshx:text-muted-foreground">
            <span>
              {props.t('firstSeen')} {TraceFormat.clock(group.firstSeenMs)}
            </span>
            <span>
              {props.t('lastSeen')} {TraceFormat.clock(group.lastSeenMs)}
            </span>
            <Button variant="link" size="sm" className="dshx:h-auto dshx:p-0" onClick={() => props.onOpenTrace(group.sampleTraceId)}>
              {props.t('sampleTrace')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
