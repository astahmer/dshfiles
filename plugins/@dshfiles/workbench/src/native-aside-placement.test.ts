import { describe, expect, it, vi } from 'vitest'
import { createNativeAsidePlacement } from './native-aside-placement.js'

describe('native aside placement', () => {
  it('deduplicates a delayed pane request and consumes it exactly once at handoff', () => {
    const show = vi.fn()
    const placement = createNativeAsidePlacement<string>(show)
    placement.request('session-a', 'jujutsu')
    placement.request('session-a', 'jujutsu')
    expect(show).not.toHaveBeenCalled()
    const detach = placement.attach('session-a', 'pane-a')
    expect(show).toHaveBeenCalledExactlyOnceWith('pane-a', 'jujutsu')
    detach()
    placement.attach('session-a', 'replacement')
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('opens immediately in an existing pane without leaking a different Session request', () => {
    const show = vi.fn()
    const placement = createNativeAsidePlacement<string>(show)
    placement.attach('session-b', 'pane-b')
    placement.request('session-a', 'jujutsu')
    expect(show).not.toHaveBeenCalled()
    placement.request('session-b', 'editor')
    expect(show).toHaveBeenCalledExactlyOnceWith('pane-b', 'editor')
    placement.attach('session-a', 'pane-a')
    expect(show).toHaveBeenLastCalledWith('pane-a', 'jujutsu')
  })

  it('releases an unmounted pane but a stale cleanup cannot release its replacement', () => {
    const show = vi.fn()
    const placement = createNativeAsidePlacement<string>(show)
    const stale = placement.attach('session-a', 'old')
    const current = placement.attach('session-a', 'new')
    stale()
    placement.request('session-a', 'jujutsu')
    expect(show).toHaveBeenCalledExactlyOnceWith('new', 'jujutsu')
    current()
    placement.request('session-a', 'editor')
    expect(show).toHaveBeenCalledTimes(1)
    placement.attach('session-a', 'remounted')
    expect(show).toHaveBeenLastCalledWith('remounted', 'editor')
  })

  it('clears mounted panes and pending handoffs when its plugin lifetime ends', () => {
    const show = vi.fn()
    const placement = createNativeAsidePlacement<string>(show)
    placement.attach('session-a', 'pane-a')
    placement.request('session-b', 'jujutsu')
    placement.dispose()
    placement.request('session-a', 'editor')
    placement.attach('session-b', 'pane-b')
    expect(show).not.toHaveBeenCalled()
  })
})
