import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, MessageSquareIcon, ScrollTextIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMemo, useState } from 'react'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import { ServiceDot } from './trace-list.js'
import type { AttributeValue, SpanRow, TraceDetail } from './types.js'

const REDACTED_VALUE = /^\[redacted: \d+ chars\]$/
const INDENT_REM = 0.9

const isRedacted = (value: AttributeValue): boolean => typeof value === 'string' && REDACTED_VALUE.test(value)

export const AttributeTable = (props: {
  readonly label: string
  readonly values: Readonly<Record<string, AttributeValue>>
  readonly t: TracesTranslate
}): JSX.Element => {
  const entries = Object.entries(props.values).sort(([left], [right]) => left.localeCompare(right))
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-1" aria-label={props.label}>
      <h4 className="dshx:text-xs dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">{props.label}</h4>
      {entries.length === 0 ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('noAttributes')}</p>
      ) : (
        <dl className="dshx:grid dshx:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] dshx:gap-x-3 dshx:gap-y-1 dshx:text-xs">
          {entries.map(([key, value]) => (
            <div key={key} className="dshx:contents">
              <dt className="dshx:min-w-0 dshx:break-all dshx:font-mono dshx:text-muted-foreground">{key}</dt>
              <dd className="dshx:min-w-0 dshx:break-all dshx:font-mono" data-attribute={key}>
                {TraceFormat.attribute(value)}
                {isRedacted(value) ? <span className="dshx:block dshx:font-sans dshx:text-[11px] dshx:text-warning">{props.t('redactedNote')}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

const SpanDetailPanel = (props: {
  readonly traceId: string
  readonly span: SpanRow
  readonly onOpenThread: (sessionId: string) => string | null
  readonly onShowLogs: (spanId: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  const [threadError, setThreadError] = useState<string | null>(null)
  const span = props.span
  return (
    <aside
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-md dshx:border dshx:border-border dshx:p-3"
      aria-label={props.t('spanDetail')}
    >
      <header className="dshx:flex dshx:flex-col dshx:gap-1">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <ServiceDot service={span.service} error={span.status === 'error'} />
          <h3 className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold" title={span.name}>
            {span.name}
          </h3>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-xs">
          <Badge variant="outline">{span.service}</Badge>
          <Badge variant="muted">{span.kind}</Badge>
          <Badge variant={span.status === 'error' ? 'destructive' : span.status === 'ok' ? 'success' : 'muted'}>{span.status}</Badge>
          <span className="dshx:font-mono">{TraceFormat.duration(span.durationMs)}</span>
          <span className="dshx:text-muted-foreground">+{TraceFormat.duration(span.offsetMs)}</span>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Button variant="outline" size="sm" onClick={() => props.onShowLogs(span.spanId)}>
            <ScrollTextIcon /> {props.t('logsForSpan')}
          </Button>
        </div>
        {span.statusMessage === null ? null : <p className="dshx:break-words dshx:text-xs dshx:text-destructive">{span.statusMessage}</p>}
        {span.sessionId === null ? null : (
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (span.sessionId !== null) setThreadError(props.onOpenThread(span.sessionId))
              }}
            >
              <MessageSquareIcon /> {props.t('openThread')}
            </Button>
            {threadError === null ? null : <span className="dshx:text-xs dshx:text-destructive">{threadError}</span>}
          </div>
        )}
      </header>
      <dl className="dshx:grid dshx:grid-cols-[auto_minmax(0,1fr)] dshx:gap-x-3 dshx:gap-y-1 dshx:text-xs">
        <dt className="dshx:text-muted-foreground">{props.t('traceId')}</dt>
        <dd className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:font-mono">
          <span className="dshx:min-w-0 dshx:truncate">{props.traceId}</span>
          <Button variant="ghost" size="icon" className="dshx:size-5" aria-label={props.t('copy')} onClick={() => void writeClipboard(props.traceId)}>
            <CopyIcon />
          </Button>
        </dd>
        <dt className="dshx:text-muted-foreground">{props.t('spanId')}</dt>
        <dd className="dshx:font-mono">{span.spanId}</dd>
        {span.parentSpanId === null ? null : (
          <>
            <dt className="dshx:text-muted-foreground">{props.t('parentSpanId')}</dt>
            <dd className="dshx:font-mono">{span.parentSpanId}</dd>
          </>
        )}
        {span.scope === null ? null : (
          <>
            <dt className="dshx:text-muted-foreground">{props.t('scope')}</dt>
            <dd className="dshx:break-all dshx:font-mono">{span.scope}</dd>
          </>
        )}
        {span.linkCount === 0 ? null : (
          <>
            <dt className="dshx:text-muted-foreground">{props.t('links')}</dt>
            <dd>{span.linkCount}</dd>
          </>
        )}
      </dl>
      <AttributeTable label={props.t('attributes')} values={span.attributes} t={props.t} />
      {span.events.length === 0 ? null : (
        <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label={props.t('events')}>
          <h4 className="dshx:text-xs dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">{props.t('events')}</h4>
          {span.events.map((event, index) => (
            <div key={`${event.name}-${String(index)}`} className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded dshx:bg-muted/40 dshx:p-2">
              <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:text-xs">
                <span className="dshx:font-medium">{event.name}</span>
                <span className="dshx:font-mono dshx:text-muted-foreground">+{TraceFormat.duration(event.offsetMs)}</span>
              </div>
              {Object.keys(event.attributes).length === 0 ? null : <AttributeTable label={props.t('attributes')} values={event.attributes} t={props.t} />}
            </div>
          ))}
        </section>
      )}
      <AttributeTable label={props.t('resource')} values={span.resource} t={props.t} />
    </aside>
  )
}

export const TraceDetailView = (props: {
  readonly trace: TraceDetail
  readonly onOpenThread: (sessionId: string) => string | null
  readonly onShowLogs: (spanId: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  const trace = props.trace
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(trace.spans[0]?.spanId ?? null)
  const rows = useMemo(() => TraceFormat.visibleRows(trace.spans, collapsed), [trace.spans, collapsed])
  const selected = trace.spans.find(span => span.spanId === selectedId) ?? trace.spans[0]
  const total = Math.max(trace.durationMs, 0.001)
  const toggle = (spanId: string): void =>
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(spanId)) next.delete(spanId)
      else next.add(spanId)
      return next
    })
  return (
    <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] dshx:gap-3 dshx:@max-pane-compact:grid-cols-1">
      <section className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1" aria-label={props.t('waterfall')}>
        <div className="dshx:grid dshx:grid-cols-[minmax(10rem,38%)_minmax(0,1fr)] dshx:gap-2 dshx:border-b dshx:border-border dshx:pb-1 dshx:text-[11px] dshx:text-muted-foreground">
          <span>
            {trace.spans.length} {props.t('spans')} · {TraceFormat.duration(trace.durationMs)}
          </span>
          <div className="dshx:relative dshx:h-4">
            {TraceFormat.axisTicks(trace.durationMs).map(tick => (
              <span
                key={tick.fraction}
                className={cn(
                  'dshx:absolute dshx:top-0 dshx:whitespace-nowrap dshx:font-mono',
                  tick.fraction === 1 ? 'dshx:-translate-x-full' : tick.fraction > 0 ? 'dshx:-translate-x-1/2' : '',
                  tick.fraction > 0 && tick.fraction < 1 ? 'dshx:@max-pane-narrow:hidden' : '',
                )}
                style={{ left: `${String(tick.fraction * 100)}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
        <ol className="dshx:flex dshx:flex-col" role="tree" aria-label={props.t('waterfall')}>
          {rows.map(span => {
            const isCollapsed = collapsed.has(span.spanId)
            const left = (span.offsetMs / total) * 100
            const width = Math.max(0.4, (span.durationMs / total) * 100)
            return (
              <li
                key={span.spanId}
                role="treeitem"
                aria-level={span.depth + 1}
                aria-selected={selected?.spanId === span.spanId}
                aria-expanded={span.childCount > 0 ? !isCollapsed : undefined}
                data-span-id={span.spanId}
                data-status={span.status}
                className={cn(
                  'dshx:grid dshx:cursor-pointer dshx:grid-cols-[minmax(10rem,38%)_minmax(0,1fr)] dshx:items-center dshx:gap-2 dshx:rounded dshx:px-1 dshx:py-0.5',
                  selected?.spanId === span.spanId ? 'dshx:bg-accent' : 'dshx:hover:bg-accent/40',
                )}
                onClick={() => setSelectedId(span.spanId)}
              >
                <div
                  className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-xs"
                  style={{ paddingLeft: `${String(span.depth * INDENT_REM)}rem` }}
                >
                  {span.childCount > 0 ? (
                    <button
                      type="button"
                      className="dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:hover:bg-muted"
                      aria-label={`${isCollapsed ? props.t('expand') : props.t('collapse')} ${span.name}`}
                      onClick={event => {
                        event.stopPropagation()
                        toggle(span.spanId)
                      }}
                    >
                      {isCollapsed ? <ChevronRightIcon className="dshx:size-3" /> : <ChevronDownIcon className="dshx:size-3" />}
                    </button>
                  ) : (
                    <span className="dshx:size-4 dshx:shrink-0" aria-hidden />
                  )}
                  <ServiceDot service={span.service} error={span.status === 'error'} />
                  <span className="dshx:min-w-0 dshx:truncate" title={`${span.service} · ${span.name}`}>
                    <span className={cn(span.status === 'error' ? 'dshx:text-destructive' : '')}>{span.name}</span>
                    <span className="dshx:ml-1 dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{span.service}</span>
                  </span>
                </div>
                <div className="dshx:relative dshx:h-4 dshx:rounded-sm dshx:bg-muted/30">
                  <div
                    data-testid="span-bar"
                    className={cn(
                      'dshx:absolute dshx:top-0.5 dshx:h-3 dshx:min-w-[2px] dshx:rounded-sm',
                      span.status === 'error' ? 'dshx:bg-destructive' : TraceFormat.serviceTone(span.service),
                    )}
                    style={{ left: `${String(Math.min(left, 99.6))}%`, width: `${String(Math.min(width, 100 - Math.min(left, 99.6)))}%` }}
                  />
                  <span
                    className="dshx:absolute dshx:top-0 dshx:whitespace-nowrap dshx:font-mono dshx:text-[10px] dshx:leading-4 dshx:text-muted-foreground"
                    style={left + width > 80 ? { right: `${String(100 - left + 0.5)}%` } : { left: `${String(left + width + 0.5)}%` }}
                  >
                    {TraceFormat.duration(span.durationMs)}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      </section>
      {selected === undefined ? null : (
        <SpanDetailPanel traceId={trace.traceId} span={selected} onOpenThread={props.onOpenThread} onShowLogs={props.onShowLogs} t={props.t} />
      )}
    </div>
  )
}
