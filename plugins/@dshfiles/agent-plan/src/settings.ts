import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const agentPlanSettings = defineSettings({
  namespace: 'dshfiles-agent-plan',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Show the agent plan, live activity and failure cards. Off restores every native view.'),
    planCard: Schema.boolean().default(true).description('Draw todo_write calls as a plan card with step N of M; off shows the native todo row.'),
    stepTiming: Schema.boolean().default(true).description('Show how long each plan step took, from the times of successive todo_write calls.'),
    pinnedStep: Schema.boolean().default(true).description('Pin the current plan step beside the composer while the plan has steps left.'),
    todoStrip: Schema.boolean()
      .default(false)
      .description('Also show the To-dos strip above the composer. Off by default: the pinned step already shows the plan and opens every step.'),
    activityStrip: Schema.boolean()
      .default(true)
      .description('Show what runs now (tool calls, background jobs, subagents) with live timers beside the composer controls.'),
    failureCard: Schema.boolean()
      .default(true)
      .description('Add "Ask to fix" beside Retry on a failed turn. It writes a request in the composer for you to review and send.'),
    compactionMeter: Schema.boolean()
      .default(true)
      .description('Show how many tokens are left before automatic compaction in the context meter panel. Needs the context compaction plugin.'),
  }),
  applies: 'live',
})

/** The switches that decide whether the native To-dos strip above the composer shows; values still loading read as defaults. */
export interface PlanSurfaceSettings {
  readonly enabled?: boolean | undefined
  readonly pinnedStep?: boolean | undefined
  readonly todoStrip?: boolean | undefined
}

/**
 * Whether the native To-dos strip shows. It repeats the pinned step chip a few pixels below it (and the plan card in
 * the transcript), so it gives way while the chip is on; it stays when the chip is off, and `todoStrip` brings it back.
 */
export const showsTodoStrip = (settings: PlanSurfaceSettings | undefined): boolean =>
  settings?.todoStrip === true || settings?.enabled === false || settings?.pinnedStep === false
