import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { ToolMetaTranslate } from './locales.js'

export type TimeFormat = 'absolute' | 'relative'

export type ToolTiming =
  | { readonly kind: 'running'; readonly startedAt: number }
  | { readonly kind: 'finished'; readonly startedAt: number; readonly endedAt: number }
  | { readonly kind: 'ended'; readonly endedAt: number }

export interface WaitTimer {
  readonly timeoutMs: number | undefined
  readonly elapsedMs: number
  readonly remainingMs: number | undefined
  readonly waitingFor: 'job-output' | 'all-jobs' | { readonly kind: 'jobs'; readonly count: number; readonly until: 'settled' | 'any-settled' }
}

/**
 * The slice of the native `tool.call.toolview` owner this plugin reads. A dispatched call carries its `tool/call` time;
 * a result carries its own `tool/result` time and, while the call is still in the loaded window, the call's time.
 */
const toolCallOwnerSchema = Schema.Union([
  Schema.Struct({ phase: Schema.Literal('preparing') }),
  Schema.Struct({ phase: Schema.Literal('start'), block: Schema.Struct({ time: Schema.Number.check(Schema.isFinite()) }) }),
  Schema.Struct({
    phase: Schema.Literal('result'),
    block: Schema.Struct({ time: Schema.Number, callTime: Schema.NullOr(Schema.Number.check(Schema.isFinite())) }),
  }),
])

const waitCallOwnerSchema = Schema.Struct({
  phase: Schema.Literal('start'),
  toolName: Schema.Literals(['job_output', 'background_jobs_wait']),
  block: Schema.Struct({ time: Schema.Number.check(Schema.isFinite()), argsRaw: Schema.String }),
})

export type WaitTimerOwner = Schema.Codec.Encoded<typeof waitCallOwnerSchema>

const waitArgumentsSchema = Schema.Struct({
  wait: Schema.optional(Schema.Boolean),
  jobId: Schema.optional(Schema.String),
  jobIds: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(20))),
  until: Schema.optional(Schema.Literals(['settled', 'any-settled'])),
  timeout_ms: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(3_600_000))),
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(3_600_000))),
})

/** What this plugin needs of a `ToolCallOwnerProps`; the native owner satisfies it. */
export type ToolCallTimes = Schema.Codec.Encoded<typeof toolCallOwnerSchema>

export class ToolTimingModel {
  private static readonly clockFormat = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  private static readonly dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

  /**
   * `null` while the model is still writing the arguments; `undefined` when the owner no longer has the shape read here.
   * The owner comes from another package at runtime, so its declared type is checked rather than trusted.
   */
  static readonly toolTimingOf = (owner: ToolCallTimes): ToolTiming | null | undefined => {
    const parsed = Schema.decodeUnknownOption(toolCallOwnerSchema)(owner)
    if (Option.isNone(parsed)) return undefined
    const call = parsed.value
    if (call.phase === 'preparing') return null
    if (call.phase === 'start') return { kind: 'running', startedAt: call.block.time }
    if (call.block.callTime === null) return { kind: 'ended', endedAt: call.block.time }
    return { kind: 'finished', startedAt: call.block.callTime, endedAt: call.block.time }
  }

  /** Show wait progress without inventing a deadline when the call has no explicit timeout. */
  static readonly waitTimerOf = (owner: WaitTimerOwner, now: number): WaitTimer | undefined => {
    const parsedOwner = Schema.decodeUnknownOption(waitCallOwnerSchema)(owner)
    if (Option.isNone(parsedOwner)) return undefined
    let rawArguments: JsonValue
    try {
      rawArguments = decodeJson(jsonValueSchema, parsedOwner.value.block.argsRaw)
    } catch {
      return undefined
    }
    const parsedArguments = Schema.decodeUnknownOption(waitArgumentsSchema)(rawArguments)
    if (Option.isNone(parsedArguments)) return undefined
    if (parsedOwner.value.toolName === 'job_output' && parsedArguments.value.wait !== true) return undefined
    const timeoutMs = parsedArguments.value.timeoutMs ?? parsedArguments.value.timeout_ms
    const elapsedMs = Math.max(0, now - parsedOwner.value.block.time)
    const waitingFor =
      parsedOwner.value.toolName === 'job_output'
        ? 'job-output'
        : parsedArguments.value.jobIds === undefined
          ? 'all-jobs'
          : { kind: 'jobs' as const, count: parsedArguments.value.jobIds.length, until: parsedArguments.value.until ?? 'settled' }
    return {
      timeoutMs,
      elapsedMs,
      remainingMs: timeoutMs === undefined ? undefined : Math.max(0, timeoutMs - elapsedMs),
      waitingFor,
    }
  }

  /** A finished call keeps tenths under ten seconds; a running counter ticks in whole seconds. */
  static readonly formatDuration = (input: { readonly ms: number; readonly live: boolean; readonly t: ToolMetaTranslate }): string => {
    const ms = Math.max(0, input.ms)
    if (ms < 10_000 && !input.live) return input.t('seconds', { n: (Math.round(ms / 100) / 10).toFixed(1) })
    const totalSeconds = Math.floor(ms / 1000)
    if (totalSeconds < 60) return input.t('seconds', { n: String(totalSeconds) })
    const totalMinutes = Math.floor(totalSeconds / 60)
    if (totalMinutes < 60) return input.t('minutes', { m: String(totalMinutes), s: String(totalSeconds % 60) })
    return input.t('hours', { h: String(Math.floor(totalMinutes / 60)), m: String(totalMinutes % 60) })
  }

  static readonly formatMoment = (input: { readonly at: number; readonly now: number; readonly format: TimeFormat; readonly t: ToolMetaTranslate }): string => {
    if (input.format === 'absolute') {
      const clock = ToolTimingModel.clockFormat.format(input.at)
      return new Date(input.at).toDateString() === new Date(input.now).toDateString() ? clock : `${ToolTimingModel.dayFormat.format(input.at)} ${clock}`
    }
    const seconds = Math.max(0, Math.floor((input.now - input.at) / 1000))
    if (seconds < 60) return input.t('secondsAgo', { n: String(seconds) })
    if (seconds < 3_600) return input.t('minutesAgo', { n: String(Math.floor(seconds / 60)) })
    if (seconds < 86_400) return input.t('hoursAgo', { n: String(Math.floor(seconds / 3_600)) })
    return input.t('daysAgo', { n: String(Math.floor(seconds / 86_400)) })
  }

  /** The visible line ("1.2 s · 14:02:11") and its spoken label. */
  static readonly describeTiming = (input: {
    readonly timing: ToolTiming
    readonly now: number
    readonly format: TimeFormat
    readonly t: ToolMetaTranslate
  }) => {
    const { timing, now, format, t } = input
    if (timing.kind === 'ended') {
      const end = ToolTimingModel.formatMoment({ at: timing.endedAt, now, format, t })
      return { text: t('ended', { end }), label: t('endedLabel', { end }) }
    }
    const live = timing.kind === 'running'
    const duration = ToolTimingModel.formatDuration({ ms: (live ? now : timing.endedAt) - timing.startedAt, live, t })
    const start = ToolTimingModel.formatMoment({ at: timing.startedAt, now, format, t })
    return { text: `${duration} · ${start}`, label: t(live ? 'runningLabel' : 'finishedLabel', { duration, start }) }
  }
}
