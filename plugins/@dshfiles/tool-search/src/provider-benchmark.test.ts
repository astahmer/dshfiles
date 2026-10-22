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
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'
import toolSearch from './host.js'
import { serializedSchemaBytes } from './schema-measurement.js'

const provider = 'opencode-go-alex'
const model = 'deepseek-v4.1-flash'
const providerBenchmarkEnabled = process.env.DSH_TOOL_SEARCH_PROVIDER_BENCHMARK === '1'

interface ProviderRequestMeasurement {
  readonly toolNames: readonly string[]
  readonly schemaBytes: number
  readonly toolsTokens: number
  readonly contextTokens: number
  elapsedMs: number
  usage: TokenUsage | undefined
  finishKind: string | undefined
  calledTools: string[]
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
    if (options.sessionId === undefined) throw new Error('AgentLoop did not attach a session id.')
    if (this.requestIndex >= (this.progressive ? 3 : 2)) throw new Error('Scripted benchmark request cap reached.')
    const session = this.ctx.sessions.get(options.sessionId)
    if (session === undefined) throw new Error('AgentLoop session was not published.')
    const breakdown = this.ctx.sessionProjections.stateOf(session, 'contextBreakdown')
    if (breakdown === undefined) throw new Error('TokenMeter did not register contextBreakdown.')

    const tools = options.tools ?? []
    const request: ProviderRequestMeasurement = {
      toolNames: tools.map(tool => tool.name).sort(),
      schemaBytes: serializedSchemaBytes(JSON.stringify(tools)),
      toolsTokens: breakdown.breakdown.toolsTokens,
      contextTokens: breakdown.breakdown.systemTokens + breakdown.breakdown.messageTokens + breakdown.breakdown.toolsTokens,
      elapsedMs: 0,
      usage: undefined,
      finishKind: undefined,
      calledTools: [],
      text: '',
    }
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
        if (chunk.type === 'finish') request.finishKind = chunk.reason.kind
        if (chunk.type === 'tool-call-delta' && chunk.name !== undefined && !request.calledTools.includes(chunk.name)) request.calledTools.push(chunk.name)
        if (chunk.type === 'text-delta') request.text += chunk.text
        yield chunk
      }
    } finally {
      request.elapsedMs = Math.round(performance.now() - startedAt)
    }
  }
}

const createProviderProfile = (): ResolvedPiAiProviderProfile => {
  const upstream = opencodeGoProvider()
  const displayName = 'OpenCode Go Alex'
  const models = upstream
    .getModels()
    .filter(candidate => candidate.id === model)
    .map(candidate => ({ ...candidate, provider, name: candidate.name }))

  return {
    provider,
    displayName,
    transport: 'sse',
    streamIdleTimeoutMs: 120_000,
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
    piProvider: { ...upstream, id: provider, name: displayName, getModels: () => models },
  }
}

class MeasuredOpenCodeGoAdapter extends PiAiAdapter {
  readonly requests: ProviderRequestMeasurement[] = []
  private readonly ctx: Context
  private readonly maximumRequests: number

  constructor(ctx: Context, maximumRequests: number) {
    const profiles = new Map([[provider, createProviderProfile()]])
    super({
      profiles: () => profiles,
      resolveApiKey: async requestedProvider => {
        if (requestedProvider !== provider) return undefined
        const key = process.env.OPENCODE_GO_ALEX
        if (key === undefined || key.trim().length === 0) throw new Error('The OPENCODE_GO_ALEX environment alias is missing.')
        return key
      },
      auth: {
        credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => undefined },
        authContext: { env: async () => undefined, fileExists: async () => false },
      },
    })
    this.ctx = ctx
    this.maximumRequests = maximumRequests
  }

  override async prepareCall(providerName: string, modelName: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(providerName, modelName, signal)
    return {
      ...prepared,
      stream: options => this.measureStream(options, prepared.stream),
    }
  }

  private async *measureStream(options: GenerateOptions, dispatch: (options: GenerateOptions) => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    if (this.requests.length >= this.maximumRequests) throw new Error('Provider benchmark request cap reached.')
    if (options.sessionId === undefined) throw new Error('AgentLoop did not attach a session id.')
    const session = this.ctx.sessions.get(options.sessionId)
    if (session === undefined) throw new Error('AgentLoop session was not published.')
    const breakdown = this.ctx.sessionProjections.stateOf(session, 'contextBreakdown')
    if (breakdown === undefined) throw new Error('TokenMeter did not register contextBreakdown.')

    const tools = options.tools ?? []
    const request: ProviderRequestMeasurement = {
      toolNames: tools.map(tool => tool.name).sort(),
      schemaBytes: serializedSchemaBytes(JSON.stringify(tools)),
      toolsTokens: breakdown.breakdown.toolsTokens,
      contextTokens: breakdown.breakdown.systemTokens + breakdown.breakdown.messageTokens + breakdown.breakdown.toolsTokens,
      elapsedMs: 0,
      usage: undefined,
      finishKind: undefined,
      calledTools: [],
      text: '',
    }
    this.requests.push(request)
    const startedAt = performance.now()

    try {
      const boundedOptions = { ...options, reasoningEffort: ReasoningEffortId('high'), maxTokens: Math.min(options.maxTokens ?? 1_024, 1_024) }
      for await (const chunk of dispatch(boundedOptions)) {
        if (chunk.type === 'usage') request.usage = chunk.usage
        if (chunk.type === 'finish') request.finishKind = chunk.reason.kind
        if (chunk.type === 'tool-call-delta' && chunk.name !== undefined && !request.calledTools.includes(chunk.name)) request.calledTools.push(chunk.name)
        if (chunk.type === 'text-delta') request.text += chunk.text
        yield chunk
      }
    } finally {
      request.elapsedMs = Math.round(performance.now() - startedAt)
    }
  }
}

