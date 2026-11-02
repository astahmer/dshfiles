import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { ImageBlock, Message } from '@deepseek-ai/dsh-llm'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { Effect, Layer, Schema } from 'effect'
import { serializedMessageBytes, summarizeInChunks, SummaryRequestFailed } from './chunked-summary.js'

const FALLBACK_CONTEXT_WINDOW = 32_768
const MAX_INPUT_BYTES = 64_000
const SUMMARY_PROMPT_RESERVE = 4_096
const MIN_CONTEXT_RESERVE = 4_096

const CompactionConfig = Schema.Struct({
  maxTokens: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(8_192))),
})

type SummarizeInput = Parameters<BasicCompactionEngine['summarize']>[0]
type CompactionAgent = Parameters<BasicCompactionEngine['summarize']>[1]
type SummaryResult = Awaited<ReturnType<BasicCompactionEngine['summarize']>>

interface SummaryRequest {
  readonly input: SummarizeInput
  readonly agent: CompactionAgent
  readonly config: BasicCompactionEngine['config']
  readonly signal: AbortSignal | undefined
  /** The stock engine's single summary request. */
  readonly base: (input: SummarizeInput, signal?: AbortSignal) => Promise<SummaryResult>
}

const failureMessages = {
  'model-info': 'Could not read the summarization model’s context capacity.',
  'input-capacity': 'The selected summarization model has too little safe input capacity.',
  'image-pricing': 'Cannot safely size an image-bearing summary without model-declared image pricing.',
} as const

class ContextCompactionFailure extends Schema.TaggedError<ContextCompactionFailure>()('ContextCompactionFailure', {
  reason: Schema.Literals(['model-info', 'input-capacity', 'image-pricing']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return failureMessages[this.reason]
  }
}

const ContextOverflow = Schema.Struct({ code: Schema.Literal('CONTEXT_WINDOW_EXCEEDED') })
const isContextOverflow = Schema.is(ContextOverflow)

const hasImages = (message: Message) => message.content.some(block => block.type === 'image')

const summarizeBounded = Effect.fn('context compaction run')(function* (request: SummaryRequest) {
  const llm = yield* Llm
  const recentRequest = request.agent.session.requestHeader()?.config
  const provider = request.config.summarizationProvider || recentRequest?.provider || request.agent.options.provider
  const model = request.config.summarizationModel || recentRequest?.model || request.agent.options.model
  const route = provider === undefined || model === undefined ? undefined : { provider, model }
  const modelInfo =
    route === undefined ? undefined : yield* llm.modelInfo(route).pipe(Effect.mapError(cause => new ContextCompactionFailure({ reason: 'model-info', cause })))
  const contextWindow = modelInfo?.context?.contextWindow ?? FALLBACK_CONTEXT_WINDOW
  const reserve = Math.max(MIN_CONTEXT_RESERVE, Math.ceil(contextWindow * 0.05))
  const maxInputBytes = Math.min(MAX_INPUT_BYTES, Math.floor((contextWindow - request.config.maxTokens - reserve) / 2) - SUMMARY_PROMPT_RESERVE)
  if (maxInputBytes < 1_024) return yield* new ContextCompactionFailure({ reason: 'input-capacity' })

  const imagePricing = route === undefined ? undefined : yield* llm.imagePricing(route)
  const textOnlyRoute = modelInfo?.inputModalities !== undefined && !modelInfo.inputModalities.includes('image')
  if (imagePricing === undefined && !textOnlyRoute && request.input.messages.some(hasImages))
    return yield* new ContextCompactionFailure({ reason: 'image-pricing' })
  const messageBytes = (message: Message) => {
    const images = message.content.filter((block): block is ImageBlock => block.type === 'image')
    if (images.length === 0 || imagePricing === undefined) return serializedMessageBytes(message)
    const imageCost = imagePricing.priceImages(images).reduce((sum, price) => sum + price.visualTokens + serializedMessageBytes(price.text), 0)
    return serializedMessageBytes(message) + imageCost
  }

  return yield* summarizeInChunks({
    input: request.input,
    maxInputBytes,
    messageBytes,
    summarize: candidate =>
      Effect.tryPromise({
        try: () => request.base(candidate, request.signal),
        catch: cause => new SummaryRequestFailed({ contextOverflow: isContextOverflow(cause), cause }),
      }),
  })
})

/** The stock engine with its single summary request bounded to the route's safe input, split and reduced as needed. */
const engineWith = (summarize: (request: SummaryRequest) => Promise<SummaryResult>) =>
  class ContextCompactionEngine extends BasicCompactionEngine {
    protected override summarize(input: SummarizeInput, agent: CompactionAgent, signal?: AbortSignal): Promise<SummaryResult> {
      return summarize({
        input,
        agent,
        config: this.config,
        signal,
        base: (candidate, candidateSignal) => super.summarize(candidate, agent, candidateSignal),
      })
    }
  }

const CompactionEngine = (config: typeof CompactionConfig.Type) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* HostContext
      const summarize = yield* DshxPlugin.callback(summarizeBounded)
      // A failed provider request reaches the engine as the provider's own error, as the stock engine throws it.
      const engine = engineWith(request =>
        summarize(request).catch((error: unknown) => {
          throw error instanceof SummaryRequestFailed ? error.cause : error
        }),
      )
      yield* Effect.acquireRelease(
        Effect.sync(() => host.ctx.plugin(engine, config)),
        fiber => Effect.promise(() => fiber.dispose()),
      )
    }),
  )

export default DshxPlugin.make({
  name: '@dshfiles/context-compaction',
  inject: ['llm'],
  Config: CompactionConfig,
  layer: config => CompactionEngine(config).pipe(Layer.provide(Llm.layer)),
})
