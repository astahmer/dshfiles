import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runtimeViewsMachine } from './runtime-view-machine.js'

const fakePopup = () => {
  const popup = { closed: false, url: '', close: () => void (popup.closed = true), location: { replace: (url: string) => void (popup.url = url) } }
  return popup
}

const startViews = (overrides: { readonly closeView?: () => Promise<unknown> } = {}) => {
  const released: string[] = []
  let leases = 0
  const actor = createActor(runtimeViewsMachine, {
    input: {
      port: {
        openView: async () => ({ leaseId: `lease-${++leases}`, launchUrl: 'https://view.test/' }),
        closeView:
          overrides.closeView ??
          (async input => {
            released.push(input.leaseId)
          }),
      },
    },
  })
  const notices: string[] = []
  actor.on('notice', event => notices.push(event.message))
  actor.start()
  return { actor, released, notices }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('runtimeViewsMachine', () => {
  it('opens a lease, then releases it and stops polling once the popup closes', async () => {
    const { actor, released, notices } = startViews()
    const popup = fakePopup()
    actor.send({ type: 'view.open', runtimeId: 'rt-1', popup })
    await vi.advanceTimersByTimeAsync(0)
    expect(popup.url).toBe('https://view.test/')
    expect(notices.at(-1)).toContain('rt-1')
    expect(Object.keys(actor.getSnapshot().context.views)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(released).toEqual([])
    popup.close()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(released).toEqual(['lease-1'])
    expect(actor.getSnapshot().context.views).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a blocked popup without spawning a view', () => {
    const { actor } = startViews()
    actor.send({ type: 'view.open', runtimeId: 'rt-1', popup: null })
    expect(actor.getSnapshot().context.error).toBe('Allow pop-ups to open the native runtime view.')
    expect(actor.getSnapshot().context.views).toEqual({})
  })

  it('closes every view and announces it once all leases are released', async () => {
    const { actor, released, notices } = startViews()
    const popups = [fakePopup(), fakePopup()]
    for (const popup of popups) actor.send({ type: 'view.open', runtimeId: 'rt-1', popup })
    await vi.advanceTimersByTimeAsync(0)
    actor.send({ type: 'views.closeAll' })
    await vi.advanceTimersByTimeAsync(0)
    expect(popups.every(popup => popup.closed)).toBe(true)
    expect(released.sort()).toEqual(['lease-1', 'lease-2'])
    expect(notices.at(-1)).toBe('Closed all native runtime views and released their tunnels.')
    expect(actor.getSnapshot().context.views).toEqual({})
  })

  it('keeps a failed release as the view error', async () => {
    const { actor } = startViews({
      closeView: async () => {
        throw new Error('host unreachable')
      },
    })
    const popup = fakePopup()
    actor.send({ type: 'view.open', runtimeId: 'rt-1', popup })
    await vi.advanceTimersByTimeAsync(0)
    popup.close()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(actor.getSnapshot().context.error).toBe('Runtime view closed. Its tunnel will expire automatically if the host is unreachable.')
  })
})
