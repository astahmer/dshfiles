import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { definePlugin } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { ToolSearchModel } from './search.js'
import { serializedSchemaBytes } from './schema-measurement.js'

const configSchema = z
  .object({
    alwaysVisible: z.array(z.string()).default([]),
    maxResults: z.number().int().positive().max(100).default(5),
    maxQueryChars: z.number().int().positive().max(4096).default(512),
    reportSchemaMetrics: z.boolean().default(false),
  })
  .default({ alwaysVisible: [], maxResults: 5, maxQueryChars: 512, reportSchemaMetrics: false })

type ToolSearchStatus = 'loaded' | 'already_loaded' | 'unavailable'

interface AgentState {
  readonly agent: Agent
  readonly eligibleNames: Set<string>
  readonly selectedNames: Set<string>
  readonly admitFutureGlobalTools: boolean
  allowedNames: string[]
  liftRestriction: (() => void) | undefined
  removeSearchTool: (() => void) | undefined
}

const TOOL_SEARCH_NAME = 'tool_search'

export default definePlugin({
  id: 'tool-search',
  name: '@dshfiles/tool-search',
  Config: configSchema,
  inject: ['agents', 'tools'],
  setup: api => {
    const ctx: Context = api.raw.ctx
    const config = configSchema.parse(api.config)
    const alwaysVisible = ToolSearchModel.compileAlwaysVisible(config.alwaysVisible)
    const states = new Map<Agent, AgentState>()
    let ownRegistryChanges = 0
    let lastSchemaReport: string | undefined

    const globals = (): Map<string, ToolSchema> => new Map(ctx.tools.schemas().map(schema => [schema.name, schema]))
    const reportGlobalSchemas = (): void => {
      if (!config.reportSchemaMetrics) return
      const schemas = ctx.tools.schemas()
      const schemaJson = JSON.stringify(schemas)
      const report = JSON.stringify({
        event: 'tool-search.schema-report',
        toolCount: schemas.length,
        schemaBytes: serializedSchemaBytes(schemaJson),
      })
      if (report === lastSchemaReport) return
      lastSchemaReport = report
      console.warn(report)
    }
    const ownedMutation = <Value>(operation: () => Value): Value => {
      ownRegistryChanges += 1
      try {
        return operation()
      } finally {
        ownRegistryChanges -= 1
      }
    }
    const restoreSelectedFromHeader = (agent: Agent, eligibleNames: ReadonlySet<string>): Set<string> => {
      const headerTools = agent.session.requestHeader()?.tools ?? []
      if (!headerTools.some(schema => schema.name === TOOL_SEARCH_NAME)) return new Set()
      const visible = new Set(headerTools.map(schema => schema.name))
      return new Set([...eligibleNames].filter(name => visible.has(name) && !alwaysVisible.some(pattern => pattern.test(name))))
    }
    const desiredAllowedNames = (state: AgentState): string[] =>
      [...globals().keys()]
        .filter(name => state.selectedNames.has(name) || alwaysVisible.some(pattern => pattern.test(name)))
        .sort(ToolSearchModel.compareToolNames)
    const refreshRestriction = (state: AgentState): void => {
      const next = desiredAllowedNames(state)
      if (state.liftRestriction !== undefined && next.length === state.allowedNames.length && next.every((name, index) => name === state.allowedNames[index]))
        return
      const liftNext = ownedMutation(() => state.agent.ctx.tools.restrict({ allow: next }))
      const liftPrevious = state.liftRestriction
      state.liftRestriction = liftNext
      state.allowedNames = next
      if (liftPrevious !== undefined) ownedMutation(liftPrevious)
    }
    const refreshCatalog = (state: AgentState): Map<string, ToolSchema> => {
      const current = globals()
      if (state.admitFutureGlobalTools) for (const name of current.keys()) state.eligibleNames.add(name)
      return new Map([...current].filter(([name]) => state.eligibleNames.has(name)))
    }
    const install = (agent: Agent): void => {
      if (states.has(agent)) return
      const registeredGlobals = globals()
      const eligibleNames = new Set<string>()
      let admitFutureGlobalTools = true
      for (const name of registeredGlobals.keys()) {
        if (ctx.tools.get(name, agent) === ctx.tools.get(name)) eligibleNames.add(name)
        else admitFutureGlobalTools = false
      }
      const state: AgentState = {
        agent,
        eligibleNames,
        selectedNames: restoreSelectedFromHeader(agent, eligibleNames),
        admitFutureGlobalTools,
        allowedNames: [],
        liftRestriction: undefined,
        removeSearchTool: undefined,
      }
      states.set(agent, state)
      try {
        const outputSchema = {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', required: true },
            tools: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  status: { type: 'string', required: true, enum: ['loaded', 'already_loaded', 'unavailable'] },
                },
              },
            },
            remainingDeferred: { type: 'integer', required: true },
          },
        } as const
        state.removeSearchTool = ownedMutation(() =>
          agent.ctx.tools.register(
            defineTool({
              name: TOOL_SEARCH_NAME,
              description:
                'Search tools that are not currently visible. Describe the capability you need or name a tool exactly. Matching tools are loaded for the next model request; call them only after this result returns.',
              parameters: {
                query: { type: 'string', required: true, description: `Capability or exact tool name to find (maximum ${config.maxQueryChars} characters).` },
                limit: { type: 'integer', description: `Maximum matches to load, from 1 to ${config.maxResults}.` },
              },
              output: {
                schema: outputSchema,
                render: (_args, value) => [
                  {
                    type: 'text',
                    text:
                      value.tools.length === 0
                        ? 'No matching tools found.'
                        : `Tool search results:\n${value.tools.map(tool => `- ${tool.name}: ${tool.status}`).join('\n')}\nRemaining deferred tools: ${value.remainingDeferred}.`,
                  },
                ],
              },
              execute: async (args, execution) => {
                if (execution.agent !== agent) throw new Error('tool_search requires its owning live agent')
                if (execution.parent !== undefined) throw new Error('tool_search supports Native Tool Mode only')
                const { query, limit } = ToolSearchModel.validate(args.query, args.limit, config)
                const catalog = refreshCatalog(state)
                const matches = ToolSearchModel.rank(query, [...catalog.values()]).slice(0, limit)
                const visibleBefore = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
                const previous = new Set(state.selectedNames)
                for (const match of matches) state.selectedNames.add(match.name)
                try {
                  refreshRestriction(state)
                } catch (error) {
                  state.selectedNames.clear()
                  for (const name of previous) state.selectedNames.add(name)
                  refreshRestriction(state)
                  throw error
                }
                const visibleAfter = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
                return {
                  query,
                  tools: matches.map(match => {
                    const status: ToolSearchStatus = !visibleAfter.has(match.name) ? 'unavailable' : visibleBefore.has(match.name) ? 'already_loaded' : 'loaded'
                    return { name: match.name, status }
                  }),
                  remainingDeferred: [...catalog.keys()].filter(name => !visibleAfter.has(name)).length,
                }
              },
            }),
          ),
        )
        refreshRestriction(state)
      } catch (error) {
        states.delete(agent)
        ownedMutation(() => state.removeSearchTool?.())
        throw error
      }
    }
    const uninstall = (agent: Agent): void => {
      const state = states.get(agent)
      if (state === undefined) return
      states.delete(agent)
      ownedMutation(() => {
        state.liftRestriction?.()
        state.removeSearchTool?.()
      })
    }
    const disposeCreated = ctx.on('agent/created', ({ agent }) => {
      install(agent)
    })
    const disposeRemoved = ctx.on('agent/disposed', ({ agent }) => {
      uninstall(agent)
    })
    const disposeRegistry = ctx.on('tools/change', () => {
      if (ownRegistryChanges > 0) return
      reportGlobalSchemas()
      for (const state of states.values()) {
        refreshCatalog(state)
        refreshRestriction(state)
      }
    })
    reportGlobalSchemas()
    for (const agent of ctx.agents.list()) install(agent)
    ctx.effect(
      () => async () => {
        disposeCreated()
        disposeRemoved()
        disposeRegistry()
        for (const agent of states.keys()) uninstall(agent)
        return undefined
      },
      'tool-search: per-agent tool disclosure',
    )
  },
})
