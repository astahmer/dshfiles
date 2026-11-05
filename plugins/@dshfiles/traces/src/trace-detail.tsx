import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CallStackTree } from '@dshfiles/plugin-ui/components/motion/call-stack-tree'
import { TraceWaterfall } from '@dshfiles/plugin-ui/components/motion/trace-waterfall'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { CopyIcon, MessageSquareIcon, ScrollTextIcon } from '@dshfiles/plugin-ui/icons'
import { useMemo, useState } from 'react'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import type { OpenThread } from './open-thread.js'
import { StackFrames } from './stack-frames.js'
import { ThreadLinks } from './thread-links.js'
import { ServiceDot } from './trace-list.js'
import type { AttributeValue, SpanRow, TraceDetail } from './types.js'
import { WaterfallSpans } from './waterfall-spans.js'

const REDACTED_VALUE = /^\[redacted: \d+ chars\]$/

const isRedacted = (value: AttributeValue): boolean => typeof value === 'string' && REDACTED_VALUE.test(value)

export const AttributeTable = (props: {
  readonly label: string
  readonly values: Readonly<Record<string, AttributeValue>>
  readonly t: TracesTranslate
}): JSX.Element => {
  const entries = Object.entries(props.values).sort(([left], [right]) => left.localeCompare(right))
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-1" aria-label={props.label}>
      <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">{props.label}</h4>
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

const STACKTRACE_KEY = 'exception.stacktrace'

/** An exception event's `exception.stacktrace` as call frames, with the raw text one toggle away. */
const StackTraceView = (props: { readonly stacktrace: string; readonly heading: string; readonly t: TracesTranslate }): JSX.Element => {
  const t = props.t
  const frames = useMemo(() => StackFrames.parse(props.stacktrace), [props.stacktrace])
  const [view, setView] = useState<'frames' | 'raw'>('frames')
  const showFrames = view === 'frames' && frames.length > 0
  const files = new Set(frames.map(frame => frame.file)).size
  return (
    <section className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2" aria-label={t('stackTrace')} data-testid="span-stack-trace">
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
        <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">{t('stackTrace')}</h4>
        {frames.length === 0 ? null : (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={t('stackView')}
            value={view}
            onValueChange={value => {
              if (value === 'frames' || value === 'raw') setView(value)
            }}
          >
            <ToggleGroupItem value="frames">{t('stackFrames')}</ToggleGroupItem>
            <ToggleGroupItem value="raw">{t('stackRaw')}</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      {showFrames ? (
        <CallStackTree
          heading={props.heading}
          roots={frames}
          spacedRoots={false}
          listLabel={t('stackFrames')}
          summary={<span>{t('stackSummary', { frames: frames.length, files })}</span>}
          className="dshx:p-3"
        />
      ) : (
        <pre className="dshx:max-h-80 dshx:overflow-auto dshx:rounded dshx:bg-muted/40 dshx:p-2 dshx:font-mono dshx:text-[11px] dshx:leading-4 dshx:whitespace-pre">
          {props.stacktrace}
        </pre>
      )}
    </section>
  )
}

const exceptionHeading = (attributes: Readonly<Record<string, AttributeValue>>, fallback: string): string => {
  const type = attributes['exception.type']
  const message = attributes['exception.message']
  const parts = [type, message].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.length === 0 ? fallback : parts.join(': ')
}

const SpanDetailPanel = (props: {
  readonly traceId: string
  readonly span: SpanRow
  readonly spans: readonly SpanRow[]
  readonly onOpenThread?: OpenThread | undefined
  readonly currentSessionId?: string | undefined
  readonly onShowLogs: (spanId: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  const [threadError, setThreadError] = useState<string | null>(null)
  const span = props.span
  const target = useMemo(() => ThreadLinks.targetOf(props.spans, span.spanId), [props.spans, span.spanId])
  const costUsd = TraceFormat.spanCostUsd(span.attributes)
  return (
    <aside
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-md dshx:border dshx:border-border dshx:p-3 dshx:@min-[42rem]:sticky dshx:@min-[42rem]:top-4 dshx:@min-[42rem]:self-start dshx:@min-[42rem]:max-h-[calc(100dvh-8rem)] dshx:@min-[42rem]:overflow-y-auto"
      aria-label={props.t('spanDetail')}
    >
      <header className="dshx:flex dshx:flex-col dshx:gap-1">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <ServiceDot service={span.service} error={span.status === 'error'} />
          <Tooltip>
            <TooltipTrigger asChild>
              <h3 className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold">{span.name}</h3>
            </TooltipTrigger>
            <TooltipContent>{span.name}</TooltipContent>
          </Tooltip>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-xs">
          <Badge variant="outline">{span.service}</Badge>
          <Badge variant="muted">{span.kind}</Badge>
          <Badge variant={span.status === 'error' ? 'destructive' : span.status === 'ok' ? 'success' : 'muted'}>{span.status}</Badge>
          <span className="dshx:font-mono">{TraceFormat.duration(span.durationMs)}</span>
          <span className="dshx:text-muted-foreground">+{TraceFormat.duration(span.offsetMs)}</span>
          {costUsd === null ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="dshx:inline-flex">
                  <Badge variant="outline" className="dshx:font-mono" data-span-cost={costUsd}>
                    {TraceFormat.usd(costUsd)}
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>{props.t('costHint')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Button variant="outline" size="sm" onClick={() => props.onShowLogs(span.spanId)}>
            <ScrollTextIcon /> {props.t('logsForSpan')}
          </Button>
        </div>
        {span.statusMessage === null ? null : <p className="dshx:break-words dshx:text-xs dshx:text-destructive">{span.statusMessage}</p>}
        {target === null || props.onOpenThread === undefined ? null : (
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="span-open-thread"
              data-focus-turn={target.focus?.turn}
              data-focus-tool-call={target.focus?.toolCallId}
              onClick={() => setThreadError(props.onOpenThread?.(target) ?? null)}
            >
              <MessageSquareIcon /> {target.sessionId === props.currentSessionId ? props.t('showInChat') : props.t('openThread')}
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
          <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">{props.t('events')}</h4>
          {span.events.map((event, index) => {
            const stacktrace = event.attributes[STACKTRACE_KEY]
            const hasStack = typeof stacktrace === 'string' && stacktrace.trim().length > 0
            const attributes = hasStack ? Object.fromEntries(Object.entries(event.attributes).filter(([key]) => key !== STACKTRACE_KEY)) : event.attributes
            return (
              <div key={`${event.name}-${String(index)}`} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:rounded dshx:bg-muted/40 dshx:p-2">
                <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:text-xs">
                  <span className="dshx:font-medium">{event.name}</span>
                  <span className="dshx:font-mono dshx:text-muted-foreground">+{TraceFormat.duration(event.offsetMs)}</span>
                </div>
                {Object.keys(attributes).length === 0 ? null : <AttributeTable label={props.t('attributes')} values={attributes} t={props.t} />}
                {hasStack ? <StackTraceView stacktrace={stacktrace} heading={exceptionHeading(event.attributes, props.t('stackTrace'))} t={props.t} /> : null}
              </div>
            )
          })}
        </section>
      )}
      <AttributeTable label={props.t('resource')} values={span.resource} t={props.t} />
    </aside>
  )
}

export const TraceDetailView = (props: {
  readonly trace: TraceDetail
  /** Opens the span's thread focused on its turn, step or tool call; absent hides the button. */
  readonly onOpenThread?: OpenThread | undefined
  /** The thread whose Traces tab shows this trace: its spans say Show in chat instead of Open in thread. */
  readonly currentSessionId?: string | undefined
  readonly onShowLogs: (spanId: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  const trace = props.trace
  const t = props.t
  const [selectedId, setSelectedId] = useState<string | null>(trace.spans[0]?.spanId ?? null)
  const spans = useMemo(() => WaterfallSpans.fromRows(trace.spans), [trace.spans])
  const selected = trace.spans.find(span => span.spanId === selectedId) ?? trace.spans[0]
  const labels = useMemo(
    () => ({
      heading: t('waterfallHeading'),
      tree: t('waterfall'),
      span: t('waterfallSpanColumn'),
      duration: t('duration'),
      spans: t('statSpans'),
      cost: t('statCost'),
      tokens: t('waterfallTokens'),
      llmCalls: t('statModelCalls'),
      toolCalls: t('statToolCalls'),
      errors: t('statErrors'),
      expand: t('expand'),
      collapse: t('collapse'),
      slowest: t('waterfallSlowest'),
    }),
    [t],
  )
  return (
    <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] dshx:gap-3 dshx:@max-pane-compact:grid-cols-1">
      <TraceWaterfall
        key={trace.traceId}
        className="dshx:self-start"
        subtitle={trace.spans[0]?.name}
        spans={spans}
        live={false}
        minimumDuration={0.001}
        selectedId={selected?.spanId ?? null}
        onSelectSpan={setSelectedId}
        labels={labels}
      />
      {selected === undefined ? null : (
        <SpanDetailPanel
          traceId={trace.traceId}
          span={selected}
          spans={trace.spans}
          onOpenThread={props.onOpenThread}
          currentSessionId={props.currentSessionId}
          onShowLogs={props.onShowLogs}
          t={t}
        />
      )}
    </div>
  )
}