const registerBenchmarkTools = (ctx: Context, executedTools: string[], savedNotes: { path: string; contents: string }[], decoyCount = 5): void => {
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
        executedTools.push('read_project_file')
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
      execute: async () => {
        executedTools.push('search_project_docs')
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
        executedTools.push('save_project_note')
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
          executedTools.push(name)
          return { result: `No matching synthetic data for ${args.query}.` }
        },
      }),
    )
  }
}

const setupBenchmarkContext = async ({
  ctx,
  executedTools,
  savedNotes,
  progressive,
  decoyCount = 5,
}: {
  readonly ctx: Context
  readonly executedTools: string[]
  readonly savedNotes: { path: string; contents: string }[]
  readonly progressive: boolean
  readonly decoyCount?: number
}): Promise<void> => {
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    personaPrefix: 'Use only the synthetic project tools. Do not guess or fabricate facts.',
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop)

  registerBenchmarkTools(ctx, executedTools, savedNotes, decoyCount)
  if (progressive) {
    if (toolSearch.setup === undefined) throw new Error('Tool-search Host setup is missing.')
    await ctx.plugin({ ...toolSearch, apply: toolSearch.setup }, { maxResults: 1 })
  }
}

const runScenario = async (task: BenchmarkTask, progressive: boolean): Promise<ScenarioResult> => {
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
    await setupBenchmarkContext({ ctx, executedTools, savedNotes, progressive })

    const adapter = new MeasuredOpenCodeGoAdapter(ctx, progressive ? 4 : 3)
    const routedModel = await adapter.resolveModel(provider, model)
    if (!routedModel.reasoning?.efforts.some(effort => effort.id === 'high')) throw new Error('The selected model does not expose high reasoning effort.')
    ctx.llm.registerAdapter([provider], adapter)

    const mode = progressive ? 'progressive' : 'direct'
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-search-benchmark-${mode}-${task.id}`),
      agentOptions: { provider, model, reasoningEffort: ReasoningEffortId('high') },
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
    await setupBenchmarkContext({ ctx, executedTools, savedNotes, progressive, decoyCount })

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

const resultSummary = (result: ScenarioResult) => ({
  taskId: result.taskId,
  mode: result.mode,
  success: result.success,
  executedTools: result.executedTools,
  agentErrors: result.agentErrors,
  elapsedMs: result.elapsedMs,
  requestCount: result.requests.length,
  totalToolSchemaBytes: result.requests.reduce((total, request) => total + request.schemaBytes, 0),
  cumulativeToolTokenEstimate: result.requests.reduce((total, request) => total + request.toolsTokens, 0),
  cumulativeContextTokenEstimate: result.requests.reduce((total, request) => total + request.contextTokens, 0),
  providerUsage: result.requests.map(request => request.usage ?? null),
  requests: result.requests.map(request => ({
    toolNames: request.toolNames,
    schemaBytes: request.schemaBytes,
    toolsTokens: request.toolsTokens,
    contextTokens: request.contextTokens,
    elapsedMs: request.elapsedMs,
    calledTools: request.calledTools,
    finishKind: request.finishKind,
    usage: request.usage ?? null,
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
})

describe.skipIf(!providerBenchmarkEnabled)('tool-search OpenCode Go provider benchmark', () => {
  it('compares three synthetic tasks using direct and progressive tool discovery', async () => {
    const results: ScenarioResult[] = []
    for (const task of tasks) {
      results.push(await runScenario(task, false))
      if (!results.at(-1)?.success) break
      results.push(await runScenario(task, true))
      if (!results.at(-1)?.success) break
    }

    console.info(JSON.stringify(results.map(resultSummary)))
    expect(results.every(result => result.success)).toBe(true)
    expect(results).toHaveLength(tasks.length * 2)
  }, 600_000)
})
