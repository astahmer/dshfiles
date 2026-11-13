import { describe, expect, it } from 'vitest'

import { ReachabilityModel } from './reachability.js'

const fail = (state = ReachabilityModel.initial) => ReachabilityModel.settled(ReachabilityModel.started(state), false).state

describe('ReachabilityModel', () => {
  it('reports offline after two failed probes even while the socket still says connected', () => {
    const once = fail()
    expect(ReachabilityModel.view({ state: once, connection: 'connected' })).toBe('online')
    const twice = fail(once)
    expect(ReachabilityModel.view({ state: twice, connection: 'connected' })).toBe('offline')
  })

  it('shows checking while a retry probe runs during an outage', () => {
    const offline = fail(fail())
    expect(ReachabilityModel.view({ state: ReachabilityModel.started(offline), connection: 'connected' })).toBe('checking')
  })

  it('asks for a reconnect when the Host answers again after an outage', () => {
    const offline = fail(fail())
    const back = ReachabilityModel.settled(ReachabilityModel.started(offline), true)
    expect(back.recovered).toBe(true)
    expect(ReachabilityModel.view({ state: back.state, connection: 'connected' })).toBe('online')
    expect(ReachabilityModel.settled(ReachabilityModel.initial, true).recovered).toBe(false)
  })

  it('follows the socket when the probe has nothing to say', () => {
    expect(ReachabilityModel.view({ state: ReachabilityModel.initial, connection: 'disconnected' })).toBe('offline')
    expect(ReachabilityModel.view({ state: ReachabilityModel.initial, connection: 'connecting' })).toBe('checking')
  })
})
