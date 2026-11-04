import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import {
  LlmAdapter,
  LlmError,
  LlmRuntime,
  ReasoningEffortId,
  ToolCallId,
  createUserMessage,
  type GenerateOptions,
  type PreparedAdapterCall,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime, defineTool, type ToolOutputDefinition } from '@deepseek-ai/dsh-tools'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { CodexCredentialStore } from '@dshfiles/ai-accounts/codex-credential'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import toolSearch from './host.js'
import { serializedSchemaBytes } from './schema-measurement.js'

const providerBenchmarkEnabled = process.env.DSH_TOOL_SEARCH_PROVIDER_BENCHMARK === '1'
const benchmarkAccount = process.env.DSH_TOOL_SEARCH_BENCHMARK_ACCOUNT ?? 'codex-alex2'
const benchmarkModel = process.env.DSH_TOOL_SEARCH_BENCHMARK_MODEL ?? 'gpt-6-luna'
const benchmarkEffort = process.env.DSH_TOOL_SEARCH_BENCHMARK_EFFORT ?? 'high'
const benchmarkRepetitions = Number(process.env.DSH_TOOL_SEARCH_BENCHMARK_REPETITIONS ?? '2')
const benchmarkRequestBudget = Number(process.env.DSH_TOOL_SEARCH_BENCHMARK_REQUEST_BUDGET ?? '90')
const benchmarkOutputPath = process.env.DSH_TOOL_SEARCH_BENCHMARK_OUTPUT
const realCatalogPath = join(import.meta.dirname, '../../../../tooling/dshx/e2e/fixtures/tool-schemas.json')

interface ProviderRequestMeasurement {
  readonly toolNames: readonly string[]
  readonly schemaBytes: number
  readonly toolsTokens: number
  readonly contextTokens: number
  elapsedMs: number
  usage: TokenUsage | undefined
  finishKind: string | undefined
  calledTools: string[]
  searchQueries: string[]
  text: string
}

type BenchmarkToolArguments = { readonly path: string } | { readonly query: string } | { readonly path: string; readonly contents: string }

interface BenchmarkTask {
  readonly id: string
  readonly prompt: string
  readonly discoveryQuery: string
  readonly expectedTool: string
  readonly toolArguments: BenchmarkToolArguments
  readonly expectedAnswer: string
}

interface ExecutedCall {
  readonly name: string
  /** The call arguments as lowercase JSON, which is all a task compares. */
  readonly argumentText: string
}

type CallRecorder = (call: ExecutedCall) => void

const argumentTextOf = (args: BenchmarkToolArguments): string => JSON.stringify(args).toLowerCase()

interface ScenarioResult {
  readonly taskId: string
  readonly mode: 'direct' | 'progressive'
  readonly success: boolean
  readonly executedTools: readonly string[]
  readonly agentErrors: readonly string[]
  readonly requests: readonly ProviderRequestMeasurement[]
  readonly elapsedMs: number
}

const tasks: readonly BenchmarkTask[] = [
  {
    id: 'release-date',
    prompt: 'Read docs/release-notes.txt in the project and report the scheduled release date. Do not guess; the date is only in that file.',
    discoveryQuery: 'find the release schedule in the project notes file',
    expectedTool: 'read_project_file',
    toolArguments: { path: 'docs/release-notes.txt' },
    expectedAnswer: '2026-10-31',
  },
  {
    id: 'rollback-window',
    prompt: 'Find the rollback window in the project documentation and state the duration. Do not guess; the answer is only in the docs.',
    discoveryQuery: 'search the project documentation for the rollback window duration',
    expectedTool: 'search_project_docs',
    toolArguments: { query: 'rollback window' },
    expectedAnswer: '45 minutes',
  },
  {
    id: 'save-note',
    prompt: 'Save a project note at notes/tool-search.txt with the exact contents "Progressive tool search benchmark." Confirm after saving.',
    discoveryQuery: 'save text as a project note file',
    expectedTool: 'save_project_note',
    toolArguments: { path: 'notes/tool-search.txt', contents: 'Progressive tool search benchmark.' },
    expectedAnswer: '',
  },
]

const toolCallStream = (id: string, name: string, argumentsValue: string): StreamChunk[] => {
  const toolCallId = ToolCallId(id)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: toolCallId, name, argumentsDelta: argumentsValue },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: toolCallId, name, arguments: argumentsValue } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const textStream = (text: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
]

