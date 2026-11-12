import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteInteraction } from './api.js'

type FeedReply = { readonly ok: true; readonly interactions: readonly RemoteInteraction[] }
interface FeedClient {
  readonly sessionInteractions: () => Promise<FeedReply>
}

interface EventStreamFake {
  handlers: { readonly onEvent: () => void; readonly onStatus: (status: string) => void } | undefined
  stopped: number
  /** The status the page stream reports the moment a listener subscribes, as dshx does. */
  initialStatus: string | undefined
}

const events = vi.hoisted((): EventStreamFake => ({ handlers: undefined, stopped: 0, initialStatus: undefined }))

vi.mock('@dshfiles/dshx/client', () => ({
  subscribeApiEvent: (_client: FeedClient, _event: string, handlers: { readonly onEvent: () => void; readonly onStatus: (status: string) => void }) => {
    events.handlers = handlers
    if (events.initialStatus !== undefined) handlers.onStatus(events.initialStatus)
    return () => {
      events.stopped += 1
    }
  },
}))

const { watchRemoteInteractions } = await import('./interaction-feed.js')

const row: RemoteInteraction = { id: 'event-1', runtimeId: 'runtime-a', sessionId: 'session-a', request: { kind: 'approval', toolName: 'bash' } }

const fixture = (read: () => Promise<FeedReply>) => {
  const seen: (readonly RemoteInteraction[])[] = []
  const sessionInteractions = vi.fn(read)
  // SAFETY: the feed calls only this method on the client.
  const client = { sessionInteractions } as never
  const stop = watchRemoteInteractions({ client, onChange: rows => seen.push(rows) })
  return { seen, sessionInteractions, stop }
}

describe('what remote threads wait on', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    events.handlers = undefined
    events.stopped = 0
    events.initialStatus = undefined
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads at once, on each announced change, and rarely while the stream is live', async () => {
    const { seen, sessionInteractions, stop } = fixture(async () => ({ ok: true as const, interactions: [row] }))
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual([[row]])
    events.handlers?.onStatus('live')
    await vi.advanceTimersByTimeAsync(0)
    const afterLive = sessionInteractions.mock.calls.length
    events.handlers?.onEvent()
    await vi.advanceTimersByTimeAsync(0)
    expect(sessionInteractions).toHaveBeenCalledTimes(afterLive + 1)
    await vi.advanceTimersByTimeAsync(14_000)
    expect(sessionInteractions).toHaveBeenCalledTimes(afterLive + 1)
    stop()
  })

  it('asks a live stream again once a minute, not every 15 s, and reads once at boot while it connects', async () => {
    const { sessionInteractions, stop } = fixture(async () => ({ ok: true as const, interactions: [] }))
    events.handlers?.onStatus('connecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(sessionInteractions).toHaveBeenCalledTimes(1)
    events.handlers?.onStatus('live')
    await vi.advanceTimersByTimeAsync(0)
    expect(sessionInteractions).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(sessionInteractions).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sessionInteractions).toHaveBeenCalledTimes(3)
    stop()
  })

  it('reads once at boot: a stream still connecting is read when it turns live, or after two seconds without it', async () => {
    events.initialStatus = 'connecting'
    const first = fixture(async () => ({ ok: true as const, interactions: [] }))
    await vi.advanceTimersByTimeAsync(0)
    expect(first.sessionInteractions).not.toHaveBeenCalled()
    events.handlers?.onStatus('live')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(first.sessionInteractions).toHaveBeenCalledTimes(1)
    first.stop()

    const second = fixture(async () => ({ ok: true as const, interactions: [] }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(second.sessionInteractions).toHaveBeenCalledTimes(1)
    second.stop()
  })

  it('reads at once when the page stream is already live', async () => {
    events.initialStatus = 'live'
    const { sessionInteractions, stop } = fixture(async () => ({ ok: true as const, interactions: [] }))
    await vi.advanceTimersByTimeAsync(0)
    expect(sessionInteractions).toHaveBeenCalledTimes(1)
    stop()
  })

  it('polls without the event stream', async () => {
    const { sessionInteractions, stop } = fixture(async () => ({ ok: true as const, interactions: [] }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(6_100)
    expect(sessionInteractions.mock.calls.length).toBeGreaterThanOrEqual(3)
    stop()
  })

  it('keeps what it has through a failed read, and backs off', async () => {
    let healthy = true
    const { seen, sessionInteractions, stop } = fixture(async () => {
      if (!healthy) throw new Error('blip')
      return { ok: true as const, interactions: [row] }
    })
    await vi.advanceTimersByTimeAsync(0)
    healthy = false
    await vi.advanceTimersByTimeAsync(2_100)
    expect(seen).toEqual([[row]])
    const failedReads = sessionInteractions.mock.calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(sessionInteractions).toHaveBeenCalledTimes(failedReads)
    stop()
  })

  it('shares one read between the listeners of a page, and hands the feed on when its owner leaves', async () => {
    const first = fixture(async () => ({ ok: true as const, interactions: [row] }))
    await vi.advanceTimersByTimeAsync(0)
    const second = fixture(async () => ({ ok: true as const, interactions: [] }))
    await vi.advanceTimersByTimeAsync(0)
    expect(first.sessionInteractions).toHaveBeenCalledTimes(1)
    expect(second.sessionInteractions).not.toHaveBeenCalled()
    expect(second.seen).toEqual([[row]])
    first.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(second.sessionInteractions).toHaveBeenCalledTimes(1)
    expect(second.seen).toEqual([[row], []])
    second.stop()
  })

  it('stops for good on a Host without multi-host', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'api-owner-missing' })
    vi.resetModules()
    const { sessionInteractions, stop } = fixture(async () => {
      throw missing
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sessionInteractions.mock.calls.length).toBeLessThanOrEqual(5)
    stop()
    expect(events.stopped).toBe(1)
  })
})
