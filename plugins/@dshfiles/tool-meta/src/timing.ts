import { z } from 'zod'
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
}

/**
 * The slice of the native `tool.call.toolview` owner this plugin reads. A dispatched call carries its `tool/call` time;
 * a result carries its own `tool/result` time and, while the call is still in the loaded window, the call's time.
 */
const toolCallOwnerSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('preparing') }),
  z.object({ phase: z.literal('start'), block: z.object({ time: z.number() }) }),
  z.object({ phase: z.literal('result'), block: z.object({ time: z.number(), callTime: z.number().nullable() }) }),
])

const waitCallOwnerSchema = z.object({
  phase: z.literal('start'),
  toolName: z.enum(['job_output', 'background_jobs_wait']),
  block: z.object({ time: z.number().finite(), argsRaw: z.string() }),
})

export type WaitTimerOwner = z.input<typeof waitCallOwnerSchema>

const waitArgumentsSchema = z.object({
  wait: z.boolean().optional(),
  timeout_ms: z.number().int().positive().max(3_600_000).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
})

/** What this plugin needs of a `ToolCallOwnerProps`; the native owner satisfies it. */
export type ToolCallTimes = z.input<typeof toolCallOwnerSchema>

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
    const parsed = toolCallOwnerSchema.safeParse(owner)
    if (!parsed.success) return undefined
    const call = parsed.data
    if (call.phase === 'preparing') return null
    if (call.phase === 'start') return { kind: 'running', startedAt: call.block.time }
    if (call.block.callTime === null) return { kind: 'ended', endedAt: call.block.time }
    return { kind: 'finished', startedAt: call.block.callTime, endedAt: call.block.time }
  }

  /** Show wait progress without inventing a deadline when the call has no explicit timeout. */
  static readonly waitTimerOf = (owner: WaitTimerOwner, now: number): WaitTimer | undefined => {
    const parsedOwner = waitCallOwnerSchema.safeParse(owner)
    if (!parsedOwner.success) return undefined
    let rawArguments: unknown
    try {
      rawArguments = JSON.parse(parsedOwner.data.block.argsRaw)
    } catch {
      return undefined
    }
    const parsedArguments = waitArgumentsSchema.safeParse(rawArguments)
    if (!parsedArguments.success) return undefined
    if (parsedOwner.data.toolName === 'job_output' && parsedArguments.data.wait !== true) return undefined
    const timeoutMs = parsedArguments.data.timeoutMs ?? parsedArguments.data.timeout_ms
    const elapsedMs = Math.max(0, now - parsedOwner.data.block.time)
    return {
      timeoutMs,
      elapsedMs,
      remainingMs: timeoutMs === undefined ? undefined : Math.max(0, timeoutMs - elapsedMs),
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
