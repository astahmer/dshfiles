import { afterEach, describe, expect, it, vi } from 'vitest'
import { StripMount } from './strip-mount.js'
import type { MainSurfaceSeat, MainSurfaceMode } from '@dshfiles/frame-layout/regions'

const frame = () => {
  const column = document.createElement('div')
  const outlet = document.createElement('div')
  outlet.setAttribute('data-slot', 'main')
  column.append(outlet)
  document.body.append(column)
  return { column, outlet }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('mountNativeStripHost', () => {
  it('keeps the native fallback without a frame seat', () => {
    const { outlet } = frame()
    const hosts: Array<HTMLElement | null> = []
    const dispose = StripMount.nativeHost({ document, onHost: host => hosts.push(host), onMissing: vi.fn(), missingAfterMs: 10 }, undefined)
    expect(hosts.at(-1)?.nextElementSibling).toBe(outlet)
    dispose()
  })

  it('removes only the native strip in workbench mode and restores it when native returns', () => {
    const { column, outlet } = frame()
    const shell = document.createElement('div')
    shell.setAttribute('data-slot', 'shell.main')
    column.append(shell)
    let mode: MainSurfaceMode = 'native'
    const listeners = new Set<() => void>()
    const seat: MainSurfaceSeat = {
      mode: () => mode,
      setMode: next => {
        mode = next
        for (const listener of listeners) listener()
      },
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
    const hosts: Array<HTMLElement | null> = []
    const onMissing = vi.fn()
    const dispose = StripMount.nativeHost({ document, onHost: host => hosts.push(host), onMissing, missingAfterMs: 10 }, seat)
    expect(document.querySelector('[data-dshfiles-main-tabs]')).not.toBeNull()
    seat.setMode('workbench')
    expect(hosts.at(-1)).toBeNull()
    expect(document.querySelector('[data-dshfiles-main-tabs]')).toBeNull()
    expect(shell.style.display).toBe('')
    expect(outlet.style.display).toBe('')
    seat.setMode('native')
    expect(hosts.at(-1)?.nextElementSibling).toBe(outlet)
    expect(onMissing).not.toHaveBeenCalled()
    dispose()
    expect(listeners.size).toBe(0)
  })

  it('cancels native outlet discovery when workbench takes over before the outlet appears', async () => {
    let mode: MainSurfaceMode = 'native'
    const listeners = new Set<() => void>()
    const seat: MainSurfaceSeat = {
      mode: () => mode,
      setMode: next => {
        mode = next
        for (const listener of listeners) listener()
      },
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
    const onMissing = vi.fn()
    const onHost = vi.fn()
    const dispose = StripMount.nativeHost({ document, onHost, onMissing, missingAfterMs: 10 }, seat)
    seat.setMode('workbench')
    frame()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onMissing).not.toHaveBeenCalled()
    expect(document.querySelector('[data-dshfiles-main-tabs]')).toBeNull()
    expect(onHost).not.toHaveBeenCalledWith(expect.any(HTMLElement))
    seat.setMode('native')
    expect(document.querySelectorAll('[data-dshfiles-main-tabs]')).toHaveLength(1)
    dispose()
    expect(listeners.size).toBe(0)
  })

  it('does not mount or warn when workbench has no native main outlet', async () => {
    const onMissing = vi.fn()
    const dispose = StripMount.nativeHost(
      { document, onHost: vi.fn(), onMissing, missingAfterMs: 0 },
      {
        mode: () => 'workbench',
        setMode: () => undefined,
        subscribe: () => () => undefined,
      },
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(onMissing).not.toHaveBeenCalled()
    expect(document.querySelector('[data-dshfiles-main-tabs]')).toBeNull()
    dispose()
  })
})

describe('mountStripHost', () => {
  it('puts the strip host right before the main outlet and removes it on dispose', () => {
    const { column, outlet } = frame()
    const hosts: Array<HTMLElement | null> = []
    const dispose = StripMount.host({ document, onHost: host => hosts.push(host), onMissing: () => undefined, missingAfterMs: 1_000 })
    expect(hosts).toHaveLength(1)
    expect(hosts[0]?.nextElementSibling).toBe(outlet)
    expect(hosts[0]?.parentElement).toBe(column)
    dispose()
    expect(column.children).toHaveLength(1)
  })

  it('follows the outlet when the frame replaces the main column', async () => {
    const { column, outlet } = frame()
    const hosts: Array<HTMLElement | null> = []
    const dispose = StripMount.host({ document, onHost: host => hosts.push(host), onMissing: () => undefined, missingAfterMs: 1_000 })
    const replacement = document.createElement('div')
    replacement.append(outlet)
    column.replaceWith(replacement)
    await vi.waitFor(() => expect(hosts.at(-1)?.parentElement).toBe(replacement))
    expect(hosts.at(-1)?.nextElementSibling).toBe(outlet)
    expect(hosts.filter(host => host !== null)).toHaveLength(2)
    dispose()
  })

  it('leaves a detached column and follows the replacement native outlet', async () => {
    const { column } = frame()
    const hosts: Array<HTMLElement | null> = []
    const dispose = StripMount.host({ document, onHost: host => hosts.push(host), onMissing: vi.fn(), missingAfterMs: 1_000 })
    const replacement = frame()
    column.remove()
    await vi.waitFor(() => expect(hosts.at(-1)?.nextElementSibling).toBe(replacement.outlet))
    expect(column.querySelector('[data-dshfiles-main-tabs]')).toBeNull()
    expect(document.querySelectorAll('[data-dshfiles-main-tabs]')).toHaveLength(1)
    dispose()
  })

  it('warns once when no main outlet shows up, and still mounts when one appears later', async () => {
    const onMissing = vi.fn()
    const hosts: Array<HTMLElement | null> = []
    const dispose = StripMount.host({ document, onHost: host => hosts.push(host), onMissing, missingAfterMs: 10 })
    await vi.waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1))
    expect(hosts).toHaveLength(0)
    const { outlet } = frame()
    await vi.waitFor(() => expect(hosts.at(-1)?.nextElementSibling).toBe(outlet))
    dispose()
  })

  it('does not warn when the outlet appears before the deadline', async () => {
    const onMissing = vi.fn()
    const dispose = StripMount.host({ document, onHost: () => undefined, onMissing, missingAfterMs: 50 })
    frame()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(onMissing).not.toHaveBeenCalled()
    dispose()
  })
})
