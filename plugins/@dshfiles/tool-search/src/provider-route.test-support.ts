import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError, ReasoningEffortId, type GenerateOptions, type PreparedAdapterCall, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { CodexCredentialStore } from '@dshfiles/ai-accounts/codex-credential'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { Schema } from 'effect'
import { serializedSchemaBytes } from './schema-measurement.js'

/** The ai-accounts Codex route the opt-in provider benchmarks call; credentials stay in the account's own home. */
export const benchmarkAccount = process.env.DSH_TOOL_SEARCH_BENCHMARK_ACCOUNT ?? 'codex-alex2'
export const benchmarkModel = process.env.DSH_TOOL_SEARCH_BENCHMARK_MODEL ?? 'gpt-6-luna'
export const benchmarkEffort = process.env.DSH_TOOL_SEARCH_BENCHMARK_EFFORT ?? 'high'

export interface ProviderRequestMeasurement {
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

export const measureRequest = (ctx: Context, options: GenerateOptions): ProviderRequestMeasurement => {
  if (options.sessionId === undefined) throw new Error('AgentLoop did not attach a session id.')
  const session = ctx.sessions.get(options.sessionId)
  if (session === undefined) throw new Error('AgentLoop session was not published.')
  const breakdown = ctx.sessionProjections.snapshot(session, ['contextBreakdown']).values.contextBreakdown
  if (breakdown === undefined) throw new Error('TokenMeter did not register contextBreakdown.')
  const tools = options.tools ?? []
  return {
    toolNames: tools.map(tool => tool.name).sort(),
    schemaBytes: serializedSchemaBytes(JSON.stringify(tools)),
    toolsTokens: breakdown.toolsTokens,
    contextTokens: breakdown.systemTokens + breakdown.messageTokens + breakdown.toolsTokens,
    elapsedMs: 0,
    usage: undefined,
    finishKind: undefined,
    calledTools: [],
    searchQueries: [],
    text: '',
  }
}

const searchQuerySchema = Schema.fromJsonString(Schema.Struct({ query: Schema.String }))

export const observeChunk = (request: ProviderRequestMeasurement, chunk: StreamChunk): void => {
  if (chunk.type === 'usage') request.usage = chunk.usage
  if (chunk.type === 'finish') request.finishKind = chunk.reason.kind
  if (chunk.type === 'tool-call-delta' && chunk.name !== undefined && !request.calledTools.includes(chunk.name)) request.calledTools.push(chunk.name)
  if (chunk.type === 'text-delta') request.text += chunk.text
  if (chunk.type === 'block-end' && chunk.block.type === 'tool-call' && chunk.block.name === 'tool_search') {
    const decoded = Schema.decodeUnknownOption(searchQuerySchema)(chunk.block.arguments)
    if (decoded._tag === 'Some') request.searchQueries.push(decoded.value.query)
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
    maxRequestImages: 50,
    imageOffloadCountQuantum: 10,
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

export class RequestBudget {
  used = 0
  constructor(readonly limit: number) {}
  get exhausted(): boolean {
    return this.used >= this.limit
  }
}

/** Authenticates through ai-accounts' Codex credential store, the same read/refresh path the live Host uses. */
export class MeasuredCodexAdapter extends PiAiAdapter {
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
