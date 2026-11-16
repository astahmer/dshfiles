/** The two facts the Hosts header carries as muted chips, so neither needs a card above the list. */
export class HostsHeader {
  /** How linking stands; nothing until the status is read. */
  static readonly linkChip = (status: { readonly enabled: boolean; readonly listening: boolean } | undefined): string | null => {
    if (status === undefined) return null
    if (!status.enabled) return 'Linking off'
    return status.listening ? 'Linking on' : 'Linking on, not listening'
  }

  /** Where "Auto" sends a new thread: the host picked by load, or unavailable while no host can take one. */
  static readonly autoChip = (selected: { readonly hostName: string } | null | undefined): string | null => {
    if (selected === undefined) return null
    return selected === null ? 'Auto destination unavailable' : `Auto destination: ${selected.hostName}`
  }
}
