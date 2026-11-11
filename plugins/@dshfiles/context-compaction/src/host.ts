import type {} from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine, type ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic'
import type { ImageBlock, Message } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-token-meter'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { createHostApiClient, isApiServed, runOutsideReload } from '@dshfiles/dshx/host'
import { Llm } from '@dshfiles/dshx/effect/llm'
import type { SessionId } from '@dshfiles/dshx/ids'
import { SessionId as sessionIdSchema } from '@dshfiles/dshx/ids'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Context, Effect, Layer, Schema } from 'effect'
import { compactionApi, type CompactionThreshold } from './compaction-api.js'
import { compactionThresholdTokens } from './compaction-threshold.js'
import { compactionRequestBudget, MIN_REQUEST_BUDGET_BYTES } from './budget.js'
import { serializedMessageBytes, summarizeInChunks, SummaryRequestFailed } from './chunked-summary.js'
import { observedIdleCandidate } from './idle-candidate.js'
import { DEFAULT_IDLE_COMPACTION } from './idle-compaction.js'
import { idleGenerationStart } from './idle-generation.js'
import { sweepIdleCompaction, type IdleCompactionCandidate } from './idle-compaction-sweep.js'

const SWEEP_INTERVAL_MS = 60_000

const IDLE_MIN_TOKENS_MAX = 10_000_000

const IdleCompactionConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_IDLE_COMPACTION.enabled))),
  minTokens: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(IDLE_MIN_TOKENS_MAX)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_IDLE_COMPACTION.minTokens)),
  ),
  lifetimeMinutes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_IDLE_COMPACTION.lifetimeMinutes)),
  ),
  leadMinutes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_IDLE_COMPACTION.leadMinutes)),
  ),
})

