import type { BacklogPeerStatusView } from './api.js'

type PeerView = BacklogPeerStatusView['peers'][number]

/** Where one peer runs background automation, when that peer has reported it on a pull. */
export interface PeerAutomationView {
  readonly hostId: string
  readonly label: string
}

/** A peer that picked another automation Host than this Host, for the row note. */
export interface PeerAutomationDisagreement {
  readonly peerName: string
  readonly peerHostId: string | null
  readonly automation: PeerAutomationView
}

/** The automation Host choices this Host knows, named as it can: this Host, a known peer, or only the reported id. */
export class PeerAutomation {
  /** The Host the backlog runs automation on, as chosen in its Hosts section: empty means this Host itself. */
  static readonly hostIdOf = (status: BacklogPeerStatusView): string => status.automationHostId ?? status.hostId

  static readonly label = (status: BacklogPeerStatusView, hostId: string): string => {
    if (hostId === status.hostId) return 'This Host'
    const named = status.peers.find(peer => peer.remoteHostId === hostId)
    return named?.name ?? `Host ${hostId.slice(0, 8)}`
  }

  /** The choice a peer reported; null until it was pulled once, since the peer reports it with its op log. */
  static readonly of = (status: BacklogPeerStatusView, peer: PeerView): PeerAutomationView | null => {
    if (peer.automationHostId === null) return null
    return { hostId: peer.automationHostId, label: PeerAutomation.label(status, peer.automationHostId) }
  }

  /** Peers whose automation Host differs from this Host's choice, so a row and a note can name each disagreement. */
  static readonly disagreements = (status: BacklogPeerStatusView): readonly PeerAutomationDisagreement[] => {
    const chosen = PeerAutomation.hostIdOf(status)
    return status.peers.flatMap(peer => {
      const automation = PeerAutomation.of(status, peer)
      return automation === null || automation.hostId === chosen ? [] : [{ peerName: peer.name, peerHostId: peer.remoteHostId, automation }]
    })
  }
}
