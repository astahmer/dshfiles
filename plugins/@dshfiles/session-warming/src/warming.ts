import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Context, Effect, Fiber, Layer, Queue, Result, Schedule, Schema, type Scope } from 'effect'

export interface WarmingSettings {
  readonly enabled: boolean
  readonly intervalMinutes: number
  readonly maxWarmupsPerIdle: number
  readonly maxWarmupsPerHour: number
  readonly providers: readonly string[]
}

export interface WarmResult {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
}

const sessionStatusSchema = Schema.Struct({
  sessionId: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  warmups: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  nextAt: Schema.NullOr(Schema.Number.check(Schema.isInt())),
  lastWarmedAt: Schema.NullOr(Schema.Number.check(Schema.isInt())),
  last: Schema.NullOr(
    Schema.Struct({
      inputTokens: Schema.Number,
      cacheReadTokens: Schema.Number,
      cacheWriteTokens: Schema.Number,
      outputTokens: Schema.Number,
    }),
  ),
  stopped: Schema.NullOr(Schema.Literals(['idle-limit', 'hourly-limit', 'failed', 'disabled'])),
  error: Schema.NullOr(Schema.String),
})

export type WarmingSessionStatus = typeof sessionStatusSchema.Type

const HOUR_MS = 60 * 60_000

interface Tracked<Request> {
  request: Request | null
  readonly provider: string
  readonly model: string
  warmups: number
  fiber: Fiber.Fiber<void, never> | undefined
  nextAt: number | null
  lastWarmedAt: number | null
  last: WarmResult | null
  stopped: WarmingSessionStatus['stopped']
  error: string | null
}

export class WarmFailure extends Schema.TaggedError<WarmFailure>()('WarmFailure', { message: Schema.String }) {}

interface WarmingRuntime {
  readonly requests: Queue.Queue<
    | { readonly kind: 'request'; readonly sessionId: string; readonly request: GenerateOptions }
    | { readonly kind: 'turn-start' | 'turn-end' | 'forget'; readonly sessionId: string }
  >
  readonly handle: (
    event:
      | { readonly kind: 'request'; readonly sessionId: string; readonly request: GenerateOptions }
      | { readonly kind: 'turn-start' | 'turn-end' | 'forget'; readonly sessionId: string },
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly status: () => Effect.Effect<{ readonly enabled: boolean; readonly sessions: WarmingSessionStatus[]; readonly warmupsLastHour: number }>
}

export class SessionWarming extends Context.Service<SessionWarming, WarmingRuntime>()('dshfiles/session-warming/Runtime') {
  static readonly sessionStatusSchema = sessionStatusSchema

