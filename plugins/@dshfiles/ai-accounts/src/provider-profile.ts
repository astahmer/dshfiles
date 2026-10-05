import type { GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { accountModelName } from './api.js'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'

export const buildProfile = (params: {
  /** Per-model default effort ids this account pins. */
  readonly reasoningDefaults?: Readonly<Record<string, string>>
  /** Ids this account never offers. */
  readonly hiddenModelIds?: readonly string[]
  /** Ids offered ahead of the rest. */
  readonly favoriteModelIds?: readonly string[]
  /** Explicit ordering; unlisted ids keep provider order after these. */
  readonly modelOrder?: readonly string[]
  readonly upstream: ReturnType<typeof openaiCodexProvider> | ReturnType<typeof opencodeGoProvider>
  readonly provider: string
  readonly displayName: string
  readonly additionalModelIds: readonly string[]
}): ResolvedPiAiProviderProfile => {
  const hidden = new Set(params.hiddenModelIds ?? [])
  const favorites = new Set(params.favoriteModelIds ?? [])
  const order = params.modelOrder ?? []
  const rank = (id: string): number => {
    const listed = order.indexOf(id)
    if (listed >= 0) return listed
    // Unlisted models follow the explicit ones, favorites first among them, then
    // the provider's own order, so adding a model never reshuffles the rest.
    return order.length + (favorites.has(id) ? 0 : 1)
  }
  const models = params.upstream
    .getModels()
    .filter(model => !hidden.has(model.id))
    .map(model => ({ ...model, provider: params.provider, name: accountModelName(params.provider, model.name) }))
    .sort((left, right) => rank(left.id) - rank(right.id))
  const template = models.find(model => model.id.startsWith('gpt-'))
  for (const id of params.additionalModelIds) {
    if (template === undefined || models.some(model => model.id === id)) continue
    models.push({ ...template, id, provider: params.provider })
  }
  // A pinned effort is offered as an override on the model it belongs to, which
  // is the seam the adapter materializes a default through: an explicit caller
  // choice still wins, and an unpinned model keeps the provider's own default.
  const pins = params.reasoningDefaults ?? {}
  const modelOverrides = Object.fromEntries(
    Object.entries(pins).flatMap(([modelId, effortId]) => {
      const model = models.find(candidate => candidate.id === modelId)
      if (model === undefined) return []
      const levels = (model as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap
      if (levels !== undefined && levels[effortId] === null) return []
      return [[modelId, { reasoningEfforts: { [effortId]: levels?.[effortId] ?? effortId } }]]
    }),
  )

  return {
    provider: params.provider,
    displayName: params.displayName,
    ...(Object.keys(modelOverrides).length === 0 ? {} : { modelOverrides }),
    transport: 'sse',
    streamIdleTimeoutMs: 120_000,
    maxRequestImageBytes: 20_971_520,
    requestImagePixelBudget: 4_194_304,
    requestImageMaxBytes: 1_048_576,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
    retryPolicy: {
      mode: 'normal',
      maxRetries: 2,
      retryableCodes: ['RATE_LIMIT', 'OVERLOADED', 'TRANSPORT', 'TIMEOUT'],
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    },
    piProvider: {
      ...params.upstream,
      id: params.provider,
      name: params.displayName,
      getModels: () => models,
    },
  }
}

/** Apply the account's pin to one request whose caller did not choose an effort. */
const pinnedCall = (options: GenerateOptions, pins: ReadonlyMap<string, Readonly<Record<string, string>>>): GenerateOptions => {
  if (options.reasoningEffort !== undefined) return options
  const effort = pins.get(options.provider)?.[options.model]
  if (effort === undefined) return options
  return { ...options, reasoningEffort: ReasoningEffortId(effort) }
}

/**
 * One default per model, not one per route.
 *
 * pi-ai materializes a default effort through the route-wide `profile.reasoning`
 * field, so a per-model pin cannot be expressed there without reshuffling every
 * other model the account serves. The adapter's `stream` entry point sees the
 * fully-assembled request after the loop built it, so overriding there applies
 * exactly one pin — the caller's explicit choice still wins, a different model
 * on the same route keeps the provider default, and an effort-only switch
 * (no provider or model change) stays silent the way `sameRoute` wants.
 */
export class EffortPinnedAdapter extends PiAiAdapter {
  private readonly reasoningDefaults: ReadonlyMap<string, Readonly<Record<string, string>>>

  constructor(config: ConstructorParameters<typeof PiAiAdapter>[0], deps: { reasoningDefaults: ReadonlyMap<string, Readonly<Record<string, string>>> }) {
    super(config)
    this.reasoningDefaults = deps.reasoningDefaults
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return super.stream(pinnedCall(options, this.reasoningDefaults))
  }

  override prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return super.prepareCall(provider, model, signal).then(call => ({
      ...call,
      stream: (options: GenerateOptions) => call.stream(pinnedCall(options, this.reasoningDefaults)),
    }))
  }
}
