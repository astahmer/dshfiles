import { createECDH, randomBytes } from 'node:crypto'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { describe, expect, it, vi } from 'vitest'
import type { AttentionItem } from './attention-api.js'
import { WebPushCrypto } from './web-push-crypto.js'
import { WebPushSend } from './web-push-send.js'
import { WEB_PUSH_WORKER_SOURCE } from './web-push-worker.js'

const item = (overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  id: 'item-1',
  source: 'agent-questions.native-question',
  dedupeKey: 'session-1:call-1',
  fingerprint: 'f',
  subject: { kind: 'session', id: 'session-1' },
  reason: 'Asks: Deploy the release now?',
  detail: null,
  severity: 'blocking',
  verbs: ['Open', 'Done'],
  choices: [],
  createdAt: 1_000,
  openedAt: 1_000,
  updatedAt: 1_000,
  occurrences: 1,
  resolvedAt: null,
  doneAt: null,
  snoozedUntil: null,
  snoozeUntilChange: false,
  ...overrides,
})

/** One send through the fetch HTTP client over `fetch`, with spans going to the dshx recorder. */
const sendWith = (fetch: typeof globalThis.fetch, input: Parameters<typeof WebPushSend.send>[0]) =>
  Effect.runPromise(
    WebPushSend.send(input).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provide(DshxEffect.tracerLayer),
    ),
  )

const subscription = () => {
  const receiver = createECDH('prime256v1')
  receiver.generateKeys()
  return {
    endpoint: 'https://web.push.apple.com/QGx-secret-token',
    p256dh: receiver.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  }
}

describe('WebPushSend', () => {
  it('pushes only new Needs you and Failed items, and the first read only seeds', () => {
    const question = item()
    const failure = item({ id: 'item-2', severity: 'failed' })
    const ready = item({ id: 'item-3', severity: 'ready' })
    expect(WebPushSend.fresh(null, [question, failure, ready])).toEqual([])
    const known = new Set([WebPushSend.occurrenceKey(question)])
    expect(WebPushSend.fresh(known, [question, failure, ready])).toEqual([failure])
    // The same item reopened later is a new occurrence.
    expect(WebPushSend.fresh(known, [{ ...question, openedAt: 2_000 }])).toHaveLength(1)
  })

  it('names the thread to open, and puts a failure recovery in the body', () => {
    expect(WebPushSend.payloadOf(item())).toMatchObject({ title: 'Needs you', body: 'Asks: Deploy the release now?', path: '?thread=session-1' })
    const failed = WebPushSend.payloadOf(
      item({ severity: 'failed', reason: 'Turn failed', detail: 'Retry from the thread.\nstack', subject: { kind: 'workspace', id: 'w', label: 'sample' } }),
    )
    expect(failed).toMatchObject({ title: 'sample', body: 'Turn failed Retry from the thread.', path: '' })
  })

  it('records a web-push send span with the push service host and status, never the endpoint or payload', async () => {
    using recorder = recordSpans()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 201 }))
    const outcome = await sendWith(fetch, {
      subscription: subscription(),
      keys: WebPushCrypto.generateVapidKeys(),
      payload: WebPushSend.payloadOf(item()),
      subject: 'mailto:dsh-inbox@localhost',
      nowSeconds: 1_000,
    })
    expect(outcome).toEqual({ kind: 'sent' })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(String(url)).toBe('https://web.push.apple.com/QGx-secret-token')
    const headers = new Headers(init?.headers)
    expect(headers.get('content-encoding')).toBe('aes128gcm')
    expect(headers.get('authorization')).toMatch(/^vapid t=.+, k=.+$/u)
    const span = recorder.span('web-push send')
    expect(span.attributes).toEqual({ 'server.address': 'web.push.apple.com', 'http.response.status_code': 201 })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toMatch(/QGx-secret-token|Deploy the release/u)
  })

  it('reports a forgotten subscription as gone and another refusal with what to do', async () => {
    const base = { subscription: subscription(), keys: WebPushCrypto.generateVapidKeys(), payload: WebPushSend.payloadOf(item()), subject: 's', nowSeconds: 1 }
    const gone = await sendWith(async () => new Response(null, { status: 410 }), base)
    expect(gone).toEqual({ kind: 'gone' })
    const refused = await sendWith(async () => new Response(null, { status: 403 }), base)
    expect(refused.kind === 'failed' && refused.message).toMatch(/Turn push off and on again/u)
    const offline = await sendWith(async () => Promise.reject(new TypeError('fetch failed')), base)
    expect(offline.kind === 'failed' && offline.message).toMatch(/could not be reached/u)
  })

  it('serves a worker that only shows notifications and opens the item', () => {
    expect(WEB_PUSH_WORKER_SOURCE).toContain("addEventListener('push'")
    expect(WEB_PUSH_WORKER_SOURCE).toContain("addEventListener('notificationclick'")
    expect(WEB_PUSH_WORKER_SOURCE).not.toMatch(/\bfetch\(|caches\.|importScripts/u)
    expect(() => new Function(WEB_PUSH_WORKER_SOURCE)).not.toThrow()
  })
})
