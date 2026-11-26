import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { SubagentRouteLabelModel } from './route-label.js'
import type { ThreadSidebarModelRoute } from './projection-types.js'
import { SchemaHelpers } from '../schema-helpers.js'

const routeLabelSchema = Schema.NullOr(Schema.String.check(Schema.isMaxLength(193)))

const assistantRouteEventSchema = Schema.Struct({
  type: Schema.Literal('assistant/message'),
  data: Schema.Struct({
    message: Schema.Struct({
      source: Schema.Struct({
        provider: Schema.String,
        model: Schema.String,
      }),
    }),
  }),
})

export const routeLabelFromAssistantEvent = (event: { readonly type: string; readonly data: object }): ThreadSidebarModelRoute | undefined => {
  const parsed = SchemaHelpers.decodeUnknownSafe(assistantRouteEventSchema, event)
  if (!parsed.success) return undefined
  return SubagentRouteLabelModel.providerModelLabel(parsed.data.data.message.source.provider, parsed.data.data.message.source.model) ?? null
}

/** Only the two route fields of a child's `subagent/descriptor` (its persona, tools and backend stay out). */
const descriptorRouteEventSchema = Schema.Struct({
  type: Schema.Literal('subagent/descriptor'),
  data: Schema.Struct({ agentProvider: Schema.String, agentModel: Schema.String }),
})

/**
 * The route a child was started on, from its descriptor: DSH resolves the parent's provider and model into it when the
 * call names none. DSH's own `subagent` projection keeps only mode and label, so without this a held child that has not
 * answered yet names no model (council round 17 B1.1).
 */
export const routeLabelFromDescriptorEvent = (event: { readonly type: string; readonly data: object }): string | undefined => {
  const parsed = SchemaHelpers.decodeUnknownSafe(descriptorRouteEventSchema, event)
  return parsed.success ? SubagentRouteLabelModel.providerModelLabel(parsed.data.data.agentProvider, parsed.data.data.agentModel) : undefined
}

export const threadSidebarModelRouteProjection = {
  key: 'threadSidebarModelRoute',
  stateSchema: zodSchemaFromEffect(routeLabelSchema),
  init: () => null,
  apply: (state, event) => {
    if (event.type === 'session/end-seed' && event.data.inherited === true) return null
    // The descriptor comes right after the inherited seed; it never rewrites a route the child really used.
    if (event.type === 'subagent/descriptor') return state ?? routeLabelFromDescriptorEvent(event) ?? null
    if (event.type !== 'assistant/message') return state
    const routeLabel = routeLabelFromAssistantEvent(event)
    return routeLabel === undefined ? state : routeLabel
  },
  wire: { viewSchema: zodSchemaFromEffect(routeLabelSchema), view: state => state },
  // 2: the fold reads the child's descriptor too, so older checkpoints refold.
  stateVersion: 2,
} satisfies ProjectionDefinition<'threadSidebarModelRoute', ThreadSidebarModelRoute>