const measureRequest = (ctx: Context, options: GenerateOptions): ProviderRequestMeasurement => {
  if (options.sessionId === undefined) throw new Error('AgentLoop did not attach a session id.')
  const session = ctx.sessions.get(options.sessionId)
  if (session === undefined) throw new Error('AgentLoop session was not published.')
  const breakdown = ctx.sessionProjections.stateOf(session, 'contextBreakdown')
  if (breakdown === undefined) throw new Error('TokenMeter did not register contextBreakdown.')
  const tools = options.tools ?? []
  return {
    toolNames: tools.map(tool => tool.name).sort(),
    schemaBytes: serializedSchemaBytes(JSON.stringify(tools)),
    toolsTokens: breakdown.breakdown.toolsTokens,
    contextTokens: breakdown.breakdown.systemTokens + breakdown.breakdown.messageTokens + breakdown.breakdown.toolsTokens,
    elapsedMs: 0,
    usage: undefined,
    finishKind: undefined,
    calledTools: [],
    searchQueries: [],
    text: '',
  }
}

const searchQuerySchema = Schema.fromJsonString(Schema.Struct({ query: Schema.String }))

const observeChunk = (request: ProviderRequestMeasurement, chunk: StreamChunk): void => {
  if (chunk.type === 'usage') request.usage = chunk.usage
  if (chunk.type === 'finish') request.finishKind = chunk.reason.kind
  if (chunk.type === 'tool-call-delta' && chunk.name !== undefined && !request.calledTools.includes(chunk.name)) request.calledTools.push(chunk.name)
  if (chunk.type === 'text-delta') request.text += chunk.text
  if (chunk.type === 'block-end' && chunk.block.type === 'tool-call' && chunk.block.name === 'tool_search') {
    const decoded = Schema.decodeUnknownOption(searchQuerySchema)(chunk.block.arguments)
    if (decoded._tag === 'Some') request.searchQueries.push(decoded.value.query)
  }
}

class ScriptedBenchmarkAdapter extends LlmAdapter {
  readonly requests: ProviderRequestMeasurement[] = []
  private requestIndex = 0

  constructor(
    private readonly ctx: Context,
    private readonly task: BenchmarkTask,
    private readonly progressive: boolean,
  ) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.requestIndex >= (this.progressive ? 3 : 2)) throw new Error('Scripted benchmark request cap reached.')
    const request = measureRequest(this.ctx, options)
    this.requests.push(request)
    const startedAt = performance.now()
    const isSearchRequest = this.progressive && this.requestIndex === 0
    const isToolRequest = this.requestIndex === (this.progressive ? 1 : 0)
    this.requestIndex += 1
    const chunks = isSearchRequest
      ? toolCallStream('search-1', 'tool_search', JSON.stringify({ query: this.task.discoveryQuery, limit: 1 }))
      : isToolRequest
        ? toolCallStream('task-tool-1', this.task.expectedTool, JSON.stringify(this.task.toolArguments))
        : textStream(this.task.expectedAnswer || 'Saved.')

    try {
      for (const chunk of chunks) {
        observeChunk(request, chunk)
        yield chunk
      }
    } finally {
      request.elapsedMs = Math.round(performance.now() - startedAt)
    }
  }
}

const accountsFileSchema = Schema.Struct({
  accounts: Schema.Array(
    Schema.Struct({
      instanceId: Schema.String,
      kind: Schema.String,
      homePath: Schema.optional(Schema.String),
      shadowHomePath: Schema.optional(Schema.String),
    }),
  ),
})

/** The account's Codex home exactly as ai-accounts stores it; credentials stay in that home and are read only in-process. */
const benchmarkCodexLayout = () => {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const file = Schema.decodeUnknownSync(Schema.fromJsonString(accountsFileSchema))(readFileSync(join(dshHome, 'plugins/ai-accounts/accounts.json'), 'utf8'))
  const account = file.accounts.find(candidate => candidate.instanceId === benchmarkAccount)
  if (account === undefined || account.kind !== 'codex')
    throw new Error(`No Codex account '${benchmarkAccount}' in ai-accounts. Set DSH_TOOL_SEARCH_BENCHMARK_ACCOUNT.`)
  return CodexCredentialStore.resolveLayout({ homePath: account.homePath ?? '', shadowHomePath: account.shadowHomePath ?? '' })
}

const createCodexProfile = (): ResolvedPiAiProviderProfile => {
  const upstream = openaiCodexProvider()
  const displayName = `Codex ${benchmarkAccount}`
  const models = upstream
    .getModels()
    .filter(candidate => candidate.id === benchmarkModel)
    .map(candidate => ({ ...candidate, provider: benchmarkAccount }))
  if (models.length === 0) throw new Error(`Codex does not offer '${benchmarkModel}'.`)

  return {
    provider: benchmarkAccount,
    displayName,
    transport: 'sse',
    streamIdleTimeoutMs: 300_000,
    maxRequestImageBytes: 20_971_520,
    requestImagePixelBudget: 4_194_304,
    requestImageMaxBytes: 1_048_576,
    retryPolicy: {
      mode: 'normal',
      maxRetries: 0,
      retryableCodes: [],
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    },
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
    piProvider: { ...upstream, id: benchmarkAccount, name: displayName, getModels: () => models },
  }
}

