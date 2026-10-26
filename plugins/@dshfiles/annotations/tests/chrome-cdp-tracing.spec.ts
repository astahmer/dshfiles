// @vitest-environment node
import { recordSpans, withSpan } from '@dshfiles/dshx/tracing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChromeCdp } from '../src/chrome-cdp.js'
import { PICK_BINDING } from '../src/picker-source.js'

const PRIVATE = 'private-token-and-page-content'

/** Protocol transport seam only: exercise the production CDP connection and command lifecycle. */
class SocketFixture {
  static current: SocketFixture | undefined
  onopen: (() => void) | undefined
  onerror: (() => void) | undefined
  onclose: (() => void) | undefined
  onmessage: ((event: { data: string }) => void) | undefined
  readonly sent: string[] = []
  onSend: (() => void) | undefined

  constructor(readonly url: string) {
    SocketFixture.current = this
  }

  send(data: string): void {
    this.sent.push(data)
    this.onSend?.()
  }

  close(): void {
    this.onclose?.()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  SocketFixture.current = undefined
})

describe('Chrome discovery tracing', () => {
  it('records the page-list span with counts but no endpoint or page content', async () => {
    using recorder = recordSpans()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        { type: 'page', id: PRIVATE, title: PRIVATE, url: `https://example.test/${PRIVATE}`, webSocketDebuggerUrl: `ws://127.0.0.1/${PRIVATE}` },
        { type: 'worker', id: 'worker' },
      ]),
    )
    vi.stubGlobal('fetch', fetcher)
    const pages = await withSpan('annotations test discovery', {}, () => ChromeCdp.listPages({ endpoint: `http://127.0.0.1/${PRIVATE}` }))
    expect(pages).toHaveLength(1)
    const span = recorder.span('annotations list chrome pages')
    expect(span.kind).toBe('client')
    expect(span.attributes).toEqual({ 'http.response.status_code': 200, 'dshx.annotations.pages': 1 })
    expect(recorder.children(recorder.span('annotations test discovery'))).toEqual([span])
    expect(JSON.stringify(span.attributes)).not.toContain(PRIVATE)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('records bounded discovery failures while preserving the empty fallback', async () => {
    using recorder = recordSpans()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error(PRIVATE)))
    expect(await ChromeCdp.listPages({ endpoint: `http://127.0.0.1/${PRIVATE}` })).toEqual([])
    expect(recorder.span('annotations list chrome pages').status).toMatchObject({ code: 'error', message: 'unavailable' })
    expect(JSON.stringify(recorder.spans.map(span => ({ attributes: span.attributes, status: span.status })))).not.toContain(PRIVATE)
  })

  it('records HTTP and invalid-response failures without response bodies', async () => {
    using recorder = recordSpans()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(PRIVATE, { status: 503 }))
        .mockResolvedValueOnce(new Response(PRIVATE))
        .mockResolvedValueOnce(Response.json({ private: PRIVATE })),
    )
    for (let attempt = 0; attempt < 3; attempt += 1) expect(await ChromeCdp.listPages({ endpoint: 'http://127.0.0.1' })).toEqual([])
    expect(recorder.named('annotations list chrome pages').map(span => span.status.message)).toEqual(['http-error', 'invalid-response', 'invalid-response'])
    expect(recorder.named('annotations list chrome pages')[0]?.attributes['http.response.status_code']).toBe(503)
  })
})

