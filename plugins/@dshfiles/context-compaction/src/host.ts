import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context, Effect, Layer, Schema } from 'effect'
import { serializedMessageBytes, summarizeInChunks } from './chunked-summary.js'

const FALLBACK_CONTEXT_WINDOW = 32_768
const MAX_INPUT_BYTES = 64_000
const SUMMARY_PROMPT_RESERVE = 4_096
const MIN_CONTEXT_RESERVE = 4_096
const compactionConfigSchema = Schema.Struct({
  maxTokens: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(8_192))),
})
type PluginConfig = typeof compactionConfigSchema.Type
type CompactionConfig = BasicCompactionEngine['config']
type SummarizeInput = Parameters<BasicCompactionEngine['summarize']>[0]
type CompactionAgent = Parameters<BasicCompactionEngine['summarize']>[1]
type SummaryResult = Awaited<ReturnType<BasicCompactionEngine['summarize']>>
type BaseSummarize = (input: SummarizeInput, signal?: AbortSignal) => Promise<SummaryResult>
type Summarize = (request: {
  readonly input: SummarizeInput
  readonly agent: CompactionAgent
  readonly config: CompactionConfig
  readonly signal?: AbortSignal
  readonly summarize: BaseSummarize
}) => Promise<SummaryResult>

class ContextCompactionRuntime extends Context.Service<ContextCompactionRuntime, { readonly llm: CordisContext['llm'] | undefined }>()(
  '@dshfiles/context-compaction/Runtime',
) {}

class ContextCompactionFailure extends Schema.TaggedError<ContextCompactionFailure>()('ContextCompactionFailure', {
  message: Schema.String,
}) {}

const summarizeBounded = Effect.fn('context compaction run')(function* ({
  input,
  agent,
  signal,
  config,
  llm,
  summarize,
}: {
  readonly input: SummarizeInput
  readonly agent: CompactionAgent
  readonly signal?: AbortSignal
  readonly config: CompactionConfig
  readonly llm: CordisContext['llm'] | undefined
  readonly summarize: BaseSummarize
}) {
  const recentRequest = agent.session.requestHeader()?.config
  const provider = config.summarizationProvider || recentRequest?.provider || agent.options.provider
  const model = config.summarizationModel || recentRequest?.model || agent.options.model
  if (llm === undefined) return yield* Effect.fail(new ContextCompactionFailure({ message: 'The Host language-model service is unavailable.' }))
  const modelInfo =
    provider === undefined || model === undefined
      ? undefined
      : yield* Effect.tryPromise({
          try: () => llm.resolveModelInfo(provider, model, signal),
          catch: error => new ContextCompactionFailure({ message: error instanceof Error ? error.message : String(error) }),
        })
  const contextWindow = modelInfo?.context?.contextWindow ?? FALLBACK_CONTEXT_WINDOW
  const reserve = Math.max(MIN_CONTEXT_RESERVE, Math.ceil(contextWindow * 0.05))
  const maxInputBytes = Math.min(MAX_INPUT_BYTES, Math.floor((contextWindow - config.maxTokens - reserve) / 2) - SUMMARY_PROMPT_RESERVE)
  if (maxInputBytes < 1_024)
    return yield* Effect.fail(new ContextCompactionFailure({ message: 'The selected summarization model has too little safe input capacity.' }))

  const imagePricing = provider === undefined || model === undefined ? undefined : llm.imageRequestPricing(provider, model)
  const textOnlyRoute = modelInfo?.inputModalities !== undefined && !modelInfo.inputModalities.includes('image')
  const messageBytes = (message: SummarizeInput['messages'][number]) => {
    const images = message.content.filter((block): block is ImageBlock => block.type === 'image')
    if (images.length === 0) return serializedMessageBytes(message)
    if (imagePricing === undefined) {
      if (textOnlyRoute) return serializedMessageBytes(message)
      throw new ContextCompactionFailure({ message: 'Cannot safely size an image-bearing summary without model-declared image pricing.' })
    }
    const imageCost = imagePricing.priceImages(images).reduce((sum, price) => sum + price.visualTokens + serializedMessageBytes(price.text), 0)
    return serializedMessageBytes(message) + imageCost
  }

  return yield* Effect.tryPromise({
    try: () =>
      summarizeInChunks({
        input,
        maxInputBytes,
        messageBytes,
        ...(signal !== undefined && { signal }),
        summarize: (candidate, candidateSignal) => summarize(candidate, candidateSignal),
      }),
    catch: error =>
      error instanceof ContextCompactionFailure ? error : new ContextCompactionFailure({ message: error instanceof Error ? error.message : String(error) }),
  })
})

const summarizeByContext = new WeakMap<CordisContext, Summarize>()

class ContextCompactionEngine extends BasicCompactionEngine {
  protected override summarize(input: SummarizeInput, agent: CompactionAgent, signal?: AbortSignal): ReturnType<BasicCompactionEngine['summarize']> {
    const summarize = summarizeByContext.get(this.ctx)
    if (summarize === undefined) return Promise.reject(new ContextCompactionFailure({ message: 'Context compaction is not initialized.' }))
    const request = {
      input,
      agent,
      config: this.config,
      summarize: (candidate: SummarizeInput, candidateSignal?: AbortSignal) => super.summarize(candidate, agent, candidateSignal),
    }
    if (signal !== undefined) return summarize({ ...request, signal })
    return summarize(request)
  }
}

const compactionPlugin = DshxEffect.plugin<PluginConfig, ContextCompactionFailure, ContextCompactionRuntime>({
  layer: (ctx: CordisContext) => Layer.succeed(ContextCompactionRuntime, { llm: ctx.get('llm') }),
  setup: Effect.fn('context compaction setup')(function* (ctx: CordisContext, config: PluginConfig) {
    const runtime = yield* ContextCompactionRuntime
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        summarizeByContext.set(ctx, request =>
          Effect.runPromise(
            summarizeBounded({ ...request, llm: runtime.llm }).pipe(Effect.provide(DshxEffect.tracerLayer)),
            request.signal === undefined ? undefined : { signal: request.signal },
          ),
        )
        ctx.plugin(ContextCompactionEngine, config)
      }),
      () => Effect.sync(() => summarizeByContext.delete(ctx)),
    )
  }),
})

export default defineHost({
  name: '@dshfiles/context-compaction',
  Config: compactionConfigSchema,
  setup: (ctx: CordisContext, config: unknown) => compactionPlugin.setup(ctx, Schema.decodeUnknownSync(compactionConfigSchema, { onExcessProperty: 'error' })(config)),
})
