import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FacetFollowing } from './facet-following.js'

const createHarness = () => {
  const calls: string[] = []
  const pages = new Map<string, { readonly thread: string; readonly kind: string; readonly follows: boolean }>()
  const placed = new Set<string>()
  const listed = new Set<string>()
  const refused = new Set<string>()
  let onScreen: string | undefined
  const following = new FacetFollowing({
    onScreen: () => onScreen,
    threadOf: id => pages.get(id)?.thread,
    kindOf: id => pages.get(id)?.kind,
    follows: id => pages.get(id)?.follows ?? false,
    placed: id => placed.has(id),
    listed: id => listed.has(id),
    openPage: kind => {
      calls.push(`open:${kind}`)
      return !refused.has(kind)
    },
    release: id => {
      calls.push(`release:${id}`)
    },
  })
  return {
    calls,
    following,
    /** Give the page a native record and a placed panel. */
    page: (id: string, page: { readonly thread: string; readonly kind: string; readonly follows?: boolean }) => {
      pages.set(id, { ...page, follows: page.follows ?? true })
      placed.add(id)
    },
    unplace: (id: string) => {
      placed.delete(id)
    },
    relist: (id: string) => {
      listed.add(id)
    },
    refuse: (kind: string) => {
      refused.add(kind)
    },
    show: (thread: string | undefined) => {
      onScreen = thread
    },
    /** The microtask a scheduleRebind queues. */
    settleQueue: () => Promise.resolve(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('facet following', () => {
  it('keeps a placed page whose thread left the screen and releases the ones that lost their reason', () => {
    const harness = createHarness()
    harness.page('kept', { thread: 'a', kind: 'cost' })
    harness.page('on-screen', { thread: 'b', kind: 'jobs' })
    harness.page('unplaced', { thread: 'c', kind: 'changes' })
    harness.page('addressed', { thread: 'd', kind: 'file', follows: false })
    harness.unplace('unplaced')
    harness.show('b')

    harness.following.drop('kept')
    harness.following.drop('on-screen')
    harness.following.drop('unplaced')
    harness.following.drop('addressed')

    expect(harness.calls).toEqual(['release:on-screen', 'release:unplaced', 'release:addressed'])
  })

  it('asks once for the on-screen thread and asks again when another thread comes on screen', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.show('b')
    harness.following.drop('cost')

    harness.following.scheduleRebind()
    await harness.settleQueue()
    expect(harness.calls).toEqual(['open:cost'])

    harness.following.drop('cost')
    harness.following.scheduleRebind()
    await harness.settleQueue()
    expect(harness.calls).toEqual(['open:cost'])

    harness.show('c')
    harness.following.scheduleRebind()
    await harness.settleQueue()
    expect(harness.calls).toEqual(['open:cost', 'open:cost'])
  })

  it('holds a kept page while no thread is on screen, and asks nothing then', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.show(undefined)
    harness.following.drop('cost')

    harness.following.scheduleRebind()
    await harness.settleQueue()
    vi.advanceTimersByTime(2_000)
    expect(harness.calls).toEqual([])
  })

  it('releases a page whose replacement the native owner refuses to open', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.show('b')
    harness.refuse('cost')
    harness.following.drop('cost')

    harness.following.scheduleRebind()
    await harness.settleQueue()
    expect(harness.calls).toEqual(['open:cost', 'release:cost'])

    vi.advanceTimersByTime(2_000)
    expect(harness.calls).toEqual(['open:cost', 'release:cost'])
  })

  it('gives a kept page up when the on-screen thread never replaces it', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.show('b')
    harness.following.drop('cost')
    harness.following.scheduleRebind()
    await harness.settleQueue()

    vi.advanceTimersByTime(1_999)
    expect(harness.calls).toEqual(['open:cost'])
    vi.advanceTimersByTime(1)
    expect(harness.calls).toEqual(['open:cost', 'release:cost'])
  })

  it('settles once for several kept pages, holding any whose own thread came back on screen', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.page('jobs', { thread: 'b', kind: 'jobs' })
    harness.show('c')
    harness.following.drop('cost')
    harness.following.drop('jobs')
    harness.following.scheduleRebind()
    await harness.settleQueue()

    harness.show('b')
    vi.advanceTimersByTime(2_000)
    expect(harness.calls).toEqual(['open:cost', 'open:jobs', 'release:cost'])
  })

  it('drops a kept page it no longer owns without releasing it', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.show('b')
    harness.following.drop('cost')
    harness.following.scheduleRebind()
    await harness.settleQueue()

    harness.relist('cost')
    vi.advanceTimersByTime(2_000)
    expect(harness.calls).toEqual(['open:cost'])
  })

  it('forgets a page another page replaced instead of releasing it', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.show('b')
    harness.following.drop('cost')
    harness.following.scheduleRebind()
    await harness.settleQueue()

    const replacement = createHarness()
    replacement.page('cost', { thread: 'a', kind: 'cost' })
    replacement.show('b')
    replacement.following.drop('cost')
    replacement.following.forget('cost')
    replacement.following.scheduleRebind()
    await replacement.settleQueue()

    expect(harness.calls).toEqual(['open:cost'])
    expect(replacement.calls).toEqual([])
  })

  it('drops every kept page on dispose, and the armed settle then releases nothing', async () => {
    const harness = createHarness()
    harness.page('cost', { thread: 'a', kind: 'cost' })
    harness.show('b')
    harness.following.drop('cost')
    harness.following.scheduleRebind()
    await harness.settleQueue()

    harness.following.dispose()
    vi.advanceTimersByTime(2_000)
    expect(harness.calls).toEqual(['open:cost'])
  })
})
