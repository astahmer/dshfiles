import { describe, expect, it, vi } from 'vitest'
import { createScreenWakeLock, type WakeLockSentinelLike } from './wake-lock.js'

const host = (overrides: { readonly available?: boolean; readonly refuse?: boolean } = {}) => {
  const sentinels: (WakeLockSentinelLike & { readonly release: ReturnType<typeof vi.fn> })[] = []
  let visible = true
  const listeners = new Set<() => void>()
  const request = vi.fn(async () => {
    if (overrides.refuse === true) throw new Error('refused')
    const sentinel = {
      released: false,
      release: vi.fn(async () => undefined),
      addEventListener: (_type: 'release', _listener: () => void) => undefined,
    }
    sentinels.push(sentinel)
    return sentinel
  })
  const service = createScreenWakeLock({
    available: overrides.available ?? true,
    request,
    onVisibility: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isVisible: () => visible,
  })
  const setVisible = (next: boolean): void => {
    visible = next
    for (const listener of listeners) listener()
  }
  return { service, request, sentinels, setVisible }
}

describe('Screen Wake Lock', () => {
  it('requests on toggle, releases on the second toggle', async () => {
    const { service, request, sentinels } = host()
    expect(service.get()).toBe(false)
    await service.toggle()
    expect(request).toHaveBeenCalledTimes(1)
    expect(service.get()).toBe(true)
    await service.toggle()
    expect(service.get()).toBe(false)
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1)
  })

  it('re-requests after the page becomes visible again while still wanted', async () => {
    const { service, request, setVisible } = host()
    await service.toggle()
    setVisible(false)
    setVisible(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('turns the toggle back off when the platform refuses the request', async () => {
    const { service } = host({ refuse: true })
    await service.toggle()
    expect(service.get()).toBe(false)
  })

  it('does nothing when the platform has no wake lock', async () => {
    const { service, request } = host({ available: false })
    await service.toggle()
    expect(request).not.toHaveBeenCalled()
    expect(service.get()).toBe(false)
  })
})
