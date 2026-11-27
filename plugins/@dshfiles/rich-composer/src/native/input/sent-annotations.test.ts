import { describe, expect, it, vi } from 'vitest'
import type { SentAnnotation } from '../../sent-annotations-api.ts'
import { SentAnnotations, type SentAnnotationHistory } from './sent-annotations.ts'

const stored = (id: number, text = 'Where do operations stop?'): SentAnnotation => ({
  id, text, comment: '', source: '', sentAt: id,
})

const history = (overrides: Partial<SentAnnotationHistory> = {}): SentAnnotationHistory => ({
  load: async () => [],
  add: async input => ({ id: 7, text: input.text, comment: input.comment, source: input.source, sentAt: 1 }),
  setComment: vi.fn(async () => true),
  remove: vi.fn(async () => true),
  ...overrides,
})

describe('SentAnnotations', () => {
  it('keeps the marker immediately, then takes the Host record id', async () => {
    const store = new SentAnnotations(history())
    const placeholder = store.add({ text: 'Hook ordering.', comment: 'fixed phases', source: 'step=s1&block=2' })
    expect(placeholder.id).toBeLessThan(0)
    expect(store.snapshot()).toMatchObject([{ text: 'Hook ordering.', comment: 'fixed phases' }])
    await vi.waitFor(() => expect(store.snapshot()).toMatchObject([{ id: 7, text: 'Hook ordering.' }]))
  })

  it('hydrates the stored history and keeps a send that raced the read', async () => {
    let release: (annotations: readonly SentAnnotation[]) => void = () => undefined
    const store = new SentAnnotations(history({ load: () => new Promise(resolve => { release = resolve }) }))
    store.add({ text: 'WASM/Lua.', comment: '', source: '' })
    release([stored(3, 'Hook ordering.')])
    await vi.waitFor(() => expect(store.snapshot().map(annotation => annotation.id)).toEqual([3, expect.any(Number)]))
    expect(store.snapshot()[0]?.text).toBe('Hook ordering.')
  })

  it('forwards comment edits and removals for stored ids only', () => {
    const api = history()
    const store = new SentAnnotations(api)
    store.state.set([stored(4)])
    store.setComment({ id: 4, comment: 'overridable' })
    expect(api.setComment).toHaveBeenCalledExactlyOnceWith({ id: 4, comment: 'overridable' })
    store.remove(4)
    expect(api.remove).toHaveBeenCalledExactlyOnceWith(4)
    const placeholder = store.add({ text: 'Draft only', comment: '', source: '' })
    store.state.set([{ ...stored(-1), id: placeholder.id }])
    store.setComment({ id: placeholder.id, comment: 'typed' })
    expect(api.setComment).toHaveBeenCalledTimes(1)
  })

  it('stays in this tab without a Host history', async () => {
    const store = new SentAnnotations(undefined)
    store.add({ text: 'Local only', comment: '', source: '' })
    await Promise.resolve()
    expect(store.snapshot()).toMatchObject([{ text: 'Local only' }])
  })
})
