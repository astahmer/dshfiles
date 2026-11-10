import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { SessionManager } from '../../src/native/client/sessions/manager.js'
import type { SessionRemotes } from '../../src/native/client/sessions/remotes.js'
import type { SessionSummary } from '../../src/native/types.js'

const RESIDENT_LIMIT = 3

const createManager = () => {
  const session = {
    list: async (): Promise<RemoteResult<{ items: readonly SessionSummary[] }>> => ({
      ok: true,
      value: { items: [] },
    }),
    create: async () => ({ ok: true as const, value: { sessionId: SessionId('session-created') } }),
    projections: async () => ({ ok: true as const, value: null }),
  }
  // SAFETY: the list, create and projection calls are the exact transport subset these manager paths read.
  return new SessionManager({ session } as unknown as SessionRemotes)
}

/** Land the two kinds of projection an opened Session receives: a list label and history state. */
const seedSession = (manager: SessionManager, sessionId: SessionId): void => {
  manager.handleControlFrame({ type: 'projection', sessionId, key: 'title', value: `title-${sessionId}`, seq: 1 })
  manager.handleControlFrame({ type: 'projection', sessionId, key: 'turnOutline', value: [{ turn: 1, prompt: 'q', response: 'a' }], seq: 2 })
}

/** Open a Session (instantiating it) and then leave the view (its unmount path). */
const viewThenLeave = async (manager: SessionManager, sessionId: SessionId): Promise<void> => {
  const session = manager.get(sessionId)
  seedSession(manager, sessionId)
  await manager.drop(sessionId, session)
}

const projectedKeys = (manager: SessionManager, sessionId: SessionId): string[] => Object.keys(manager.projectionValues(sessionId) ?? {}).sort()

describe('SessionManager resident per-session state', () => {
  it(`keeps history projections only for the last ${RESIDENT_LIMIT} viewed Sessions`, async () => {
    const manager = createManager()
    const viewed = ['a', 'b', 'c', 'd', 'e'].map(id => SessionId(`session-${id}`))

    for (const sessionId of viewed.slice(0, -1)) await viewThenLeave(manager, sessionId)
    const mounted = manager.get(viewed.at(-1)!)
    seedSession(manager, viewed.at(-1)!)

    // The oldest two are past the limit: their list label stays, their history state is gone.
    expect(projectedKeys(manager, viewed[0]!)).toEqual(['title'])
    expect(projectedKeys(manager, viewed[1]!)).toEqual(['title'])
    // The last three keep everything the Host sent.
    expect(projectedKeys(manager, viewed[2]!)).toEqual(['title', 'turnOutline'])
    expect(projectedKeys(manager, viewed[3]!)).toEqual(['title', 'turnOutline'])
    expect(projectedKeys(manager, viewed[4]!)).toEqual(['title', 'turnOutline'])
    // The viewed Session is still resident, so its values were not touched.
    expect(manager.get(viewed.at(-1)!)).toBe(mounted)
  })

  it('never evicts a Session that is still mounted', async () => {
    const manager = createManager()
    const first = SessionId('session-first')
    const second = SessionId('session-second')
    // Two Sessions stay open; four later views cannot push them past the limit.
    manager.get(first)
    seedSession(manager, first)
    manager.get(second)
    seedSession(manager, second)

    for (const id of ['a', 'b', 'c', 'd']) {
      const sessionId = SessionId(`session-${id}`)
      await viewThenLeave(manager, sessionId)
    }

    expect(projectedKeys(manager, first)).toEqual(['title', 'turnOutline'])
    expect(projectedKeys(manager, second)).toEqual(['title', 'turnOutline'])
  })

  it('releases instances no view subscribes to beyond the unrendered limit', async () => {
    const manager = createManager()
    const mountedId = SessionId('session-mounted')
    const mounted = manager.get(mountedId)
    const unsubscribe = mounted.subscribe(() => undefined)

    const visited = Array.from({ length: 8 }, (_value, index) => SessionId(`session-visit-${String(index)}`))
    for (const sessionId of visited) {
      manager.get(sessionId)
      seedSession(manager, sessionId)
    }

    // The newest unrendered instances stay resident, so reopening one reuses it.
    expect(manager.get(visited.at(-1)!)).toBe(manager.get(visited.at(-1)!))
    // The oldest were released: the next open builds a new instance instead of reusing history.
    const reopened = manager.get(visited[0]!)
    expect(projectedKeys(manager, visited[0]!)).toEqual(['title'])
    expect(manager.get(visited[0]!)).toBe(reopened)
    // A subscribed Session is never released.
    expect(manager.get(mountedId)).toBe(mounted)
    unsubscribe()
  })

  it('never releases an instance a live scope holds before its view subscribes', () => {
    const manager = createManager()
    // A view retains its Session (scope bound, history opening) and subscribes only after React commits.
    const openingId = SessionId('session-opening')
    const opening = manager.get(openingId)
    // SAFETY: the release pass reads only whether a scope is bound, never the context itself.
    opening.bindScope({} as Parameters<typeof opening.bindScope>[0])

    // A restore burst instantiates more unrendered Sessions than the resident limit in the same tick.
    for (let index = 0; index < 8; index += 1) manager.get(SessionId(`session-burst-${String(index)}`))

    // The held instance stays the resident one, so the view never renders a disposed Session.
    expect(manager.get(openingId)).toBe(opening)
  })
})
