import type { HostSummary } from '../api.js'

/** Where a host is reached: its SSH target, its paired link URL, or this machine. */
export const hostTargetLabel = (host: Pick<HostSummary, 'connector'>): string => {
  switch (host.connector.kind) {
    case 'ssh':
      return host.connector.sshTarget
    case 'direct':
      return host.connector.url
    case 'local':
      return 'this machine'
  }
}
