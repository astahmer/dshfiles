import { describe, expect, it } from 'vitest'
import { SentAnnotations, SENT_ANNOTATION_LIMIT } from './sent-annotations.ts'

const memoryStorage = (): { readonly getItem: (key: string) => string | null; readonly setItem: (key: string, value: string) => void; readonly raw: Map<string, string> } => {
  const raw = new Map<string, string>()
  return { raw, getItem: key => raw.get(key) ?? null, setItem: (key, value) => { raw.set(key, value) } }
}

describe('SentAnnotations', () => {
  it('keeps the annotation an accepted message carried, and reloads it for the same session', () => {
    const storage = memoryStorage()
    const store = new SentAnnotations('session-1', storage)
    store.add({ text: 'Where do operations stop?', source: 'step=s1&block=0', comment: 'business logic' })
    expect(store.snapshot()).toMatchObject([{ text: 'Where do operations stop?', comment: 'business logic' }])
    const reloaded = new SentAnnotations('session-1', storage)
    expect(reloaded.snapshot()).toMatchObject([{ text: 'Where do operations stop?', comment: 'business logic' }])
    expect(new SentAnnotations('session-2', storage).snapshot()).toEqual([])
  })

  it('edits and removes a sent annotation without touching the draft store on reload', () => {
    const storage = memoryStorage()
    const store = new SentAnnotations('session-1', storage)
    const kept = store.add({ text: 'Hook ordering.', source: '', comment: '' })
    const removed = store.add({ text: 'WASM/Lua.', source: '', comment: '' })
    store.setComment({ id: kept.id, comment: 'fixed phases' })
    store.remove(removed.id)
    const reloaded = new SentAnnotations('session-1', storage)
    expect(reloaded.snapshot()).toMatchObject([{ id: kept.id, text: 'Hook ordering.', comment: 'fixed phases' }])
  })

  it('ignores unreadable storage and keeps the oldest ids out of the cap', () => {
    const storage = memoryStorage()
    storage.setItem('dshfiles-rich-composer:sent-annotations:session-1', '{not json')
    expect(new SentAnnotations('session-1', storage).snapshot()).toEqual([])
    const store = new SentAnnotations('session-1', memoryStorage())
    for (let index = 0; index < SENT_ANNOTATION_LIMIT + 5; index += 1) store.add({ text: `passage ${String(index)}`, source: '', comment: '' })
    expect(store.snapshot()).toHaveLength(SENT_ANNOTATION_LIMIT)
    expect(store.snapshot()[0]?.text).toBe('passage 5')
  })
})