class RequestBudget {
  used = 0
  constructor(readonly limit: number) {}
  get exhausted(): boolean {
    return this.used >= this.limit
  }
}

/** Authenticates through ai-accounts' Codex credential store, the same read/refresh path the live Host uses. */
class MeasuredCodexAdapter extends PiAiAdapter {
  readonly requests: ProviderRequestMeasurement[] = []
  private readonly ctx: Context
  private readonly maximumRequests: number
  private readonly budget: RequestBudget

  constructor(input: { readonly ctx: Context; readonly maximumRequests: number; readonly budget: RequestBudget }) {
    const profiles = new Map([[benchmarkAccount, createCodexProfile()]])
    const credentialStore = CodexCredentialStore.forLayout(benchmarkCodexLayout())
    super({
      profiles: () => profiles,
      resolveApiKey: async () => undefined,
      auth: {
        credentials: {
          read: async provider => (provider === benchmarkAccount ? credentialStore.read() : undefined),
          list: async () => [{ providerId: benchmarkAccount, type: 'oauth' as const }],
          modify: async (provider, mutate) => {
            if (provider !== benchmarkAccount) throw new LlmError('Only the benchmark Codex account is configured.', 'UNSUPPORTED_OPERATION')
            return credentialStore.modify(mutate)
          },
          delete: async () => {
            throw new LlmError('Codex credentials are owned by Codex CLI', 'UNSUPPORTED_OPERATION')
          },
        },
        authContext: { env: async () => undefined, fileExists: async () => false },
      },
    })
    this.ctx = input.ctx
    this.maximumRequests = input.maximumRequests
    this.budget = input.budget
  }

  override async prepareCall(providerName: string, modelName: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(providerName, modelName, signal)
    return {
      ...prepared,
      stream: options => this.measureStream(options, prepared.stream),
    }
  }

  private async *measureStream(options: GenerateOptions, dispatch: (options: GenerateOptions) => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    if (this.requests.length >= this.maximumRequests) throw new Error('Provider benchmark per-scenario request cap reached.')
    if (this.budget.exhausted) throw new Error('Provider benchmark total request budget reached.')
    const request = measureRequest(this.ctx, options)
    this.requests.push(request)
    this.budget.used += 1
    const startedAt = performance.now()

    try {
      for await (const chunk of dispatch({ ...options, reasoningEffort: ReasoningEffortId(benchmarkEffort) })) {
        observeChunk(request, chunk)
        yield chunk
      }
    } finally {
      request.elapsedMs = Math.round(performance.now() - startedAt)
    }
  }
}

const textOutput: ToolOutputDefinition = {
  schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

const registerSyntheticTools = (ctx: Context, record: CallRecorder, savedNotes: { path: string; contents: string }[], decoyCount: number): void => {
  ctx.tools.register(
    defineTool({
      name: 'read_project_file',
      description: 'Read a text file from the current project to inspect its contents.',
      parameters: { path: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false },
        render: (_args, result) => [{ type: 'text', text: result.text ?? '' }],
      },
      execute: async args => {
        record({ name: 'read_project_file', argumentText: argumentTextOf(args) })
        return { text: args.path === 'docs/release-notes.txt' ? 'Scheduled release date: 2026-10-31.' : 'File not found.' }
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'search_project_docs',
      description: 'Search local project documentation for a policy or procedure.',
      parameters: { query: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false },
        render: (_args, result) => [{ type: 'text', text: result.text ?? '' }],
      },
      execute: async args => {
        record({ name: 'search_project_docs', argumentText: argumentTextOf(args) })
        return { text: 'Deployment policy: rollback window is 45 minutes.' }
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'save_project_note',
      description: 'Save text to a note file in the current project.',
      parameters: {
        path: { type: 'string', required: true },
        contents: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'object', properties: { saved: { type: 'boolean' } }, additionalProperties: false },
        render: (_args, result) => [{ type: 'text', text: result.saved ? 'Saved.' : 'Not saved.' }],
      },
      execute: async args => {
        record({ name: 'save_project_note', argumentText: argumentTextOf(args) })
        savedNotes.push({ path: args.path, contents: args.contents })
        return { saved: true }
      },
    }),
  )

  const fixedDecoys: readonly [string, string][] = [
    ['inspect_dependency_graph', 'Inspect the local dependency graph for package relationships.'],
    ['calculate_date_range', 'Calculate the number of days between two dates.'],
    ['list_incident_reports', 'List synthetic incident reports by severity.'],
    ['read_access_matrix', 'Read the access-control matrix for project roles.'],
    ['format_json_payload', 'Format and validate a JSON payload.'],
  ]
  const generatedDecoys = Array.from({ length: Math.max(0, decoyCount - fixedDecoys.length) }, (_, index): readonly [string, string] => {
    const ordinal = String(index + fixedDecoys.length + 1).padStart(3, '0')
    return [`inspect_catalog_${ordinal}`, `Inspect synthetic catalog segment ${ordinal} for unrelated diagnostic data.`]
  })

  for (const [name, description] of [...fixedDecoys, ...generatedDecoys].slice(0, decoyCount)) {
    ctx.tools.register(
      defineTool({
        name,
        description,
        parameters: { query: { type: 'string', required: true } },
        output: {
          schema: { type: 'object', properties: { result: { type: 'string' } }, additionalProperties: false },
          render: (_args, result) => [{ type: 'text', text: result.result ?? '' }],
        },
        execute: async args => {
          record({ name, argumentText: argumentTextOf(args) })
          return { result: `No matching synthetic data for ${args.query}.` }
        },
      }),
    )
  }
}

