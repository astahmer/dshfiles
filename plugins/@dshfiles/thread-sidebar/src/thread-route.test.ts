import { describe, expect, it } from 'vitest'
import { ThreadRouteModel, type ThreadRouteState } from './thread-route.js'

const idleRoute = (): ThreadRouteState => ({ status: 'idle', suppressedSessionId: null })

describe('thread route', () => {
  it('resolves a page-load link only once, and never writes the URL while it waits', () => {
    const waiting = ThreadRouteModel.initialThreadRoute('thread-a')
    expect(ThreadRouteModel.pendingThreadRoute(waiting)).toEqual({ sessionId: 'thread-a', source: 'page-load' })
    expect(ThreadRouteModel.threadUrlRoute({ state: waiting, selectedSessionId: null }).sessionId).toBeNull()

    const opening = ThreadRouteModel.reduceThreadRoute(waiting, { type: 'open' })
    expect(ThreadRouteModel.pendingThreadRoute(opening)).toBeNull()
    expect(ThreadRouteModel.threadUrlRoute({ state: opening, selectedSessionId: null }).sessionId).toBeNull()

    expect(ThreadRouteModel.reduceThreadRoute(opening, { type: 'settle', selectedSessionId: 'thread-a' })).toEqual(idleRoute())
  })

  it('opens a waiting request once, not again on every render', () => {
    const opening = ThreadRouteModel.reduceThreadRoute(ThreadRouteModel.initialThreadRoute('thread-a'), { type: 'open' })
    expect(ThreadRouteModel.reduceThreadRoute(opening, { type: 'open' })).toBe(opening)
    expect(ThreadRouteModel.reduceThreadRoute(idleRoute(), { type: 'open' })).toEqual(idleRoute())
  })

  it('a Back navigation supersedes the request still waiting and is not a page-load link', () => {
    const replaced = ThreadRouteModel.reduceThreadRoute(ThreadRouteModel.initialThreadRoute('thread-a'), {
      type: 'navigate',
      sessionId: 'thread-b',
      selectedSessionId: null,
    })
    expect(replaced).toEqual({ status: 'pending', sessionId: 'thread-b', source: 'popstate' })
    expect(ThreadRouteModel.pendingThreadRoute(replaced)?.source).toBe('popstate')
  })

  it('suppresses the URL write when Back lands on a URL without a thread', () => {
    const idle = ThreadRouteModel.reduceThreadRoute(idleRoute(), { type: 'navigate', sessionId: null, selectedSessionId: 'thread-a' })
    expect(idle).toEqual({ status: 'idle', suppressedSessionId: 'thread-a' })
    expect(ThreadRouteModel.threadUrlRoute({ state: idle, selectedSessionId: 'thread-a' }).sessionId).toBeNull()
    expect(ThreadRouteModel.reduceThreadRoute(idle, { type: 'select' })).toEqual(idleRoute())
  })

  it('drops a suppression the user moved past instead of silencing every later write', () => {
    const idle = ThreadRouteModel.reduceThreadRoute(idleRoute(), { type: 'navigate', sessionId: null, selectedSessionId: 'thread-a' })
    const projected = ThreadRouteModel.threadUrlRoute({ state: idle, selectedSessionId: 'thread-b' })
    expect(projected).toEqual({ sessionId: 'thread-b', suppressionStale: true })
    expect(
      ThreadRouteModel.threadUrlRoute({ state: ThreadRouteModel.reduceThreadRoute(idle, { type: 'clear-suppression' }), selectedSessionId: 'thread-b' })
        .sessionId,
    ).toBe('thread-b')
  })

  it('clears a route whose Session this Host does not list', () => {
    const missing = ThreadRouteModel.reduceThreadRoute({ status: 'pending', sessionId: 'thread-gone', source: 'popstate' }, { type: 'missing' })
    expect(missing).toEqual(idleRoute())
    expect(ThreadRouteModel.threadUrlRoute({ state: missing, selectedSessionId: 'thread-a' }).sessionId).toBe('thread-a')
  })

  it('never reports a URL write while the request is unresolved or its write is held back', () => {
    const unresolved: ThreadRouteState[] = [ThreadRouteModel.initialThreadRoute('thread-a'), { status: 'opening', sessionId: 'thread-a' }]
    for (const state of unresolved) expect(ThreadRouteModel.threadUrlRoute({ state, selectedSessionId: 'thread-b' }).sessionId).toBeNull()
    const heldBack: ThreadRouteState = { status: 'idle', suppressedSessionId: 'thread-a' }
    expect(ThreadRouteModel.threadUrlRoute({ state: heldBack, selectedSessionId: 'thread-a' }).sessionId).toBeNull()
  })
})
