import { act, cleanup, render, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/query-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveElapsed } from '../src/components/live-elapsed.js'
import { HOST_CONNECTION_ATTRIBUTE, HOST_CONNECTION_EVENT, HostConnection, useHostConnection } from '../src/lib/host-connection.js'
import { PluginQueryProvider, useQuery } from '../src/query.js'

/**
 * What another bundle's inlined kit copy does: it owns its own module state, so all two copies share is the attribute
 * on `html` and the event. Every reader here must agree with it.
 */
const publishFromAnotherCopy = (state: 'online' | 'reconnecting' | 'offline'): void => {
  if (state === 'online') document.documentElement.removeAttribute('data-host-connection')
  else document.documentElement.setAttribute('data-host-connection', state)
  document.dispatchEvent(new CustomEvent('dshfiles:host-connection', { detail: { state } }))
}

afterEach(() => {
  cleanup()
  publishFromAnotherCopy('online')
  vi.useRealTimers()
})

describe('HostConnection', () => {
  it('mirrors the state on html[data-host-connection], absent when online, and tells subscribers once per change', () => {
    const seen: string[] = []
    const stop = HostConnection.subscribe(state => seen.push(state))
    expect(HostConnection.read()).toBe('online')
    HostConnection.publish('reconnecting')
    expect(document.documentElement.getAttribute(HOST_CONNECTION_ATTRIBUTE)).toBe('reconnecting')
    HostConnection.publish('reconnecting')
    HostConnection.publish('offline')
    HostConnection.publish('online')
    expect(document.documentElement.hasAttribute(HOST_CONNECTION_ATTRIBUTE)).toBe(false)
    stop()
    HostConnection.publish('offline')
    expect(seen).toEqual(['reconnecting', 'offline', 'online'])
    expect(HOST_CONNECTION_EVENT).toBe('dshfiles:host-connection')
  })

  it("reads settings-shell's probe view: checking is reconnecting", () => {
    HostConnection.publish('checking')
    expect(HostConnection.read()).toBe('reconnecting')
  })

  it('agrees with a state another kit copy published', () => {
    const { result } = renderHook(() => useHostConnection())
    expect(result.current).toBe('online')
    act(() => publishFromAnotherCopy('offline'))
    expect(result.current).toBe('offline')
    expect(HostConnection.read()).toBe('offline')
    act(() => publishFromAnotherCopy('online'))
    expect(result.current).toBe('online')
  })
})

describe('LiveElapsed while DSH is away (D2)', () => {
  it('stops at its last value while the connection is not online, and moves again when it is', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const view = render(<LiveElapsed since={1_000_000 - 12_000} active />)
    const clock = view.container.querySelector('[data-live-elapsed]')
    expect(clock?.textContent).toBe('12s')
    act(() => publishFromAnotherCopy('reconnecting'))
    act(() => vi.advanceTimersByTime(5_000))
    expect(clock?.textContent).toBe('12s')
    act(() => publishFromAnotherCopy('online'))
    act(() => vi.advanceTimersByTime(1_000))
    expect(clock?.textContent).not.toBe('12s')
  })

  it('is a silent timer for screen readers (D14)', () => {
    const view = render(<LiveElapsed since={Date.now()} active />)
    const clock = view.container.querySelector('[data-live-elapsed]')
    expect(clock?.getAttribute('role')).toBe('timer')
    expect(clock?.getAttribute('aria-live')).toBe('off')
  })
})

describe('PluginQueryProvider when DSH is back', () => {
  it('refetches its queries once on the return to online, not while away', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    const queryFn = vi.fn(async () => 'value')
    const Reader = (): JSX.Element => {
      const query = useQuery({ queryKey: ['inbox'], queryFn })
      return <span>{query.data ?? 'loading'}</span>
    }
    // Two providers on one client (two slots of one bundle) must not refetch twice.
    render(
      <>
        <PluginQueryProvider client={client}>
          <Reader />
        </PluginQueryProvider>
        <PluginQueryProvider client={client}>
          <span />
        </PluginQueryProvider>
      </>,
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    act(() => publishFromAnotherCopy('reconnecting'))
    act(() => publishFromAnotherCopy('offline'))
    await Promise.resolve()
    expect(queryFn).toHaveBeenCalledTimes(1)
    act(() => publishFromAnotherCopy('online'))
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    act(() => publishFromAnotherCopy('online'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(queryFn).toHaveBeenCalledTimes(2)
  })
})

describe('CSS: motion stands still while DSH is away', () => {
  it('pauses the StatusGlyph spinner and the working shimmer under html[data-host-connection]', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    const rule = /html\[data-host-connection\]\s*:where\(([^)]*)\)\s*\{\s*animation-play-state: paused !important;/u.exec(styles)
    expect(rule).not.toBeNull()
    for (const selector of ['[data-glyph-spinner]', '.dshx-live-shimmer-sweep', '.dshx-live-shimmer-copy']) expect(rule?.[1]).toContain(selector)
  })
})