const realCatalogSchema = Schema.Struct({
  schemas: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String, parameters: Schema.Record(Schema.String, Schema.Unknown) })),
})

/** 335 real tool schemas the owned web-profile bundles register; every tool answers from in-memory fixtures. */
const realToolSchemas = () => Schema.decodeUnknownSync(Schema.fromJsonString(realCatalogSchema))(readFileSync(realCatalogPath, 'utf8')).schemas

const registerRealTools = (ctx: Context, record: CallRecorder, fixtures: ReadonlyMap<string, string>): void => {
  for (const schema of realToolSchemas()) {
    ctx.tools.register({
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
      output: textOutput,
      execute: async args => {
        record({ name: schema.name, argumentText: JSON.stringify(args ?? {}).toLowerCase() })
        return { result: fixtures.get(schema.name) ?? 'No matching data.' }
      },
    })
  }
}

type BenchmarkCatalog = { readonly kind: 'synthetic'; readonly decoyCount: number } | { readonly kind: 'real' }

const catalogLabel = (catalog: BenchmarkCatalog): string => (catalog.kind === 'real' ? 'real-335' : `synthetic-${catalog.decoyCount + 3}`)

const setupBenchmarkContext = async (input: {
  readonly ctx: Context
  readonly progressive: boolean
  readonly toolSearchConfig: { readonly maxResults?: number }
  readonly registerTools: () => void
}): Promise<void> => {
  const ctx = input.ctx
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    personaPrefix: 'Use only the provided tools to answer. Do not guess or fabricate facts.',
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop)

  input.registerTools()
  if (input.progressive) {
    if (toolSearch.setup === undefined) throw new Error('Tool-search Host setup is missing.')
    await ctx.plugin({ ...toolSearch, apply: toolSearch.setup }, input.toolSearchConfig)
  }
}