  static readonly warm = Effect.fn('session-warming warm')(function* (input: {
    readonly llm: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> }
    readonly request: GenerateOptions
  }) {
    return yield* Effect.tryPromise({
      try: async () => {
        let result: WarmResult = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        for await (const chunk of input.llm.stream({ ...input.request, maxTokens: 1, signal: AbortSignal.timeout(60_000) })) {
          if (chunk.type !== 'usage') continue
          result = {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
            cacheReadTokens: chunk.usage.cacheReadTokens ?? 0,
            cacheWriteTokens: chunk.usage.cacheWriteTokens ?? 0,
          }
        }
        return result
      },
      catch: error => new WarmFailure({ message: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400) }),
    }).pipe(
      Effect.tap(result =>
        Effect.annotateCurrentSpan({
          'gen_ai.provider.name': input.request.provider,
          'gen_ai.request.model': input.request.model,
          'session_warming.cache_read_tokens': result.cacheReadTokens,
        }),
      ),
    )
  })

  static layer(input: {
    readonly settings: () => WarmingSettings
    readonly llm: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> }
  }): Layer.Layer<SessionWarming> {
    return Layer.effect(
      SessionWarming,
      Effect.gen(function* () {
        const requests = yield* Queue.unbounded<Parameters<WarmingRuntime['handle']>[0]>()
        const sessions = new Map<string, Tracked<GenerateOptions>>()
        const recent: number[] = []
        const now = Date.now

        const cancel = (tracked: Tracked<GenerateOptions>) =>
          Effect.gen(function* () {
            if (tracked.fiber !== undefined) yield* Fiber.interrupt(tracked.fiber)
            tracked.fiber = undefined
            tracked.nextAt = null
          })
        const stop = (tracked: Tracked<GenerateOptions>, reason: NonNullable<WarmingSessionStatus['stopped']>) => {
          tracked.stopped = reason
          tracked.request = null
        }
        const schedule = (sessionId: string, tracked: Tracked<GenerateOptions>): Effect.Effect<void, never, Scope.Scope> =>
          Effect.gen(function* () {
            yield* cancel(tracked)
            if (tracked.request === null) return
            const settings = input.settings()
            if (!settings.enabled || (settings.providers.length > 0 && !settings.providers.includes(tracked.provider))) {
              stop(tracked, 'disabled')
              return
            }
            if (tracked.warmups >= settings.maxWarmupsPerIdle) {
              stop(tracked, 'idle-limit')
              return
            }
            const delayMs = settings.intervalMinutes * 60_000
            tracked.nextAt = now() + delayMs
            tracked.fiber = yield* Effect.forkScoped(
              Effect.repeat(Effect.sleep(`${delayMs} millis`).pipe(Effect.andThen(fire(sessionId, tracked))), Schedule.recurs(0)).pipe(Effect.asVoid),
            )
          })
        const fire = (sessionId: string, tracked: Tracked<GenerateOptions>): Effect.Effect<void, never, Scope.Scope> =>
          Effect.gen(function* () {
            tracked.fiber = undefined
            tracked.nextAt = null
            if (sessions.get(sessionId) !== tracked) return
            const settings = input.settings()
            if (!settings.enabled) {
              stop(tracked, 'disabled')
              return
            }
            while (recent.length > 0 && (recent[0] ?? 0) <= now() - HOUR_MS) recent.shift()
            if (recent.length >= settings.maxWarmupsPerHour) {
              stop(tracked, 'hourly-limit')
              return
            }
            recent.push(now())
            const request = tracked.request
            if (request === null) return
            tracked.warmups += 1
            const warmed = yield* Effect.result(SessionWarming.warm({ llm: input.llm, request }))
            if (Result.isFailure(warmed)) {
              stop(tracked, 'failed')
              tracked.error = warmed.failure.message
              return
            }
            tracked.last = warmed.success
            tracked.lastWarmedAt = now()
            tracked.error = null
            if (sessions.get(sessionId) === tracked && tracked.fiber === undefined) yield* schedule(sessionId, tracked)
          })
        const handle = Effect.fn('session-warming handle event')(function* (event: Parameters<WarmingRuntime['handle']>[0]) {
          if (event.kind === 'request') {
            const tracked = sessions.get(event.sessionId)
            if (tracked !== undefined && tracked.provider === event.request.provider && tracked.model === event.request.model) {
              tracked.request = event.request
              tracked.stopped = null
              return
            }
            if (tracked !== undefined) yield* cancel(tracked)
            sessions.set(event.sessionId, {
              request: event.request,
              provider: event.request.provider,
              model: event.request.model,
              warmups: 0,
              fiber: undefined,
              nextAt: null,
              lastWarmedAt: null,
              last: null,
              stopped: null,
              error: null,
            })
            return
          }
          const tracked = sessions.get(event.sessionId)
          if (event.kind === 'forget') {
            if (tracked !== undefined) yield* cancel(tracked)
            sessions.delete(event.sessionId)
            return
          }
          if (tracked === undefined) return
          if (event.kind === 'turn-start') {
            yield* cancel(tracked)
            tracked.warmups = 0
            tracked.stopped = null
            tracked.error = null
            return
          }
          yield* schedule(event.sessionId, tracked)
        })
        const status = Effect.fn('session-warming status')(() =>
          Effect.sync(() => {
            const settings = input.settings()
            return {
              enabled: settings.enabled,
              sessions: [...sessions.entries()].map(([sessionId, tracked]) => ({
                sessionId,
                provider: tracked.provider,
                model: tracked.model,
                warmups: tracked.warmups,
                nextAt: tracked.nextAt,
                lastWarmedAt: tracked.lastWarmedAt,
                last: tracked.last,
                stopped: tracked.stopped,
                error: tracked.error,
              })),
              warmupsLastHour: recent.filter(at => at > now() - HOUR_MS).length,
            }
          }),
        )
        yield* Effect.forkScoped(Effect.forever(Queue.take(requests).pipe(Effect.flatMap(handle))))
        return { requests, handle, status }
      }),
    )
  }
}
