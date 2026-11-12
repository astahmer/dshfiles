import { describe, expect, it } from 'vitest'
import { RunFoldModel } from './run-fold-model.ts'
import type { RunFoldMemberState, RunFoldText } from './run-folds.ts'

const job: RunFoldText = { count: count => `${String(count)} ${count === 1 ? 'background job' : 'background jobs'}`, active: 'running', done: 'done' }
const agent: RunFoldText = { count: count => `${String(count)} ${count === 1 ? 'subagent' : 'subagents'}`, active: 'working', done: 'finished' }
const words = { stopped: 'stopped', failed: 'failed', needsYou: 'need you' }
const state = (status: RunFoldMemberState['status'], startedAt?: number, finishedAt?: number): RunFoldMemberState => {
  if (startedAt === undefined) return { status }
  return finishedAt === undefined ? { status, startedAt } : { status, startedAt, finishedAt }
}
const text = (parts: readonly { readonly text: string }[]): string => parts.map(part => part.text).join(' · ')

describe('RunFoldModel.partition', () => {
  it('folds a run of consecutive claimed rows', () => {
    expect(RunFoldModel.partition(['job', 'job', 'job'], true)).toEqual([{ start: 0, end: 3 }])
  })

  it('leaves a single claimed row alone', () => {
    expect(RunFoldModel.partition([undefined, 'job', undefined], true)).toEqual([])
  })

  it('breaks runs at an unclaimed row', () => {
    expect(RunFoldModel.partition(['job', 'job', undefined, 'agent', 'agent', undefined, 'job'], true)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ])
  })

  it('keeps mixed kinds in one run', () => {
    expect(RunFoldModel.partition(['job', 'agent', 'job'], true)).toEqual([{ start: 0, end: 3 }])
  })

  it('folds nothing when the view mode does not fold (Verbose)', () => {
    expect(RunFoldModel.partition(['job', 'job', 'job'], false)).toEqual([])
  })
})

describe('RunFoldModel.memberHidden', () => {
  it('hides members of a collapsed run', () => {
    expect(RunFoldModel.memberHidden({ expanded: false, problem: false })).toBe(true)
  })

  it('never hides a problem, even collapsed', () => {
    expect(RunFoldModel.memberHidden({ expanded: false, problem: true })).toBe(false)
  })

  it('shows every member of an expanded run', () => {
    expect(RunFoldModel.memberHidden({ expanded: true, problem: false })).toBe(false)
  })

  it('counts failed and needs-you as problems, nothing else', () => {
    const statuses: readonly RunFoldMemberState['status'][] = ['working', 'done', 'stopped', 'failed', 'needs-you']
    expect(statuses.map(status => RunFoldModel.isProblem(status))).toEqual([false, false, false, true, true])
  })
})

describe('RunFoldModel.summary', () => {
  it('names one kind with its live and settled counts', () => {
    const parts = RunFoldModel.summary([{ text: job, states: [state('working'), state('working'), state('done')] }], words)
    expect(text(parts)).toBe('3 background jobs · 2 running · 1 done')
  })

  it('names each kind of a mixed run with its noun', () => {
    const parts = RunFoldModel.summary(
      [
        { text: job, states: [state('working'), state('working')] },
        { text: agent, states: [state('working'), state('done')] },
      ],
      words,
    )
    expect(text(parts)).toBe('2 background jobs running · 1 subagent working · 1 subagent finished')
  })

  it('counts a failure in the failed tone and a waiting member in the needs-you tone', () => {
    const parts = RunFoldModel.summary([{ text: agent, states: [state('working'), state('needs-you'), state('failed')] }], words)
    expect(text(parts)).toBe('3 subagents · 1 need you · 1 failed · 1 working')
    expect(parts.map(part => part.tone)).toEqual(['plain', 'needs-you', 'failed', 'plain'])
  })

  it('leads a mixed run with its totals when a member failed', () => {
    const parts = RunFoldModel.summary(
      [
        { text: job, states: [state('working'), state('failed')] },
        { text: agent, states: [state('working')] },
      ],
      words,
    )
    expect(text(parts)).toBe('2 background jobs · 1 subagent · 1 failed · 1 background job running · 1 subagent working')
  })

  it('reports stopped members', () => {
    expect(text(RunFoldModel.summary([{ text: job, states: [state('stopped'), state('done')] }], words))).toBe('2 background jobs · 1 done · 1 stopped')
  })
})

describe('RunFoldModel.glyph and longest', () => {
  it('lets a problem outrank work in progress', () => {
    expect(RunFoldModel.glyph(RunFoldModel.count([state('working'), state('failed')]))).toBe('failed')
    expect(RunFoldModel.glyph(RunFoldModel.count([state('working'), state('done')]))).toBe('working')
    expect(RunFoldModel.glyph(RunFoldModel.count([state('done'), state('done')]))).toBe('done')
  })

  it('ticks from the earliest working start', () => {
    expect(RunFoldModel.longest([state('working', 5_000), state('working', 2_000), state('done', 1_000, 9_000)])).toEqual({ kind: 'live', since: 2_000 })
  })

  it('reports the longest settled span once nothing works', () => {
    expect(RunFoldModel.longest([state('done', 1_000, 4_000), state('done', 0, 10_000)])).toEqual({ kind: 'settled', ms: 10_000 })
  })

  it('omits the clause without times', () => {
    expect(RunFoldModel.longest([state('working'), state('done')])).toBeUndefined()
  })
})
