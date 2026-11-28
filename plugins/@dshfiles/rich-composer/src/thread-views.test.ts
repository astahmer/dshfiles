// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadViewsModel } from './thread-views.ts'

afterEach(() => {
  ThreadViewsModel.publish([])
})

describe('thread views as thread-panel facets', () => {
  it('publishes the views once per change and notifies subscribers', () => {
    const listener = vi.fn()
    const off = ThreadViewsModel.subscribe(listener)
    ThreadViewsModel.publish([{ id: 'dshfiles-traces', label: 'Traces' }])
    ThreadViewsModel.publish([{ id: 'dshfiles-traces', label: 'Traces' }])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(ThreadViewsModel.list()).toEqual([{ id: 'dshfiles-traces', label: 'Traces' }])
    off()
  })

  it('reports whether an owner took an open request, and ignores malformed ones', () => {
    expect(ThreadViewsModel.open({ sessionId: 's1', viewId: 'trajectory' })).toBe(false)
    const seen: string[] = []
    const off = ThreadViewsModel.handle(request => {
      seen.push(`${request.sessionId}:${request.viewId}`)
      return request.viewId === 'trajectory'
    })
    expect(ThreadViewsModel.open({ sessionId: 's1', viewId: 'trajectory' })).toBe(true)
    expect(ThreadViewsModel.open({ sessionId: 's1', viewId: 'unknown' })).toBe(false)
    window.dispatchEvent(new CustomEvent('dshfiles-conversation:open-thread-view', { detail: { sessionId: 1 }, cancelable: true }))
    expect(seen).toEqual(['s1:trajectory', 's1:unknown'])
    off()
    expect(ThreadViewsModel.open({ sessionId: 's1', viewId: 'trajectory' })).toBe(false)
  })

  it('names one page kind per view', () => {
    expect(ThreadViewsModel.facetKind('dshfiles-traces')).toBe('dshfiles-thread-view.dshfiles-traces')
    expect(ThreadViewsModel.facetKind('a/b c')).toBe('dshfiles-thread-view.a-b-c')
  })
})

describe('the thread header menu, folded into the one thread menu', () => {
  it('says the native More button is hosted only while a thread menu lists its actions', () => {
    const listener = vi.fn()
    const off = ThreadViewsModel.subscribe(listener)
    expect(ThreadViewsModel.headerMenuHosted()).toBe(false)
    const release = ThreadViewsModel.hostHeaderMenu()
    const releaseSecond = ThreadViewsModel.hostHeaderMenu()
    expect(ThreadViewsModel.headerMenuHosted()).toBe(true)
    release()
    release()
    expect(ThreadViewsModel.headerMenuHosted()).toBe(true)
    releaseSecond()
    expect(ThreadViewsModel.headerMenuHosted()).toBe(false)
    // Two hosts and two real releases; releasing the same host twice is a no-op.
    expect(listener).toHaveBeenCalledTimes(4)
    off()
  })

  it('hands a thread menu the actions the owner resolves, and nothing without an owner', () => {
    expect(ThreadViewsModel.headerMenuAvailable()).toBe(false)
    expect(ThreadViewsModel.headerMenu('s1')).toBeUndefined()
    const selected: string[] = []
    const withdraw = ThreadViewsModel.provideHeaderMenu(sessionId => ({
      subscribe: () => () => undefined,
      actions: () => [{ id: `${sessionId}/copy`, label: 'Copy Session as Markdown', iconKey: 'session-log-download.copy' }],
      select: id => selected.push(id),
      dispose: () => undefined,
    }))
    expect(ThreadViewsModel.headerMenuAvailable()).toBe(true)
    const menu = ThreadViewsModel.headerMenu('s1')
    expect(menu?.actions()).toEqual([{ id: 's1/copy', label: 'Copy Session as Markdown', iconKey: 'session-log-download.copy' }])
    menu?.select('s1/copy')
    expect(selected).toEqual(['s1/copy'])
    withdraw()
    expect(ThreadViewsModel.headerMenu('s1')).toBeUndefined()
  })
})
