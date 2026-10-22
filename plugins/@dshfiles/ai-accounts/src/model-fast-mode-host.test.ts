import { describe, expect, it } from 'vitest'
import { fastModeRouteForCaller } from './model-fast-mode-host.js'

const route = { provider: 'codex-primary', model: 'gpt-6-luna' }

describe('Fast mode API caller scope', () => {
  it('infers the calling Agent session when omitted', () => {
    expect(fastModeRouteForCaller(route, { kind: 'agent', sessionId: 'session-a' })).toEqual({
      ...route,
      sessionId: 'session-a',
    })
  })

  it('rejects an Agent that names another live session', () => {
    expect(() => fastModeRouteForCaller({ ...route, sessionId: 'session-b' }, { kind: 'agent', sessionId: 'session-a' })).toThrow(
      'Agents can only access Fast mode for their own session.',
    )
  })

  it('rejects an Agent caller without a session', () => {
    expect(() => fastModeRouteForCaller(route, { kind: 'agent' })).toThrow('Fast mode requires an active Agent session.')
  })

  it('requires an explicit session from non-Agent callers', () => {
    expect(() => fastModeRouteForCaller(route, { kind: 'client' })).toThrow('Fast mode requires a session ID.')
    expect(fastModeRouteForCaller({ ...route, sessionId: 'session-b' }, { kind: 'client' })).toEqual({
      ...route,
      sessionId: 'session-b',
    })
  })
})
