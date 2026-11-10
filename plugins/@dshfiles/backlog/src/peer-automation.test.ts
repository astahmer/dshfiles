import { describe, expect, it } from 'vitest'
import type { BacklogPeerStatusView } from './api.js'
import { PeerAutomation } from './peer-automation.js'

const peer = (input: Partial<BacklogPeerStatusView['peers'][number]>): BacklogPeerStatusView['peers'][number] => ({
  runtimeId: '10000000-0000-4000-8000-000000000002',
  name: 'Build box',
  connected: true,
  enabled: true,
  remoteHostId: 'build-box',
  cursor: 0,
  lag: 0,
  pulled: 0,
  lastPullAt: null,
  lastSuccessAt: null,
  automationHostId: null,
  error: null,
  ...input,
})

const status = (input: Partial<BacklogPeerStatusView>): BacklogPeerStatusView => ({
  available: true,
  hostId: 'studio',
  intervalSeconds: 60,
  automationHostId: null,
  automationHere: true,
  automationNote: null,
  peers: [],
  ...input,
})

describe('peer automation Host', () => {
  it('names this Host, a known peer and an id it cannot place, and treats an empty choice as this Host', () => {
    const reported = status({ peers: [peer({ name: 'Build box', remoteHostId: 'build-box' }), peer({ remoteHostId: 'laptop', name: 'Laptop' })] })
    expect(PeerAutomation.label(reported, 'studio')).toBe('This Host')
    expect(PeerAutomation.label(reported, 'build-box')).toBe('Build box')
    expect(PeerAutomation.label(reported, '5f3c2a10-unknown')).toBe('Host 5f3c2a10')
    expect(PeerAutomation.hostIdOf(reported)).toBe('studio')
    expect(PeerAutomation.hostIdOf({ ...reported, automationHostId: 'build-box' })).toBe('build-box')
  })

  it('shows a peer choice only once that peer reported one', () => {
    const unknown = status({ peers: [peer({ automationHostId: null })] })
    expect(PeerAutomation.of(unknown, unknown.peers[0]!)).toBeNull()
    expect(PeerAutomation.of(status({ peers: [peer({ automationHostId: 'studio' })] }), peer({ automationHostId: 'studio' }))).toEqual({
      hostId: 'studio',
      label: 'This Host',
    })
  })

  it('lists every peer that runs automation elsewhere, as it picks one on itself', () => {
    const here = status({
      peers: [
        peer({ name: 'Build box', remoteHostId: 'build-box', automationHostId: 'studio' }),
        peer({ name: 'Laptop', remoteHostId: 'laptop', automationHostId: 'laptop' }),
      ],
    })
    expect(PeerAutomation.disagreements(here)).toEqual([{ peerName: 'Laptop', peerHostId: 'laptop', automation: { hostId: 'laptop', label: 'Laptop' } }])

    const elsewhere = status({ automationHostId: 'build-box', peers: [peer({ name: 'Laptop', remoteHostId: 'laptop', automationHostId: 'studio' })] })
    expect(PeerAutomation.disagreements(elsewhere)).toEqual([
      { peerName: 'Laptop', peerHostId: 'laptop', automation: { hostId: 'studio', label: 'This Host' } },
    ])
    expect(PeerAutomation.disagreements({ ...elsewhere, peers: [peer({ automationHostId: 'build-box', remoteHostId: 'build-box' })] })).toEqual([])
  })
})
