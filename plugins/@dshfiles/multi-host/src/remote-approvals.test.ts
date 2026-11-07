import { describe, expect, test, vi } from 'vitest'
import type { RemoteInteraction } from './api.js'
import { PendingRemoteApproval, RemoteApprovals } from './remote-approvals.js'

const approval = (id: string): RemoteInteraction => ({
  id,
  runtimeId: 'runtime-a',
  sessionId: 'session-remote',
  request: { kind: 'approval', toolName: 'bash', callId: 'call-1', reason: 'needs the network' },
})

const question: RemoteInteraction = { id: 'question-1', runtimeId: 'runtime-a', sessionId: 'session-remote', request: { kind: 'question', questions: [] } }

const fixture = () => {
  const removed: string[] = []
  const published: PendingRemoteApproval[] = []
  const decide = vi.fn<ConstructorParameters<typeof RemoteApprovals>[0]['decide']>(async () => ({ ok: true }))
  const approvals = new RemoteApprovals({
    decide,
    publish: pending => {
      published.push(pending)
      return () => void removed.push(pending.key)
    },
  })
  return { approvals, decide, published, removed }
}

describe('approvals another machine holds', () => {
  test('publishes each held approval once and nothing else', () => {
    const { approvals, published } = fixture()
    approvals.sync([approval('event-1'), question])
    approvals.sync([approval('event-1'), question])
    expect(published.map(pending => pending.key)).toEqual(['remote-approval:event-1'])
    expect(published[0]).toMatchObject({ sessionId: 'session-remote', toolName: 'bash', callId: 'call-1', reason: 'needs the network' })
  })

  test('a request the owner withdrew leaves the seat', () => {
    const { approvals, removed } = fixture()
    approvals.sync([approval('event-1')])
    approvals.sync([])
    expect(removed).toEqual(['remote-approval:event-1'])
  })

  test('a decision goes to the owner, and its refusal reaches the panel with the request still held', async () => {
    const { approvals, decide, published, removed } = fixture()
    approvals.sync([approval('event-1')])
    await published[0]?.answer('allowed-once')
    expect(decide).toHaveBeenCalledWith({ sessionId: 'session-remote', interactionId: 'event-1', outcome: 'allowed-once' })

    decide.mockResolvedValueOnce({ ok: false, message: 'This request is no longer waiting.' })
    await expect(published[0]?.answer('rejected')).rejects.toThrow('no longer waiting')
    expect(removed).toEqual([])
  })

  test('disposal empties the seat', () => {
    const { approvals, removed } = fixture()
    approvals.sync([approval('event-1')])
    approvals.dispose()
    expect(removed).toEqual(['remote-approval:event-1'])
  })
})
