import { describe, expect, it } from 'vitest'
import {
  DRAFT_STORE_KEY,
  LEGACY_DRAFT_STORE_KEY,
  defaultDraftTitle,
  draftSaveBlock,
  MAX_SAVED_DRAFTS,
  readDraftStore,
  readStoredDrafts,
  removeDraft,
  saveDraft,
  sentPromptFromNode,
  type DraftStore,
} from './draft-store.js'

const draft = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Draft ${index}`,
  text: `Prompt ${index}`,
  now: '2026-10-05T12:00:00.000Z',
})

describe('saved prompt drafts', () => {
  it('rejects a draft when the composer is busy, empty, too large, or contains non-text data', () => {
    expect(draftSaveBlock({ phase: 'submitting', text: 'hello', attachmentCount: 0, referenceCount: 0 })).toBe('busy')
    expect(draftSaveBlock({ phase: 'plain', text: '   ', attachmentCount: 0, referenceCount: 0 })).toBe('empty')
    expect(draftSaveBlock({ phase: 'plain', text: 'hello', attachmentCount: 1, referenceCount: 0 })).toBe('rich-content')
    expect(draftSaveBlock({ phase: 'plain', text: 'hello', attachmentCount: 0, referenceCount: 1 })).toBe('rich-content')
    expect(draftSaveBlock({ phase: 'plain', text: 'x'.repeat(24_001), attachmentCount: 0, referenceCount: 0 })).toBe('too-long')
  })

  it('round-trips bounded plain text and removes only the selected saved prompt', () => {
    const result = saveDraft({ schemaVersion: 1, drafts: [] }, draft(1))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(readDraftStore(result.serialized)).toEqual(result.store)
    expect(removeDraft(result.store, draft(1).id)).toEqual({ schemaVersion: 1, drafts: [] })
  })

  it('ignores malformed, oversized, duplicate-id, and over-capacity stores', () => {
    expect(readDraftStore('{')).toEqual({ schemaVersion: 1, drafts: [] })
    expect(readDraftStore('x'.repeat(512_001))).toEqual({ schemaVersion: 1, drafts: [] })

    const sameId = draft(1)
    const duplicateStore: DraftStore = {
      schemaVersion: 1,
      drafts: [
        { id: sameId.id, title: 'One', text: 'One', createdAt: sameId.now, updatedAt: sameId.now },
        { id: sameId.id, title: 'Two', text: 'Two', createdAt: sameId.now, updatedAt: sameId.now },
      ],
    }
    expect(readDraftStore(JSON.stringify(duplicateStore))).toEqual({ schemaVersion: 1, drafts: [] })
  })

  it('caps the saved list and rejects malformed input without changing it', () => {
    let store: DraftStore = { schemaVersion: 1, drafts: [] }
    for (let index = 1; index <= MAX_SAVED_DRAFTS; index += 1) {
      const result = saveDraft(store, draft(index))
      expect(result.ok).toBe(true)
      if (result.ok) store = result.store
    }

    expect(saveDraft(store, draft(MAX_SAVED_DRAFTS + 1))).toEqual({ ok: false, reason: 'limit' })
    expect(saveDraft({ schemaVersion: 1, drafts: [] }, { ...draft(1), title: '  ' })).toEqual({ ok: false, reason: 'invalid-title' })
  })

  it('uses a bounded first-line title without storing prompt text in metadata', () => {
    expect(defaultDraftTitle('  Fix the parser\nsecond line')).toBe('Fix the parser')
    expect(defaultDraftTitle('x'.repeat(130))).toHaveLength(120)
  })
})

describe('sent prompt history', () => {
  it('reads only bounded plain-text user messages', () => {
    expect(
      sentPromptFromNode({
        kind: 'user',
        seq: 4,
        content: [{ type: 'text', text: 'Earlier prompt' }],
      }),
    ).toEqual({ id: 4, text: 'Earlier prompt' })
    expect(
      sentPromptFromNode({
        kind: 'user',
        seq: 5,
        content: [
          { type: 'text', text: 'first ' },
          { type: 'text', text: 'second' },
        ],
      }),
    ).toEqual({ id: 5, text: 'first second' })
    expect(sentPromptFromNode({ kind: 'steering', seq: 6, content: [{ type: 'text', text: 'steer' }] })).toBeNull()
    expect(sentPromptFromNode({ kind: 'user', seq: 7, content: [{ type: 'text', text: 'prompt' }, { type: 'file' }] })).toBeNull()
    expect(sentPromptFromNode({ kind: 'user', seq: 8, content: [{ type: 'text', text: 'x'.repeat(24_001) }] })).toBeNull()
    expect(sentPromptFromNode({ kind: 'user', seq: -1, content: [{ type: 'text', text: 'invalid' }] })).toBeNull()
  })
})

describe('draft storage key', () => {
  const storageOf = (initial: Record<string, string>) => {
    const values = new Map(Object.entries(initial))
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values }
  }
  const stored: DraftStore = {
    schemaVersion: 1,
    drafts: [{ id: draft(1).id, title: draft(1).title, text: draft(1).text, createdAt: draft(1).now, updatedAt: draft(1).now }],
  }
  const library = JSON.stringify({ version: 1, prompts: [] })

  it('keeps drafts apart from the prompt library key', () => {
    const storage = storageOf({ [LEGACY_DRAFT_STORE_KEY]: library, [DRAFT_STORE_KEY]: JSON.stringify(stored) })
    expect(readStoredDrafts(storage)).toEqual(stored)
    expect(storage.values.get(LEGACY_DRAFT_STORE_KEY)).toBe(library)
  })

  it('moves drafts saved under the shared legacy key to their own key', () => {
    const storage = storageOf({ [LEGACY_DRAFT_STORE_KEY]: JSON.stringify(stored) })
    expect(readStoredDrafts(storage)).toEqual(stored)
    expect(readDraftStore(storage.values.get(DRAFT_STORE_KEY) ?? null)).toEqual(stored)
  })

  it('reads an empty store when the legacy key holds the prompt library', () => {
    const storage = storageOf({ [LEGACY_DRAFT_STORE_KEY]: library })
    expect(readStoredDrafts(storage).drafts).toEqual([])
    expect(storage.values.has(DRAFT_STORE_KEY)).toBe(false)
  })
})
