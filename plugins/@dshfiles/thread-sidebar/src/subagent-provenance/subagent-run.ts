import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { useSyncExternalStore } from 'react'
import { SubagentFeedModel, type SubagentFeed } from './subagent-feed.js'
import { useChildFeed, type SubagentPreviewBindings } from './subagent-live-preview.js'
import { SubagentRouteLabelModel, type SubagentModelRoute } from './route-label.js'

/** What the dock row adds to a working child: the tool it is in now and the model it runs on. */
export interface SubagentRun {
  /** The tool in flight; undefined between tools or until the child's event window loads. */
  readonly tool: string | undefined
  /** The provider and model it runs on; undefined while no route names a model. */
  readonly route: SubagentModelRoute | undefined
}

const noopSubscribe =
  (_listener: () => void): (() => void) =>
  () =>
    undefined
const emptyFeed = (): SubagentFeed => SubagentFeedModel.empty

/**
 * The child's event window says which tool is in flight; its route projection says which model runs it. With
 * `enabled` off (the `subagentRunCards` setting) the child is never held and the row shows no step.
 */
export const useSubagentRun = (input: {
  readonly childId: string
  readonly enabled: boolean
  readonly retainChild: SubagentPreviewBindings['retainChild']
  readonly useSessions: UseSessions
}): SubagentRun => {
  const feed = useChildFeed({ childId: input.childId, retainChild: input.retainChild, enabled: input.enabled })
  const store = feed.kind === 'ready' ? feed.store : undefined
  const snapshot = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptyFeed)
  // The selector returns the label (a string), so unrelated list updates do not re-render the row.
  const label = input.useSessions(list => {
    const summary = list.byId[SessionId(input.childId)]
    return SubagentRouteLabelModel.displayedAgentRouteLabel(summary?.projectionValues?.threadSidebarModelRoute, summary?.projectionValues?.subagent)
  })
  return { tool: input.enabled ? snapshot.tool : undefined, route: SubagentRouteLabelModel.routeOf(label) }
}