describe('CDP transport tracing', () => {
  it('records connection and command spans around their actual completion', async () => {
    using recorder = recordSpans()
    vi.stubGlobal('WebSocket', SocketFixture)
    await withSpan('annotations test cdp', {}, async () => {
      const opening = ChromeCdp.openCdp({ wsUrl: `ws://127.0.0.1/${PRIVATE}` })
      expect(recorder.named('annotations open cdp')).toHaveLength(0)
      const socket = SocketFixture.current
      if (socket === undefined) throw new Error('no socket')
      socket.onopen?.()
      const cdp = await opening
      try {
        const command = cdp.send(`Runtime.${PRIVATE}`, { expression: PRIVATE })
        expect(socket.sent).toHaveLength(1)
        expect(recorder.named('annotations send cdp command')).toHaveLength(0)
        socket.onmessage?.({ data: JSON.stringify({ id: 1, result: { private: PRIVATE } }) })
        expect(await command).toEqual({ private: PRIVATE })
      } finally {
        cdp.close()
      }
    })
    const opened = recorder.span('annotations open cdp')
    const sent = recorder.span('annotations send cdp command')
    expect(opened.kind).toBe('client')
    expect(sent.kind).toBe('client')
    expect(recorder.children(recorder.span('annotations test cdp'))).toEqual([opened, sent])
    expect(opened.attributes).toEqual({})
    expect(sent.attributes).toEqual({})
  })

  it('ignores malformed protocol envelopes until the matching valid response arrives', async () => {
    vi.stubGlobal('WebSocket', SocketFixture)
    const opening = ChromeCdp.openCdp({ wsUrl: 'ws://127.0.0.1/fixture' })
    const socket = SocketFixture.current
    if (socket === undefined) throw new Error('no socket')
    socket.onopen?.()
    const cdp = await opening
    try {
      const command = cdp.send('Runtime.enable')
      socket.onmessage?.({ data: '{invalid-json' })
      socket.onmessage?.({ data: JSON.stringify({ id: '1', result: {} }) })
      socket.onmessage?.({ data: JSON.stringify({ id: 1, error: 'not-an-error-object' }) })
      socket.onmessage?.({ data: JSON.stringify({ id: 1, result: {} }) })
      expect(await command).toEqual({})
    } finally {
      cdp.close()
    }
  })

  it.each([
    ['not-json', 'unavailable'],
    [JSON.stringify({ ok: false }), 'cancelled'],
    [JSON.stringify({ ok: true, target: {}, point: {} }), 'unavailable'],
  ])('preserves picker failure outcomes for %s', async (payload, reason) => {
    vi.stubGlobal('WebSocket', SocketFixture)
    const picking = ChromeCdp.pickOnPage({ page: { id: 'fixture', title: 'fixture', url: 'http://fixture', wsUrl: 'ws://127.0.0.1/fixture' }, timeoutMs: 100 })
    const socket = SocketFixture.current
    if (socket === undefined) throw new Error('no socket')
    socket.onSend = () => {
      const id = socket.sent.length
      socket.onmessage?.({ data: JSON.stringify({ id, result: {} }) })
      if (id === 3) socket.onmessage?.({ data: JSON.stringify({ method: 'Runtime.bindingCalled', params: { name: PICK_BINDING, payload } }) })
    }
    socket.onopen?.()
    expect(await picking).toEqual({ ok: false, reason })
  })

  it('records connection timeout failures without recording the socket URL', async () => {
    using recorder = recordSpans()
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', SocketFixture)
    const opening = ChromeCdp.openCdp({ wsUrl: `ws://127.0.0.1/${PRIVATE}`, timeoutMs: 10 })
    const rejected = expect(opening).rejects.toThrow('cdp open timed out')
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    expect(recorder.span('annotations open cdp').status.code).toBe('error')
    expect(recorder.span('annotations open cdp').attributes).toEqual({ 'error.type': 'Error' })
  })

  it('records command failure without the protocol error message', async () => {
    using recorder = recordSpans()
    vi.stubGlobal('WebSocket', SocketFixture)
    const opening = ChromeCdp.openCdp({ wsUrl: `ws://127.0.0.1/${PRIVATE}` })
    const socket = SocketFixture.current
    if (socket === undefined) throw new Error('no socket')
    socket.onopen?.()
    const cdp = await opening
    try {
      const command = cdp.send('Runtime.evaluate', { expression: PRIVATE })
      socket.onmessage?.({ data: JSON.stringify({ id: 1, error: { message: PRIVATE } }) })
      await expect(command).rejects.toThrow(PRIVATE)
      const span = recorder.span('annotations send cdp command')
      expect(span.status.code).toBe('error')
      expect(span.attributes).toEqual({ 'error.type': 'Error' })
      expect(span.status.message).not.toContain(PRIVATE)
    } finally {
      cdp.close()
    }
  })
})
