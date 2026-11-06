import { describe, expect, it, vi } from 'vitest'
import { createViewedMarks, viewedKey } from './viewed-marks.js'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  }
}

const file = { sessionId: 'session-1', seq: 4, path: 'src/a.ts' }

describe('createViewedMarks', () => {
  it('toggles a file and persists the mark', () => {
    const storage = memoryStorage()
    const marks = createViewedMarks({ storage: () => storage })
    marks.toggle(file)
    expect(marks.getSnapshot().has(viewedKey(file))).toBe(true)
    expect(
      createViewedMarks({ storage: () => storage })
        .getSnapshot()
        .has(viewedKey(file)),
    ).toBe(true)
    marks.toggle(file)
    expect(marks.getSnapshot().has(viewedKey(file))).toBe(false)
  })

  it('keeps a mark to its own turn', () => {
    const marks = createViewedMarks({ storage: () => memoryStorage() })
    marks.toggle(file)
    expect(marks.getSnapshot().has(viewedKey({ ...file, seq: 9 }))).toBe(false)
    expect(marks.getSnapshot().has(viewedKey({ ...file, sessionId: 'session-2' }))).toBe(false)
  })

  it('notifies subscribers with a new snapshot identity', () => {
    const marks = createViewedMarks({ storage: () => memoryStorage() })
    const listener = vi.fn()
    const unsubscribe = marks.subscribe(listener)
    const before = marks.getSnapshot()
    marks.toggle(file)
    expect(listener).toHaveBeenCalledOnce()
    expect(marks.getSnapshot()).not.toBe(before)
    unsubscribe()
    marks.toggle(file)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('starts empty when the stored value is corrupt', () => {
    const marks = createViewedMarks({ storage: () => memoryStorage({ 'dshfiles.diffViewed.v1': '{not json' }) })
    expect(marks.getSnapshot().size).toBe(0)
  })

  it('evicts the oldest marks beyond the cap', () => {
    const storage = memoryStorage()
    const marks = createViewedMarks({ storage: () => storage })
    for (let seq = 0; seq < 2001; seq++) marks.toggle({ ...file, seq })
    expect(marks.getSnapshot().size).toBe(2000)
    expect(marks.getSnapshot().has(viewedKey({ ...file, seq: 0 }))).toBe(false)
    expect(marks.getSnapshot().has(viewedKey({ ...file, seq: 2000 }))).toBe(true)
  })
  describe('with the Host as owner', () => {
    const other = { ...file, path: 'src/b.ts' }
    const hostMarks = () => {
      const marks = createViewedMarks({ storage: () => memoryStorage() })
      const replies: Array<{ readonly resolve: (marks: readonly string[]) => void; readonly reject: () => void }> = []
      let revision = 1
      marks.routeTo(
        () =>
          new Promise((resolve, reject) => {
            replies.push({ resolve: next => resolve({ revision: ++revision, marks: next }), reject: () => reject(new Error('Host refused')) })
          }),
      )
      marks.adopt({ revision, marks: [] })
      const shown = () => [...marks.getSnapshot()].sort()
      return { marks, replies, shown }
    }

    it('stacks a second click on the first one before the Host answers', () => {
      const { marks, shown } = hostMarks()
      marks.toggle(file)
      marks.toggle(other)
      expect(shown()).toEqual([viewedKey(file), viewedKey(other)].sort())
    })

    it('keeps a newer flip when an older click is answered', async () => {
      const { marks, replies, shown } = hostMarks()
      marks.toggle(file)
      marks.toggle(other)
      replies[0]?.resolve([viewedKey(file)])
      await Promise.resolve()
      expect(shown()).toEqual([viewedKey(file), viewedKey(other)].sort())
      replies[1]?.resolve([viewedKey(file), viewedKey(other)])
      await vi.waitFor(() => expect(shown()).toEqual([viewedKey(file), viewedKey(other)].sort()))
    })

    it('rolls back only the refused click', async () => {
      const { marks, replies, shown } = hostMarks()
      marks.toggle(file)
      marks.toggle(other)
      replies[0]?.reject()
      await vi.waitFor(() => expect(shown()).toEqual([viewedKey(other)]))
      replies[1]?.resolve([viewedKey(other)])
      await vi.waitFor(() => expect(shown()).toEqual([viewedKey(other)]))
    })
  })

  it('adopts marks another window wrote when reloaded', () => {
    const storage = memoryStorage()
    const here = createViewedMarks({ storage: () => storage })
    const elsewhere = createViewedMarks({ storage: () => storage })
    const listener = vi.fn()
    here.subscribe(listener)
    expect(here.getSnapshot().size).toBe(0)
    elsewhere.toggle(file)
    expect(here.getSnapshot().has(viewedKey(file))).toBe(false)
    here.reload()
    expect(here.getSnapshot().has(viewedKey(file))).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
  })
})
