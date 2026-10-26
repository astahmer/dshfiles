// @vitest-environment node
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { annotationsApi } from '../src/api.js'
import plugin from '../src/host.js'

const startHost = async () => {
  const host = await createTestHost()
  // Chrome status does not need the store; prevent the unrelated startup effect from doing disk I/O.
  host.ctx.provide('storageDomain', {
    open: async () => {
      throw new Error('store unavailable in transport test')
    },
  })
  host.ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [],
    update: async () => undefined,
    replace: async () => undefined,
  })
  await host.mount(plugin, { packageId: '@dshfiles/annotations' })
  return { host, api: createHostApiClient(host.ctx, annotationsApi, '@dshfiles/annotations') }
}

afterEach(() => vi.unstubAllGlobals())

describe('Chrome Host tracing', () => {
  it('records the Chrome version probe under its API span without response content', async () => {
    using recorder = recordSpans()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-browser-version', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const { host, api } = await startHost()
    try {
      const status = await api.chromeStatus({})
      expect(status.running).toBe(false)
      expect(status.pages).toEqual([])
      expect(fetcher).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/json\/version$/), { signal: expect.any(AbortSignal) })
      const span = recorder.span('annotations probe chrome')
      expect(span.kind).toBe('client')
      expect(span.attributes).toEqual({ 'http.response.status_code': 200 })
      expect(span.traceId).toBe(recorder.span('annotations/chromeStatus').traceId)
      expect(span.parentSpanId).toBe(recorder.span('annotations/chromeStatus').spanId)
    } finally {
      await host.dispose()
    }
  })

  it('records a bounded failed probe and preserves the unavailable status', async () => {
    using recorder = recordSpans()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('private-endpoint-and-error')))
    const { host, api } = await startHost()
    try {
      expect((await api.chromeStatus({})).running).toBe(false)
      const span = recorder.span('annotations probe chrome')
      expect(span.status).toMatchObject({ code: 'error', message: 'unavailable' })
      expect(span.attributes).toEqual({})
    } finally {
      await host.dispose()
    }
  })

  it('records the HTTP status of a rejected version probe', async () => {
    using recorder = recordSpans()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('private-response', { status: 503 })))
    const { host, api } = await startHost()
    try {
      expect((await api.chromeStatus({})).running).toBe(false)
      const span = recorder.span('annotations probe chrome')
      expect(span.status).toMatchObject({ code: 'error', message: 'http-error' })
      expect(span.attributes).toEqual({ 'http.response.status_code': 503 })
    } finally {
      await host.dispose()
    }
  })
})
