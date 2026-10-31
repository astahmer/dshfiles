import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { ToolSearchModel } from './search.js'
import { serializedSchemaBytes } from './schema-measurement.js'

const defaultConfig = { alwaysVisible: [], maxResults: 5, maxQueryChars: 512, reportSchemaMetrics: false }
const configSchema = Schema.Struct({
  alwaysVisible: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  maxResults: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(5)),
  ),
  maxQueryChars: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(4096)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(512)),
  ),
  reportSchemaMetrics: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
}).pipe(Schema.withDecodingDefault(Effect.succeed(defaultConfig)))
const configStandard = Schema.toStandardSchemaV1(configSchema)
const configStandardSchema = { '~standard': configStandard['~standard'] }

type ToolSearchConfig = Schema.Schema.Type<typeof configSchema>
type ToolSearchStatus = 'loaded' | 'already_loaded' | 'unavailable'

class ToolSearchFailure extends Schema.TaggedError<ToolSearchFailure>()('ToolSearchFailure', {
  message: Schema.String,
  reason: Schema.Literals(['configuration', 'agent', 'mode', 'query', 'registry']),
}) {}

interface AgentState {
  readonly agent: Agent
  readonly eligibleNames: Set<string>
  readonly selectedNames: Set<string>
  readonly admitFutureGlobalTools: boolean
  allowedNames: string[]
  liftRestriction: (() => void) | undefined
  removeSearchTool: (() => void) | undefined
}

interface ToolSearchRuntime {
  readonly ctx: Context
  readonly config: ToolSearchConfig
  readonly alwaysVisible: readonly RegExp[]
  readonly states: Map<Agent, AgentState>
  ownRegistryChanges: number
  lastSchemaReport: string | undefined
}

interface ToolSearchArguments {
  readonly query: string
  readonly limit?: number
}

interface ToolSearchExecution {
  readonly agent?: Agent
  readonly parent?: symbol
}

interface ToolSearchInvocation {
  readonly runtime: ToolSearchRuntime
  readonly state: AgentState
  readonly args: ToolSearchArguments
  readonly execution: ToolSearchExecution
}

const TOOL_SEARCH_NAME = 'tool_search'

const createRuntime = (ctx: Context, config: ToolSearchConfig): ToolSearchRuntime => ({
  ctx,
  config,
  alwaysVisible: ToolSearchModel.compileAlwaysVisible(config.alwaysVisible),
  states: new Map(),
  ownRegistryChanges: 0,
  lastSchemaReport: undefined,
})

const globals = (runtime: ToolSearchRuntime): Map<string, ToolSchema> => new Map(runtime.ctx.tools.schemas().map(schema => [schema.name, schema]))

const reportGlobalSchemas = (runtime: ToolSearchRuntime): void => {
  if (!runtime.config.reportSchemaMetrics) return
  const schemas = runtime.ctx.tools.schemas()
  const schemaJson = JSON.stringify(schemas)
  const report = JSON.stringify({
    event: 'tool-search.schema-report',
    toolCount: schemas.length,
    schemaBytes: serializedSchemaBytes(schemaJson),
  })
  if (report === runtime.lastSchemaReport) return
  runtime.lastSchemaReport = report
  console.warn(report)
}

const ownedMutation = <Value>(runtime: ToolSearchRuntime, operation: () => Value): Value => {
  runtime.ownRegistryChanges += 1
  try {
    return operation()
  } finally {
    runtime.ownRegistryChanges -= 1
  }
}

const restoreSelectedFromHeader = (runtime: ToolSearchRuntime, agent: Agent, eligibleNames: ReadonlySet<string>): Set<string> => {
  const headerTools = agent.session.requestHeader()?.tools ?? []
  if (!headerTools.some(schema => schema.name === TOOL_SEARCH_NAME)) return new Set()
  const visible = new Set(headerTools.map(schema => schema.name))
  return new Set([...eligibleNames].filter(name => visible.has(name) && !runtime.alwaysVisible.some(pattern => pattern.test(name))))
}

const desiredAllowedNames = (runtime: ToolSearchRuntime, state: AgentState): string[] =>
  [...globals(runtime).keys()]
    .filter(name => state.selectedNames.has(name) || runtime.alwaysVisible.some(pattern => pattern.test(name)))
    .sort(ToolSearchModel.compareToolNames)

const refreshRestriction = (runtime: ToolSearchRuntime, state: AgentState): void => {
  const next = desiredAllowedNames(runtime, state)
  if (state.liftRestriction !== undefined && next.length === state.allowedNames.length && next.every((name, index) => name === state.allowedNames[index]))
    return
  const liftNext = ownedMutation(runtime, () => state.agent.ctx.tools.restrict({ allow: next }))
  const liftPrevious = state.liftRestriction
  state.liftRestriction = liftNext
  state.allowedNames = next
  if (liftPrevious !== undefined) ownedMutation(runtime, liftPrevious)
}

const refreshCatalog = (runtime: ToolSearchRuntime, state: AgentState): Map<string, ToolSchema> => {
  const current = globals(runtime)
  if (state.admitFutureGlobalTools) for (const name of current.keys()) state.eligibleNames.add(name)
  return new Map([...current].filter(([name]) => state.eligibleNames.has(name)))
}

