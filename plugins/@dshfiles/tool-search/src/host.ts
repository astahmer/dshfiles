import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { DshxPlugin, HostContext, HostEvents, Tool } from '@dshfiles/dshx/effect'
import { Context, Effect, Exit, Layer, Ref, Schema, Scope } from 'effect'
import { serializedSchemaBytes } from './schema-measurement.js'
import { ToolSearchModel } from './search.js'
import { TOOL_CALL_NAME, toolCallDefinition } from './tool-call.js'

/** The native core tools an agent needs on its first step; agent-plane registrations stay visible regardless. */
const nativeCoreTools = [
  'read',
  'write',
  'edit',
  'apply_patch',
  'bash',
  'glob',
  'grep',
  'todo_write',
  'skill',
  'ask_user_question',
  'job_*',
  'subagent*',
  'send_message',
  'list_agents',
  'interrupt_agent',
  'web_search',
  'web_fetch',
  'present',
  'read_image',
  'create_goal',
  'get_goal',
  'update_goal',
  'complete_blocked_goal',
  'extend_goal_budget',
  'exit_plan_mode',
  'workflow',
  'working_directory',
  'compaction_threshold',
]
const modeSchema = Schema.Literals(['cache-safe', 'progressive'])
const defaultConfig = { mode: 'cache-safe' as const, alwaysVisible: nativeCoreTools, maxResults: 5, maxQueryChars: 512, reportSchemaMetrics: false }
const configSchema = Schema.Struct({
  mode: modeSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('cache-safe' as const))),
  alwaysVisible: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(nativeCoreTools))),
  maxResults: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(5)),
  ),
  maxQueryChars: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(4096)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(512)),
  ),
  reportSchemaMetrics: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
}).pipe(Schema.withDecodingDefault(Effect.succeed(defaultConfig)))

type ToolSearchConfig = typeof configSchema.Type

const TOOL_SEARCH_NAME = 'tool_search'

class ToolSearchFailure extends Schema.TaggedError<ToolSearchFailure>()(
  'ToolSearchFailure',
  {
    reason: Schema.Literals(['configuration', 'agent', 'mode', 'query', 'registry']),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'tool-search-failed' },
) {
  override get message(): string {
    return this.detail
  }
}

const detailOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

const outputSchema = Schema.Struct({
  query: Schema.String,
  tools: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.Literals(['loaded', 'already_loaded', 'unavailable']) })),
  remainingDeferred: Schema.Int,
})

const schemaOutputSchema = Schema.Struct({
  query: Schema.String,
  tools: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String, parameters: Schema.String })),
})

const renderSchemas = (value: typeof schemaOutputSchema.Type): string =>
  value.tools.length === 0
    ? 'No matching tools found. Try other words for the capability, or an exact tool name.'
    : [
        `Matching tools. Call one with ${TOOL_CALL_NAME} { name, args }; args must match its parameters.`,
        ...value.tools.map(tool => `## ${tool.name}\n${tool.description}\nParameters: ${tool.parameters}`),
      ].join('\n\n')

interface AgentState {
  readonly agent: Agent
  readonly scope: Scope.Closeable
  readonly eligibleNames: Set<string>
  /** Global names an agent-plane registration (an agent preset's `bash`, `read`, …) shadowed at attachment. */
  readonly shadowedNames: ReadonlySet<string>
  readonly selectedNames: Set<string>
  readonly admitFutureGlobalTools: boolean
  deniedNames: readonly string[]
  liftRestriction: (() => void) | undefined
}

/** Per-agent progressive tool discovery: each agent sees only its disclosed tools plus `tool_search`. */
class ToolSearch extends Context.Service<
  ToolSearch,
  {
    readonly install: (agent: Agent) => Effect.Effect<void, ToolSearchFailure>
    readonly uninstall: (agent: Agent) => Effect.Effect<void>
    readonly globalsChanged: Effect.Effect<void>
  }
