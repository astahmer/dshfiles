import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentRunStatus, type AgentRunStatusLabels } from '@dshfiles/plugin-ui/components/motion/agent-run-status'
import { useSyncExternalStore } from 'react'
import { SubagentFeedModel, type SubagentFeed } from './subagent-feed.js'
import { useChildFeed, type SubagentPreviewBindings, type SubagentPreviewTranslate } from './subagent-live-preview.js'
import { SubagentRouteLabelModel } from './route-label.js'

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

/** One working subagent as the compact run card: current tool, route, elapsed time and the verbs the dock really has. */
export const SubagentRunCard = (props: {
  readonly run: SubagentRun
  readonly heading: string
  readonly stepLabel: string
  readonly openLabel: string
  readonly labels: Partial<AgentRunStatusLabels>
  readonly onStop: () => void
  readonly onOpen: () => void
}): JSX.Element => (
  <AgentRunStatus
    className="dshx:my-1 dshx:shadow-none"
    heading={props.heading}
    {...(props.run.model === undefined ? {} : { model: props.run.model })}
    steps={[{ id: props.run.tool, label: props.stepLabel, startedAt: props.run.startedAt }]}
    stepIndex={props.run.toolCalls}
    startedAt={props.run.startedAt}
    state="running"
    labels={props.labels}
    onStop={props.onStop}
    onOpen={props.onOpen}
    openLabel={props.openLabel}
  />
)

/** The step line names the tool in flight; the dock owns the locale. */
export const subagentRunStepLabel = (input: { readonly t: SubagentPreviewTranslate; readonly tool: string }): string =>
  input.t('subagentRunStepTool', { tool: input.tool })
