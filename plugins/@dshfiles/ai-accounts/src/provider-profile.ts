import type { GenerateOptions, LlmImageRequestPricing, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { accountModelName } from './api.js'
import type { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import type { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import type { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import type { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import type { createCommandCodeProvider } from './commandcode-provider.js'

export const buildProfile = (params: {
  /** Per-model default effort ids this account pins. */
  readonly reasoningDefaults?: Readonly<Record<string, string>>
  /** Ids this account never offers. */
  readonly hiddenModelIds?: readonly string[]
  /** Ids offered ahead of the rest. */
  readonly favoriteModelIds?: readonly string[]
  /** Explicit ordering; unlisted ids keep provider order after these. */
  readonly modelOrder?: readonly string[]
  readonly upstream:
    | ReturnType<typeof openaiCodexProvider>
    | ReturnType<typeof opencodeGoProvider>
    | ReturnType<typeof anthropicProvider>
    | ReturnType<typeof githubCopilotProvider>
    | ReturnType<typeof createCommandCodeProvider>
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
  const upstreamModels = params.upstream.getModels()
  const models = upstreamModels.map(model => ({ ...model, provider: params.provider, name: accountModelName(params.provider, model.name) }))
  for (const id of new Set(params.additionalModelIds)) {
    if (models.some(model => model.id === id)) continue
    // Command Code knows each model's own efforts and modalities; a neighbour's would be wrong.
    const described = 'describeModel' in params.upstream ? params.upstream.describeModel(id) : undefined
    if (described !== undefined) {
      models.push({ ...described, provider: params.provider, name: accountModelName(params.provider, id) })
      continue
    }
    const api = id.startsWith('anthropic/') || id.startsWith('claude-') ? 'anthropic-messages' : 'openai-completions'
    const gptFamily = /^gpt-\d+(?:\.\d+)?(.*)$/u.exec(id)?.[1]
    const familyTemplate = gptFamily === undefined ? undefined : upstreamModels.findLast(model => /^gpt-\d+(?:\.\d+)?(.*)$/u.exec(model.id)?.[1] === gptFamily)
    const template =
      familyTemplate ??
      (id.startsWith('gpt-') ? upstreamModels.find(model => model.id.startsWith('gpt-')) : undefined) ??
      upstreamModels.find(model => model.api === api) ??
      upstreamModels[0]
    if (template === undefined) continue
    models.push({ ...template, id, provider: params.provider, name: accountModelName(params.provider, id) })
  }
  const offeredModels = models.filter(model => !hidden.has(model.id)).sort((left, right) => rank(left.id) - rank(right.id))
  // A pinned effort is offered as an override on the model it belongs to, which
  // is the seam the adapter materializes a default through: an explicit caller
  // choice still wins, and an unpinned model keeps the provider's own default.
  const pins = params.reasoningDefaults ?? {}
  const modelOverrides = Object.fromEntries(
    Object.entries(pins).flatMap(([modelId, effortId]) => {
      const model = offeredModels.find(candidate => candidate.id === modelId)
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
    // 5 min (pi-ai's default): high/max-effort models can reason silently for > 2 min before the first answer token.
    streamIdleTimeoutMs: 300_000,
    maxRequestImageBytes: 20_971_520,
    requestImagePixelBudget: 4_194_304,
    requestImageMaxBytes: 1_048_576,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
    retryPolicy: {
      mode: 'normal',
      maxRetries: 2,
      // EMPTY_RESPONSE: a stop with no answer is a failed attempt, never a finished turn.
      retryableCodes: ['RATE_LIMIT', 'OVERLOADED', 'TRANSPORT', 'TIMEOUT', 'EMPTY_RESPONSE'],
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    },
    piProvider: {
      ...params.upstream,
      id: params.provider,
      name: params.displayName,
      getModels: () => offeredModels,
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
 * Envoy in front of the ChatGPT backend answers 507 with this text when its own
 * upstream reset and the body was too large for Envoy to replay. The model never
 * saw the request, so a fresh one is safe, but the text carries no status that
 * dsh-llm-pi-ai recognizes: it lands as `PI_AI_ERROR`, which no retry policy
 * lists, and one transient reset ends a long turn.
 */
const UPSTREAM_REPLAY_OVERFLOW = /exceeded request buffer limit while retrying upstream/i

async function* retryableUpstreamReplayOverflow(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  for await (const chunk of chunks) {
    if (chunk.type === 'finish' && chunk.reason.kind === 'error' && UPSTREAM_REPLAY_OVERFLOW.test(chunk.reason.failure.message)) {
      yield { ...chunk, reason: { ...chunk.reason, failure: { ...chunk.reason.failure, code: 'TRANSPORT' } } }
      continue
    }
    yield chunk
  }
}

/**
 * Keeps account-specific model defaults visible to the catalog and applies
 * them only when a completed request does not already carry an explicit effort.
 */
export class EffortPinnedAdapter extends PiAiAdapter {
  private readonly reasoningDefaults: ReadonlyMap<string, Readonly<Record<string, string>>>
  private readonly routeFor: (options: GenerateOptions) => string
  private readonly pricingFor: ((provider: string, model: string) => LlmImageRequestPricing | undefined) | undefined

  constructor(
    config: ConstructorParameters<typeof PiAiAdapter>[0],
    deps: {
      reasoningDefaults: ReadonlyMap<string, Readonly<Record<string, string>>>
      /**
       * The account that serves this request on the wire. A fail-over swaps the
       * route here only, like Luna Reserve swaps the model, so the picker, the
       * request header and the transcript keep the route the user chose.
       */
      routeFor?: (options: GenerateOptions) => string
      /** Route-owned visual-token pricing; routes without one keep the neutral estimate. */
      imageRequestPricing?: (provider: string, model: string) => LlmImageRequestPricing | undefined
    },
  ) {
    super(config)
    this.reasoningDefaults = deps.reasoningDefaults
    this.routeFor = deps.routeFor ?? (options => options.provider)
    this.pricingFor = deps.imageRequestPricing
  }

  override imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined {
    return this.pricingFor?.(provider, model) ?? super.imageRequestPricing(provider, model)
  }

  private withModelDefault(model: LlmResolvedModelInfo): LlmResolvedModelInfo {
    const defaultEffort = this.reasoningDefaults.get(model.provider)?.[model.id]
    if (defaultEffort === undefined || model.reasoning === undefined || !model.reasoning.efforts.some(effort => effort.id === defaultEffort)) return model
    return {
      ...model,
      reasoning: { ...model.reasoning, defaultEffort: ReasoningEffortId(defaultEffort) },
    }
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return this.withModelDefault(await super.resolveModel(provider, model, signal))
  }

  private wireCall(options: GenerateOptions): GenerateOptions {
    const provider = this.routeFor(options)
    return pinnedCall(provider === options.provider ? options : { ...options, provider }, this.reasoningDefaults)
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return retryableUpstreamReplayOverflow(super.stream(this.wireCall(options)))
  }

  override prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return super.prepareCall(provider, model, signal).then(call => ({
      ...call,
      model: this.withModelDefault(call.model),
      stream: (options: GenerateOptions) => retryableUpstreamReplayOverflow(call.stream(this.wireCall(options))),
    }))
  }
}