const runScriptedScenario = async (task: BenchmarkTask, progressive: boolean, decoyCount = 5): Promise<ScenarioResult> => {
  const ctx = new Context()
  const executedTools: string[] = []
  const agentErrors: string[] = []
  const savedNotes: { path: string; contents: string }[] = []
  ctx.on('agent/error', event => {
    agentErrors.push(event.error instanceof LlmError ? event.error.code : event.error instanceof Error ? event.error.name : 'unknown')
  })
  let disposeAgent: (() => Promise<void>) | undefined
  const startedAt = performance.now()

  try {
    await setupBenchmarkContext({
      ctx,
      progressive,
      toolSearchConfig: { maxResults: 1 },
      registerTools: () => registerSyntheticTools(ctx, call => executedTools.push(call.name), savedNotes, decoyCount),
    })

    const adapter = new ScriptedBenchmarkAdapter(ctx, task, progressive)
    ctx.llm.registerAdapter(['tool-search-local'], adapter)

    const mode = progressive ? 'progressive' : 'direct'
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-search-local-${mode}-${task.id}`),
      agentOptions: { provider: 'tool-search-local', model: 'scripted' },
    })
    disposeAgent = () => handle.dispose()
    await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: task.prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    const finalText = adapter.requests.findLast(request => request.finishKind === 'stop')?.text.toLowerCase() ?? ''
    const noteSaved =
      task.expectedTool !== 'save_project_note' ||
      savedNotes.some(note => note.path === 'notes/tool-search.txt' && note.contents === 'Progressive tool search benchmark.')
    const success =
      agentErrors.length === 0 &&
      executedTools.length === 1 &&
      executedTools[0] === task.expectedTool &&
      noteSaved &&
      (task.expectedAnswer.length === 0 || finalText.includes(task.expectedAnswer.toLowerCase()))

    return {
      taskId: task.id,
      mode,
      success,
      executedTools: [...executedTools],
      agentErrors: [...agentErrors],
      requests: [...adapter.requests],
      elapsedMs: Math.round(performance.now() - startedAt),
    }
  } finally {
    await disposeAgent?.()
    await ctx.fiber.dispose()
  }
}

const localResultSummary = (result: ScenarioResult) => ({
  taskId: result.taskId,
  mode: result.mode,
  success: result.success,
  executedTools: result.executedTools,
  requestCount: result.requests.length,
  totalToolSchemaBytes: result.requests.reduce((total, request) => total + request.schemaBytes, 0),
  cumulativeToolTokenEstimate: result.requests.reduce((total, request) => total + request.toolsTokens, 0),
  cumulativeContextTokenEstimate: result.requests.reduce((total, request) => total + request.contextTokens, 0),
  requests: result.requests.map(({ toolNames, schemaBytes, toolsTokens, contextTokens, calledTools }) => ({
    toolNames,
    schemaBytes,
    toolsTokens,
    contextTokens,
    calledTools,
  })),
})

describe('tool-search local schema benchmark', () => {
  it('compares three synthetic tasks across eight tools without provider calls', async () => {
    const results: ScenarioResult[] = []
    for (const task of tasks) {
      results.push(await runScriptedScenario(task, false))
      results.push(await runScriptedScenario(task, true))
    }

    if (process.env.DSH_TOOL_SEARCH_MEASURE === '1') console.info(JSON.stringify(results.map(localResultSummary)))
    expect(results).toHaveLength(tasks.length * 2)
    expect(results.every(result => result.success)).toBe(true)

    for (const [taskIndex, task] of tasks.entries()) {
      const direct = results[taskIndex * 2]
      const progressive = results[taskIndex * 2 + 1]
      expect(direct?.mode).toBe('direct')
      expect(direct?.requests).toHaveLength(2)
      expect(direct?.requests.every(request => request.toolNames.length === 8)).toBe(true)
      expect(direct?.requests.every(request => request.contextTokens >= request.toolsTokens)).toBe(true)
      expect(progressive?.mode).toBe('progressive')
      expect(progressive?.requests).toHaveLength(3)
      expect(progressive?.requests.every(request => request.contextTokens >= request.toolsTokens)).toBe(true)
      expect(progressive?.requests[0]?.toolNames).toEqual(['tool_search'])
      const expectedVisibleTools = ['tool_search', task.expectedTool].sort()
      expect(progressive?.requests[1]?.toolNames).toEqual(expectedVisibleTools)
      expect(progressive?.requests[2]?.toolNames).toEqual(expectedVisibleTools)
    }
  })

  it('measures context savings across three tasks at a 603-tool scale without provider calls', async () => {
    const decoyCount = 600
    const scenarios: { task: BenchmarkTask; direct: ScenarioResult; progressive: ScenarioResult }[] = []
    for (const task of tasks) {
      const direct = await runScriptedScenario(task, false, decoyCount)
      const progressive = await runScriptedScenario(task, true, decoyCount)
      scenarios.push({ task, direct, progressive })
    }

    const summarize = (results: ScenarioResult[]) => ({
      successCount: results.filter(result => result.success).length,
      requestCount: results.reduce((total, result) => total + result.requests.length, 0),
      totalToolSchemaBytes: results.reduce(
        (total, result) => total + result.requests.reduce((requestTotal, request) => requestTotal + request.schemaBytes, 0),
        0,
      ),
      cumulativeToolTokenEstimate: results.reduce(
        (total, result) => total + result.requests.reduce((requestTotal, request) => requestTotal + request.toolsTokens, 0),
        0,
      ),
      cumulativeContextTokenEstimate: results.reduce(
        (total, result) => total + result.requests.reduce((requestTotal, request) => requestTotal + request.contextTokens, 0),
        0,
      ),
      requests: results.flatMap(result =>
        result.requests.map(request => ({
          taskId: result.taskId,
          toolCount: request.toolNames.length,
          schemaBytes: request.schemaBytes,
          toolsTokens: request.toolsTokens,
          contextTokens: request.contextTokens,
        })),
      ),
    })
    const directResults = scenarios.map(scenario => scenario.direct)
    const progressiveResults = scenarios.map(scenario => scenario.progressive)
    const directSummary = summarize(directResults)
    const progressiveSummary = summarize(progressiveResults)

    if (process.env.DSH_TOOL_SEARCH_MEASURE === '1') {
      console.info(
        JSON.stringify({
          catalogToolCount: decoyCount + 3,
          taskOutcomes: scenarios.map(({ task, direct, progressive }) => ({
            taskId: task.id,
            directSuccess: direct.success,
            progressiveSuccess: progressive.success,
          })),
          direct: directSummary,
          progressive: progressiveSummary,
        }),
      )
    }

    expect(scenarios).toHaveLength(tasks.length)
    expect(directSummary.successCount).toBe(tasks.length)
    expect(progressiveSummary.successCount).toBe(tasks.length)
    for (const { task, direct, progressive } of scenarios) {
      expect(direct.requests).toHaveLength(2)
      expect(direct.requests.every(request => request.toolNames.length === decoyCount + 3)).toBe(true)
      expect(progressive.requests).toHaveLength(3)
      expect(progressive.requests[0]?.toolNames).toEqual(['tool_search'])
      const expectedVisibleTools = ['tool_search', task.expectedTool].sort()
      expect(progressive.requests.slice(1).every(request => request.toolNames.length === 2)).toBe(true)
      expect(progressive.requests[1]?.toolNames).toEqual(expectedVisibleTools)
      expect(progressive.requests[2]?.toolNames).toEqual(expectedVisibleTools)
    }
    expect(progressiveSummary.cumulativeToolTokenEstimate).toBeLessThan(directSummary.cumulativeToolTokenEstimate)
    expect(progressiveSummary.cumulativeContextTokenEstimate).toBeLessThan(directSummary.cumulativeContextTokenEstimate)
  }, 30_000)

  it('loads every real catalog schema as a registrable tool', () => {
    const schemas = realToolSchemas()
    expect(schemas.length).toBeGreaterThanOrEqual(300)
    for (const task of realTasks) for (const name of task.acceptedTools) expect(schemas.some(schema => schema.name === name)).toBe(true)
  })
})

interface ProviderTask {
  readonly id: string
  readonly prompt: string
  readonly acceptedTools: readonly string[]
  readonly acceptsArguments: (argumentText: string) => boolean
  readonly expectedAnswer: string
}

const anyArguments = () => true

/** Phrased by intent: no prompt names its tool, so each must be found by meaning. */
const realTasks: readonly ProviderTask[] = [
  {
    id: 'running-jobs',
    prompt: 'Is anything still running in the background across all my threads right now? Name each running job.',
    acceptedTools: ['background_jobs_board'],
    acceptsArguments: anyArguments,
    expectedAnswer: 'vitest-shard-7',
  },
  {
    id: 'capture-bug',
    prompt: 'Note this for later in my task tracker, do not fix it now: bug — the sidebar flickers when the browser window is resized. Tell me the id it got.',
    acceptedTools: ['backlog_capture'],
    acceptsArguments: argumentText => argumentText.includes('flicker'),
    expectedAnswer: '4242',
  },
  {
    id: 'subscription-left',
    prompt: 'How much of my ChatGPT subscription allowance is left this week?',
    acceptedTools: ['ai_accounts_quota', 'ai_accounts_refresh_quota'],
    acceptsArguments: anyArguments,
    expectedAnswer: '37',
  },
  {
    id: 'frequent-failure',
    prompt: 'Something in the harness keeps failing over the last hour. Group the recent failures and tell me which error is the most frequent.',
    acceptedTools: ['traces_error_groups'],
    acceptsArguments: anyArguments,
    expectedAnswer: 'econnreset',
  },
  {
    id: 'earlier-discussion',
    prompt: 'Did we already talk about migrating the rate limiter in an earlier conversation? What did we decide?',
    acceptedTools: ['find_threads', 'memory_search'],
    acceptsArguments: argumentText => argumentText.includes('rate'),
    expectedAnswer: 'token bucket',
  },
  {
    id: 'remote-machines',
    prompt: 'Which remote machines can I run threads on, and which of them currently has a connection problem?',
    acceptedTools: ['multi_host_list'],
    acceptsArguments: anyArguments,
    expectedAnswer: 'gpu-box',
  },
]

const quotaFixture = 'Codex Alex2: weekly window 37% remaining, resets 2026-11-07; 5-hour window 82% remaining.'
const earlierThreadFixture = "Thread 'Rate limiter token bucket rewrite' (2026-10-02): decided to migrate the rate limiter to a token bucket per account."
const realFixtures = new Map<string, string>(
  Object.entries({
    background_jobs_board: "2 running jobs: 'vitest-shard-7' (tests, thread Sidebar rework, 4m12s); 'tsc-watch' (typecheck, thread Tool search, 31m).",
    backlog_capture: 'Captured b:4242 (bug, inbox).',
    ai_accounts_quota: quotaFixture,
    ai_accounts_refresh_quota: quotaFixture,
    traces_error_groups: '1) service jj, span "jj fetch", error ECONNRESET: 14 errors. 2) service llm, span "chat", error TIMEOUT: 3 errors.',
    find_threads: earlierThreadFixture,
    memory_search: earlierThreadFixture,
    multi_host_list: 'mac-mini: runtime connected. gpu-box: runtime disconnected (last error: ssh timeout).',
  }),
)

const syntheticProviderTask = (task: BenchmarkTask): ProviderTask => ({
  id: task.id,
  prompt: task.prompt,
  acceptedTools: [task.expectedTool],
  acceptsArguments: argumentText => task.expectedTool !== 'save_project_note' || argumentText === argumentTextOf(task.toolArguments),
  expectedAnswer: task.expectedAnswer,
})

interface ProviderScenarioResult {
  readonly catalog: string
  readonly taskId: string
  readonly repetition: number
  readonly mode: 'direct' | 'progressive'
  readonly success: boolean
  readonly acceptedCallFound: boolean
  readonly answerFound: boolean
  readonly executedTools: readonly string[]
  readonly searchQueries: readonly string[]
  readonly wrongToolCalls: number
  readonly agentErrors: readonly string[]
  readonly requests: readonly ProviderRequestMeasurement[]
  readonly elapsedMs: number
  readonly finalTextExcerpt: string
}

const runProviderScenario = async (input: {
  readonly catalog: BenchmarkCatalog
  readonly task: ProviderTask
  readonly progressive: boolean
  readonly repetition: number
  readonly budget: RequestBudget
}): Promise<ProviderScenarioResult> => {
  const ctx = new Context()
  const calls: ExecutedCall[] = []
  const agentErrors: string[] = []
  const savedNotes: { path: string; contents: string }[] = []
  ctx.on('agent/error', event => {
    agentErrors.push(event.error instanceof LlmError ? event.error.code : event.error instanceof Error ? event.error.message.slice(0, 160) : 'unknown')
  })
  let disposeAgent: (() => Promise<void>) | undefined
  const mode = input.progressive ? 'progressive' : 'direct'
  const record: CallRecorder = call => calls.push(call)
  const startedAt = performance.now()

  try {
    await setupBenchmarkContext({
      ctx,
      progressive: input.progressive,
      toolSearchConfig: {},
      registerTools: () =>
        input.catalog.kind === 'real'
          ? registerRealTools(ctx, record, realFixtures)
          : registerSyntheticTools(ctx, record, savedNotes, input.catalog.decoyCount),
    })

    const adapter = new MeasuredCodexAdapter({ ctx, maximumRequests: input.progressive ? 6 : 4, budget: input.budget })
    const routedModel = await adapter.resolveModel(benchmarkAccount, benchmarkModel)
    if (!routedModel.reasoning?.efforts.some(effort => effort.id === benchmarkEffort))
      throw new Error(`'${benchmarkModel}' does not expose ${benchmarkEffort} reasoning.`)
    ctx.llm.registerAdapter([benchmarkAccount], adapter)

    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-search-codex-${catalogLabel(input.catalog)}-${mode}-${input.task.id}-${input.repetition}-${Date.now()}`),
      agentOptions: { provider: benchmarkAccount, model: benchmarkModel, reasoningEffort: ReasoningEffortId(benchmarkEffort) },
    })
    disposeAgent = () => handle.dispose()
    await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: input.task.prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    const finalText = adapter.requests.findLast(request => request.finishKind === 'stop')?.text ?? ''
    const acceptedCallFound = calls.some(call => input.task.acceptedTools.includes(call.name) && input.task.acceptsArguments(call.argumentText))
    const answerFound = input.task.expectedAnswer.length === 0 || finalText.toLowerCase().includes(input.task.expectedAnswer.toLowerCase())
    return {
      catalog: catalogLabel(input.catalog),
      taskId: input.task.id,
      repetition: input.repetition,
      mode,
      success: agentErrors.length === 0 && acceptedCallFound && answerFound,
      acceptedCallFound,
      answerFound,
      executedTools: calls.map(call => call.name),
      searchQueries: adapter.requests.flatMap(request => request.searchQueries),
      wrongToolCalls: calls.filter(call => !input.task.acceptedTools.includes(call.name)).length,
      agentErrors: [...agentErrors],
      requests: [...adapter.requests],
      elapsedMs: Math.round(performance.now() - startedAt),
      finalTextExcerpt: finalText.slice(0, 240),
    }
  } finally {
    await disposeAgent?.()
    await ctx.fiber.dispose()
  }
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : sum(values) / values.length)
const standardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(sum(values.map(value => (value - average) ** 2)) / (values.length - 1))
}

