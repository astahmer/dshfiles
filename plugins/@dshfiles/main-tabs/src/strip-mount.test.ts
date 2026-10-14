import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountStripHost } from './strip-mount.js'

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

describe('mountStripHost', () => {
  it('puts the strip host right before the main outlet and removes it on dispose', () => {
    const { column, outlet } = frame()
    const hosts: Array<HTMLElement | null> = []
    const dispose = mountStripHost({ document, onHost: host => hosts.push(host), onMissing: () => undefined, missingAfterMs: 1_000 })
    expect(hosts).toHaveLength(1)
    expect(hosts[0]?.nextElementSibling).toBe(outlet)
    expect(hosts[0]?.parentElement).toBe(column)
    dispose()
    expect(column.children).toHaveLength(1)
  })

  it('follows the outlet when the frame replaces the main column', async () => {
    const { column, outlet } = frame()
    const hosts: Array<HTMLElement | null> = []
    const dispose = mountStripHost({ document, onHost: host => hosts.push(host), onMissing: () => undefined, missingAfterMs: 1_000 })
    const replacement = document.createElement('div')
    replacement.append(outlet)
    column.replaceWith(replacement)
    await vi.waitFor(() => expect(hosts.at(-1)?.parentElement).toBe(replacement))
    expect(hosts.at(-1)?.nextElementSibling).toBe(outlet)
    expect(hosts.filter(host => host !== null)).toHaveLength(2)
    dispose()
  })

  it('warns once when no main outlet shows up, and still mounts when one appears later', async () => {
    const onMissing = vi.fn()
    const hosts: Array<HTMLElement | null> = []
    const dispose = mountStripHost({ document, onHost: host => hosts.push(host), onMissing, missingAfterMs: 10 })
    await vi.waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1))
    expect(hosts).toHaveLength(0)
    const { outlet } = frame()
    await vi.waitFor(() => expect(hosts.at(-1)?.nextElementSibling).toBe(outlet))
    dispose()
  })

  it('does not warn when the outlet appears before the deadline', async () => {
    const onMissing = vi.fn()
    const dispose = mountStripHost({ document, onHost: () => undefined, onMissing, missingAfterMs: 50 })
    frame()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(onMissing).not.toHaveBeenCalled()
    dispose()
  })
})
