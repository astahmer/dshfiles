import { networkInterfaces } from 'node:os'

const unmapped = (address: string): string => address.replace(/^::ffff:/i, '').replace(/%.*$/, '')

export const isLoopbackAddress = (address: string): boolean => {
  const plain = unmapped(address)
  return plain === '::1' || /^127\./.test(plain)
}

/**
 * Whether a peer address is this machine: loopback, or one of its own interface addresses (the loopback-access
 * forwarder reaches a LAN-bound server from the machine's LAN address).
 */
export const isLocalAddress = (address: string | undefined): boolean => {
  if (address === undefined) return false
  if (isLoopbackAddress(address)) return true
  const peer = unmapped(address)
  return Object.values(networkInterfaces()).some(entries => (entries ?? []).some(entry => unmapped(entry.address) === peer))
}
