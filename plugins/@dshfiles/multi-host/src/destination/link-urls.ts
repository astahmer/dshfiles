const tailscaleCgnat = (hostname: string): boolean => {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [first, second] = octets
  return first === 100 && second !== undefined && second >= 64 && second <= 127
}

const loopback = (hostname: string): boolean => hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)

/**
 * Whether pairing with this link sends the credential over plain HTTP on a network that does not encrypt it
 * itself: an `http:` origin outside Tailscale (100.64/10, `*.ts.net`) and loopback. Unparseable input is not.
 */
export const needsPlainHttpConsent = (link: string): boolean => {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const hostname = url.hostname.toLowerCase()
  return !(tailscaleCgnat(hostname) || hostname.endsWith('.ts.net') || loopback(hostname))
}

/** Link back tries each URL this machine listens on; it needs consent only when none of them is protected. */
export const linkBackNeedsPlainHttpConsent = (urls: readonly string[]): boolean => urls.length > 0 && urls.every(needsPlainHttpConsent)
