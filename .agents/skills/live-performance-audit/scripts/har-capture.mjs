#!/usr/bin/env node
// Usage: node har-capture.mjs [--out file.har] [--seconds 60] [--tabs 1] [--summary]
//   env: LAUNCH_URL (default ~/.dsh/runtime/web-url), the same entry the other probes read.
// Records a fresh page load of the DSH Web GUI in a headless Chromium as a HAR, so a page-load audit does not need a
// HAR exported by hand. `--tabs N` opens N pages in one browser context, which share one HTTP/1.1 socket pool, to
// reproduce the queueing several open DSH tabs cause. Read-only: it only loads the page and waits.
//
// The written HAR is redacted before it touches disk under its final name: no headers, cookies, query strings or
// response bodies, and every request body replaced by a digest (with its byte size), so the launch token and Session
// contents never land in the file. har-summary.mjs reads the digests for duplicate detection.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const digest = text => `sha1:${crypto.createHash('sha1').update(text).digest('hex')}`

/** Body without the per-call `rpcId`, so two calls with the same arguments get the same digest. */
const stableBody = text => {
  try {
    const { rpcId: _rpcId, ...rest } = JSON.parse(text)
    return JSON.stringify(rest)
  } catch {
    return text
  }
}

const redactUrl = raw => {
  const url = new URL(raw)
  const search = url.search === '' ? '' : `?q=${digest(url.search).slice(5, 17)}`
  return `${url.origin}${url.pathname}${search}`
}

/** Drop everything that can carry a credential or Session content; keep timings, sizes, statuses and digests. */
export const redactHar = har => {
  const entries = (har.log?.entries ?? []).map(entry => {
    const text = entry.request.postData?.text
    return {
      ...entry,
      request: {
        method: entry.request.method,
        url: redactUrl(entry.request.url),
        httpVersion: entry.request.httpVersion,
        headers: [],
        cookies: [],
        queryString: [],
        headersSize: -1,
        bodySize: entry.request.bodySize,
        ...(text === undefined
          ? {}
          : { postData: { mimeType: entry.request.postData.mimeType, text: digest(stableBody(text)), _bodyBytes: Buffer.byteLength(text) } }),
      },
      response: {
        status: entry.response.status,
        statusText: entry.response.statusText,
        httpVersion: entry.response.httpVersion,
        headers: [],
        cookies: [],
        content: { size: entry.response.content?.size ?? 0, mimeType: entry.response.content?.mimeType ?? '' },
        redirectURL: '',
        headersSize: -1,
        bodySize: entry.response.bodySize,
      },
    }
  })
  return { log: { ...har.log, pages: (har.log?.pages ?? []).map(page => ({ ...page, title: '' })), entries } }
}

const main = async () => {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: path.join(os.tmpdir(), `dsh-load-${new Date().toISOString().replaceAll(':', '-')}.har`) },
      seconds: { type: 'string', default: '60' },
      tabs: { type: 'string', default: '1' },
      summary: { type: 'boolean', default: false },
    },
  })
  const seconds = Number(values.seconds)
  const tabs = Number(values.tabs)
  const require = createRequire(path.join(scriptDirectory, '../../../../tooling/dshx/package.json'))
  const { chromium } = require('@playwright/test')
  const url = process.env.LAUNCH_URL ?? fs.readFileSync(path.join(os.homedir(), '.dsh/runtime/web-url'), 'utf8').trim()
  const raw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-har-')), 'raw.har')

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordHar: { path: raw, content: 'omit' } })
    const pages = await Promise.all(Array.from({ length: tabs }, () => context.newPage()))
    await Promise.all(pages.map(page => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })))
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
    await context.close()
  } finally {
    await browser.close()
  }

  const redacted = redactHar(JSON.parse(fs.readFileSync(raw, 'utf8')))
  fs.rmSync(path.dirname(raw), { recursive: true, force: true })
  fs.writeFileSync(values.out, JSON.stringify(redacted), { mode: 0o600 })
  console.log(`har-capture: ${String(redacted.log.entries.length)} entries over ${String(seconds)} s with ${String(tabs)} tab(s) → ${values.out}`)
  if (values.summary) {
    const { summarizeHarFile } = await import('./har-summary.mjs')
    console.log(await summarizeHarFile(values.out))
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main()