const scenarioTotals = (result: ProviderScenarioResult) => ({
  requests: result.requests.length,
  inputTokens: sum(result.requests.map(request => request.usage?.inputTokens ?? 0)),
  cacheReadTokens: sum(result.requests.map(request => request.usage?.cacheReadTokens ?? 0)),
  outputTokens: sum(result.requests.map(request => request.usage?.outputTokens ?? 0)),
  reasoningTokens: sum(result.requests.map(request => request.usage?.reasoningTokens ?? 0)),
  schemaBytes: sum(result.requests.map(request => request.schemaBytes)),
  modelLatencyMs: sum(result.requests.map(request => request.elapsedMs)),
})

const aggregate = (results: readonly ProviderScenarioResult[]) => {
  const totals = results.map(scenarioTotals)
  const stat = (pick: (value: ReturnType<typeof scenarioTotals>) => number) => {
    const values = totals.map(pick)
    return { mean: Math.round(mean(values)), sd: Math.round(standardDeviation(values)), total: sum(values) }
  }
  return {
    scenarios: results.length,
    successes: results.filter(result => result.success).length,
    wrongToolCalls: sum(results.map(result => result.wrongToolCalls)),
    failures: results.flatMap(result =>
      result.success ? [] : [{ taskId: result.taskId, repetition: result.repetition, errors: result.agentErrors, executed: result.executedTools }],
    ),
    requests: stat(value => value.requests),
    inputTokens: stat(value => value.inputTokens),
    cacheReadTokens: stat(value => value.cacheReadTokens),
    outputTokens: stat(value => value.outputTokens),
    reasoningTokens: stat(value => value.reasoningTokens),
    schemaBytes: stat(value => value.schemaBytes),
    modelLatencyMs: stat(value => value.modelLatencyMs),
  }
}

