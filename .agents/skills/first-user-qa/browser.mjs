import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { Agent, createServer, request } from 'node:http'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { join } from 'node:path'
import { start } from 'node:repl'

const { chromium } = createRequire(new URL('../../../tooling/dshx/package.json', import.meta.url))('playwright')

// A browser-wide proxy sees redirects, popup requests and WebSockets before forwarding anything.
// Even browser-context Playwright routing does not recheck every redirect hop.
const originProxy = async origin => {
  // Do not use the global agent: NODE_USE_ENV_PROXY can forward scratch credentials elsewhere.
  const agent = new Agent({ proxyEnv: {} })
  const server = createServer((incoming, outgoing) => {
    const target = URL.parse(incoming.url)
    if (target?.origin !== origin.origin || target.protocol !== origin.protocol || target.username || target.password) {
      outgoing.writeHead(403).end()
      return
    }
    const upstream = request(target, { agent, method: incoming.method, headers: { ...incoming.headers, host: origin.host } }, response => {
      outgoing.writeHead(response.statusCode, response.headers)
      response.pipe(outgoing)
    })
    upstream.once('error', () => outgoing.destroy())
    outgoing.once('close', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  server.on('connect', (incoming, client, head) => {
    if (incoming.url !== origin.host) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    // Chromium uses CONNECT for WebSockets. Dial the fixed loopback socket directly, not through an agent.
    const upstream = connect({ host: origin.hostname, port: Number(origin.port) }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(client).pipe(upstream)
    })
    client.once('close', () => upstream.destroy())
    client.once('error', () => upstream.destroy())
    upstream.once('error', () => client.destroy())
  })
  const sockets = new Set()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      agent.destroy()
      for (const socket of sockets) socket.destroy()
      return new Promise(resolve => server.close(resolve))
    },
  }
}

export const openScratchBrowser = async ({ origin: publicOrigin, launchUrl, mobile }) => {
  const launch = new URL(launchUrl)
  if (launch.origin !== publicOrigin || launch.protocol !== 'http:' || launch.hostname !== '127.0.0.1' || !launch.port || launch.username || launch.password)
    throw new Error('Expected the assigned scratch HTTP origin')
  const proxy = await originProxy(new URL(publicOrigin))
  let browser
  const close = async () => {
    try {
      await browser?.close()
    } finally {
      await proxy.close()
    }
  }
  try {
    browser = await chromium.launch({
      executablePath: process.env.DSHX_CHROMIUM_EXECUTABLE || undefined,
      proxy: { server: proxy.url, bypass: '<-loopback>' },
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    })
    // The mobile persona needs real phone emulation (touch events, mobile layout, device pixels), not only a narrow viewport.
    const device = mobile
      ? { viewport: { width: 375, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
      : { viewport: { width: 1440, height: 900 } }
    const context = await browser.newContext({ ...device, serviceWorkers: 'block' })
    const page = await context.newPage()
    // Keep all persona actions on this page. The proxy also guards any popup's first request.
    context.on('page', popup => void popup.close().catch(() => {}))
    if (mobile) {
      // This session stays attached to the page until the browser is closed, including across reloads.
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 })
    }
    const response = await page.goto(launch.href, { waitUntil: 'commit' })
    if (!response?.ok() || new URL(page.url()).origin !== publicOrigin) throw new Error('Scratch navigation failed')
    return { page, close }
  } catch (error) {
    await close()
    throw error
  }
}

const run = async () => {
  const { QA_STATE_DIR, QA_ORIGIN, QA_PERSONA } = process.env
  const state = JSON.parse(await readFile(join(QA_STATE_DIR, 'state.json'), 'utf8'))
  if (state.origin !== QA_ORIGIN) throw new Error('Unexpected state origin')
  const browser = await openScratchBrowser({ origin: QA_ORIGIN, launchUrl: state.launchUrl, mobile: QA_PERSONA === 'mobile' })
  try {
    const repl = start({ prompt: 'qa> ', terminal: false, ignoreUndefined: true, useGlobal: false })
    repl.context.act = async action => {
      try {
        return await action(browser.page)
      } catch {
        // Browser errors can contain credential-bearing URLs. Do not print them.
        return 'Action failed; inspect the visible scratch page before trying again.'
      }
    }
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => repl.close())
    await once(repl, 'exit')
  } finally {
    await browser.close()
  }
}

if (import.meta.main) {
  await run().catch(() => {
    console.error('Scratch browser failed to start or stop. Check the assigned instance with dshx dev doctor.')
    process.exitCode = 1
  })
}
