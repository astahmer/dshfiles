import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, WaypointsIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useInfiniteQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { z } from 'zod'
import type { LogsInput } from './api.js'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import { tracesQueries, type TracesClient } from './queries.js'
import { AttributeTable } from './trace-detail.js'
import { ServiceDot } from './trace-list.js'
import type { LogRecord } from './types.js'

const ALL = '__all__'

const SEVERITY_FLOORS = [
  { value: 0, key: 'severityAll' },
  { value: 5, key: 'severityDebug' },
  { value: 9, key: 'severityInfo' },
  { value: 13, key: 'severityWarn' },
  { value: 17, key: 'severityError' },
] as const

export const logsViewSchema = z
  .object({
    search: z.string().max(200).catch(''),
    service: z.string().max(256).nullable().catch(null),
    minSeverity: z.number().int().min(0).max(24).catch(0),
    attribute: z.string().max(640).catch(''),
  })
  .strip()

export const storedLogsView = createStoredValue({
  key: 'dshfiles.traces.logs-view.v1',
  schema: logsViewSchema,
  fallback: { search: '', service: null, minSeverity: 0, attribute: '' },
})

/** `key=value` from the attribute box; anything else filters nothing. */
const parseAttributeFilter = (text: string): { readonly key: string; readonly value: string } | null => {
  const separator = text.indexOf('=')
  if (separator <= 0) return null
  const key = text.slice(0, separator).trim()
  return /^[\w.:/-]{1,128}$/.test(key) ? { key, value: text.slice(separator + 1).trim() } : null
}

const severityLabel = (log: LogRecord): string => {
  if (log.severityText !== null) return log.severityText
  if (log.severityNumber >= 21) return 'FATAL'
  if (log.severityNumber >= 17) return 'ERROR'
  if (log.severityNumber >= 13) return 'WARN'
  if (log.severityNumber >= 9) return 'INFO'
  if (log.severityNumber >= 5) return 'DEBUG'
  return log.severityNumber === 0 ? 'UNSET' : 'TRACE'
}

const severityVariant = (severityNumber: number): 'destructive' | 'warning' | 'info' | 'muted' => {
  if (severityNumber >= 17) return 'destructive'
  if (severityNumber >= 13) return 'warning'
  if (severityNumber >= 9) return 'info'
  return 'muted'
}

export type LogCorrelation = { readonly traceId: string; readonly spanId: string | null }

export const LogRow = (props: { readonly log: LogRecord; readonly onOpenTrace: (traceId: string) => void; readonly t: TracesTranslate }): JSX.Element => {
  const [open, setOpen] = useState(false)
  const log = props.log
  return (
    <li className="dshx:flex dshx:flex-col dshx:border-b dshx:border-border" data-log-id={log.id} data-severity={log.severityNumber}>
      <button
        type="button"
        aria-expanded={open}
        className="dshx:flex dshx:w-full dshx:min-w-0 dshx:items-start dshx:gap-2 dshx:px-1 dshx:py-1.5 dshx:text-left dshx:text-xs dshx:hover:bg-accent/30"
        onClick={() => setOpen(current => !current)}
      >
        {open ? <ChevronDownIcon className="dshx:mt-0.5 dshx:size-3 dshx:shrink-0" /> : <ChevronRightIcon className="dshx:mt-0.5 dshx:size-3 dshx:shrink-0" />}
        <span className="dshx:w-20 dshx:shrink-0 dshx:font-mono dshx:text-muted-foreground" title={new Date(log.timeMs).toLocaleString()}>
          {TraceFormat.clock(log.timeMs)}
        </span>
        <Badge variant={severityVariant(log.severityNumber)} className="dshx:w-14 dshx:shrink-0 dshx:justify-center">
          {severityLabel(log)}
        </Badge>
        <span className="dshx:flex dshx:w-32 dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:@max-pane-narrow:hidden">
          <ServiceDot service={log.service} />
          <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">{log.service}</span>
        </span>
        <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:font-mono', open ? 'dshx:break-words dshx:whitespace-pre-wrap' : 'dshx:truncate')}>
          {log.eventName === null ? null : <span className="dshx:mr-1.5 dshx:text-muted-foreground">{log.eventName}</span>}
          {log.body}
        </span>
      </button>
      {open ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:px-6 dshx:pb-3">
          {log.traceId === null ? null : (
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs">
              <Button variant="outline" size="sm" onClick={() => props.onOpenTrace(log.traceId ?? '')}>
                <WaypointsIcon /> {props.t('openTrace')}
              </Button>
              <span className="dshx:font-mono dshx:text-muted-foreground">
                {log.traceId}
                {log.spanId === null ? '' : ` / ${log.spanId}`}
              </span>
            </div>
          )}
          <AttributeTable label={props.t('attributes')} values={log.attributes} t={props.t} />
          <AttributeTable label={props.t('resource')} values={log.resource} t={props.t} />
        </div>
      ) : null}
    </li>
  )
}

