import { AsyncLocalStorage } from 'node:async_hooks'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'
import type { FastModeUsageObservation } from './fast-mode-usage-model.js'
import type { FastModeStatus } from './model-fast-mode-api.js'

const fastModeRequestBodySchema = Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Json))
const tokenCount = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const codexResponseEventSchema = Schema.Struct({
  type: Schema.Literals(['response.completed', 'response.incomplete']),
  response: Schema.Struct({
    status: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
    service_tier: Schema.optional(Schema.NullOr(AiAccountsSchema.id(32))),
    usage: Schema.optional(
      Schema.Struct({
        input_tokens: Schema.optional(tokenCount).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(0)))),
        output_tokens: Schema.optional(tokenCount).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(0)))),
        input_tokens_details: Schema.optional(Schema.Struct({ cached_tokens: tokenCount.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(0)))) })),
      }),
    ),
  }),
})

const CODEX_FAST_MODE_MODEL_IDS = new Set(['gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'])

export const isCodexFastModeModel = (model: { readonly api: string; readonly id: string }): boolean =>
  model.api === 'openai-codex-responses' && CODEX_FAST_MODE_MODEL_IDS.has(model.id)

const routeKeyOf = (route: { readonly provider: string; readonly model: string }): string => JSON.stringify([route.provider, route.model])

interface FastModeRoute {
  sessionId: string
  provider: string
  model: string
}

interface FastModeRequest {
  sessionId: string
  provider: string
  model: string
}

interface FastModeCall {
  sessionId: string | undefined
  selectedProvider: string
  wireProvider: string
  model: string
}

interface FastModeDependencies {
  isAvailable: (route: Omit<FastModeRoute, 'sessionId'>) => boolean
  isLiveSession: (sessionId: string) => boolean
  isEnabledByDefault: () => boolean
  recordUsage?: (observation: FastModeUsageObservation) => Promise<void>
  onUsageError?: (error: unknown) => void
}

export class FastModeService {
  private readonly selections = new Map<string, Map<string, boolean>>()
  private readonly requestContext = new AsyncLocalStorage<FastModeRequest>()

  constructor(private readonly dependencies: FastModeDependencies) {}

  status(route: FastModeRoute): FastModeStatus {
    const available = this.dependencies.isLiveSession(route.sessionId) && this.dependencies.isAvailable(route)
    if (!available) return { available: false, enabled: false }

    return {
      available: true,
      enabled: this.selections.get(route.sessionId)?.get(routeKeyOf(route)) ?? this.dependencies.isEnabledByDefault(),
    }
  }

  set(route: FastModeRoute & { enabled: boolean }): FastModeStatus {
    if (!this.dependencies.isLiveSession(route.sessionId)) throw new Error('Fast mode session is no longer active.')
    if (!this.dependencies.isAvailable(route)) {
      if (route.enabled) throw new Error('Fast mode is unavailable for this provider/model route.')
      return { available: false, enabled: false }
    }

    const routeOverrides = this.selections.get(route.sessionId) ?? new Map<string, boolean>()
    routeOverrides.set(routeKeyOf(route), route.enabled)
    this.selections.set(route.sessionId, routeOverrides)
    return this.status(route)
  }

  delete(sessionId: string): void {
    this.selections.delete(sessionId)
  }

  clear(): void {
    this.selections.clear()
  }

  withRequest(call: FastModeCall, stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    if (call.sessionId === undefined) return stream

    if (
      !(
        this.selections.get(call.sessionId)?.get(routeKeyOf({ provider: call.selectedProvider, model: call.model })) ?? this.dependencies.isEnabledByDefault()
      ) ||
      !this.dependencies.isAvailable({ provider: call.wireProvider, model: call.model })
    ) {
      return stream
    }

    return this.withRequestContext({ sessionId: call.sessionId, provider: call.wireProvider, model: call.model }, stream)
  }

  decorateOptions(options: SimpleStreamOptions | undefined, model: Model<'openai-codex-responses'>): SimpleStreamOptions | undefined {
    const request = this.requestContext.getStore()
    if (
      request === undefined ||
      request.provider !== model.provider ||
      request.model !== model.id ||
      !isCodexFastModeModel(model) ||
      !this.dependencies.isAvailable({ provider: request.provider, model: request.model })
    ) {
      return options
    }

    return {
      ...options,
      onPayload: async (payload, payloadModel) => {
        const transformed = options?.onPayload === undefined ? payload : ((await options.onPayload(payload, payloadModel)) ?? payload)
        const body = AiAccountsSchema.decodeResult(fastModeRequestBodySchema, transformed)
        if (body._tag === 'Failure') throw new Error('ai-accounts: Fast mode request payload must be a JSON object.')
        return { ...body.success, service_tier: 'priority' }
      },
      onProviderStreamEvent: async (event, eventModel) => {
        await options?.onProviderStreamEvent?.(event, eventModel)
        const parsed = AiAccountsSchema.decodeResult(codexResponseEventSchema, event)
        if (parsed._tag === 'Failure') return
        const response = parsed.success.response
        try {
          await this.dependencies.recordUsage?.({
            instanceId: request.provider,
            model: request.model,
            serviceTier: response.service_tier ?? null,
            responseStatus: parsed.success.type === 'response.incomplete' || response.status === 'incomplete' ? 'incomplete' : 'completed',
            inputTokens: response.usage?.input_tokens ?? 0,
            outputTokens: response.usage?.output_tokens ?? 0,
            cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
          })
        } catch (error) {
          this.dependencies.onUsageError?.(error)
        }
      },
    }
  }

  private async *withRequestContext(request: FastModeRequest, stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const iterator = stream[Symbol.asyncIterator]()
    try {
      while (true) {
        const result = await this.requestContext.run(request, () => iterator.next())
        if (result.done) return
        yield result.value
      }
    } finally {
      if (iterator.return !== undefined) await this.requestContext.run(request, () => iterator.return?.())
    }
  }
}

export const withCodexFastMode = (input: {
  upstream: ReturnType<typeof openaiCodexProvider>
  fastMode: FastModeService
}): ReturnType<typeof openaiCodexProvider> => ({
  ...input.upstream,
  streamSimple: (model, context, options) => input.upstream.streamSimple(model, context, input.fastMode.decorateOptions(options, model)),
})
