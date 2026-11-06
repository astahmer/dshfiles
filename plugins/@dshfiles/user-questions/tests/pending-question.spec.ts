import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import { createWaterfallRequest, PendingQuestion } from '../src/native/contract/slots.js'

const SESSION = brandString<SessionId>('session-1')
const QUESTIONS: AskUserQuestionItem[] = [{ id: 'q1', question: 'Pick one?', options: [{ label: 'A' }, { label: 'B' }] }]

interface PendingStart {
  readonly pending: PendingQuestion
  readonly outcome: Promise<{ readonly ok: boolean; readonly value?: unknown; readonly code?: string }>
}

const start = (deadline: number | undefined): PendingStart => {
  const pending = new PendingQuestion(SESSION, QUESTIONS)
  const request = createWaterfallRequest(deadline, undefined, () => {})
  pending.attachWaterfall(request.channel)
  return {
    pending,
    outcome: request.result.then(
      value => ({ ok: true, value }),
      (error: Error & { code?: string }) => ({ ok: false, code: error.code }),
    ),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PendingQuestion wait lifecycle', () => {
  it('counts a timed request down, freezes it on focus and resumes from the remaining time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { pending } = start(61_000)

    expect(pending.snapshot().phase).toEqual({ kind: 'counting', deadline: 61_000 })
    expect(pending.snapshot().countdown).toEqual({ remainingMs: 60_000, running: true })

    vi.setSystemTime(11_000)
    pending.holdFocus()

    expect(pending.snapshot().phase).toEqual({ kind: 'paused', remainingMs: 50_000 })
    expect(pending.snapshot().countdown).toEqual({ remainingMs: 50_000, running: false })

    vi.setSystemTime(21_000)
    pending.releaseFocus()

    expect(pending.snapshot().phase).toEqual({ kind: 'counting', deadline: 71_000 })
    expect(pending.snapshot().countdown).toEqual({ remainingMs: 50_000, running: true })
  })

  it('keeps a taken-over wait out of every countdown transition', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { pending } = start(31_000)

    pending.takeTime()

    expect(pending.snapshot().waitState).toBe('waiting')
    expect(pending.snapshot().phase).toEqual({ kind: 'waiting' })
    expect(pending.snapshot().countdown).toEqual({ remainingMs: 0, running: false })

    pending.holdFocus()
    pending.engage()
    pending.releaseFocus()

    expect(pending.snapshot().phase).toEqual({ kind: 'waiting' })
  })

  it('freezes the countdown once the user edits a draft', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { pending } = start(61_000)

    vi.setSystemTime(11_000)
    pending.engage()

    expect(pending.snapshot().phase).toEqual({ kind: 'editing', remainingMs: 50_000 })
    expect(pending.snapshot().countdown).toEqual({ remainingMs: 50_000, running: false })
    expect(pending.snapshot().waitState).toBe('editing')

    pending.releaseFocus()
    pending.holdFocus()

    expect(pending.snapshot().phase).toEqual({ kind: 'editing', remainingMs: 50_000 })
  })

  it('shows no countdown for a request that carried no deadline', () => {
    const { pending } = start(undefined)

    expect(pending.snapshot().phase).toEqual({ kind: 'counting', deadline: undefined })
    expect(pending.snapshot().countdown).toBeUndefined()

    pending.engage()

    expect(pending.snapshot().phase).toEqual({ kind: 'editing', remainingMs: undefined })
    expect(pending.snapshot().countdown).toBeUndefined()
    expect(pending.snapshot().waitState).toBe('editing')
  })

  it('times out once from a live countdown and rejects the waterfall', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { pending, outcome } = start(3_000)

    vi.advanceTimersByTime(1_000)
    expect(pending.snapshot().phase).toEqual({ kind: 'counting', deadline: 3_000 })
    expect(pending.snapshot().countdown).toEqual({ remainingMs: 1_000, running: true })

    vi.advanceTimersByTime(1_000)

    expect(pending.snapshot().phase).toEqual({ kind: 'timedOut' })
    expect(pending.snapshot().countdown).toBeUndefined()
    expect(pending.snapshot().waitState).toBe('counting')
    await expect(outcome).resolves.toEqual({ ok: false, code: 'ASK_TIMED_OUT' })
  })

  it('never times out a frozen countdown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { pending, outcome } = start(2_000)
    let settled = false
    void outcome.then(() => {
      settled = true
    })

    pending.holdFocus(1_000)
    vi.advanceTimersByTime(60_000)

    expect(pending.snapshot().phase).toEqual({ kind: 'paused', remainingMs: 1_000 })
    expect(settled).toBe(false)
  })

  it('stops owning the wait once the card is closed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { pending, outcome } = start(2_000)
    let settled = false
    void outcome.then(() => {
      settled = true
    })

    pending.close()
    vi.advanceTimersByTime(60_000)

    expect(pending.snapshot().phase).toEqual({ kind: 'closed' })
    expect(settled).toBe(false)
  })

  it('reports the channel a submission would use right now', () => {
    const { pending } = start(undefined)
    expect(pending.snapshot().channel).toBe('waterfall')

    const continued = new PendingQuestion(SESSION, QUESTIONS)
    expect(continued.snapshot().channel).toBe('none')

    continued.attachRpc({ answer: () => Promise.resolve(true) })
    expect(continued.snapshot().channel).toBe('none')

    continued.setState('continued')
    expect(continued.snapshot().channel).toBe('rpc')
  })
})

describe('PendingQuestion settlement', () => {
  it('resolves the attached waterfall with the whole answer batch', async () => {
    const { pending, outcome } = start(undefined)
    const answer = { answers: [{ id: 'q1', selected: ['A'] }] }

    await pending.answer(answer)

    await expect(outcome).resolves.toEqual({ ok: true, value: answer })
  })

  it('routes a continued question through the Remote channel', async () => {
    const pending = new PendingQuestion(SESSION, QUESTIONS)
    const answers: unknown[] = []
    pending.attachRpc({
      answer: async answer => {
        answers.push(answer)
        return true
      },
    })
    pending.setState('continued')
    const answer = { answers: [{ id: 'q1', selected: ['B'] }] }

    await pending.answer(answer)

    expect(answers).toEqual([answer])
  })

  it('refuses a question no channel accepts yet', async () => {
    const pending = new PendingQuestion(SESSION, QUESTIONS)

    await expect(pending.answer({ answers: [] })).rejects.toThrow('no channel accepts an answer yet')
  })
})