const isFatalAuthFailure = (result: ProviderScenarioResult): boolean =>
  result.agentErrors.some(code => code === 'AUTH' || code === 'MISSING_CREDENTIAL' || code === 'INVALID_CREDENTIAL' || code === 'QUOTA_EXCEEDED')

describe.skipIf(!providerBenchmarkEnabled)('tool-search Codex provider benchmark', () => {
  it('compares direct and progressive discovery on synthetic and real tool catalogs', async () => {
    const budget = new RequestBudget(benchmarkRequestBudget)
    const plan: { readonly catalog: BenchmarkCatalog; readonly task: ProviderTask; readonly repetition: number }[] = [
      ...Array.from({ length: benchmarkRepetitions }, (_, repetition) =>
        realTasks.map(task => ({ catalog: { kind: 'real' } as const, task, repetition })),
      ).flat(),
      ...tasks.slice(0, 2).map(task => ({ catalog: { kind: 'synthetic', decoyCount: 600 } as const, task: syntheticProviderTask(task), repetition: 0 })),
      ...tasks.slice(0, 2).map(task => ({ catalog: { kind: 'synthetic', decoyCount: 5 } as const, task: syntheticProviderTask(task), repetition: 0 })),
    ]
    const results: ProviderScenarioResult[] = []
    const skipped: string[] = []
    let stopReason: string | undefined

    for (const entry of plan) {
      for (const progressive of entry.repetition % 2 === 0 ? [false, true] : [true, false]) {
        const label = `${catalogLabel(entry.catalog)}/${entry.task.id}/${entry.repetition}/${progressive ? 'progressive' : 'direct'}`
        if (stopReason !== undefined || budget.limit - budget.used < (progressive ? 3 : 2)) {
          skipped.push(label)
          continue
        }
        const result = await runProviderScenario({ ...entry, progressive, budget })
        results.push(result)
        console.info(
          JSON.stringify({
            label,
            success: result.success,
            requests: result.requests.length,
            executed: result.executedTools,
            errors: result.agentErrors,
            ms: result.elapsedMs,
          }),
        )
        if (isFatalAuthFailure(result)) stopReason = `fatal provider failure: ${result.agentErrors.join(', ')}`
      }
    }

    const catalogs = [...new Set(results.map(result => result.catalog))]
    const report = {
      route: { provider: benchmarkAccount, model: benchmarkModel, reasoningEffort: benchmarkEffort },
      providerRequests: budget.used,
      stopReason,
      skipped,
      byCatalog: Object.fromEntries(
        catalogs.map(catalog => [
          catalog,
          {
            direct: aggregate(results.filter(result => result.catalog === catalog && result.mode === 'direct')),
            progressive: aggregate(results.filter(result => result.catalog === catalog && result.mode === 'progressive')),
          },
        ]),
      ),
      scenarios: results.map(result => ({
        ...result,
        totals: scenarioTotals(result),
        requests: result.requests.map(request => ({
          toolCount: request.toolNames.length,
          visibleTaskTools: request.toolNames.length <= 12 ? request.toolNames : undefined,
          schemaBytes: request.schemaBytes,
          toolsTokens: request.toolsTokens,
          contextTokens: request.contextTokens,
          elapsedMs: request.elapsedMs,
          calledTools: request.calledTools,
          finishKind: request.finishKind,
          usage: request.usage ?? null,
        })),
      })),
    }
    if (benchmarkOutputPath !== undefined) writeFileSync(benchmarkOutputPath, `${JSON.stringify(report, null, 2)}\n`)
    console.info(JSON.stringify({ providerRequests: report.providerRequests, stopReason, skipped: skipped.length, byCatalog: report.byCatalog }))
    expect(stopReason).toBeUndefined()
    expect(results.length).toBeGreaterThan(0)
  }, 3_600_000)
})
