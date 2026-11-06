import { describe, expect, it } from 'vitest'
import { initialThreadRoute, pendingThreadRoute, reduceThreadRoute, threadUrlRoute, type ThreadRouteState } from './thread-route.js'

const settled = (selectedSessionId: string | null): ThreadRouteState => ({ status: 'idle', suppressedSessionId: null })

describe('thread route', () => {
  it('resolves a page-load link only once, and never writes the URL while it waits', () => {
    const waiting = initialThreadRoute('thread-a')
    expect(pendingThreadRoute(waiting)).toEqual({ sessionId: 'thread-a', source: 'page-load' })
    expect(threadUrlRoute({ state: waiting, selectedSessionId: null }).sessionId).toBeNull()

    const opening = reduceThreadRoute(waiting, { type: 'open' })
    expect(pendingThreadRoute(opening)).toBeNull()
    expect(threadUrlRoute({ state: opening, selectedSessionId: null }).sessionId).toBeNull()

    expect(reduceThreadRoute(opening, { type: 'settle', selectedSessionId: 'thread-a' })).toEqual(settled('thread-a'))
  })

  it('opens a waiting request once, not again on every render', () => {
    const opening = reduceThreadRoute(initialThreadRoute('thread-a'), { type: 'open' })
    expect(reduceThreadRoute(opening, { type: 'open' })).toBe(opening)
    expect(reduceThreadRoute(settled(null), { type: 'open' })).toEqual(settled(null))
  })

  it('a Back navigation supersedes the request still waiting and is not a page-load link', () => {
    const replaced = reduceThreadRoute(initialThreadRoute('thread-a'), { type: 'navigate', sessionId: 'thread-b', selectedSessionId: null })
    expect(replaced).toEqual({ status: 'pending', sessionId: 'thread-b', source: 'popstate' })
    expect(pendingThreadRoute(replaced)?.source).toBe('popstate')
  })

  it('suppresses the URL write when Back lands on a URL without a thread', () => {
    const idle = reduceThreadRoute(settled(null), { type: 'navigate', sessionId: null, selectedSessionId: 'thread-a' })
    expect(idle).toEqual({ status: 'idle', suppressedSessionId: 'thread-a' })
    expect(threadUrlRoute({ state: idle, selectedSessionId: 'thread-a' }).sessionId).toBeNull()
    expect(reduceThreadRoute(idle, { type: 'select' })).toEqual(settled(null))
  })

  it('drops a suppression the user moved past instead of silencing every later write', () => {
    const idle = reduceThreadRoute(settled(null), { type: 'navigate', sessionId: null, selectedSessionId: 'thread-a' })
    const projected = threadUrlRoute({ state: idle, selectedSessionId: 'thread-b' })
    expect(projected).toEqual({ sessionId: 'thread-b', suppressionStale: true })
    expect(threadUrlRoute({ state: reduceThreadRoute(idle, { type: 'clear-suppression' }), selectedSessionId: 'thread-b' }).sessionId).toBe('thread-b')
  })

  it('clears a route whose Session this Host does not list', () => {
    const missing = reduceThreadRoute({ status: 'pending', sessionId: 'thread-gone', source: 'popstate' }, { type: 'missing' })
    expect(missing).toEqual(settled(null))
    expect(threadUrlRoute({ state: missing, selectedSessionId: 'thread-a' }).sessionId).toBe('thread-a')
  })

  it('never reports a URL write while the request is unresolved or its write is held back', () => {
    const unresolved: ThreadRouteState[] = [initialThreadRoute('thread-a'), { status: 'opening', sessionId: 'thread-a' }]
    for (const state of unresolved) expect(threadUrlRoute({ state, selectedSessionId: 'thread-b' }).sessionId).toBeNull()
    const heldBack: ThreadRouteState = { status: 'idle', suppressedSessionId: 'thread-a' }
    expect(threadUrlRoute({ state: heldBack, selectedSessionId: 'thread-a' }).sessionId).toBeNull()
  })
})
