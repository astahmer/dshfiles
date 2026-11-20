import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { ArrowUpRightIcon, SquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useSyncExternalStore } from 'react'
import { SubagentFeedModel, type SubagentFeed } from './subagent-feed.js'
import { useChildFeed, type SubagentPreviewBindings } from './subagent-live-preview.js'
import { SubagentRouteLabelModel } from './route-label.js'
import { LiveElapsed } from '../live-activity.js'
import { ToolSteps } from '../tool-steps.js'

type DockSessions = PropsRuntime<'conversation.input.dock'>['useSessions']

/** What a working child exposes as a run: its open turn's start, its route and the tool it is in now. */
export interface SubagentRun {
  readonly binding: SessionBinding
  readonly model: string | undefined
  readonly tool: string
  readonly toolCalls: number
  readonly startedAt: number
}

const noopSubscribe =
  (_listener: () => void): (() => void) =>
  () =>
    undefined
const emptyFeed = (): SubagentFeed => SubagentFeedModel.empty

/**
 * The child's own projections say when its open turn started and which route it runs; its event window says which
 * tool is in flight. Undefined until every part is known, so the caller can keep its plain row.
 */
export const useSubagentRun = (input: {
  readonly childId: string
  readonly enabled: boolean
  readonly retainChild: SubagentPreviewBindings['retainChild']
  readonly useSessions: DockSessions
}): SubagentRun | undefined => {
  const feed = useChildFeed({ childId: input.childId, retainChild: input.retainChild, enabled: input.enabled })
  const store = feed.kind === 'ready' ? feed.store : undefined
  const snapshot = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptyFeed)
  const model = input.useSessions(list => {
    const summary = list.byId[SessionId(input.childId)]
    return SubagentRouteLabelModel.displayedAgentRouteLabel(summary?.projectionValues?.threadSidebarModelRoute, summary?.projectionValues?.subagent)
  })
  const startedAt = input.useSessions(list => list.byId[SessionId(input.childId)]?.projectionValues?.subagentTiming?.active?.since)
  if (!input.enabled || feed.kind !== 'ready' || snapshot.tool === undefined || startedAt === undefined) return undefined
  return { binding: feed.binding, model, tool: snapshot.tool, toolCalls: snapshot.toolCalls, startedAt }
}

/**
 * One working subagent as a compact card: the shared status glyph, its name, what it is doing in words, the model's
 * name and one clock, with the verbs the dock really has. A child held by a question is not working: it shows the
 * Needs-you glyph and "Waiting for an answer".
 */
export const SubagentRunCard = (props: {
  readonly run: SubagentRun
  readonly heading: string
  readonly labels: { readonly working: string; readonly waiting: string; readonly stop: string; readonly open: string }
  readonly onStop: () => void
  readonly onOpen: () => void
}): JSX.Element => {
  const step = ToolSteps.ofName(props.run.tool)
  const model = SubagentRouteLabelModel.modelName(props.run.model)
  const stateLabel = step.waitsForAnswer ? props.labels.waiting : props.labels.working
  return (
    <div
      className="dshx:my-1 dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:p-2.5"
      data-subagent-run-card=""
      data-waiting={step.waitsForAnswer ? '' : undefined}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <StatusGlyph label={stateLabel} status={step.waitsForAnswer ? 'needs-you' : 'working'} />
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">{props.heading}</span>
        <LiveElapsed active className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground" startedAt={props.run.startedAt} />
      </div>
      <p className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground" role="status">
        <span className={cn('dshx:min-w-0 dshx:truncate', step.waitsForAnswer && 'dshx:text-foreground')} data-subagent-run-step="">
          {step.waitsForAnswer ? props.labels.waiting : step.words}
        </span>
        {model === undefined ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span className="dshx:shrink-0" data-subagent-run-model="">
              {model}
            </span>
          </>
        )}
      </p>
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <Button size="sm" variant="outline" className="dshx:shrink" onClick={props.onStop}>
          <SquareIcon aria-hidden="true" />
          <span className="dshx:@max-pane-narrow:sr-only">{props.labels.stop}</span>
        </Button>
        <Button size="sm" variant="ghost" className="dshx:ml-auto dshx:shrink dshx:text-muted-foreground" onClick={props.onOpen}>
          {props.labels.open}
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
