import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { HOST_CONNECTION_ATTRIBUTE } from '@dshfiles/plugin-ui/lib/host-connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startHostReachability, type HostReachability } from './connection-strip.js'

const published = (): string | null => document.documentElement.getAttribute(HOST_CONNECTION_ATTRIBUTE)

let running: HostReachability | undefined

const start = (socketState: ConnectionState | undefined = 'connected') => {
  const socket = createSnapshotStore<ConnectionState | undefined>(socketState)
  const answer = { reachable: true }
  const probe = vi.fn(async () => answer.reachable)
  const reconnect = vi.fn()
  running = startHostReachability({ connectionState: socket, reconnect, probe })
  return { socket, answer, probe, reconnect, reachability: running }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  running?.dispose()
  running = undefined
  vi.useRealTimers()
  document.documentElement.removeAttribute(HOST_CONNECTION_ATTRIBUTE)
})

describe('startHostReachability', () => {
  it('finds a dead tunnel on a desktop too: reconnecting after one miss, offline after two, then Connected for 2 s', async () => {
    const { answer, probe, reconnect, reachability } = start()
    expect(reachability.strip.getSnapshot()).toBeUndefined()
    answer.reachable = false

    await vi.advanceTimersByTimeAsync(20_000)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(reachability.strip.getSnapshot()).toBe('reconnecting')
    expect(published()).toBe('reconnecting')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(reachability.strip.getSnapshot()).toBe('offline')
    expect(published()).toBe('offline')

    // A retry probe during the outage keeps the strip on its sentence instead of flipping it every 20 s.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(reachability.strip.getSnapshot()).toBe('offline')

    answer.reachable = true
    // t = 45 s: the next interval probe is at 60 s.
    await vi.advanceTimersByTimeAsync(15_000)
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(published()).toBeNull()
    expect(reachability.strip.getSnapshot()).toBe('connected')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(reachability.strip.getSnapshot()).toBeUndefined()
  })

  it('probes at once when the socket state changes', async () => {
    const { socket, probe, reachability } = start()
    socket.set('connecting')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(reachability.strip.getSnapshot()).toBe('reconnecting')
    expect(published()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(0)
    socket.set('connected')
    await vi.advanceTimersByTimeAsync(0)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(reachability.strip.getSnapshot()).toBe('connected')
    expect(published()).toBeNull()
  })

  it('leaves a socket that reopened itself during the outage alone when the Host answers again', async () => {
    const { socket, answer, reconnect, reachability } = start()
    answer.reachable = false
    socket.set('disconnected')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(reachability.strip.getSnapshot()).toBe('offline')
    answer.reachable = true
    socket.set('connecting')
    await vi.advanceTimersByTimeAsync(0)
    socket.set('connected')
    await vi.advanceTimersByTimeAsync(0)
    expect(reconnect).not.toHaveBeenCalled()
    expect(reachability.strip.getSnapshot()).toBe('connected')
  })

  it('says nothing while the page is still opening its first socket', async () => {
    const { socket, reachability } = start('connecting')
    expect(reachability.strip.getSnapshot()).toBeUndefined()
    expect(published()).toBeNull()
    socket.set('connected')
    await vi.advanceTimersByTimeAsync(0)
    expect(reachability.strip.getSnapshot()).toBeUndefined()
  })

  it('clears the published state when it stops', async () => {
    const { answer, reachability } = start()
    answer.reachable = false
    await vi.advanceTimersByTimeAsync(25_000)
    expect(published()).toBe('offline')
    reachability.dispose()
    running = undefined
    expect(published()).toBeNull()
  })
})
