import { createServer, type Server } from 'node:http'

/**
 * The scratch Host's side of the E2E network boundary. The browser is fenced by Playwright routes in `steps.ts`; the
 * Host process is fenced here: every scratch Host gets a loopback proxy that refuses whatever reaches it, and the
 * standard proxy variables point the Host at it.
 *
 * Coverage: DSH installs a process-wide undici dispatcher from these variables (`@deepseek-ai/dsh-http-proxy`), which
 * routes `fetch` and every undici client; `NODE_USE_ENV_PROXY=1` makes Node's own `http`/`https` and built-in `fetch`
 * honour them too; spawned children (git, curl, pnpm) inherit them. Loopback stays direct (`NO_PROXY`), so the scratch
 * Host itself, loopback fakes and the SSH fixture are unaffected. A raw `net.connect` to a public address is not
 * covered; nothing in the Host does that today.
 *
 * Set `DSHX_E2E_HOST_EGRESS=allow` to run a journey with the network, for example while recording a new fake.
 */
export interface HostEgressGuard {
  /** Proxy variables for the Host process; empty when egress is allowed. */
  readonly environment: Readonly<Record<string, string>>
  /** `host:port` targets the Host tried to reach, in order, duplicates kept. */
  attempts(): readonly string[]
  close(): Promise<void>
}

const REFUSAL = 'External network access is blocked for the E2E scratch Host. Use a loopback fake, or set DSHX_E2E_HOST_EGRESS=allow.'

const LOOPBACK_BYPASS = '127.0.0.1,localhost,::1,[::1]'

const targetOfRequest = (url: string | undefined, hostHeader: string | undefined): string => {
  try {
    const parsed = new URL(url ?? '')
    return `${parsed.hostname}:${parsed.port === '' ? (parsed.protocol === 'https:' ? '443' : '80') : parsed.port}`
  } catch {
    return hostHeader ?? 'unknown'
  }
}

const allowed: HostEgressGuard = { environment: {}, attempts: () => [], close: () => Promise.resolve() }

export const startHostEgressGuard = async (source: NodeJS.ProcessEnv = process.env): Promise<HostEgressGuard> => {
  if (source.DSHX_E2E_HOST_EGRESS === 'allow') return allowed
  const attempts: string[] = []
  const server: Server = createServer((request, response) => {
    attempts.push(targetOfRequest(request.url, request.headers.host))
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
    response.end(REFUSAL)
  })
  server.on('connect', (request, socket) => {
    attempts.push(request.url ?? 'unknown')
    socket.on('error', () => undefined)
    socket.end(
      `HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\ncontent-length: ${String(Buffer.byteLength(REFUSAL))}\r\n\r\n${REFUSAL}`,
    )
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  // A worker that exits without its After hook must not stay alive for the guard.
  server.unref()
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The E2E Host egress guard did not bind a TCP port.')
  const proxy = `http://127.0.0.1:${String(address.port)}`
  const environment = {
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    all_proxy: proxy,
    NO_PROXY: LOOPBACK_BYPASS,
    no_proxy: LOOPBACK_BYPASS,
    NODE_USE_ENV_PROXY: '1',
  }
  return {
    environment,
    attempts: () => [...attempts],
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
