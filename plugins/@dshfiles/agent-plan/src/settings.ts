import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const agentPlanSettings = defineSettings({
  namespace: 'dshfiles-agent-plan',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Show the agent plan, live activity and failure cards. Off restores every native view.'),
    planCard: Schema.boolean().default(true).description('Draw todo_write calls as a plan card with step N of M; off shows the native todo row.'),
    stepTiming: Schema.boolean().default(true).description('Show how long each plan step took, from the times of successive todo_write calls.'),
    pinnedStep: Schema.boolean().default(true).description('Pin the current plan step beside the composer while the plan has steps left.'),
    activityStrip: Schema.boolean()
      .default(true)
      .description('Show what runs now (tool calls, background jobs, subagents) with live timers beside the composer controls.'),
    failureCard: Schema.boolean().default(true).description('Add retry count, Retry and Ask to fix under turn errors and given-up model retries.'),
  }),
  applies: 'live',
})
