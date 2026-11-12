import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientSessions } from '../../src/native/client/sessions/service.ts'
import type { SessionRemotes } from '../../src/native/client/sessions/remotes.ts'

const contexts = new Set<Context>()
const tick = async (): Promise<void> => {
  for (let index = 0; index < 4; index++) await Promise.resolve()
}

const fixture = (): ClientSessions => {
  const ctx = new Context()
  contexts.add(ctx)
  // SAFETY: list publication reads no Remote; every call would throw on the empty namespaces.
  return new ClientSessions(ctx, { session: {}, commands: {}, subagents: {} } as unknown as SessionRemotes)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
  vi.useRealTimers()
})

describe('session list publication', () => {
  it('coalesces activity-only row changes and publishes structural ones at once', async () => {
    const sessions = fixture()
    const id = SessionId('session-streaming')
    sessions.handleSessionAdded({ sessionId: id, agentAvailable: true, updatedAt: 1, running: true, blank: false })
    sessions.handleControlFrame({ type: 'projection', sessionId: id, seq: 1, changes: [{ key: 'title', val: 'Streaming' }] })
    await tick()
    const published = vi.fn()
    sessions.list.subscribe(published)

    sessions.handleControlFrame({
      type: 'projection',
      sessionId: id,
      seq: 2,
      changes: [{ key: 'turnOutline', val: [{ turn: 1, prompt: 'q', response: 'a' }] }],
    })
    await tick()
    sessions.handleSessionActivity(id, 2)
    await tick()
    expect(published).not.toHaveBeenCalled()
    expect(sessions.list.getSnapshot().byId[id]?.updatedAt).toBe(1)

    vi.advanceTimersByTime(2_000)
    await tick()
    expect(published).toHaveBeenCalledTimes(1)
    expect(sessions.list.getSnapshot().byId[id]?.updatedAt).toBe(2)
    expect(sessions.list.getSnapshot().byId[id]?.projectionValues).toHaveProperty('turnOutline')

    sessions.handleSessionStatus(id, false)
    await tick()
    expect(published).toHaveBeenCalledTimes(2)
    expect(sessions.list.getSnapshot().byId[id]?.running).toBe(false)
  })

  it('keeps a catalog-only subagent row identical while its parent streams', async () => {
    const sessions = fixture()
    const parent = SessionId('session-parent')
    const child = SessionId('session-child')
    sessions.handleSessionAdded({ sessionId: parent, agentAvailable: true, updatedAt: 1, running: true, blank: false })
    sessions.handleControlFrame({
      type: 'projection',
      sessionId: parent,
      seq: 1,
      changes: [{ key: 'subagentCatalog', val: [{ id: child, createdAt: 1, mode: 'one-shot', label: 'Child' }] }],
    })
    await tick()
    const row = sessions.list.getSnapshot().byId[child]
    expect(row?.displayTitle).toBe('Child')

    for (let seq = 2; seq < 6; seq++) {
      sessions.handleSessionActivity(parent, seq)
      vi.advanceTimersByTime(2_000)
      await tick()
    }
    expect(sessions.list.getSnapshot().byId[parent]?.updatedAt).toBe(5)
    expect(sessions.list.getSnapshot().byId[child]).toBe(row)
  })
})
