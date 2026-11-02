// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Schedule, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { type Cdp, choosePage, dispatchClick, endpointOf, listPages, openCdp, pickOnPage } from '../src/chrome-cdp.js'

const knownChromes = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
const CHROME = process.env.CHROME_PATH ?? knownChromes.find(candidate => existsSync(candidate))
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
  // Chrome writes into its profile while it dies, so the first removal can lose the race with a fresh file.
  if (profileDir.length > 0) await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const Evaluated = Schema.Struct({ result: Schema.optional(Schema.Struct({ value: Schema.optional(Schema.Unknown) })) })
const evaluate = (cdp: Cdp, expression: string) =>
  Effect.map(cdp.send('Runtime.evaluate', { expression, returnByValue: true }), result => Schema.decodeUnknownSync(Evaluated)(result).result?.value)

const waitForPicker = (cdp: Cdp) =>
  evaluate(cdp, 'window.__dshAnnotationPicking === true').pipe(
    Effect.repeat({ until: armed => armed === true, schedule: Schedule.spaced(Duration.millis(100)) }),
    Effect.timeout(Duration.seconds(4)),
  )

const Rect = Schema.fromJsonString(Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number }))
const buttonCenter = (cdp: Cdp) =>
  Effect.map(evaluate(cdp, 'JSON.stringify(document.getElementById("save").getBoundingClientRect())'), value => {
    const rect = Schema.decodeUnknownSync(Rect)(value)
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
  })

describe.skipIf(CHROME === undefined || !existsSync(CHROME))('chrome cdp picker', () => {
  it.live(
    'lists the page and returns the clicked element',
    () =>
      Effect.gen(function* () {
        if (!started) return yield* Effect.die('chrome did not start')
        const pages = yield* listPages({ endpoint: endpointOf({ port }) }).pipe(
          Effect.repeat({ until: found => found.length > 0, schedule: Schedule.spaced(Duration.millis(250)) }),
          Effect.timeout(Duration.seconds(10)),
        )
        const page = pages[0]
        if (page === undefined) return yield* Effect.die('no page')
        const cdp = yield* openCdp({ wsUrl: page.wsUrl })
        const picking = yield* Effect.forkChild(pickOnPage({ page, timeout: Duration.seconds(15) }))
        yield* waitForPicker(cdp)
        yield* dispatchClick({ cdp, ...(yield* buttonCenter(cdp)) })
        const outcome = yield* Fiber.join(picking)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.target.selector).toBe('#save')
        expect(outcome.target.text).toBe('Save changes')
        expect(outcome.target.surface).toBe('external')
        expect(outcome.target.url).toBe(pageUrl)
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
    30_000,
  )
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
    expect(choosePage({ pages, focusedId: 'b' })?.id).toBe('b')
  })

  it('falls back to the first tab when focus is unknown', () => {
    expect(choosePage({ pages: [page('a'), page('b')] })?.id).toBe('a')
    expect(choosePage({ pages: [page('a')], focusedId: 'gone' })?.id).toBe('a')
  })

  it('returns nothing for no pages', () => {
    expect(choosePage({ pages: [] })).toBeUndefined()
  })
})
