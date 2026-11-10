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

const BATCH_PATH = '/api/dshx-batch'

/** A batch envelope without its per-call `traceparent`, so two reads with the same input get the same digest. */
const stablePayload = payload => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return JSON.stringify(payload ?? null)
  const { traceparent: _traceparent, ...rest } = payload
  return JSON.stringify(rest)
}

/**
 * The calls one `/api/dshx-batch` POST carries: each one's endpoint (`dshx-<channel hash>/<method>`, no caller data), a
 * digest of its envelope and its size. Undefined for any other body.
 */
export const batchCalls = text => {
  try {
    const { entries } = JSON.parse(text)
    if (!Array.isArray(entries)) return undefined
    return entries.flatMap(entry =>
      typeof entry?.endpoint === 'string' && Number.isInteger(entry.id)
        ? [
            {
              id: entry.id,
              endpoint: entry.endpoint,
              digest: digest(stablePayload(entry.payload)),
              requestBytes: Buffer.byteLength(JSON.stringify(entry.payload ?? null)),
            },
          ]
        : [],
    )
  } catch {
    return undefined
  }
}

/** Bytes of each NDJSON answer line by call id: what each call of a batch weighed, never what it said. */
export const batchAnswerBytes = text => {
  const bytesById = {}
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const { id } = JSON.parse(line)
      if (Number.isInteger(id)) bytesById[id] = Buffer.byteLength(line) + 1
    } catch {
      // A cut last line of an aborted stream counts as unanswered.
    }
  }
  return bytesById
}

const responseText = content => {
  if (typeof content?.text !== 'string') return ''
  return content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text
}

const redactUrl = raw => {
  const url = new URL(raw)
  const search = url.search === '' ? '' : `?q=${digest(url.search).slice(5, 17)}`
  return `${url.origin}${url.pathname}${search}`
}

/**
 * Drop everything that can carry a credential or Session content; keep timings, sizes, statuses and digests. A batch
 * POST keeps its calls' endpoints and digests (`_batch`), plus each call's answer size read off the recorded answer.
 */
export const redactHar = har => {
  const entries = (har.log?.entries ?? []).map(entry => {
    const text = entry.request.postData?.text
    const calls = text !== undefined && new URL(entry.request.url).pathname === BATCH_PATH ? batchCalls(text) : undefined
    const answers = calls === undefined ? undefined : batchAnswerBytes(responseText(entry.response.content))
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
          : {
              postData: {
                mimeType: entry.request.postData.mimeType,
                text: digest(stableBody(text)),
                _bodyBytes: Buffer.byteLength(text),
                ...(calls === undefined ? {} : { _batch: calls.map(({ id, ...call }) => ({ ...call, responseBytes: answers?.[id] ?? null })) }),
              },
            }),
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
    // `embed`: with `omit` Playwright also drops request bodies. The raw file lives in a private temp directory and is
    // deleted once redacted.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordHar: { path: raw, content: 'embed' } })
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