export const LogsView = (props: {
  readonly client: TracesClient
  readonly services: readonly string[]
  readonly correlation: LogCorrelation | null
  readonly onClearCorrelation: () => void
  readonly onOpenTrace: (traceId: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  const t = props.t
  const view = storedLogsView.useValue()
  const update = (patch: Partial<z.infer<typeof logsViewSchema>>): void => {
    storedLogsView.set({ ...view, ...patch })
  }
  const search = useDebouncedValue({ value: view.search.trim(), delayMs: 250 })
  const attribute = parseAttributeFilter(useDebouncedValue({ value: view.attribute, delayMs: 250 }))
  // dshx API payloads refuse undefined values, so absent filters are omitted rather than sent as undefined.
  const filters: Omit<LogsInput, 'cursor'> = { limit: 100 }
  if (search.length > 0) filters.search = search
  if (view.service !== null) filters.service = view.service
  if (view.minSeverity !== 0) filters.minSeverity = view.minSeverity
  if (attribute !== null) filters.attribute = attribute
  if (props.correlation !== null) {
    filters.traceId = props.correlation.traceId
    if (props.correlation.spanId !== null) filters.spanId = props.correlation.spanId
  }
  const logsQuery = useInfiniteQuery({ ...tracesQueries.logs(props.client, filters), placeholderData: keepPreviousData })
  const logs = logsQuery.data?.pages.flatMap(page => page.logs) ?? []
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <InputGroup className="dshx:w-72 dshx:max-w-full dshx:@max-pane-narrow:w-full">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('searchLogs')}
            placeholder={t('searchLogsPlaceholder')}
            value={view.search}
            onChange={event => update({ search: event.target.value })}
          />
        </InputGroup>
        <Select value={view.service ?? ALL} onValueChange={value => update({ service: value === ALL ? null : value })}>
          <SelectTrigger size="sm" aria-label={t('logService')} className="dshx:w-44 dshx:@max-pane-narrow:w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allServices')}</SelectItem>
            {[...new Set([...(view.service === null ? [] : [view.service]), ...props.services])].map(service => (
              <SelectItem key={service} value={service}>
                {service}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(view.minSeverity)} onValueChange={value => update({ minSeverity: Number(value) })}>
          <SelectTrigger size="sm" aria-label={t('severity')} className="dshx:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITY_FLOORS.map(floor => (
              <SelectItem key={floor.value} value={String(floor.value)}>
                {t(floor.key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label={t('attributeFilter')}
          placeholder={t('attributeFilterPlaceholder')}
          className="dshx:h-8 dshx:w-48 dshx:font-mono! dshx:@max-pane-narrow:w-full"
          value={view.attribute}
          onChange={event => update({ attribute: event.target.value })}
        />
        {props.correlation === null ? null : (
          <Button variant="secondary" size="sm" onClick={props.onClearCorrelation} aria-label={t('clearCorrelation')}>
            {props.correlation.spanId === null ? t('logsOfTrace') : t('logsOfSpan')}: {(props.correlation.spanId ?? props.correlation.traceId).slice(0, 12)}… ✕
          </Button>
        )}
      </div>
      {logsQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(logsQuery.error, t('loadFailed'))}</AlertDescription>
        </Alert>
      ) : null}
      {logs.length === 0 && logsQuery.isSuccess ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">{t('noLogs')}</p>
      ) : (
        <ul className="dshx:flex dshx:flex-col" aria-label={t('tabLogs')}>
          {logs.map(log => (
            <LogRow key={log.id} log={log} onOpenTrace={props.onOpenTrace} t={t} />
          ))}
        </ul>
      )}
      {logsQuery.hasNextPage ? (
        <Button variant="outline" size="sm" className="dshx:self-center" disabled={logsQuery.isFetchingNextPage} onClick={() => void logsQuery.fetchNextPage()}>
          {t('loadMoreLogs')}
        </Button>
      ) : null}
    </div>
  )
}
