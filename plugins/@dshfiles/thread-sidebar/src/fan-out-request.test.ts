// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { FAN_OUT_REQUEST_EVENT, fanOutRoutesOf, requestFanOut } from './fan-out-request.js'

describe('fan-out request', () => {
  it('accepts two through six complete routes', () => {
    const routes = [
      { provider: 'northstar', model: 'nova-3', reasoningEffort: 'deep' },
      { provider: 'redwood', model: 'r2' },
    ]
    expect(fanOutRoutesOf({ models: routes })).toEqual(routes)
    expect(fanOutRoutesOf({ models: [routes[0]] })).toBeUndefined()
    expect(
      fanOutRoutesOf({
        models: Array.from({ length: 7 }, (_, index) => ({ provider: 'p', model: `m${String(index)}` })),
      }),
    ).toBeUndefined()
  })

  it('rejects malformed routes instead of guessing them', () => {
    expect(fanOutRoutesOf(undefined)).toBeUndefined()
    expect(fanOutRoutesOf({ models: 'northstar' })).toBeUndefined()
    expect(
      fanOutRoutesOf({
        models: [
          { provider: '', model: 'm' },
          { provider: 'p', model: 'm' },
        ],
      }),
    ).toBeUndefined()
    expect(
      fanOutRoutesOf({
        models: [
          { provider: 'p', model: 'm', reasoningEffort: 2 },
          { provider: 'p', model: 'm2' },
        ],
      }),
    ).toBeUndefined()
  })

  it('dispatches the request as one bounded event', () => {
    const seen: unknown[] = []
    const listener = (event: Event): void => {
      seen.push(event instanceof CustomEvent ? event.detail : undefined)
    }
    window.addEventListener(FAN_OUT_REQUEST_EVENT, listener)
    try {
      requestFanOut([
        { provider: 'northstar', model: 'nova-3' },
        { provider: 'redwood', model: 'r2' },
      ])
    } finally {
      window.removeEventListener(FAN_OUT_REQUEST_EVENT, listener)
    }
    expect(fanOutRoutesOf(seen[0])).toHaveLength(2)
  })
})
