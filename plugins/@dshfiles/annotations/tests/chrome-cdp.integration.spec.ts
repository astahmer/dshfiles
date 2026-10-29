// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Cdp, ChromeCdp } from '../src/chrome-cdp.js'
import { ChromeLaunch } from '../src/chrome-launch.js'

const CHROME = process.env.CHROME_PATH ?? ChromeLaunch.chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '' })
const PAGE = '<title>Pick fixture</title><h1>Fixture</h1><button id="save" aria-label="Save changes">Save</button>'

let chrome: ChildProcessWithoutNullStreams | undefined
let profileDir = ''
let port = 0
let started = false
let pageUrl = ''
let server: Server | undefined

const waitForPort = (stderr: NodeJS.ReadableStream): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chrome did not print a devtools endpoint')), 20_000)
    let buffer = ''
    stderr.on('data', chunk => {
      buffer += String(chunk)
      const match = /ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//.exec(buffer)
      if (match?.[1] === undefined) return
      clearTimeout(timer)
      resolve(Number.parseInt(match[1], 10))
    })
  })

beforeAll(async () => {
  if (CHROME === undefined || !existsSync(CHROME)) return
  profileDir = await mkdtemp(join(tmpdir(), 'dsh-annotations-chrome-'))
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><body>${PAGE}</body></html>`)
  })
  await new Promise<void>(resolve => {
    server?.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no fixture port')
  pageUrl = `http://127.0.0.1:${address.port}/`
  chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    pageUrl,
  ])
  port = await waitForPort(chrome.stderr)
  started = true
}, 40_000)

afterAll(async () => {
  chrome?.kill('SIGKILL')
  await new Promise<void>(resolve => {
    if (server === undefined) return resolve()
    server.close(() => resolve())
  })
  if (profileDir.length > 0) await rm(profileDir, { recursive: true, force: true })
})

const waitForPicker = async ({ cdp }: { cdp: Cdp }): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = (await cdp.send('Runtime.evaluate', {
      expression: 'window.__dshAnnotationPicking === true',
      returnByValue: true,
    })) as { readonly result?: { readonly value?: unknown } }
    if (result.result?.value === true) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('picker never armed')
}

const buttonCenter = async ({ cdp }: { cdp: Cdp }): Promise<{ x: number; y: number }> => {
  const result = (await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify(document.getElementById("save").getBoundingClientRect())',
    returnByValue: true,
  })) as { readonly result?: { readonly value?: string } }
  const rect = JSON.parse(result.result?.value ?? '{}') as { x?: number; y?: number; width?: number; height?: number }
  return { x: Math.round((rect.x ?? 0) + (rect.width ?? 0) / 2), y: Math.round((rect.y ?? 0) + (rect.height ?? 0) / 2) }
}

describe.skipIf(CHROME === undefined || !existsSync(CHROME))('chrome cdp picker', () => {
  it('lists the page and returns the clicked element', async () => {
    if (!started) throw new Error('chrome did not start')
    let pages = await ChromeCdp.listPages({ endpoint: ChromeCdp.endpointOf({ port }) })
    for (let attempt = 0; attempt < 40 && pages.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250))
      pages = await ChromeCdp.listPages({ endpoint: ChromeCdp.endpointOf({ port }) })
    }
    expect(pages.length).toBeGreaterThan(0)
    const page = pages[0]
    if (page === undefined) throw new Error('no page')

    const cdp = await ChromeCdp.openCdp({ wsUrl: page.wsUrl })
    try {
      const picking = ChromeCdp.pickOnPage({ page, timeoutMs: 15_000 })
      await waitForPicker({ cdp })
      const center = await buttonCenter({ cdp })
      const base = { x: center.x, y: center.y, button: 'left', clickCount: 1 }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })

      const outcome = await picking
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.target.selector).toBe('#save')
      expect(outcome.target.text).toBe('Save changes')
      expect(outcome.target.surface).toBe('external')
      expect(outcome.target.url).toBe(pageUrl)
    } finally {
      cdp.close()
    }
  }, 30_000)
})

describe('choosePage', () => {
  const page = (id: string): { id: string; title: string; url: string; wsUrl: string } => ({
    id,
    title: id,
    url: `http://localhost/${id}`,
    wsUrl: `ws://127.0.0.1:1/${id}`,
  })

  it('prefers the focused tab', () => {
    const pages = [page('a'), page('b')]
    expect(ChromeCdp.choosePage({ pages, focusedId: 'b' })?.id).toBe('b')
  })

  it('falls back to the first tab when focus is unknown', () => {
    expect(ChromeCdp.choosePage({ pages: [page('a'), page('b')] })?.id).toBe('a')
    expect(ChromeCdp.choosePage({ pages: [page('a')], focusedId: 'gone' })?.id).toBe('a')
  })

  it('returns nothing for no pages', () => {
    expect(ChromeCdp.choosePage({ pages: [] })).toBeUndefined()
  })
})
