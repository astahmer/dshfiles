import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ToolSchema, type UserMessage } from '@deepseek-ai/dsh-llm'
import { projectToolSchema, type ToolExecutor } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import { DshxPlugin, HostContext, HostEvents, Tool } from '@dshfiles/dshx/effect'
import { toolSources, type ToolSourceView } from '@dshfiles/dshx/host'
import { Context, Effect, Exit, Layer, Ref, Schema, Scope } from 'effect'
import { ToolAccess, toolAccessPolicySchema, type ToolAccessDecision, type ToolAccessPolicy, type ToolAccessProvider } from './access.js'
import { serializedSchemaBytes } from './schema-measurement.js'
import { ToolSearchModel } from './search.js'
import { TOOL_CALL_NAME, toolCallDefinition } from './tool-call.js'
import { ToolSetDeltaModel } from './tool-set-delta.js'
import { makeToolSearchVisibility, type ToolSearchVisibility } from './tool-visibility.js'

const TOOL_SET_SOURCE = 'dshfiles-tool-search'
/** The native executor's batch concurrency (`@deepseek-ai/dsh-tool-executor-native`), kept for the agents this plugin executes for. */
const NATIVE_MAX_PARALLEL_TOOL_CALLS = 10

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dshfiles-tool-search': { readonly kind: 'dshfiles-tool-search'; readonly form: 'tool-set-delta' }
  }
}

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
const defaultConfig = {
  mode: 'cache-safe' as const,
  alwaysVisible: nativeCoreTools,
  maxResults: 5,
  maxQueryChars: 512,
  reportSchemaMetrics: false,
  announceToolChanges: true,
}
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
  announceToolChanges: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
}).pipe(Schema.withDecodingDefault(Effect.succeed(defaultConfig)))

type ToolSearchConfig = typeof configSchema.Type

const TOOL_SEARCH_NAME = 'tool_search'
const TOOL_ACCESS_NAME = 'tool_search_access'

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

const detailOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/**
 * Matches this thread's agent has disabled: named so the user can re-enable one, never described or loaded. `notice`
 * names the agent and how to change its access.
 */
const disabledSchema = Schema.optionalKey(Schema.Struct({ names: Schema.Array(Schema.String), notice: Schema.String }))

const outputSchema = Schema.Struct({
  query: Schema.String,
  tools: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.Literals(['loaded', 'already_loaded', 'unavailable']) })),
  remainingDeferred: Schema.Int,
  disabled: disabledSchema,
})

const schemaOutputSchema = Schema.Struct({
  query: Schema.String,
  tools: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String, parameters: Schema.String })),
  disabled: disabledSchema,
})

const disabledLine = (disabled: typeof disabledSchema.Type | undefined): string[] =>
  disabled === undefined ? [] : [`Also matching, but disabled for this thread: ${disabled.names.join(', ')}. ${disabled.notice}`]

const renderSchemas = (value: typeof schemaOutputSchema.Type): string =>
  value.tools.length === 0
    ? ['No matching tools found. Try other words for the capability, or an exact tool name.', ...disabledLine(value.disabled)].join('\n\n')
    : [
        `Matching tools. Call one with ${TOOL_CALL_NAME} { name, args }; args must match its parameters.`,
        ...value.tools.map(tool => `## ${tool.name}\n${tool.description}\nParameters: ${tool.parameters}`),
        ...disabledLine(value.disabled),
      ].join('\n\n')

const MAX_LISTED_NAMES = 200

const accessOutputSchema = Schema.Struct({
  /** Whether tool-search is attached to the calling agent. */
  attached: Schema.Boolean,
  /** The resolved policy, or null when no plugin provides tool access (every tool on). */
  policy: Schema.NullOr(toolAccessPolicySchema),
  pinnedTools: Schema.Array(Schema.String),
  disabledTools: Schema.Array(Schema.String),
})

/** Who decides this thread's tools, in one phrase: `@reviewer (this project's default agent)`. */
const describePolicy = (policy: ToolAccessPolicy): string => {
  switch (policy.source) {
    case 'override':
      return policy.toolsFrom === null
        ? `@${policy.agent}, overridden with every tool for this thread`
        : `@${policy.agent}, overridden with @${policy.toolsFrom}'s tools for this thread`
    case 'project-default':
      return `@${policy.agent} (this project's default agent)`
    case 'default':
      return `@${policy.agent} (no agent chosen, so the built-in default)`
    case 'agent':
      return `@${policy.agent}`
  }
}

