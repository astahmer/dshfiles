import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer, globalAgent } from 'node:http'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { openScratchBrowser } from './browser.mjs'

const fixture = async handler => {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { origin: `http://127.0.0.1:${server.address().port}`, server, close: () => server.close() }
}

const checkBrowser = async t => {
  assert.equal(globalAgent.options.proxyEnv?.HTTP_PROXY, process.env.HTTP_PROXY)
  let escaped = 0
  const outside = await fixture((_request, response) => {
    escaped++
    response.end('outside')
  })
  t.after(outside.close)
  const scratch = await fixture((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: outside.origin }).end()
    } else if (request.url.startsWith('/probe')) {
      response.setHeader('Cache-Control', 'no-store')
      response.end('ok')
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end(`<button data-probe="details">Details</button><button data-probe="refresh">Refresh</button><output></output><script>
        for (const button of document.querySelectorAll('button')) button.onclick = async () => {
          const now = performance.now(); await fetch('/probe-' + button.dataset.probe); document.querySelector('output').textContent = performance.now() - now;
        };
      </script>`)
    }
  })
  t.after(scratch.close)
  scratch.server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.once('data', () => socket.write(Buffer.from([0x81, 4, ...Buffer.from('pong')])))
    socket.on('end', () => socket.end())
  })
  const runner = await openScratchBrowser({ origin: scratch.origin, launchUrl: `${scratch.origin}/?token=fixture`, mobile: true })
  try {
    const { page } = runner
    assert.equal(page.viewportSize().width, 375)
    assert.deepEqual(await page.evaluate(() => [navigator.maxTouchPoints > 0, matchMedia('(pointer: coarse)').matches]), [true, true])
    const verifyLatency = async name => {
      await page.locator('output').evaluate(output => (output.textContent = ''))
      await page.getByRole('button', { name }).click()
      await page.waitForFunction(() => document.querySelector('output').textContent !== '')
      assert.ok(Number(await page.locator('output').textContent()) >= 350, `${name} did not incur the configured latency`)
    }
    await verifyLatency('Details')
    await verifyLatency('Refresh')
    await page.reload()
    await verifyLatency('Details')
    const pong = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const socket = new WebSocket(`ws://${location.host}/socket`)
          socket.addEventListener('open', () => socket.send('ping'))
          socket.addEventListener('message', event => {
            socket.close()
            resolve(event.data)
          })
          socket.addEventListener('error', () => reject(new Error('Same-origin WebSocket failed')))
        }),
    )
    assert.equal(pong, 'pong')
    assert.deepEqual(
      await page.evaluate(async outsideOrigin => {
        const rejects = url =>
          fetch(url).then(
            () => false,
            () => true,
          )
        const outcome = await Promise.all([rejects(outsideOrigin), rejects('/redirect')])
        return [...outcome, window.open(outsideOrigin, '_blank') !== null]
      }, outside.origin),
      [true, true, true],
    )
    // The allowed request acts as a barrier while the popup initiates its navigation.
    await page.evaluate(() => fetch('/probe'))
    assert.equal(escaped, 0)
  } finally {
    await runner.close()
  }
}

const name = 'uses direct scratch HTTP and WebSockets despite the ambient proxy, persists slow 3G, and blocks off-origin requests'
test(
  name,
  { timeout: 25_000 },
  process.env.FIRST_USER_QA_PROXY_PROBE === '1'
    ? checkBrowser
    : async t => {
        let proxyHits = 0
        const decoy = await fixture((_request, response) => {
          proxyHits++
          response.writeHead(502).end()
        })
        decoy.server.on('connect', (_request, socket) => {
          proxyHits++
          socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        })
        t.after(decoy.close)
        const env = { ...process.env, NODE_USE_ENV_PROXY: '1', FIRST_USER_QA_PROXY_PROBE: '1', NO_PROXY: '', no_proxy: '' }
        for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) env[key] = decoy.origin
        delete env.NODE_TEST_CONTEXT
        await promisify(execFile)(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env, timeout: 20_000 })
        assert.equal(proxyHits, 0)
      },
)