const search = Effect.fn('tool search disclose')((input: ToolSearchInvocation) =>
  Effect.gen(function* () {
    if (input.execution.agent !== input.state.agent) {
      return yield* Effect.fail(new ToolSearchFailure({ reason: 'agent', message: 'tool_search requires its owning live agent' }))
    }
    if (input.execution.parent !== undefined) {
      return yield* Effect.fail(new ToolSearchFailure({ reason: 'mode', message: 'tool_search supports Native Tool Mode only' }))
    }

    const validated = yield* Effect.try({
      try: () => ToolSearchModel.validate(input.args.query, input.args.limit, input.runtime.config),
      catch: failure => new ToolSearchFailure({ reason: 'query', message: failure instanceof Error ? failure.message : String(failure) }),
    })
    const catalog = refreshCatalog(input.runtime, input.state)
    const matches = ToolSearchModel.rank(validated.query, [...catalog.values()]).slice(0, validated.limit)
    const visibleBefore = new Set(input.runtime.ctx.tools.schemas(input.state.agent).map(schema => schema.name))
    const previous = new Set(input.state.selectedNames)
    for (const match of matches) input.state.selectedNames.add(match.name)

    yield* Effect.try({
      try: () => refreshRestriction(input.runtime, input.state),
      catch: failure => new ToolSearchFailure({ reason: 'registry', message: failure instanceof Error ? failure.message : String(failure) }),
    }).pipe(
      Effect.catch(failure =>
        Effect.sync(() => {
          input.state.selectedNames.clear()
          for (const name of previous) input.state.selectedNames.add(name)
          refreshRestriction(input.runtime, input.state)
        }).pipe(Effect.andThen(Effect.fail(failure))),
      ),
    )

    const visibleAfter = new Set(input.runtime.ctx.tools.schemas(input.state.agent).map(schema => schema.name))
    return {
      query: validated.query,
      tools: matches.map(match => {
        const status: ToolSearchStatus = !visibleAfter.has(match.name) ? 'unavailable' : visibleBefore.has(match.name) ? 'already_loaded' : 'loaded'
        return { name: match.name, status }
      }),
      remainingDeferred: [...catalog.keys()].filter(name => !visibleAfter.has(name)).length,
    }
  }),
)

const install = (runtime: ToolSearchRuntime, agent: Agent): void => {
  if (runtime.states.has(agent)) return
  const registeredGlobals = globals(runtime)
  const eligibleNames = new Set<string>()
  let admitFutureGlobalTools = true
  for (const name of registeredGlobals.keys()) {
    if (runtime.ctx.tools.get(name, agent) === runtime.ctx.tools.get(name)) eligibleNames.add(name)
    else admitFutureGlobalTools = false
  }
  const state: AgentState = {
    agent,
    eligibleNames,
    selectedNames: restoreSelectedFromHeader(runtime, agent, eligibleNames),
    admitFutureGlobalTools,
    allowedNames: [],
    liftRestriction: undefined,
    removeSearchTool: undefined,
  }
  runtime.states.set(agent, state)
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
    state.removeSearchTool = ownedMutation(runtime, () =>
      agent.ctx.tools.register(
        defineTool({
          name: TOOL_SEARCH_NAME,
          description:
            'Search tools that are not currently visible. Describe the capability you need or name a tool exactly. Matching tools are loaded for the next model request; call them only after this result returns.',
          parameters: {
            query: {
              type: 'string',
              required: true,
              description: `Capability or exact tool name to find (maximum ${runtime.config.maxQueryChars} characters).`,
            },
            limit: { type: 'integer', description: `Maximum matches to load, from 1 to ${runtime.config.maxResults}.` },
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
          execute: (args, execution) => Effect.runPromise(search({ runtime, state, args, execution }).pipe(Effect.provide(DshxEffect.tracerLayer))),
        }),
      ),
    )
    refreshRestriction(runtime, state)
  } catch (failure) {
    runtime.states.delete(agent)
    ownedMutation(runtime, () => state.removeSearchTool?.())
    throw failure
  }
}

const uninstall = (runtime: ToolSearchRuntime, agent: Agent): void => {
  const state = runtime.states.get(agent)
  if (state === undefined) return
  runtime.states.delete(agent)
  ownedMutation(runtime, () => {
    state.liftRestriction?.()
    state.removeSearchTool?.()
  })
}

class ToolSearchHost extends EffectContext.Service<ToolSearchHost, ToolSearchRuntime>()('@dshfiles/tool-search/Host') {}

const effectPlugin = DshxEffect.plugin<unknown, ToolSearchFailure, ToolSearchHost>({
  layer: (ctx, config) =>
    Layer.effect(
      ToolSearchHost,
      Effect.try({
        try: () => createRuntime(ctx, Schema.decodeUnknownSync(configSchema)(config)),
        catch: failure => new ToolSearchFailure({ reason: 'configuration', message: failure instanceof Error ? failure.message : String(failure) }),
      }),
    ),
  setup: () =>
    Effect.gen(function* () {
      const runtime = yield* ToolSearchHost
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          runtime.ctx.on('agent/created', ({ agent }) => {
            install(runtime, agent)
            return undefined
          }),
        ),
        dispose => Effect.sync(dispose),
      )
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          runtime.ctx.on('agent/disposed', ({ agent }) => {
            uninstall(runtime, agent)
            return undefined
          }),
        ),
        dispose => Effect.sync(dispose),
      )
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          runtime.ctx.on('tools/change', () => {
            if (runtime.ownRegistryChanges > 0) return undefined
            reportGlobalSchemas(runtime)
            for (const state of runtime.states.values()) {
              refreshCatalog(runtime, state)
              refreshRestriction(runtime, state)
            }
            return undefined
          }),
        ),
        dispose => Effect.sync(dispose),
      )
      yield* Effect.sync(() => reportGlobalSchemas(runtime))
      for (const agent of runtime.ctx.agents.list()) {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            install(runtime, agent)
            return agent
          }),
          current => Effect.sync(() => uninstall(runtime, current)),
        )
      }
    }),
})

export default defineHost({
  name: '@dshfiles/tool-search',
  Config: configStandardSchema,
  inject: ['agents', 'tools'],
  setup: effectPlugin.setup,
})
