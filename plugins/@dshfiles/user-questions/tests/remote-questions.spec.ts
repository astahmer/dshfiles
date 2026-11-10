import { describe, expect, it, vi } from 'vitest'
import type { RemoteInteraction } from '@dshfiles/multi-host/api'
import type { QuestionWaterfallChannel } from '../src/native/contract/slots.ts'
import { RemoteQuestions, type RemoteQuestionCard, type RemoteQuestionPorts } from '../src/remote-questions.ts'

const row = (id: string, request: Partial<Extract<RemoteInteraction['request'], { kind: 'question' }>> = {}): RemoteInteraction => ({
  id,
  runtimeId: 'runtime-a',
  sessionId: 'session-remote',
  request: { kind: 'question', questions: [{ id: 'q1', question: 'Ship it?', options: [{ label: 'Yes' }] }], callId: 'call-1', ...request },
})

const approval: RemoteInteraction = { id: 'approval-1', runtimeId: 'runtime-a', sessionId: 'session-remote', request: { kind: 'approval', toolName: 'bash' } }

const fixture = () => {
  const channels: QuestionWaterfallChannel[] = []
  const detached: QuestionWaterfallChannel[] = []
  const tracked: Promise<void>[] = []
  const removed = vi.fn()
  const card: RemoteQuestionCard = {
    attachWaterfall: channel => void channels.push(channel),
    detachWaterfall: channel => void detached.push(channel),
    trackRequest: completion => {
      tracked.push(completion)
      return () => undefined
    },
    remove: removed,
  }
  const ports = {
    cardFor: vi.fn<RemoteQuestionPorts['cardFor']>(() => card),
    answer: vi.fn<RemoteQuestionPorts['answer']>(async () => undefined),
    decline: vi.fn<RemoteQuestionPorts['decline']>(async () => undefined),
    ended: vi.fn(),
  }
  return { channels, detached, tracked, removed, ports, questions: new RemoteQuestions(ports) }
}

describe('questions another machine holds', () => {
  it('presents a held question once, and no other kind of request', () => {
    const { channels, ports, questions } = fixture()
    questions.sync([row('event-1'), approval])
    questions.sync([row('event-1'), approval])
    expect(ports.cardFor).toHaveBeenCalledTimes(1)
    expect(ports.cardFor.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'session-remote', callId: 'call-1' })
    expect(channels).toHaveLength(1)
  })

  it('keeps a plan review a plan review', () => {
    const { ports, questions } = fixture()
    questions.sync([
      row('event-1', {
        questions: [{ id: 'q1', question: 'Plan?', detail: '# Plan', options: [{ label: 'Go' }], intent: { kind: 'plan-review', approve: 'Go' } }],
      }),
    ])
    expect(ports.cardFor.mock.calls[0]?.[0].questions[0]?.intent).toEqual({ kind: 'plan-review', approve: 'Go' })
  })

  it('sends an answer to the owner and lets a refusal reach the card', async () => {
    const { channels, ports, questions } = fixture()
    questions.sync([row('event-1')])
    const answer = { answers: [{ id: 'q1', selected: ['Yes'] }] }
    await channels[0]?.resolve(answer)
    expect(ports.answer).toHaveBeenCalledWith({ sessionId: 'session-remote', interactionId: 'event-1', answer })

    ports.answer.mockRejectedValueOnce(new Error('The host refused.'))
    await expect(channels[0]?.resolve(answer)).rejects.toThrow('The host refused.')
  })

  it('tells the owner when the person cancels or the countdown ends', () => {
    const { channels, ports, questions } = fixture()
    questions.sync([row('event-1')])
    channels[0]?.reject('ASK_CANCELLED')
    channels[0]?.reject('ASK_TIMED_OUT')
    expect(ports.decline.mock.calls.map(call => call[0].reason)).toEqual(['cancelled', 'timed-out'])
  })

  it('hands nothing on when the card leaves its seat: the owner keeps the request', () => {
    const { channels, ports, questions } = fixture()
    questions.sync([row('event-1')])
    channels[0]?.delegate()
    expect(ports.answer).not.toHaveBeenCalled()
    expect(ports.decline).not.toHaveBeenCalled()
  })

  it('mounts a timed card with its deadline, so focus cannot freeze a countdown that has not started', () => {
    const { channels, questions } = fixture()
    questions.sync([row('event-1', { remainingMs: 30_000 })])
    expect(channels[0]?.deadline).toBeGreaterThan(Date.now())
    questions.sync([row('event-1', { remainingMs: 29_000 })])
    expect(channels).toHaveLength(1)
  })

  it('ends a tool-call card through the projection, not by itself', async () => {
    const { detached, ports, removed, tracked, questions } = fixture()
    questions.sync([row('event-1')])
    questions.sync([])
    await tracked[0]
    expect(detached).toHaveLength(1)
    expect(removed).not.toHaveBeenCalled()
    expect(ports.ended).toHaveBeenCalledTimes(1)
  })

  it('removes a blocking card: no projection row will ever close it', () => {
    const { removed, questions } = fixture()
    questions.sync([{ ...row('event-1'), request: { kind: 'question', questions: [{ id: 'q1', question: 'Ship it?' }] } }])
    questions.sync([])
    expect(removed).toHaveBeenCalledTimes(1)
  })
})
