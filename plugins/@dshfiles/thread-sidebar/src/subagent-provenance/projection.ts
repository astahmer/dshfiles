import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { SubagentRouteLabelModel } from './route-label.js'
import type { ThreadSidebarModelRoute } from './projection-types.js'

const routeLabelSchema = z.string().max(193).nullable()

const assistantRouteEventSchema = z.object({
  type: z.literal('assistant/message'),
  data: z.object({
    message: z.object({
      source: z.object({
        provider: z.string(),
        model: z.string(),
      }),
    }),
  }),
})

export const routeLabelFromAssistantEvent = (event: { readonly type: string; readonly data: object }): ThreadSidebarModelRoute | undefined => {
  const parsed = assistantRouteEventSchema.safeParse(event)
  if (!parsed.success) return undefined
  return SubagentRouteLabelModel.providerModelLabel(parsed.data.data.message.source.provider, parsed.data.data.message.source.model) ?? null
}

export const threadSidebarModelRouteProjection = {
  key: 'threadSidebarModelRoute',
  stateSchema: routeLabelSchema,
  init: () => null,
  apply: (state, event) => {
    if (event.type === 'session/end-seed' && event.data.inherited === true) return null
    if (event.type !== 'assistant/message') return state
    const routeLabel = routeLabelFromAssistantEvent(event)
    return routeLabel === undefined ? state : routeLabel
  },
  wire: { viewSchema: routeLabelSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'threadSidebarModelRoute', ThreadSidebarModelRoute>
