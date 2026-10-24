import { appendFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { Page } from 'playwright'
import { ScratchStateRuntime } from './state.js'
import { chromiumLaunchOptions } from '../project/chromium-launch-options.js'

/**
 * Long-lived headless Chromium for one scratch DSH. `dshx dev open` and `shot` attach over CDP, so the page and its
 * state survive between commands, and this process records console, page and network errors for the whole session.
 * `dshx dev down` stops its process group, which takes the browser with it.
 */
const { values } = parseArgs({
  options: {
    'cdp-port': { type: 'string' },
    'user-data-dir': { type: 'string' },
    events: { type: 'string' },
    ready: { type: 'string' },
  },
})
const cdpPort = values['cdp-port']
const userDataDir = values['user-data-dir']
const eventsFile = values.events
const readyFile = values.ready
if (cdpPort === undefined || userDataDir === undefined || eventsFile === undefined || readyFile === undefined) {
  throw new Error('browser-host requires --cdp-port, --user-data-dir, --events and --ready.')
}

const record = (kind: string, detail: string): void => {
  appendFileSync(eventsFile, `${JSON.stringify({ at: new Date().toISOString(), kind, detail: ScratchStateRuntime.redactUrls(detail).slice(0, 2_000) })}\n`, {
    mode: 0o600,
  })
}

const pathOf = (url: string): string => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' ? parsed.pathname : `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

const watch = (page: Page): void => {
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') record(`console.${message.type()}`, message.text())
  })
  page.on('pageerror', error => record('pageerror', error.message))
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText ?? 'unknown'
    if (reason !== 'net::ERR_ABORTED') record('requestfailed', `${request.resourceType()} ${pathOf(request.url())} ${reason}`)
  })
  page.on('response', response => {
    if (response.status() >= 400) record('http', `${response.status()} ${response.request().resourceType()} ${pathOf(response.url())}`)
  })
}

const { chromium } = await import('playwright')
const context = await chromium.launchPersistentContext(userDataDir, {
  ...(await chromiumLaunchOptions()),
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [`--remote-debugging-port=${cdpPort}`],
})
for (const page of context.pages()) watch(page)
context.on('page', watch)
if (context.pages().length === 0) await context.newPage()
writeFileSync(readyFile, 'ready\n', { mode: 0o600 })

const stop = (): void => {
  void context.close().finally(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
setInterval(() => undefined, 60_000)