const renderAccess = (value: typeof accessOutputSchema.Type): string => {
  if (!value.attached) return 'tool-search is not attached to this agent, so it applies no tool access.'
  if (value.policy === null) return 'No plugin provides per-agent tool access (install @dshfiles/agents), so every tool is available to this thread.'
  const listed = (names: readonly string[]) => (names.length === 0 ? 'none' : names.join(', '))
  return [
    `This thread's tools come from ${describePolicy(value.policy)}.`,
    `Pinned (declared from the first request): ${listed(value.pinnedTools)}.`,
    `Disabled: ${listed(value.disabledTools)}.`,
    'Every other tool is enabled and deferred: find it with tool_search.',
    value.policy.change,
  ].join('\n')
}

/** The access policy an agent attached with (or switched to): the provider's answer and its per-name decisions. */
interface AgentAccess {
  /** Undefined without a provider: every tool on, nothing pinned beyond `alwaysVisible`. */
  readonly policy: ToolAccessPolicy | undefined
  readonly decisions: Map<string, ToolAccessDecision>
}

interface AgentState {
  readonly agent: Agent
  readonly scope: Scope.Closeable
  readonly eligibleNames: Set<string>
  /** Global names an agent-plane registration (an agent preset's `bash`, `read`, …) shadowed at attachment. */
  readonly shadowedNames: ReadonlySet<string>
  /** Every name the agent could see at attachment, its own and preset tools included, so access can disable those too. */
  readonly attachedNames: ReadonlySet<string>
  access: AgentAccess
  readonly selectedNames: Set<string>
  readonly admitFutureGlobalTools: boolean
  /** Cache-safe only: the global names the request declares, fixed until the thread's access policy changes. */
  declaredNames: ReadonlySet<string>
  /** The reachable catalog (name → description) the model was last told about. */
  announced: ReadonlyMap<string, string>
  catalogChanged: boolean
  deniedNames: readonly string[]
  liftRestriction: (() => void) | undefined
  /** Cache-safe only: the scope holding the current `tool_search` registration, replaced when access changes. */
  searchScope: Scope.Closeable | undefined
}

/** Per-agent tool discovery and access: each agent sees its enabled, declared tools plus `tool_search`. */
class ToolSearch extends Context.Service<
  ToolSearch,
  {
    readonly install: (agent: Agent) => Effect.Effect<void, ToolSearchFailure>
    readonly uninstall: (agent: Agent) => Effect.Effect<void>
    readonly globalsChanged: Effect.Effect<void>
    /** A provider appeared or reported a change: resolve the matching agents' access again (all agents when undefined). */
    readonly accessChanged: (sessionId: string | undefined) => Effect.Effect<void>
    readonly describeAccess: (agent: Agent | undefined) => Effect.Effect<typeof accessOutputSchema.Type>
  }