>()('@dshfiles/tool-search/ToolSearch') {
  static readonly layer = (config: ToolSearchConfig) =>
    Layer.effect(
      ToolSearch,
      Effect.gen(function* () {
        const hostContext = yield* HostContext
        const ctx = hostContext.ctx
        const pluginScope = yield* Effect.scope
        const alwaysVisible = yield* Effect.try({
          try: () => ToolSearchModel.compileAlwaysVisible(config.alwaysVisible),
          catch: cause => new ToolSearchFailure({ reason: 'configuration', detail: detailOf(cause), cause }),
        })
        const states = new Map<Agent, AgentState>()
        const ownRegistryChanges = yield* Ref.make(0)
        const lastSchemaReport = yield* Ref.make<string | undefined>(undefined)

        /** Registry mutations this plugin makes emit `tools/change` synchronously; those events are not foreign changes. */
        const owned = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Ref.update(ownRegistryChanges, count => count + 1).pipe(Effect.andThen(effect), Effect.ensuring(Ref.update(ownRegistryChanges, count => count - 1)))
        const ownedSync = <A>(operation: () => A) => owned(Effect.sync(operation))

        /** Every registry mutation emits `tools/change`, and the watcher below drops this projection then. */
        let globalCatalog: Map<string, ToolSchema> | undefined

        const globals = (): Map<string, ToolSchema> => {
          globalCatalog ??= new Map(ctx.tools.schemas().map(schema => [schema.name, schema]))
          return globalCatalog
        }
        const isAlwaysVisible = (name: string) => alwaysVisible.some(pattern => pattern.test(name))

        const reportGlobalSchemas = Effect.gen(function* () {
          if (!config.reportSchemaMetrics) return
          const schemas = ctx.tools.schemas()
          const report = JSON.stringify({
            event: 'tool-search.schema-report',
            toolCount: schemas.length,
            schemaBytes: serializedSchemaBytes(JSON.stringify(schemas)),
          })
          if (report === (yield* Ref.getAndSet(lastSchemaReport, report))) return
          yield* Effect.sync(() => console.warn(report))
        })

        const restoreSelectedFromHeader = (agent: Agent, eligibleNames: ReadonlySet<string>): Set<string> => {
          const headerTools = agent.session.requestHeader()?.tools ?? []
          if (!headerTools.some(schema => schema.name === TOOL_SEARCH_NAME)) return new Set()
          const visible = new Set(headerTools.map(schema => schema.name))
          return new Set([...eligibleNames].filter(name => visible.has(name) && !isAlwaysVisible(name)))
        }

        /**
         * A restriction filters everything an agent inherits, agent presets' scopes included, so an allow list of
         * global names would hide the agent's own tools. Deny only the deferred global names instead.
         */
        const refreshRestriction = (state: AgentState) =>
          Effect.gen(function* () {
            const next = [...globals().keys()]
              .filter(name => !state.selectedNames.has(name) && !isAlwaysVisible(name) && !state.shadowedNames.has(name))
              .sort(ToolSearchModel.compareToolNames)
            const unchanged = next.length === state.deniedNames.length && next.every((name, index) => name === state.deniedNames[index])
            if (state.liftRestriction !== undefined && unchanged) return
            const liftNext = yield* ownedSync(() => state.agent.ctx.tools.restrict({ deny: next }))
            const liftPrevious = state.liftRestriction
            state.liftRestriction = liftNext
            state.deniedNames = next
            if (liftPrevious !== undefined) yield* ownedSync(liftPrevious)
          })

        const refreshCatalog = (state: AgentState): Map<string, ToolSchema> => {
          const current = globals()
          if (state.admitFutureGlobalTools) for (const name of current.keys()) state.eligibleNames.add(name)
          return new Map([...current].filter(([name]) => state.eligibleNames.has(name)))
        }

        const disclose = Effect.fn('tool search disclose')(function* (input: {
          readonly state: AgentState
          readonly call: Tool.ToolCall
          readonly query: string
          readonly limit: number | undefined
        }) {
          if (input.call.agent !== input.state.agent)
            return yield* new ToolSearchFailure({ reason: 'agent', detail: 'tool_search requires its owning live agent' })
          if (input.call.nested) return yield* new ToolSearchFailure({ reason: 'mode', detail: 'tool_search supports Native Tool Mode only' })
          const validated = yield* Effect.try({
            try: () => ToolSearchModel.validate(input.query, input.limit, config),
            catch: cause => new ToolSearchFailure({ reason: 'query', detail: detailOf(cause), cause }),
          })
          const catalog = refreshCatalog(input.state)
          const matches = ToolSearchModel.rank(validated.query, [...catalog.values()]).slice(0, validated.limit)
          const visibleBefore = new Set(ctx.tools.schemas(input.state.agent).map(schema => schema.name))
          const previous = new Set(input.state.selectedNames)
          for (const match of matches) input.state.selectedNames.add(match.name)
          yield* refreshRestriction(input.state).pipe(
            Effect.catchDefect(cause =>
              Effect.gen(function* () {
                input.state.selectedNames.clear()
                for (const name of previous) input.state.selectedNames.add(name)
                yield* refreshRestriction(input.state)
                return yield* new ToolSearchFailure({ reason: 'registry', detail: detailOf(cause), cause })
              }),
            ),
          )
          const visibleAfter = new Set(ctx.tools.schemas(input.state.agent).map(schema => schema.name))
          return {
            query: validated.query,
            tools: matches.map(match => {
              const status = !visibleAfter.has(match.name) ? 'unavailable' : visibleBefore.has(match.name) ? 'already_loaded' : 'loaded'
              return { name: match.name, status } as const
            }),
            remainingDeferred: [...catalog.keys()].filter(name => !visibleAfter.has(name)).length,
          }
        })

        const searchTool = (state: AgentState) =>
          Tool.make({
            name: TOOL_SEARCH_NAME,
            description:
              'Search tools that are not currently visible. Describe the capability you need or name a tool exactly. Matching tools are loaded for the next model request; call them only after this result returns.',
            input: Schema.Struct({
              query: Schema.String.annotate({ description: `Capability or exact tool name to find (maximum ${config.maxQueryChars} characters).` }),
              limit: Schema.optionalKey(Schema.Int.annotate({ description: `Maximum matches to load, from 1 to ${config.maxResults}.` })),
            }),
            output: outputSchema,
            render: value =>
              value.tools.length === 0
                ? 'No matching tools found.'
                : `Tool search results:\n${value.tools.map(tool => `- ${tool.name}: ${tool.status}`).join('\n')}\nRemaining deferred tools: ${value.remainingDeferred}.`,
            execute: (input, call) => disclose({ state, call, query: input.query, limit: input.limit }),
          })

        /** Deferred global names: eligible, not always visible, not shadowed by an agent-plane registration. */
        const deferredNames = (state: AgentState): Set<string> =>
          new Set([...refreshCatalog(state).keys()].filter(name => !isAlwaysVisible(name) && !state.shadowedNames.has(name)))

        const describeMatches = Effect.fn('tool search describe')(function* (input: {
          readonly state: AgentState
          readonly call: Tool.ToolCall
          readonly query: string
          readonly limit: number | undefined
        }) {
          if (input.call.agent !== input.state.agent)
            return yield* new ToolSearchFailure({ reason: 'agent', detail: 'tool_search requires its owning live agent' })
          if (input.call.nested) return yield* new ToolSearchFailure({ reason: 'mode', detail: 'tool_search supports Native Tool Mode only' })
          const validated = yield* Effect.try({
            try: () => ToolSearchModel.validate(input.query, input.limit, config),
            catch: cause => new ToolSearchFailure({ reason: 'query', detail: detailOf(cause), cause }),
          })
          const deferred = deferredNames(input.state)
          const candidates = [...globals().values()].filter(schema => deferred.has(schema.name))
          const matches = ToolSearchModel.rank(validated.query, candidates).slice(0, validated.limit)
          const schemas = globals()
          return {
            query: validated.query,
            tools: matches.flatMap(match => {
              const schema = schemas.get(match.name)
              return schema === undefined ? [] : [{ name: schema.name, description: schema.description, parameters: JSON.stringify(schema.parameters) }]
            }),
          }
        })

        /** Fixed when the agent attaches, so the declared list never changes; later MCP tools are still searchable. */
        const schemaSearchDescription = (state: AgentState): string => {
          const families = ToolSearchModel.familyLabels(deferredNames(state))
          const covers = families.length === 0 ? '' : ` Unlisted tools include ${families.join(', ')}; search before saying you cannot do something.`
          return `Find tools that are not listed: describe the capability you need or name a tool exactly. Returns each match's description and parameter schema; call it with ${TOOL_CALL_NAME}.${covers}`
        }

        const schemaSearchTool = (state: AgentState) =>
          Tool.make({
            name: TOOL_SEARCH_NAME,
            description: schemaSearchDescription(state),
            input: Schema.Struct({
              query: Schema.String.annotate({ description: `Capability or exact tool name to find (maximum ${config.maxQueryChars} characters).` }),
              limit: Schema.optionalKey(Schema.Int.annotate({ description: `Maximum matches to return, from 1 to ${config.maxResults}.` })),
            }),
            output: schemaOutputSchema,
            readOnly: true,
            render: renderSchemas,
            execute: (input, call) => describeMatches({ state, call, query: input.query, limit: input.limit }),
          })

        /** The request declares the same tools for the whole Session: deferred globals are filtered from each assembly. */
        const attachCacheSafe = (state: AgentState) =>
          Effect.gen(function* () {
            const agent = state.agent
            yield* owned(Tool.register(schemaSearchTool(state), { tools: agent.ctx.tools }))
            const definition = toolCallDefinition({ agent, tools: ctx.tools, reserved: new Set([TOOL_SEARCH_NAME, TOOL_CALL_NAME]) })
            yield* Effect.acquireRelease(
              ownedSync(() => agent.ctx.tools.register(definition)),
              unregister => ownedSync(unregister),
            )
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
                  const assembly = await next()
                  const deferred = deferredNames(state)
                  return { ...assembly, tools: assembly.tools.filter(tool => !deferred.has(tool.name)) }
                }),
              ),
              dispose => Effect.sync(dispose),
            )
          })

        const uninstall = (agent: Agent) =>
          Effect.suspend(() => {
            const state = states.get(agent)
            if (state === undefined) return Effect.void
            states.delete(agent)
            return Scope.close(state.scope, Exit.void)
          })

        const install = Effect.fn('tool search install')(function* (agent: Agent) {
          if (states.has(agent)) return
          const registeredGlobals = globals()
          const eligibleNames = new Set<string>()
          const shadowedNames = new Set<string>()
          let admitFutureGlobalTools = true
          for (const name of registeredGlobals.keys()) {
            const scoped = ctx.tools.get(name, agent)
            if (scoped === ctx.tools.get(name)) eligibleNames.add(name)
            else {
              admitFutureGlobalTools = false
              if (scoped !== undefined) shadowedNames.add(name)
            }
          }
          const scope = yield* Scope.fork(pluginScope)
          const state: AgentState = {
            agent,
            scope,
            eligibleNames,
            shadowedNames,
            selectedNames: restoreSelectedFromHeader(agent, eligibleNames),
            admitFutureGlobalTools,
            deniedNames: [],
            liftRestriction: undefined,
          }
          states.set(agent, state)
          yield* Scope.addFinalizer(
            scope,
            ownedSync(() => state.liftRestriction?.()),
          )
          const attach =
            config.mode === 'cache-safe'
              ? attachCacheSafe(state)
              : owned(Tool.register(searchTool(state), { tools: agent.ctx.tools })).pipe(Effect.andThen(refreshRestriction(state)))
          yield* attach.pipe(
            Scope.provide(scope),
            Effect.provideService(HostContext, hostContext),
            Effect.catchCause(cause => uninstall(agent).pipe(Effect.andThen(Effect.failCause(cause)))),
            Effect.mapError(cause => new ToolSearchFailure({ reason: 'registry', detail: `tool_search could not attach to ${agent.id}.`, cause })),
          )
        })

        const globalsChanged = Effect.gen(function* () {
          globalCatalog = undefined
          if ((yield* Ref.get(ownRegistryChanges)) > 0) return
          yield* reportGlobalSchemas
          for (const state of states.values()) {
            refreshCatalog(state)
            if (config.mode === 'progressive') yield* refreshRestriction(state)
          }
        })

        yield* reportGlobalSchemas
        return ToolSearch.of({ install, uninstall, globalsChanged })
      }),
    )
}

/** Attach every live and future agent, follow global tool changes, and detach on dispose or unload. */
const attachAgents = Layer.effectDiscard(
  Effect.gen(function* () {
    const ctx = (yield* HostContext).ctx
    const search = yield* ToolSearch
    const logged = (effect: Effect.Effect<void, ToolSearchFailure>) => effect.pipe(Effect.catchTag('ToolSearchFailure', Effect.logWarning))
    yield* HostEvents.on('agent/created', event => logged(search.install(event.agent)))
    yield* HostEvents.on('agent/disposed', event => search.uninstall(event.agent))
    yield* HostEvents.on('tools/change', () => search.globalsChanged)
    for (const agent of ctx.agents.list()) yield* search.install(agent)
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/tool-search',
  inject: ['agents', 'tools'],
  Config: configSchema,
  layer: config => Layer.provideMerge(attachAgents, ToolSearch.layer(config)),
})
