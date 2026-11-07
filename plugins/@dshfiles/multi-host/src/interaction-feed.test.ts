import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteInteraction } from './api.js'

type FeedReply = { readonly ok: true; readonly interactions: readonly RemoteInteraction[] }
interface FeedClient {
  readonly sessionInteractions: () => Promise<FeedReply>
}

const events = vi.hoisted(() => ({
  handlers: undefined as { readonly onEvent: () => void; readonly onStatus: (status: string) => void } | undefined,
  stopped: 0,
}))

vi.mock('@dshfiles/dshx/client', () => ({
  subscribeApiEvent: (_client: FeedClient, _event: string, handlers: { readonly onEvent: () => void; readonly onStatus: (status: string) => void }) => {
    events.handlers = handlers
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
