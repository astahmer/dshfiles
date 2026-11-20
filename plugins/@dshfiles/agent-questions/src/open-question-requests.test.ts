import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import { describe, expect, it } from 'vitest'
import { OpenQuestionRequests, type OpenQuestionRequest } from './open-question-requests.js'

const request = (overrides: Partial<OpenQuestionRequest> = {}): OpenQuestionRequest => ({
  agent: { id: 'session-root' },
  questions: [{ id: 'layout' }],
  wait: { callId: 'call-1' },
  ...overrides,
})

const answer: AskUserQuestionAnswer = { answers: [{ id: 'layout', selected: ['One flat list'] }] }

/** A browser answerer that waits for its form until the request is cancelled. */
const browser = (held: OpenQuestionRequest) => {
  let resolve: (answer: AskUserQuestionAnswer) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<AskUserQuestionAnswer>((onAnswer, onError) => {
    resolve = onAnswer
    reject = onError
  })
  const next = (): Promise<AskUserQuestionAnswer> => {
    held.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    return promise
  }
  return { form: { resolve }, next }
}

describe('open question requests', () => {
  it('lets the Host answer a form that is still open, and retracts the form the browser shows', async () => {
    const open = new OpenQuestionRequests()
    const held = request()
    const { next } = browser(held)
    const result = open.listener(held, next)
    await Promise.resolve()
    expect(open.has('session-root', 'call-1')).toBe(true)

    expect(open.answer({ sessionId: 'session-root', callId: 'call-1', answer })).toBe('answered')
    await expect(result).resolves.toEqual(answer)
    expect(held.signal?.aborted).toBe(true)
    expect(open.has('session-root', 'call-1')).toBe(false)
    expect(open.answer({ sessionId: 'session-root', callId: 'call-1', answer })).toBe('not-held')
  })

  it('keeps the browser answer when it comes first, and then holds nothing', async () => {
    const open = new OpenQuestionRequests()
    const held = request()
    const { form, next } = browser(held)
    const result = open.listener(held, next)
    await Promise.resolve()
    form.resolve({ answers: [{ id: 'layout', selected: ['Grouped by plugin'] }] })
    await expect(result).resolves.toEqual({ answers: [{ id: 'layout', selected: ['Grouped by plugin'] }] })
    expect(held.signal?.aborted).toBe(false)
    expect(open.has('session-root', 'call-1')).toBe(false)
  })

  it('passes the turn cancellation on to the browser and reports it to the caller', async () => {
    const open = new OpenQuestionRequests()
    const turn = new AbortController()
    const held = request({ signal: turn.signal })
    const { next } = browser(held)
    const result = open.listener(held, next)
    await Promise.resolve()
    turn.abort()
    await expect(result).rejects.toThrow('aborted')
    expect(open.has('session-root', 'call-1')).toBe(false)
  })

  it('refuses an incomplete batch and keeps the form open', async () => {
    const open = new OpenQuestionRequests()
    const held = request({ questions: [{ id: 'layout' }, { id: 'audience' }] })
    const { form, next } = browser(held)
    const result = open.listener(held, next)
    await Promise.resolve()
    expect(open.answer({ sessionId: 'session-root', callId: 'call-1', answer })).toBe('bad-answer')
    expect(open.has('session-root', 'call-1')).toBe(true)
    form.resolve({ answers: [] })
    await result
  })

  it('leaves a request without an agent or a call id to the browser alone', async () => {
    const open = new OpenQuestionRequests()
    for (const unkeyed of [request({ agent: undefined }), request({ wait: undefined })]) {
      await expect(open.listener(unkeyed, () => Promise.resolve(answer))).resolves.toEqual(answer)
      expect(unkeyed.signal).toBeUndefined()
    }
    expect(open.has('session-root', 'call-1')).toBe(false)
  })
})
