import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PreviewBrowsers } from './browser-pool.js'
import { previewSettings, type PreviewSettings } from './settings.js'

const PAGE = `<!doctype html><title>Preview fixture</title>
<h1>Counter</h1>
<label>Name <input id="name"></label>
<button onclick="document.querySelector('output').textContent = 'Hello ' + document.querySelector('#name').value">Greet</button>
<output></output>
<a href="https://example.com/">Outside</a>`

let server: Server
let origin = ''
let requestCount = 0
let settings: PreviewSettings = previewSettings.schema({})
const browsers = new PreviewBrowsers({ settings: () => settings })

beforeAll(async () => {
  server = createServer((_request, response) => {
    requestCount += 1
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  // SAFETY: a TCP server listening on a host and port reports an AddressInfo, never a pipe name.
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterAll(async () => {
  await browsers.dispose()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('PreviewBrowsers', () => {
  it('opens a loopback page, snapshots it with refs, types and clicks by ref, and records one span per action', { timeout: 60_000 }, async () => {
    using recorder = recordSpans()
    const opened = await browsers.open({ sessionId: 'session-a', url: origin, reveal: true })
    expect(opened).toMatchObject({ pageId: 'p1', title: 'Preview fixture', status: 200 })
    expect(opened.revealRequestedAt).not.toBeNull()

    const first = await browsers.snapshot({ sessionId: 'session-a', pageId: 'p1', maxChars: 20_000 })
    expect(first.refs).toBe(true)
    const inputRef = /textbox "Name" \[ref=(\w+)\]/.exec(first.snapshot)?.[1]
    const buttonRef = /button "Greet" \[ref=(\w+)\]/.exec(first.snapshot)?.[1]
    expect(inputRef).toBeDefined()
    expect(buttonRef).toBeDefined()

    await browsers.type({ sessionId: 'session-a', pageId: 'p1', target: { ref: inputRef }, text: 'preview', submit: false })
    await browsers.click({ sessionId: 'session-a', pageId: 'p1', target: { ref: buttonRef }, doubleClick: false })
    const after = await browsers.snapshot({ sessionId: 'session-a', pageId: 'p1', maxChars: 20_000 })
    expect(after.snapshot).toContain('Hello preview')
    const shot = await browsers.screenshot({ sessionId: 'session-a', pageId: 'p1', fullPage: false })
    expect([...shot.image.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])

    const names = recorder.spans.map(span => span.name)
    expect(names).toEqual(expect.arrayContaining(['preview launch', 'preview open', 'preview snapshot', 'preview type', 'preview click', 'preview screenshot']))
    expect(recorder.span('preview click').attributes).toEqual({ 'dshx.preview.page': 'p1' })
  })

  it('bounds a snapshot and reports the truncation', { timeout: 30_000 }, async () => {
    const snapshot = await browsers.snapshot({ sessionId: 'session-a', pageId: 'p1', maxChars: 500 })
    expect(snapshot.snapshot.length).toBeLessThan(600)
    expect(snapshot.truncated).toBe(snapshot.snapshot.includes('[snapshot truncated'))
  })

  it('refuses a remote host and blocks a link navigation to it', { timeout: 30_000 }, async () => {
    expect(() => browsers.open({ sessionId: 'session-a', url: 'https://example.com', reveal: false })).toThrow('not an allowed preview host')
    await expect(browsers.click({ sessionId: 'session-a', pageId: 'p1', target: { selector: 'text=Outside' }, doubleClick: false })).resolves.toBeDefined()
    const [page] = await browsers.list('session-a')
    expect(page?.url).not.toContain('example.com')
    await browsers.navigate({ sessionId: 'session-a', pageId: 'p1', url: origin, action: undefined })
  })

  it('keeps evaluate off until the setting allows it, then bounds its result', { timeout: 30_000 }, async () => {
    expect(() => browsers.evaluate({ sessionId: 'session-a', pageId: 'p1', expression: 'document.title' })).toThrow('allowEvaluate')
    settings = previewSettings.schema({ allowEvaluate: true })
    const result = await browsers.evaluate({ sessionId: 'session-a', pageId: 'p1', expression: '"x".repeat(20000)' })
    expect(result.truncated).toBe(true)
    expect(result.result.length).toBeLessThan(8_100)
    settings = previewSettings.schema({})
  })

  it('renders untrusted HTML offline in a sandboxed frame, grows a full-page capture and records a render span', { timeout: 60_000 }, async () => {
    using recorder = recordSpans()
    // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: requestCount keeps counting while the page renders
    const before = requestCount
    const document = [
      '<body style="margin:0"><div id="tall" style="height:1500px;background:#123456">probe</div>',
      `<img src="${origin}/pixel.png"><script>fetch("${origin}/beacon").catch(() => undefined); document.getElementById("tall").textContent = String(parent === window)</script>`,
    ].join('')
    const viewport = await browsers.renderHtml({
      document,
      width: 400,
      height: 300,
      fullPage: false,
      colorScheme: 'dark',
      maxImageBytes: 700 * 1024,
      maxFullPageHeight: 6000,
    })
    expect([...viewport.image.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect(viewport).toMatchObject({ width: 400, height: 300 })
    const full = await browsers.renderHtml({
      document,
      width: 400,
      height: 300,
      fullPage: true,
      colorScheme: 'light',
      maxImageBytes: 700 * 1024,
      maxFullPageHeight: 1000,
    })
    expect(full.height).toBe(1000)
    expect(requestCount).toBe(before)
    expect(recorder.spans.filter(span => span.name === 'preview render-html')).toHaveLength(2)
    expect(recorder.span('preview render-html').attributes).toEqual({ 'dshx.preview.document_chars': document.length, 'dshx.preview.full_page': false })
  })

  it('refuses a render that stays over the image budget at every quality', { timeout: 30_000 }, async () => {
    await expect(
      browsers.renderHtml({ document: '<p>x</p>', width: 400, height: 300, fullPage: false, colorScheme: 'light', maxImageBytes: 10, maxFullPageHeight: 6000 }),
    ).rejects.toThrow('even at low quality')
  })

  it('isolates threads and closes a thread’s pages when it ends', { timeout: 30_000 }, async () => {
    await browsers.open({ sessionId: 'session-b', url: origin, reveal: false })
    expect(() => browsers.snapshot({ sessionId: 'session-b', pageId: 'p2', maxChars: 1_000 })).toThrow('No open preview page')
    expect(await browsers.closeThread('session-b')).toBe(1)
    expect(await browsers.list('session-b')).toEqual([])
    expect((await browsers.list('session-a')).length).toBe(1)
  })
})
