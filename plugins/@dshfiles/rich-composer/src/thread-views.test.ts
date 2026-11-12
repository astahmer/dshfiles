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
