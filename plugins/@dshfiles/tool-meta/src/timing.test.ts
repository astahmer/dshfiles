import { describe, expect, it } from 'vitest'
import type { ToolMetaTranslate } from './locales.js'
import { ToolTimingModel, type WaitTimerOwner } from './timing.js'

const templates = new Map([
  ['seconds', '{n} s'],
  ['minutes', '{m} min {s} s'],
  ['hours', '{h} h {m} min'],
  ['secondsAgo', '{n} s ago'],
  ['minutesAgo', '{n} min ago'],
  ['hoursAgo', '{n} h ago'],
  ['daysAgo', '{n} d ago'],
  ['ended', 'ended {end}'],
  ['runningLabel', 'Running for {duration}, started {start}'],
  ['finishedLabel', 'Took {duration}, started {start}'],
  ['endedLabel', 'Finished {end}'],
  ['waitElapsed', 'Waiting for {duration}'],
  ['waitRemaining', '{duration} until wait timeout'],
  ['waitProgress', 'Wait timeout countdown: {remaining} remaining of {timeout}'],
])
const t: ToolMetaTranslate = (key, params) => (templates.get(key) ?? key).replaceAll(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))

const at = (time: string): number => new Date(`2026-10-14T${time}`).getTime()

describe('toolTimingOf', () => {
  it('reads a running call from its dispatch time and a settled one from its call and result times', () => {
    expect(ToolTimingModel.toolTimingOf({ phase: 'preparing' })).toBeNull()
    expect(ToolTimingModel.toolTimingOf({ phase: 'start', block: { time: 1_000 } })).toEqual({ kind: 'running', startedAt: 1_000 })
    expect(ToolTimingModel.toolTimingOf({ phase: 'result', block: { time: 2_200, callTime: 1_000 } })).toEqual({
      kind: 'finished',
      startedAt: 1_000,
      endedAt: 2_200,
    })
    expect(ToolTimingModel.toolTimingOf({ phase: 'result', block: { time: 2_200, callTime: null } })).toEqual({ kind: 'ended', endedAt: 2_200 })
  })

  it('reports an owner the native renderer reshaped instead of guessing', () => {
    expect(ToolTimingModel.toolTimingOf({ phase: 'start', block: { time: Number.NaN } })).toBeUndefined()
    expect(ToolTimingModel.toolTimingOf({ phase: 'result', block: { time: 2_200, callTime: Number.POSITIVE_INFINITY } })).toBeUndefined()
  })
})

describe('waitTimerOf', () => {
  const waitCall = (toolName: WaitTimerOwner['toolName'], args: string): WaitTimerOwner => ({
    phase: 'start',
    toolName,
    block: { time: 1_000, argsRaw: args },
  })

  it('shows elapsed and remaining time for an explicit timed job wait', () => {
    expect(ToolTimingModel.waitTimerOf(waitCall('job_output', '{"wait":true,"timeout_ms":300000}'), 91_000)).toEqual({
      timeoutMs: 300_000,
      elapsedMs: 90_000,
      remainingMs: 210_000,
    })
    expect(ToolTimingModel.waitTimerOf(waitCall('background_jobs_wait', '{"timeoutMs":120000}'), 181_000)).toEqual({
      timeoutMs: 120_000,
      elapsedMs: 180_000,
      remainingMs: 0,
    })
    expect(ToolTimingModel.waitTimerOf(waitCall('background_jobs_wait', '{}'), 91_000)).toEqual({
      timeoutMs: undefined,
      elapsedMs: 90_000,
      remainingMs: undefined,
    })
  })

  it('shows indeterminate elapsed time without a timeout, and omits malformed or non-wait calls', () => {
    expect(ToolTimingModel.waitTimerOf(waitCall('job_output', '{"wait":true}'), 91_000)).toEqual({
      timeoutMs: undefined,
      elapsedMs: 90_000,
      remainingMs: undefined,
    })
    expect(ToolTimingModel.waitTimerOf(waitCall('job_output', '{"wait":false,"timeout_ms":300000}'), 91_000)).toBeUndefined()
    expect(ToolTimingModel.waitTimerOf(waitCall('background_jobs_wait', '{'), 91_000)).toBeUndefined()
  })
})

describe('formatDuration', () => {
  it('keeps tenths for a short finished call and whole seconds for a live counter', () => {
    expect(ToolTimingModel.formatDuration({ ms: 1_234, live: false, t })).toBe('1.2 s')
    expect(ToolTimingModel.formatDuration({ ms: 1_234, live: true, t })).toBe('1 s')
    expect(ToolTimingModel.formatDuration({ ms: 42_900, live: false, t })).toBe('42 s')
    expect(ToolTimingModel.formatDuration({ ms: 125_000, live: false, t })).toBe('2 min 5 s')
    expect(ToolTimingModel.formatDuration({ ms: 3_720_000, live: false, t })).toBe('1 h 2 min')
    expect(ToolTimingModel.formatDuration({ ms: -50, live: true, t })).toBe('0 s')
  })
})

describe('formatMoment', () => {
  it('shows the clock time today and adds the day otherwise', () => {
    expect(ToolTimingModel.formatMoment({ at: at('14:02:11'), now: at('15:00:00'), format: 'absolute', t })).toMatch(/^14:02:11$/)
    expect(ToolTimingModel.formatMoment({ at: at('14:02:11') - 86_400_000, now: at('15:00:00'), format: 'absolute', t })).toMatch(/13.* 14:02:11$/)
  })

  it('counts back from now in the relative format', () => {
    const now = at('15:00:00')
    expect(ToolTimingModel.formatMoment({ at: now - 12_000, now, format: 'relative', t })).toBe('12 s ago')
    expect(ToolTimingModel.formatMoment({ at: now - 5 * 60_000, now, format: 'relative', t })).toBe('5 min ago')
    expect(ToolTimingModel.formatMoment({ at: now - 3 * 3_600_000, now, format: 'relative', t })).toBe('3 h ago')
    expect(ToolTimingModel.formatMoment({ at: now - 2 * 86_400_000, now, format: 'relative', t })).toBe('2 d ago')
  })
})

describe('describeTiming', () => {
  it('pairs the duration with the start time, live while the call runs', () => {
    const now = at('14:02:15')
    expect(ToolTimingModel.describeTiming({ timing: { kind: 'running', startedAt: at('14:02:11') }, now, format: 'absolute', t })).toEqual({
      text: '4 s · 14:02:11',
      label: 'Running for 4 s, started 14:02:11',
    })
    expect(
      ToolTimingModel.describeTiming({ timing: { kind: 'finished', startedAt: at('14:02:11'), endedAt: at('14:02:11') + 1_200 }, now, format: 'relative', t }),
    ).toEqual({
      text: '1.2 s · 4 s ago',
      label: 'Took 1.2 s, started 4 s ago',
    })
    expect(ToolTimingModel.describeTiming({ timing: { kind: 'ended', endedAt: at('14:02:12') }, now, format: 'absolute', t }).text).toBe('ended 14:02:12')
  })
})
