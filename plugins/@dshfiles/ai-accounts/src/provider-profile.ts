import type { GenerateOptions, LlmDiscoveredModel, LlmImageRequestPricing, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { FastModeService } from './codex-fast-mode.js'
import type { DeclaredRetryAfter } from './provider-retry-after.js'
import { AccountsRules } from './api.js'
import type { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import type { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import type { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import type { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import type { createCommandCodeProvider } from './commandcode-provider.js'
import type { createMistralProvider } from './mistral-provider.js'

/** DeepSeek's documented default effort when thinking is on and the request names none. */
const DEEPSEEK_DEFAULT_EFFORT = 'high'

type ThinkingCatalogModel = {
  readonly api: string
  readonly compat?: { readonly thinkingFormat?: string } | undefined
  readonly thinkingLevelMap?: Readonly<Record<string, string | null | undefined>> | undefined
}

/** Models offered `off` below; only they gain a default, so a model that already stopped thinking without one keeps doing so. */
const thinkingOffOffered = new WeakSet<object>()

/**
 * OpenCode Go forwards DeepSeek's `thinking: {type: 'disabled'}` (verified against the live route on 2026-10-13), but
 * pi-ai's catalog marks `off` unsupported there, so nothing could ask DeepSeek V4.1 not to think. Dropping the `null`
 * offers `off`. pi-ai then sends `disabled` for every request without an effort, so {@link EffortPinnedAdapter} gives
 * those requests DeepSeek's documented default to keep thinking exactly as before.
 */
const offerThinkingOff = <Model extends ThinkingCatalogModel>(model: Model): Model => {
  if (model.api !== 'openai-completions' || model.compat?.thinkingFormat !== 'deepseek' || model.thinkingLevelMap?.off !== null) return model
  const { off: _unsupported, ...levels } = model.thinkingLevelMap
  const offered = { ...model, thinkingLevelMap: levels }
  thinkingOffOffered.add(offered)
  return offered
}

/**
 * pi-ai's own default. High/max-effort Codex models can reason silently for
 * minutes before the first answer token, so this route keeps the long bound.
 */
const SILENT_REASONING_STREAM_IDLE_TIMEOUT_MS = 300_000
/**
 * OpenCode Go answers or dies within seconds: first-token p90 on this route is
 * ~11s, and every 300s stall in the 2026-10-15..18 window was this route (four
 * `TIMEOUT` failures plus 309s and 404s first-token stalls that only completed
 * after the full pi-ai bound). A 2-minute silence here is a dead route, and
 * failing at 2 minutes lets the retry policy fail over instead of burning five
 * minutes of the turn per attempt.
 */
const OPENCODE_GO_STREAM_IDLE_TIMEOUT_MS = 120_000

const streamIdleTimeoutMsFor = (upstreamId: string): number =>
  upstreamId === 'opencode-go' ? OPENCODE_GO_STREAM_IDLE_TIMEOUT_MS : SILENT_REASONING_STREAM_IDLE_TIMEOUT_MS

const profilePins = new WeakMap<ResolvedPiAiProviderProfile, Readonly<Record<string, string>>>()
const nativeModels = new WeakMap<ResolvedPiAiProviderProfile, ReadonlySet<string>>()

/** Match the installed adapter's supported-thinking-level rule before publishing or applying a pin. */
const supportsEffort = (
  model: { readonly reasoning: boolean; readonly thinkingLevelMap?: Readonly<Record<string, string | null>> | undefined },
  effort: string,
): boolean => {
  if (!model.reasoning) return false
  if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) return false
  const mapped = model.thinkingLevelMap?.[effort]
  return mapped !== null && ((effort !== 'xhigh' && effort !== 'max') || mapped !== undefined)
}

export class ProviderProfileModel {
  static nativeModelIdsForProfile = (profile: ResolvedPiAiProviderProfile): ReadonlySet<string> => nativeModels.get(profile) ?? new Set()
  static reasoningDefaultsForProfile = (profile: ResolvedPiAiProviderProfile): Readonly<Record<string, string>> => profilePins.get(profile) ?? {}

  static buildProfile = (params: {
    readonly defaultReasoningEffort?: string | null | undefined
    /** Per-model default effort ids this account pins. */
    readonly reasoningDefaults?: Readonly<Record<string, string>> | undefined
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
      | ReturnType<typeof createMistralProvider>
    readonly provider: string
    readonly displayName: string
    readonly additionalModelIds: readonly string[]
    /** Models the provider catalog reported for this account, with the context window and input it disclosed. */
    readonly discoveredModels?: readonly LlmDiscoveredModel[]
    /** Sees every HTTP response this account's provider receives, e.g. to read a declared Retry-After. */
    readonly onResponse?: (response: { readonly status: number; readonly headers: Readonly<Record<string, string>> }) => void
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
    const offersThinkingOff = params.upstream.id === 'opencode-go'
    const models = upstreamModels.map(model => {
      const named = { ...model, provider: params.provider, name: AccountsRules.accountModelName(params.provider, model.name) }
      return offersThinkingOff ? offerThinkingOff(named) : named
    })
    const discovered = new Map((params.discoveredModels ?? []).map(model => [model.id, model]))
    for (const id of new Set([...params.additionalModelIds, ...discovered.keys()])) {
      if (models.some(model => model.id === id)) continue
      // Command Code knows each model's own efforts and modalities; a neighbour's would be wrong.
      const described = 'describeModel' in params.upstream ? params.upstream.describeModel(id, discovered.get(id)) : undefined
      if (described !== undefined) {
        models.push({ ...described, provider: params.provider, name: AccountsRules.accountModelName(params.provider, id) })
        continue
      }
      const api = id.startsWith('anthropic/') || id.startsWith('claude-') ? 'anthropic-messages' : 'openai-completions'
      const gptFamily = /^gpt-\d+(?:\.\d+)?(.*)$/u.exec(id)?.[1]
      const familyTemplate =
        gptFamily === undefined ? undefined : upstreamModels.findLast(model => /^gpt-\d+(?:\.\d+)?(.*)$/u.exec(model.id)?.[1] === gptFamily)
      const template =
        familyTemplate ??
        (id.startsWith('gpt-') ? upstreamModels.find(model => model.id.startsWith('gpt-')) : undefined) ??
        upstreamModels.find(model => model.api === api) ??
        upstreamModels[0]
      if (template === undefined) continue
      models.push({ ...template, id, provider: params.provider, name: AccountsRules.accountModelName(params.provider, id) })
    }
    const offeredModels = models.filter(model => !hidden.has(model.id)).sort((left, right) => rank(left.id) - rank(right.id))
    // A pinned effort is offered as an override on the model it belongs to, which
    // is the seam the adapter materializes a default through: an explicit caller
    // choice still wins, and an unpinned model keeps the provider's own default.
    const pins = Object.fromEntries(
      offeredModels.flatMap(model => {
        const override = params.reasoningDefaults?.[model.id]
        const effort = override !== undefined && supportsEffort(model, override) ? override : params.defaultReasoningEffort
        return effort != null && supportsEffort(model, effort) ? [[model.id, effort]] : []
      }),
    )
    const modelOverrides = Object.fromEntries(
      offeredModels.flatMap(model => {
        const effort = pins[model.id]
        const levels: Readonly<Record<string, string | null>> | undefined = model.thinkingLevelMap
        return effort === undefined ? [] : [[model.id, { reasoningEfforts: { [effort]: levels?.[effort] ?? effort } }]]
      }),
    )

    const profile: ResolvedPiAiProviderProfile = {
      provider: params.provider,
      displayName: params.displayName,
      ...(Object.keys(modelOverrides).length !== 0 && { modelOverrides }),
      transport: 'sse',
      streamIdleTimeoutMs: streamIdleTimeoutMsFor(params.upstream.id),
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
      piProvider: observedProvider(
        {
          ...params.upstream,
          id: params.provider,
          name: params.displayName,
          getModels: () => offeredModels,
        },
        params.onResponse,
      ),
    }
    profilePins.set(profile, pins)
    nativeModels.set(profile, new Set(upstreamModels.map(model => model.id)))
    return profile
  }
}

/** Apply the account's pin, else the model's own thinking default, to one request whose caller did not choose an effort. */
const pinnedCall = (
  options: GenerateOptions,
  pins: ReadonlyMap<string, Readonly<Record<string, string>>>,
  defaultEffort: (provider: string, model: string) => string | undefined,
): GenerateOptions => {
  if (options.reasoningEffort !== undefined) return options
  const effort = pins.get(options.provider)?.[options.model] ?? defaultEffort(options.provider, options.model)
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

type PiProvider = NonNullable<ResolvedPiAiProviderProfile['piProvider']>

/**
 * The provider's HTTP responses, rejected ones included, seen through its `fetch` on the simple stream the adapter
 * calls; pi-ai's own `onResponse` only fires for accepted responses.
 */
const observedProvider = (
  provider: PiProvider,
  onResponse: ((response: { readonly status: number; readonly headers: Readonly<Record<string, string>> }) => void) | undefined,
): PiProvider => {
  if (onResponse === undefined) return provider
  return {
    ...provider,
    streamSimple: (model, context, options) =>
      provider.streamSimple(model, context, {
        ...options,
        fetch: async (input, init) => {
          const response = await (options?.fetch ?? globalThis.fetch)(input, init)
          onResponse({ status: response.status, headers: Object.fromEntries(response.headers.entries()) })
          return response
        },
      }),
  }
}

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
  private readonly fastMode: FastModeService
  private readonly profilesFor: ConstructorParameters<typeof PiAiAdapter>[0]['profiles']
  private readonly routeFor: (options: GenerateOptions) => string
  private readonly pricingFor: ((provider: string, model: string) => LlmImageRequestPricing | undefined) | undefined
  private readonly declaredRetryAfter: DeclaredRetryAfter | undefined

  constructor(
    config: ConstructorParameters<typeof PiAiAdapter>[0],
    deps: {
      reasoningDefaults: ReadonlyMap<string, Readonly<Record<string, string>>>
      fastMode: FastModeService
      /**
       * The account that serves this request on the wire. A fail-over swaps the
       * route here only, like Luna Reserve swaps the model, so the picker, the
       * request header and the transcript keep the route the user chose.
       */
      routeFor?: (options: GenerateOptions) => string
      /** Route-owned visual-token pricing; routes without one keep the neutral estimate. */
      imageRequestPricing?: (provider: string, model: string) => LlmImageRequestPricing | undefined
      /** The Retry-After each route's provider declared, put back on its failed attempts. */
      declaredRetryAfter?: DeclaredRetryAfter
    },
  ) {
    super(config)
    this.profilesFor = config.profiles
    this.reasoningDefaults = deps.reasoningDefaults
    this.fastMode = deps.fastMode
    this.routeFor = deps.routeFor ?? (options => options.provider)
    this.pricingFor = deps.imageRequestPricing
    this.declaredRetryAfter = deps.declaredRetryAfter
  }

  override imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined {
    return this.pricingFor?.(provider, model) ?? super.imageRequestPricing(provider, model)
  }

  private readonly thinkingDefault = (provider: string, model: string): string | undefined => {
    const catalogModel = this.profilesFor()
      .get(provider)
      ?.piProvider?.getModels()
      .find(candidate => candidate.id === model)
    return catalogModel !== undefined && thinkingOffOffered.has(catalogModel) ? DEEPSEEK_DEFAULT_EFFORT : undefined
  }

  private withModelDefault(model: LlmResolvedModelInfo): LlmResolvedModelInfo {
    const defaultEffort = this.reasoningDefaults.get(model.provider)?.[model.id] ?? this.thinkingDefault(model.provider, model.id)
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
    return pinnedCall(provider === options.provider ? options : { ...options, provider }, this.reasoningDefaults, this.thinkingDefault)
  }

  private withFastMode(options: GenerateOptions, wireOptions: GenerateOptions, stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    return this.fastMode.withRequest(
      {
        sessionId: options.sessionId,
        selectedProvider: options.provider,
        wireProvider: wireOptions.provider,
        model: wireOptions.model,
      },
      stream,
    )
  }

  private withDeclaredRetryAfter(wireOptions: GenerateOptions, stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    if (this.declaredRetryAfter === undefined) return stream
    this.declaredRetryAfter.forget(wireOptions.provider)
    return this.declaredRetryAfter.attach(wireOptions.provider, stream)
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const wireOptions = this.wireCall(options)
    return this.withFastMode(options, wireOptions, this.withDeclaredRetryAfter(wireOptions, retryableUpstreamReplayOverflow(super.stream(wireOptions))))
  }

  override prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return super.prepareCall(provider, model, signal).then(call => ({
      ...call,
      model: this.withModelDefault(call.model),
      stream: (options: GenerateOptions) => {
        const wireOptions = this.wireCall(options)
        return this.withFastMode(options, wireOptions, this.withDeclaredRetryAfter(wireOptions, retryableUpstreamReplayOverflow(call.stream(wireOptions))))
      },
    }))
  }
}
