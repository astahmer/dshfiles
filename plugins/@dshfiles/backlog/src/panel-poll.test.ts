import { resourceStore } from '@dshfiles/dshx/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlogApi } from './api.js'
import { BacklogPanelPoll } from './panel-poll.js'

const snapshot = (status: 'success' | 'error') => ({ status, data: { active: false }, error: undefined, updatedAt: 1, fetching: false })

describe('BacklogPanelPoll', () => {
  it('polls the revision every 5 s, and only every minute while the Host pushes changes', () => {
    expect(BacklogPanelPoll.revision).toEqual({ pollInterval: 5_000, livePollInterval: 60_000 })
  })

  it('polls AI activity every second until a read fails', () => {
    expect(BacklogPanelPoll.aiActivity.pollInterval).toBe(1_000)
    expect(BacklogPanelPoll.aiActivity.shouldPoll(snapshot('success'))).toBe(true)
    expect(BacklogPanelPoll.aiActivity.shouldPoll(snapshot('error'))).toBe(false)
  })

  describe('AI activity while the Host pushes its changes', () => {
    afterEach(() => {
      resourceStore().clear()
      vi.useRealTimers()
    })

    const methodTags: readonly string[] = backlogApi.methods.aiActivity.tags ?? []
    const pushingEvents = Object.values(backlogApi.events ?? {}).filter(definition => definition.invalidates?.some(tag => methodTags.includes(tag)) === true)

    it('reads once and again only on a pushed flip, instead of every second', async () => {
      vi.useFakeTimers()
      const store = resourceStore()
      const fetch = vi.fn(async () => ({ active: false }))
      let push = (): void => undefined
      const key = store.register({
        key: 'backlog-ai-activity-test',
        fetch,
        tags: methodTags,
        invalidatedBy: pushingEvents.map((definition, index) => ({
          id: `ai-activity-source-${String(index)}`,
          tags: definition.invalidates ?? [],
          subscribe: handlers => {
            push = handlers.onInvalidate
            handlers.onLive(true)
            return () => undefined
          },
        })),
        ...BacklogPanelPoll.aiActivity,
      })
      const unsubscribe = store.subscribe(key, () => undefined)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(pushingEvents).toHaveLength(1)
      expect(fetch).toHaveBeenCalledTimes(1)
      push()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(fetch).toHaveBeenCalledTimes(2)
      unsubscribe()
    })
  })
})
