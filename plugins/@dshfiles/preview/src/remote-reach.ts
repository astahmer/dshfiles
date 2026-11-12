/**
 * Open a thread's dev server from another device (productivity pass T6.4). The Host lists a port as
 * `http://localhost:<port>/`, which on a phone reaching DSH over Tailscale (or the LAN) names the phone itself. When
 * the GUI is not on loopback, a server listening on every interface is opened on the DSH Host's own name instead
 * (the name the browser already reached DSH on), and a server that listens on loopback only gets the exact fix,
 * since no other device can reach it. Pure: the viewer's location and the socket's address decide.
 */

export interface Viewer {
  /** `window.location.hostname` of the DSH GUI. */
  readonly hostname: string
  /** `window.location.protocol` of the DSH GUI (`https:` behind `tailscale serve`). */
  readonly protocol: string
}

export interface ListeningPort {
  /** The socket's bound address as the Host saw it (`127.0.0.1`, `::1`, `0.0.0.0`, `::`, `*`, or a concrete one). */
  readonly address: string
  readonly port: number
  readonly url: string
}

export type Reach =
  /** Open this URL; `newTab` when a pane (an iframe in an https page) would refuse an http page from another host. */
  | { readonly kind: 'open'; readonly url: string; readonly newTab: boolean }
  /** No other device can reach this port: say why and how to fix it. */
  | { readonly kind: 'loopback-only'; readonly port: number; readonly address: string; readonly host: string; readonly message: string; readonly fix: string }

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const WILDCARD_ADDRESSES = new Set(['*', '0.0.0.0', '::', ''])

const isLoopbackHost = (hostname: string): boolean => {
  const bare = hostname.toLowerCase()
  return LOOPBACK_HOSTS.has(bare) || bare.endsWith('.localhost') || /^127\./u.test(bare)
}
const isLoopbackAddress = (address: string): boolean =>
  address === '::1' || address === 'localhost' || /^127\./u.test(address) || address === '::ffff:127.0.0.1'

const hostForUrl = (hostname: string): string => (hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname)

/** The command that makes a loopback-only server reachable from other devices. */
export const LOOPBACK_FIX = 'restart it listening on every interface, e.g. `vite --host 0.0.0.0`, `next dev -H 0.0.0.0` or `HOST=0.0.0.0 npm run dev`'

/** Over Tailscale (a `*.ts.net` name), `tailscale serve` also publishes a loopback port to the tailnet, over HTTPS. */
const fixFor = (port: ListeningPort, viewer: Viewer): string =>
  viewer.hostname.endsWith('.ts.net')
    ? `${LOOPBACK_FIX}; or publish it on the tailnet with \`tailscale serve --bg --https=${String(port.port)} http://127.0.0.1:${String(port.port)}\``
    : LOOPBACK_FIX

const loopbackOnly = (port: ListeningPort, viewer: Viewer): Reach => ({
  kind: 'loopback-only',
  port: port.port,
  address: port.address,
  host: viewer.hostname,
  message: `Port ${String(port.port)} only listens on ${port.address}, so this device can't reach it through ${viewer.hostname}. To open it here, ${fixFor(port, viewer)}, then Open again. Watch on a preview page shows the agent's own browser meanwhile.`,
  fix: fixFor(port, viewer),
})

const resolvePort = (port: ListeningPort, viewer: Viewer): Reach => {
  if (isLoopbackHost(viewer.hostname)) return { kind: 'open', url: port.url, newTab: false }
  if (isLoopbackAddress(port.address)) return loopbackOnly(port, viewer)
  const target = new URL(port.url)
  if (WILDCARD_ADDRESSES.has(port.address) || isLoopbackHost(target.hostname)) target.hostname = hostForUrl(viewer.hostname)
  const url = target.toString()
  // An https GUI cannot frame an http page from a non-loopback host (mixed content): open a tab instead.
  return { kind: 'open', url, newTab: viewer.protocol === 'https:' && target.protocol === 'http:' }
}

/**
 * A preview page's URL (`http://localhost:5173/route`): its port's listening address comes from the dev-server list
 * when a listed server owns that port; an unlisted port is treated as reachable and opened on the Host's name.
 */
const resolveUrl = (url: string, ports: readonly ListeningPort[], viewer: Viewer): Reach => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'open', url, newTab: false }
  }
  if (isLoopbackHost(viewer.hostname) || !isLoopbackHost(parsed.hostname)) return { kind: 'open', url, newTab: false }
  const number = Number(parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : parsed.port)
  const known = ports.find(port => port.port === number)
  if (known !== undefined && isLoopbackAddress(known.address)) return loopbackOnly(known, viewer)
  parsed.hostname = hostForUrl(viewer.hostname)
  return { kind: 'open', url: parsed.toString(), newTab: viewer.protocol === 'https:' && parsed.protocol === 'http:' }
}

export class RemoteReach {
  static readonly port = resolvePort
  static readonly url = resolveUrl
  static readonly isLoopbackHost = isLoopbackHost
}
