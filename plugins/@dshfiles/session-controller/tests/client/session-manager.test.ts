import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { SessionManager } from '../../src/native/client/sessions/manager.js'
import type { SessionRemotes } from '../../src/native/client/sessions/remotes.js'
import type { SessionSummary } from '../../src/native/types.js'

const deferred = <Value>() => {
  const settled = Promise.withResolvers<Value>()
  return { promise: settled.promise, resolve: settled.resolve, reject: settled.reject }
}

const summary = (sessionId: SessionId, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  agentAvailable: true,
  sessionId,
  updatedAt: 1,
  running: false,
  blank: false,
  ...overrides,
})

const listResult = (items: readonly SessionSummary[]): RemoteResult<{ items: readonly SessionSummary[] }> => ({
  ok: true,
  value: { items },
})

const createManager = () => {
  const pulls: ReturnType<typeof deferred<RemoteResult<{ items: readonly SessionSummary[] }>>>[] = []
  const projectionReads: SessionId[] = []
  const created = SessionId('session-created')
  const session = {
    list: () => {
      const pull = deferred<RemoteResult<{ items: readonly SessionSummary[] }>>()
      pulls.push(pull)
      return pull.promise
    },
    create: async () => ({ ok: true as const, value: { sessionId: created } }),
    projections: async (request: { readonly sessionId: SessionId }) => {
      projectionReads.push(request.sessionId)
      return { ok: true as const, value: null }
    },
  }
  // SAFETY: the list, create and projection calls are the exact transport subset these manager paths read.
  const manager = new SessionManager({ session } as unknown as SessionRemotes)
  return { manager, pulls, projectionReads, created }
}

describe('SessionManager list refresh', () => {
  it('keeps one pull flight and lets a reconnect fence the stale one out', async () => {
    const { manager, pulls } = createManager()
    const staleId = SessionId('session-stale')
    const freshId = SessionId('session-fresh')

    const first = manager.refreshList()
    expect(manager.getListSnapshot().state).toBe('loading')
    expect(manager.refreshList()).toBe(first)

    manager.handleConnected()
    const second = manager.refreshList()
    expect(pulls).toHaveLength(2)
    expect(manager.getListSnapshot()).toMatchObject({ state: 'loading', phase: 'pending' })

    pulls[0]?.resolve(listResult([summary(staleId)]))
    await first
    expect(manager.getListSnapshot().items.some(item => item.sessionId === staleId)).toBe(false)
    expect(manager.getListSnapshot().state).toBe('loading')

    pulls[1]?.resolve(listResult([summary(freshId)]))
    await second
    expect(manager.getListSnapshot()).toMatchObject({ state: 'idle', phase: 'ready', error: null })
    expect(manager.getListSnapshot().items.map(item => item.sessionId)).toEqual([freshId])
    await manager.dispose()
  })

  it('leaves no loading state behind when disposed mid-pull', async () => {
    const { manager, pulls } = createManager()
    void manager.refreshList()
    expect(manager.getListSnapshot().state).toBe('loading')

    await manager.dispose()
    expect(manager.getListSnapshot().state).toBe('idle')
    await manager.refreshList()
    expect(pulls).toHaveLength(1)
  })
})

describe('SessionManager provisional records', () => {
  it('keeps one record per identity across defer, discard and finish', async () => {
    const { manager, projectionReads } = createManager()
    const draftId = manager.beginProvisional({ cwd: '/tmp/workspace' })
    expect(manager.creationFor(draftId)).toBeUndefined()
    expect(manager.getListSnapshot().items.map(item => item.sessionId)).toContain(draftId)

    const created = Promise.withResolvers<SessionId>()
    manager.deferCreation(draftId, created.promise, async () => {})
    expect(manager.creationFor(draftId)).toBe(created.promise)
    await manager.refreshProjections(draftId)
    expect(projectionReads).toHaveLength(0)

    manager.discardDeferred(draftId)
    expect(manager.creationFor(draftId)).toBeUndefined()
    expect(manager.getListSnapshot().items.some(item => item.sessionId === draftId)).toBe(false)

    const plainId = manager.beginProvisional({})
    manager.discardDeferred(plainId)
    expect(manager.getListSnapshot().items.some(item => item.sessionId === plainId)).toBe(true)

    const keptId = manager.beginProvisional({})
    const keptCreated = Promise.withResolvers<SessionId>()
    manager.deferCreation(keptId, keptCreated.promise, async () => {})
    manager.finishDeferred(keptId)
    expect(manager.creationFor(keptId)).toBeUndefined()
    manager.discardDeferred(keptId)
    expect(manager.getListSnapshot().items.some(item => item.sessionId === keptId)).toBe(true)
    await manager.dispose()
  })

  it('replaces the creation gate with the created Host row', async () => {
    const { manager, created } = createManager()
    const provisionalId = manager.beginProvisional({})
    const settled = manager.settleProvisional(provisionalId, {})
    expect(manager.creationFor(provisionalId)).toBeDefined()

    await expect(settled).resolves.toMatchObject({ ok: true, value: { sessionId: created } })
    expect(manager.creationFor(provisionalId)).toBeUndefined()
    expect(manager.getListSnapshot().items.some(item => item.sessionId === provisionalId)).toBe(false)
    expect(manager.getListSnapshot().items.some(item => item.sessionId === created)).toBe(true)
    await manager.dispose()
  })
})