>()('@dshfiles/tool-search/ToolSearch') {
  static readonly layer = (config: ToolSearchConfig, visibility: ToolSearchVisibility) =>
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

        /** Every registry mutation emits `tools/change`, and the watcher below drops these projections then. */
        let globalCatalog: Map<string, ToolSchema> | undefined
        let sourceOf: ((name: string) => ToolSourceView) | undefined

        const globals = (): Map<string, ToolSchema> => {
          globalCatalog ??= new Map(ctx.tools.schemas().map(schema => [schema.name, schema]))
          return globalCatalog
        }
        const isAlwaysVisible = (name: string) => alwaysVisible.some(pattern => pattern.test(name)) || visibility.names().has(name)
        const provider = (): ToolAccessProvider | undefined => ctx.get('dshfilesToolAccess') ?? undefined

        const resolvePolicy = (agent: Agent): ToolAccessPolicy | undefined => {
          const source = provider()
          if (source === undefined) return undefined
          const header = agent.session.header
          return source.resolve({
            sessionId: agent.id,
            cwd: header.cwd === undefined || header.cwd === '' ? undefined : header.cwd,
            parentSessionId: header.origin === 'subagent' ? header.parentSession : undefined,
          })
        }

        /** One tool's access for this agent; cached per name until the policy or the global tool set changes. */
        const decisionOf = (state: AgentState, name: string): ToolAccessDecision | undefined => {
          const policy = state.access.policy
          if (policy === undefined) return undefined
          const cached = state.access.decisions.get(name)
          if (cached !== undefined) return cached
          sourceOf ??= toolSources(ctx)
          const decision = ToolAccess.decide(policy.access, { name, group: ToolAccess.groupOf({ name, ...sourceOf(name) }).key })
          state.access.decisions.set(name, decision)
          return decision
        }
        const isDisabled = (state: AgentState, name: string) => decisionOf(state, name)?.enabled === false
        const isPinned = (state: AgentState, name: string) => decisionOf(state, name)?.pinned === true
        /** Declared from the first request: `alwaysVisible` or pinned by the agent, unless the agent disabled it. */
        const isVisibleTo = (state: AgentState, name: string) => !isDisabled(state, name) && (isAlwaysVisible(name) || isPinned(state, name))
        /** The names this agent's access disables among everything it could reach: globals now, and its own tools at attachment. */
        const disabledNames = (state: AgentState): string[] =>
          state.access.policy === undefined ? [] : [...new Set([...globals().keys(), ...state.attachedNames])].filter(name => isDisabled(state, name))

        const refusal = (state: AgentState, name: string): string | undefined => {
          const policy = state.access.policy
          if (policy === undefined || !isDisabled(state, name)) return undefined
          return `${name} is disabled for this thread, whose tools come from ${describePolicy(policy)}. ${policy.change}`
        }

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

        const restoreSelectedFromHeader = (state: AgentState): void => {
          const headerTools = state.agent.session.requestHeader()?.tools ?? []
          if (!headerTools.some(schema => schema.name === TOOL_SEARCH_NAME)) return
          const visible = new Set(headerTools.map(schema => schema.name))
          for (const name of state.eligibleNames) if (visible.has(name) && !isVisibleTo(state, name) && !isDisabled(state, name)) state.selectedNames.add(name)
        }

        /**
         * A restriction filters everything an agent inherits, agent presets' scopes included, so an allow list of
         * global names would hide the agent's own tools. Deny only the deferred global names instead (progressive mode),
         * plus every name the agent's access disables (both modes): then no registry view, declaration or dispatch has it.
         */
        const refreshRestriction = (state: AgentState) =>
          Effect.gen(function* () {
            const deferred =
              config.mode === 'progressive'
                ? [...globals().keys()].filter(name => !state.selectedNames.has(name) && !isVisibleTo(state, name) && !state.shadowedNames.has(name))
                : []
            const next = [...new Set([...deferred, ...disabledNames(state)])].sort(ToolSearchModel.compareToolNames)
            const unchanged = next.length === state.deniedNames.length && next.every((name, index) => name === state.deniedNames[index])
            if (state.liftRestriction !== undefined && unchanged) return
            // Cache-safe mode restricts nothing until the agent disables a tool, exactly as without a provider.
            if (state.liftRestriction === undefined && next.length === 0 && config.mode === 'cache-safe') return
            const liftNext = yield* ownedSync(() => state.agent.ctx.tools.restrict({ deny: next }))
            const liftPrevious = state.liftRestriction
            state.liftRestriction = liftNext
            state.deniedNames = next
            if (liftPrevious !== undefined) yield* ownedSync(liftPrevious)
          })

        const refreshCatalog = (state: AgentState): Map<string, ToolSchema> => {
          const current = globals()
          if (state.admitFutureGlobalTools) for (const name of current.keys()) state.eligibleNames.add(name)
          return new Map([...current].filter(([name]) => state.eligibleNames.has(name) && !isDisabled(state, name)))
        }

        /** Rank the reachable candidates together with the disabled globals; a disabled match is named, never disclosed. */
        const rankWithDisabled = (state: AgentState, query: string, candidates: readonly ToolSchema[], limit: number) => {
          const disabled = [...globals().values()].filter(schema => state.eligibleNames.has(schema.name) && isDisabled(state, schema.name))
          const ranked = ToolSearchModel.rank(query, [...candidates, ...disabled]).slice(0, limit)
          const names = ranked.filter(match => isDisabled(state, match.name)).map(match => match.name)
          const policy = state.access.policy
          return {
            matches: ranked.filter(match => !isDisabled(state, match.name)),
            disabled:
              names.length === 0 || policy === undefined
                ? undefined
                : { names, notice: `This thread's tools come from ${describePolicy(policy)}, which disables them. ${policy.change}` },
          }
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
          const { matches, disabled } = rankWithDisabled(input.state, validated.query, [...catalog.values()], validated.limit)
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
            ...(disabled !== undefined && { disabled }),
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
            render: value => {
              const found =
                value.tools.length === 0
                  ? 'No matching tools found.'
                  : `Tool search results:\n${value.tools.map(tool => `- ${tool.name}: ${tool.status}`).join('\n')}\nRemaining deferred tools: ${value.remainingDeferred}.`
              return [found, ...disabledLine(value.disabled)].join('\n')
            },
            execute: (input, call) => disclose({ state, call, query: input.query, limit: input.limit }),
          })

        /**
         * Deferred global names: eligible, enabled and not shadowed by an agent-plane registration, minus the declared
         * ones. Cache-safe mode takes "declared" as the set fixed at attachment (or at the last access change), so a
         * matching tool that appears later stays searchable without changing the declared list.
         */
        const deferredNames = (state: AgentState): Set<string> =>
          new Set(
            [...refreshCatalog(state).keys()].filter(
              name => !state.shadowedNames.has(name) && !(config.mode === 'cache-safe' ? state.declaredNames.has(name) : isVisibleTo(state, name)),
            ),
          )

        const reachableCatalog = (state: AgentState): Map<string, string> =>
          new Map([...refreshCatalog(state)].filter(([name]) => !state.shadowedNames.has(name)).map(([name, schema]) => [name, schema.description]))

        /** The pending tool-set change as one reminder, or nothing; the change counts as told once it is returned. */
        const takeToolSetNotice = (state: AgentState): UserMessage | undefined => {
          if (!state.catalogChanged) return undefined
          state.catalogChanged = false
          const next = reachableCatalog(state)
          const delta = ToolSetDeltaModel.diff(state.announced, next)
          state.announced = next
          if (ToolSetDeltaModel.isEmpty(delta)) return undefined
          return createUserMessage({
            content: [{ type: 'text', text: ToolSetDeltaModel.render(delta, config.mode) }],
            source: { kind: TOOL_SET_SOURCE, form: 'tool-set-delta' },
          })
        }

        /** Append the change after the step's own messages: a logged user message, so the cached prefix is untouched. */
        const announceToolChanges = (state: AgentState) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              state.agent.ctx.on('agent/pre-step', async (payload, next) => {
                const decision = await next()
                if (decision.kind === 'reject' || (payload.step === 1 && decision.messages.length === 0)) return decision
                const notice = takeToolSetNotice(state)
                if (notice === undefined) return decision
                const insertAt = decision.messages.findLastIndex(message => payload.messages.includes(message)) + 1
                return { ...decision, messages: [...decision.messages.slice(0, insertAt), notice, ...decision.messages.slice(insertAt)] }
              }),
            ),
            dispose => Effect.sync(dispose),
          )

        /**
         * A call by a disabled tool's real name: the restriction already hides it from the registry, and pre-execute
         * policy still runs for an unknown tool, so the refusal names the agent instead of saying "unknown tool".
         */
        const refuseDisabledCalls = (state: AgentState) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              state.agent.ctx.on('tools/pre-execute', (exec, next) => {
                const reason = refusal(state, exec.name)
                return reason === undefined ? next() : Promise.resolve({ kind: 'deny' as const, reason })
              }),
            ),
            dispose => Effect.sync(dispose),
          )

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
          const { matches, disabled } = rankWithDisabled(input.state, validated.query, candidates, validated.limit)
          const schemas = globals()
          return {
            query: validated.query,
            tools: matches.flatMap(match => {
              const schema = schemas.get(match.name)
              return schema === undefined ? [] : [{ name: schema.name, description: schema.description, parameters: JSON.stringify(schema.parameters) }]
            }),
            ...(disabled !== undefined && { disabled }),
          }
        })

        /** Fixed until the thread's access changes, so the declared list stays put; later MCP tools are still searchable. */
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

        /** (Re)register the cache-safe `tool_search` in a child scope, so an access change can replace its description. */
        const registerSchemaSearch = (state: AgentState) =>
          Effect.gen(function* () {
            const previous = state.searchScope
            state.searchScope = undefined
            if (previous !== undefined) yield* Scope.close(previous, Exit.void)
            const scope = yield* Scope.fork(state.scope)
            yield* owned(Tool.register(schemaSearchTool(state), { tools: state.agent.ctx.tools })).pipe(
              Scope.provide(scope),
              Effect.provideService(HostContext, hostContext),
            )
            state.searchScope = scope
          })

        /**
         * The request declares the same tools until the thread's access changes: the agent's own executor leaves deferred
         * and disabled tools out of its declarations, while deferred ones stay admitted, so `tool_call` and a call by
         * real name still dispatch them.
         */
        const attachCacheSafe = (state: AgentState) =>
          Effect.gen(function* () {
            const agent = state.agent
            const pipeline = new ToolExecutionPipeline(ctx)
            const executor: ToolExecutor = {
              describe: tools => {
                const deferred = deferredNames(state)
                return {
                  schemas: tools.filter(tool => !deferred.has(tool.name) && !isDisabled(state, tool.name)).map(tool => projectToolSchema(tool, false)),
                }
              },
              execute: input => executeToolBatch(input, pipeline, () => NATIVE_MAX_PARALLEL_TOOL_CALLS),
            }
            yield* registerSchemaSearch(state)
            const definition = toolCallDefinition({
              agent,
              tools: ctx.tools,
              pipeline,
              reserved: new Set([TOOL_SEARCH_NAME, TOOL_CALL_NAME]),
              refuse: name => {
                const reason = refusal(state, name)
                return reason === undefined ? undefined : `tool_call cannot call ${reason}`
              },
            })
            yield* Effect.acquireRelease(
              ownedSync(() => agent.ctx.tools.register(definition)),
              unregister => ownedSync(unregister),
            )
            yield* Effect.acquireRelease(
              ownedSync(() => agent.ctx.tools.setExecutor(executor)),
              release => ownedSync(release),
            )
            yield* refreshRestriction(state)
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
          const policy = yield* Effect.try({
            try: () => resolvePolicy(agent),
            catch: cause => new ToolSearchFailure({ reason: 'configuration', detail: `Tool access could not be resolved: ${detailOf(cause)}`, cause }),
          })
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
            attachedNames: new Set(ctx.tools.schemas(agent).map(schema => schema.name)),
            access: { policy, decisions: new Map() },
            selectedNames: new Set(),
            admitFutureGlobalTools,
            declaredNames: new Set(),
            announced: new Map(),
            catalogChanged: false,
            deniedNames: [],
            liftRestriction: undefined,
            searchScope: undefined,
          }
          state.declaredNames = new Set([...eligibleNames].filter(name => isVisibleTo(state, name)))
          restoreSelectedFromHeader(state)
          state.announced = reachableCatalog(state)
          states.set(agent, state)
          yield* Scope.addFinalizer(
            scope,
            ownedSync(() => state.liftRestriction?.()),
          )
          const attachMode =
            config.mode === 'cache-safe'
              ? attachCacheSafe(state)
              : owned(Tool.register(searchTool(state), { tools: agent.ctx.tools })).pipe(Effect.andThen(refreshRestriction(state)))
          const announced = config.announceToolChanges ? attachMode.pipe(Effect.andThen(announceToolChanges(state))) : attachMode
          yield* announced.pipe(
            Effect.andThen(refuseDisabledCalls(state)),
            Scope.provide(scope),
            Effect.provideService(HostContext, hostContext),
            Effect.catchCause(cause => uninstall(agent).pipe(Effect.andThen(Effect.failCause(cause)))),
            Effect.mapError(cause => new ToolSearchFailure({ reason: 'registry', detail: `tool_search could not attach to ${agent.id}.`, cause })),
          )
        })

        /**
         * Apply a new policy from the thread's next model request: the declared list, the restriction and (cache-safe)
         * the `tool_search` description are rebuilt once, which costs that one request its prompt-cache prefix.
         */
        const applyPolicy = (state: AgentState, policy: ToolAccessPolicy | undefined) =>
          Effect.gen(function* () {
            state.access = { policy, decisions: new Map() }
            for (const name of [...state.selectedNames]) if (isDisabled(state, name)) state.selectedNames.delete(name)
            state.declaredNames = new Set([...state.eligibleNames].filter(name => isVisibleTo(state, name)))
            yield* refreshRestriction(state)
            if (config.mode === 'cache-safe') yield* registerSchemaSearch(state)
            state.catalogChanged = config.announceToolChanges
          })

        const accessChanged = (sessionId: string | undefined) =>
          Effect.gen(function* () {
            for (const state of [...states.values()]) {
              if (sessionId !== undefined && state.agent.id !== sessionId) continue
              const policy = yield* Effect.try({
                try: () => resolvePolicy(state.agent),
                catch: cause => new ToolSearchFailure({ reason: 'configuration', detail: `Tool access could not be resolved: ${detailOf(cause)}`, cause }),
              })
              const before = state.access.policy
              if (before !== undefined && policy !== undefined && JSON.stringify(before) === JSON.stringify(policy)) continue
              if (before === undefined && policy === undefined) continue
              yield* applyPolicy(state, policy)
            }
          }).pipe(
            Effect.catchTags({ ToolSearchFailure: Effect.logWarning, HostServiceMissing: Effect.logWarning }),
            Effect.withSpan('tool search access change', { attributes: { scoped: sessionId !== undefined } }),
          )

        const globalsChanged = Effect.gen(function* () {
          globalCatalog = undefined
          sourceOf = undefined
          if ((yield* Ref.get(ownRegistryChanges)) > 0) return
          yield* reportGlobalSchemas
          for (const state of states.values()) {
            state.access.decisions.clear()
            refreshCatalog(state)
            state.catalogChanged = true
            yield* refreshRestriction(state)
          }
        })

        const describeAccess = (agent: Agent | undefined) =>
          Effect.sync((): typeof accessOutputSchema.Type => {
            const state = agent === undefined ? undefined : states.get(agent)
            if (state === undefined) return { attached: false, policy: null, pinnedTools: [], disabledTools: [] }
            const reachable = [...new Set([...globals().keys(), ...state.attachedNames])].sort(ToolSearchModel.compareToolNames)
            return {
              attached: true,
              policy: state.access.policy ?? null,
              pinnedTools: reachable.filter(name => !isDisabled(state, name) && isVisibleTo(state, name)).slice(0, MAX_LISTED_NAMES),
              disabledTools: reachable.filter(name => isDisabled(state, name)).slice(0, MAX_LISTED_NAMES),
            }
          })

        yield* reportGlobalSchemas
        return ToolSearch.of({ install, uninstall, globalsChanged, accessChanged, describeAccess })
      }),
    )
}

