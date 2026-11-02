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

export const threadSidebarModelRouteProjection = {
  key: 'threadSidebarModelRoute',
  stateSchema: zodSchemaFromEffect(routeLabelSchema),
  init: () => null,
  apply: (state, event) => {
    if (event.type === 'session/end-seed' && event.data.inherited === true) return null
    if (event.type !== 'assistant/message') return state
    const routeLabel = routeLabelFromAssistantEvent(event)
    return routeLabel === undefined ? state : routeLabel
  },
  wire: { viewSchema: zodSchemaFromEffect(routeLabelSchema), view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'threadSidebarModelRoute', ThreadSidebarModelRoute>
