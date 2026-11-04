import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Llm } from '@dshfiles/dshx/effect/llm'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Clock, Context, Duration, Effect, FiberMap, Layer, Option, Ref, Schema, Stream } from 'effect'
import { sessionWarmingSettings } from './settings.js'

export type WarmingSettingsValue = SettingsValue<typeof sessionWarmingSettings.schema>

export const WarmingSettings = Settings.Tag<WarmingSettingsValue>(sessionWarmingSettings.namespace)

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

type StopReason = NonNullable<WarmingSessionStatus['stopped']>

const HOUR_MS = 60 * 60_000
const WARM_TIMEOUT = Duration.minutes(1)
const MAX_DETAIL_CHARS = 400

const ErrorWithMessage = Schema.Struct({ message: Schema.String })

/** A warm-up request failed or timed out; `detail` is the bounded provider explanation shown in the status. */
export class WarmFailure extends Schema.TaggedError<WarmFailure>()('WarmFailure', {
  provider: Schema.String,
  model: Schema.String,
  timedOut: Schema.Boolean,
  detail: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Warming ${this.provider}/${this.model} ${this.timedOut ? 'timed out' : 'failed'}${this.detail === undefined ? '' : `: ${this.detail}`}`
  }
}

const failureDetail = (cause: unknown): string | undefined =>
  Option.getOrUndefined(Option.map(Schema.decodeUnknownOption(ErrorWithMessage)(cause), error => error.message.slice(0, MAX_DETAIL_CHARS)))

export type WarmingEvent =
  | { readonly kind: 'request'; readonly sessionId: string; readonly request: GenerateOptions }
  | { readonly kind: 'turn-start' | 'turn-end' | 'forget'; readonly sessionId: string }

interface Tracked {
  readonly request: GenerateOptions | null
  readonly provider: string
  readonly model: string
  readonly warmups: number
  readonly nextAt: number | null
  readonly lastWarmedAt: number | null
  readonly last: WarmResult | null
  readonly stopped: StopReason | null
  readonly error: string | null
}

/** What one warm-up stream reported: its last usage, and the provider failure of an error finish. */
interface WarmStream {
  readonly usage: WarmResult
  readonly failure: unknown
}

const noUsage: WarmResult = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/**
 * Keeps idle threads' provider prompt caches warm: after a turn, re-sends its last request for one output token each
 * interval, within a per-idle and a rolling hourly budget shared by every thread.
 */
export class SessionWarming extends Context.Service<
  SessionWarming,
  {
    readonly handle: (event: WarmingEvent) => Effect.Effect<void>
    readonly status: Effect.Effect<{ readonly enabled: boolean; readonly sessions: WarmingSessionStatus[]; readonly warmupsLastHour: number }>
  }
>()('@dshfiles/session-warming/SessionWarming') {
  static readonly sessionStatusSchema = sessionStatusSchema

  static readonly layer = Layer.effect(
    SessionWarming,
    Effect.gen(function* () {
      const settings = yield* WarmingSettings
      const llm = yield* Llm
      const sessions = yield* Ref.make<ReadonlyMap<string, Tracked>>(new Map())
      const recent = yield* Ref.make<readonly number[]>([])
      const timers = yield* FiberMap.make<string>()

      const read = (sessionId: string) => Effect.map(Ref.get(sessions), map => map.get(sessionId))
      const update = (sessionId: string, change: (tracked: Tracked) => Tracked) =>
        Ref.update(sessions, map => {
          const tracked = map.get(sessionId)
          return tracked === undefined ? map : new Map(map).set(sessionId, change(tracked))
        })
      const stop = (sessionId: string, reason: StopReason) => update(sessionId, tracked => ({ ...tracked, stopped: reason, request: null, nextAt: null }))

      const warm = Effect.fn('session-warming warm')(function* (request: GenerateOptions) {
        const failure = (input: { readonly timedOut: boolean; readonly cause?: unknown }) => {
          const detail = failureDetail(input.cause)
          return new WarmFailure({
            provider: request.provider,
            model: request.model,
            timedOut: input.timedOut,
            ...(input.cause !== undefined && { cause: input.cause }),
            ...(detail !== undefined && { detail }),
          })
        }
        const streamed = yield* llm.stream({ ...request, maxTokens: 1 }).pipe(
          Stream.runFold(
            (): WarmStream => ({ usage: noUsage, failure: undefined }),
            (current, chunk): WarmStream => {
              if (chunk.type === 'finish' && chunk.reason.kind === 'error') return { ...current, failure: chunk.reason.failure }
              if (chunk.type !== 'usage') return current
              return {
                ...current,
                usage: {
                  inputTokens: chunk.usage.inputTokens,
                  outputTokens: chunk.usage.outputTokens,
                  cacheReadTokens: chunk.usage.cacheReadTokens ?? 0,
                  cacheWriteTokens: chunk.usage.cacheWriteTokens ?? 0,
                },
              }
            },
          ),
          Effect.mapError(error => failure({ timedOut: false, cause: error.cause })),
          Effect.timeoutOrElse({ duration: WARM_TIMEOUT, orElse: () => Effect.fail(failure({ timedOut: true })) }),
        )
        if (streamed.failure !== undefined) return yield* failure({ timedOut: false, cause: streamed.failure })
        const result = streamed.usage
        yield* Effect.annotateCurrentSpan({
          'gen_ai.provider.name': request.provider,
          'gen_ai.request.model': request.model,
          'session_warming.cache_read_tokens': result.cacheReadTokens,
        })
        return result
      })

      const fire = Effect.fn('session-warming fire')(function* (sessionId: string) {
        const current = yield* settings.get
        if (!current.enabled) {
          yield* stop(sessionId, 'disabled')
          return false
        }
        const now = yield* Clock.currentTimeMillis
        const admitted = yield* Ref.modify(recent, (list): readonly [boolean, readonly number[]] => {
          const kept = list.filter(at => at > now - HOUR_MS)
          return kept.length >= current.maxWarmupsPerHour ? [false, kept] : [true, [...kept, now]]
        })
        if (!admitted) {
          yield* stop(sessionId, 'hourly-limit')
          return false
        }
        const request = (yield* read(sessionId))?.request
        if (request === null || request === undefined) return false
        yield* update(sessionId, tracked => ({ ...tracked, warmups: tracked.warmups + 1 }))
        const warmed = yield* Effect.result(warm(request))
        if (warmed._tag === 'Failure') {
          yield* update(sessionId, tracked => ({ ...tracked, stopped: 'failed', request: null, error: warmed.failure.detail ?? warmed.failure.message }))
          return false
        }
        const warmedAt = yield* Clock.currentTimeMillis
        yield* update(sessionId, tracked => ({ ...tracked, last: warmed.success, lastWarmedAt: warmedAt, error: null }))
        return true
      })

      const warmLoop = (sessionId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const tracked = yield* read(sessionId)
          if (tracked === undefined || tracked.request === null) return
          const current = yield* settings.get
          if (!current.enabled || (current.providers.length > 0 && !current.providers.includes(tracked.provider))) return yield* stop(sessionId, 'disabled')
          if (tracked.warmups >= current.maxWarmupsPerIdle) return yield* stop(sessionId, 'idle-limit')
          const delay = Duration.minutes(current.intervalMinutes)
          const now = yield* Clock.currentTimeMillis
          yield* update(sessionId, entry => ({ ...entry, nextAt: now + Duration.toMillis(delay) }))
          yield* Effect.sleep(delay)
          yield* update(sessionId, entry => ({ ...entry, nextAt: null }))
          if (yield* fire(sessionId)) yield* warmLoop(sessionId)
        })

      const cancel = (sessionId: string) =>
        FiberMap.remove(timers, sessionId).pipe(Effect.andThen(update(sessionId, tracked => ({ ...tracked, nextAt: null }))))

      const handle = Effect.fn('session-warming handle event')(function* (event: WarmingEvent) {
        const tracked = yield* read(event.sessionId)
        if (event.kind === 'request') {
          if (tracked !== undefined && tracked.provider === event.request.provider && tracked.model === event.request.model)
            return yield* update(event.sessionId, entry => ({ ...entry, request: event.request, stopped: null }))
          yield* FiberMap.remove(timers, event.sessionId)
          return yield* Ref.update(sessions, map =>
            new Map(map).set(event.sessionId, {
              request: event.request,
              provider: event.request.provider,
              model: event.request.model,
              warmups: 0,
              nextAt: null,
              lastWarmedAt: null,
              last: null,
              stopped: null,
              error: null,
            }),
          )
        }
        if (event.kind === 'forget') {
          yield* FiberMap.remove(timers, event.sessionId)
          return yield* Ref.update(sessions, map => {
            const next = new Map(map)
            next.delete(event.sessionId)
            return next
          })
        }
        if (tracked === undefined) return
        if (event.kind === 'turn-start') {
          yield* cancel(event.sessionId)
          return yield* update(event.sessionId, entry => ({ ...entry, warmups: 0, stopped: null, error: null }))
        }
        yield* FiberMap.run(timers, event.sessionId, warmLoop(event.sessionId))
      })

      const status = Effect.gen(function* () {
        const current = yield* settings.get
        const now = yield* Clock.currentTimeMillis
        const tracked = yield* Ref.get(sessions)
        return {
          enabled: current.enabled,
          sessions: [...tracked.entries()].map(([sessionId, entry]) => ({
            sessionId,
            provider: entry.provider,
            model: entry.model,
            warmups: entry.warmups,
            nextAt: entry.nextAt,
            lastWarmedAt: entry.lastWarmedAt,
            last: entry.last,
            stopped: entry.stopped,
            error: entry.error,
          })),
          warmupsLastHour: (yield* Ref.get(recent)).filter(at => at > now - HOUR_MS).length,
        }
      }).pipe(Effect.withSpan('session-warming status'))

      return SessionWarming.of({ handle, status })
    }),
  )
}