/** Attach every live and future agent, follow global tool and access changes, and detach on dispose or unload. */
const attachAgents = (visibility: ToolSearchVisibility) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const ctx = (yield* HostContext).ctx
      const search = yield* ToolSearch
      ctx.provide('toolSearchVisibility', visibility)
      const logged = (effect: Effect.Effect<void, ToolSearchFailure>) => effect.pipe(Effect.catchTag('ToolSearchFailure', Effect.logWarning))
      yield* HostEvents.on('agent/created', event => logged(search.install(event.agent)))
      yield* HostEvents.on('agent/disposed', event => search.uninstall(event.agent))
      yield* HostEvents.on('tools/change', () => search.globalsChanged)
      for (const agent of ctx.agents.list()) yield* logged(search.install(agent))
      // A provider that arrives (or reloads) re-resolves every attached agent; while it lives, its change reports apply
      // to the one thread they name.
      const resolveAll = yield* DshxPlugin.callback(() => search.accessChanged(undefined))
      const resolveOne = yield* DshxPlugin.callback((sessionId: string) => search.accessChanged(sessionId))
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          ctx.inject(['dshfilesToolAccess'], scoped => {
            const provider = scoped.get('dshfilesToolAccess')
            if (provider === undefined || provider === null) return
            void resolveAll()
            const unsubscribe = provider.subscribe(sessionId => void resolveOne(sessionId))
            scoped.effect(() => unsubscribe, 'tool-search: tool access provider')
          }),
        ),
        watcher => Effect.promise(() => watcher.dispose()),
      )
    }),
  )

/**
 * One registry per process, not per layer build: dshx may build the plugin layer more than once (host setup and
 * activation), and a per-build registry would let the provided service and the engine's closure disagree.
 */
const hostVisibility = makeToolSearchVisibility()

/** Agent parity for per-agent tool access: which agent decides the calling thread's tools, and what it allows. Read-only. */
const accessTool = Tool.make({
  name: TOOL_ACCESS_NAME,
  description:
    "Show the calling thread's agent, why it applies (its own agent, a per-thread override, the project's default agent or the built-in default), the tools it pins and the tools it disables. Read-only. Change it with the agents_* tool-access tools, only when the user asked.",
  input: Schema.Struct({}),
  output: accessOutputSchema,
  readOnly: true,
  render: renderAccess,
  execute: (_input, call) => ToolSearch.use(search => search.describeAccess(call.agent)),
})

export default DshxPlugin.make({
  name: '@dshfiles/tool-search',
  inject: ['agents', 'tools'],
  Config: configSchema,
  layer: config => Layer.provideMerge(attachAgents(hostVisibility), ToolSearch.layer(config, hostVisibility)),
  tools: [accessTool],
})