const CompactionConfig = Schema.Struct({
  maxTokens: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(8_192))),
  // Off by default: a compaction is a billed request per idle thread, so it only runs where a measurement showed it pays.
  idle: IdleCompactionConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({ enabled: false }))),
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
  const maxInputBytes = compactionRequestBudget({ contextWindow: modelInfo?.context?.contextWindow, maxTokens: request.config.maxTokens })
  if (maxInputBytes < MIN_REQUEST_BUDGET_BYTES) return yield* new ContextCompactionFailure({ reason: 'input-capacity' })

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
const engineWith = (summarize: (request: SummaryRequest) => Promise<SummaryResult>, onConfig: (config: ResolvedConfig) => void) =>
  class ContextCompactionEngine extends BasicCompactionEngine {
    constructor(...args: ConstructorParameters<typeof BasicCompactionEngine>) {
      super(...args)
      onConfig(this.config)
    }

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

class CompactionThresholdFailure extends Schema.TaggedError<CompactionThresholdFailure>()(
  'CompactionThresholdFailure',
  { provider: Schema.String, model: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'compaction-threshold-failure' },
) {
  override get message(): string {
    return `Could not read the context capacity of ${this.provider}/${this.model}. Check that model in Settings › Models, then retry.`
  }
}

/** The running engine's trigger for one live thread, priced as `compactIfNeeded` prices it. */
class CompactionThresholds extends Context.Service<
  CompactionThresholds,
  { readonly read: (sessionId: SessionId) => Effect.Effect<CompactionThreshold | null, CompactionThresholdFailure> }
>()('@dshfiles/context-compaction/CompactionThresholds') {}

const CompactionEngine = (config: typeof CompactionConfig.Type) =>
  Layer.effect(
    CompactionThresholds,
    Effect.gen(function* () {
      const host = yield* HostContext
      const llm = yield* Llm
      const summarize = yield* DshxPlugin.callbackWithSignal(summarizeBounded)
      let policy: ResolvedConfig | undefined
      // A failed provider request reaches the engine as the provider's own error, as the stock engine throws it.
      const engine = engineWith(
        request =>
          summarize({ signal: request.signal }, request).catch((error: unknown) => {
            throw error instanceof SummaryRequestFailed ? error.cause : error
          }),
        resolved => {
          policy = resolved
        },
      )
      yield* Effect.acquireRelease(
        Effect.sync(() => host.ctx.plugin(engine, { maxTokens: config.maxTokens })),
        fiber => Effect.promise(() => fiber.dispose()),
      )
      // One sweep owns every visible thread. The Session controller resumes a cold Agent under its own admission and
      // hold, so this timer never touches `ctx.agents` directly.
      const sessions = createHostApiClient(host.ctx, sessionsApi, '@dshfiles/context-compaction')
      // This Host's own observation of the last request or turn end per thread, kept across Agent eviction. A thread
      // this Host never saw active has an unknown idle start and is left alone instead of trusting the list's updatedAt.
      const observedLastActivity = new Map<SessionId, number>()
      const attemptedAt = new Map<SessionId, number>()
      const sweepAbort = new AbortController()
      const toSessionId = (value: string): SessionId => Schema.decodeSync(sessionIdSchema)(value)
      let sweeping = false
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const logger = host.ctx.logger('context-compaction')
          const offEvent = host.ctx.on(
            'session/event',
            (session, event) => {
              const idleStart = idleGenerationStart(event)
              if (idleStart !== null) observedLastActivity.set(session.id, idleStart)
            },
            { global: true },
          )
          const offStatus = host.ctx.on(
            'agent/status',
            ({ agent, status }) => {
              if (status === 'idle') observedLastActivity.set(agent.id, Date.now())
              else observedLastActivity.delete(agent.id)
            },
            { global: true },
          )
          const timer = setInterval(() => {
            if (!config.idle.enabled || sweeping) return
            runOutsideReload(host.ctx, () => {
              if (!isApiServed(host.ctx, sessionsApi)) return
              sweeping = true
              void (async () => {
                const now = Date.now()
                const listed = await sessions.list({ limit: 200 }, { signal: sweepAbort.signal })
                const candidates: IdleCompactionCandidate[] = []
                for (const row of listed.threads) {
                  if (row.running) continue
                  const sessionId = toSessionId(row.sessionId)
                  const liveAgent = () => host.ctx.get('agents')?.get(sessionId)
                  const measuredAgent = liveAgent()
                  const measured = measuredAgent === undefined ? undefined : host.ctx.get('tokenMeter')?.measure(measuredAgent.session).totalTokens
                  const candidate = observedIdleCandidate({
                    sessionId,
                    observedLastActivityAt: observedLastActivity.get(sessionId) ?? null,
                    currentLastActivityAt: () => observedLastActivity.get(sessionId) ?? null,
                    liveAgent: () => {
                      const agent = liveAgent()
                      return agent === undefined
                        ? undefined
                        : { status: agent.status, nextTurn: agent.inbox.nextTurn.length, nextStep: agent.inbox.nextStep.length }
                    },
                    tokens: measured === undefined || !Number.isFinite(measured) ? null : Math.round(measured),
                    compact: async () => {
                      const result = await sessions.compact({ sessionId: row.sessionId, minTokens: config.idle.minTokens }, { signal: sweepAbort.signal })
                      if (result.kind === 'error') throw new Error(result.text ?? 'Compaction failed.')
                    },
                  })
                  if (candidate !== null) candidates.push(candidate)
                }
                await sweepIdleCompaction({
                  now,
                  candidates,
                  attemptedAt,
                  policy: config.idle,
                  onAttempt: ({ sessionId, lastActivityAt }) => attemptedAt.set(sessionId, lastActivityAt),
                  onFailure: ({ sessionId, error }) => logger.warn(`context-compaction: idle compaction of "${sessionId}" skipped: ${String(error)}`),
                })
              })()
                .catch((error: unknown) => logger.warn(`context-compaction: idle sweep failed: ${String(error)}`))
                .finally(() => {
                  sweeping = false
                })
            })
          }, SWEEP_INTERVAL_MS)
          timer.unref()
          return () => {
            clearInterval(timer)
            offEvent()
            offStatus()
            sweepAbort.abort()
          }
        }),
        dispose => Effect.sync(dispose),
      )
      return CompactionThresholds.of({
        read: Effect.fn('context compaction threshold read')(function* (sessionId: SessionId) {
          const session = host.ctx.get('agents')?.get(sessionId)?.session
          const header = session?.requestHeader()?.config
          if (session === undefined || header === undefined || policy === undefined || header.provider === '' || header.model === '') return null
          const route = { provider: header.provider, model: header.model }
          const info = yield* llm.modelInfo(route).pipe(Effect.mapError(cause => new CompactionThresholdFailure({ ...route, cause })))
          const contextWindow = info.context?.contextWindow
          if (contextWindow === undefined) return null
          const thresholdTokens = compactionThresholdTokens({
            config: policy,
            route,
            contextWindow,
            reservedCompletionTokens: header.maxTokens ?? info.defaultMaxTokens ?? 0,
          })
          if (thresholdTokens === null) return null
          const measured = host.ctx.get('tokenMeter')?.measure(session).totalTokens
          return {
            ...route,
            auto: policy.auto,
            contextWindow,
            thresholdTokens,
            usedTokens: measured === undefined || !Number.isFinite(measured) ? null : Math.max(0, Math.round(measured)),
          }
        }),
      })
    }),
  )

export default DshxPlugin.make({
  name: '@dshfiles/context-compaction',
  inject: ['llm'],
  Config: CompactionConfig,
  layer: config => CompactionEngine(config).pipe(Layer.provide(Llm.layer)),
  apis: [Api.bind(compactionApi, { threshold: input => CompactionThresholds.use(thresholds => thresholds.read(input.sessionId)) })],
})
