import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MemoryCopy } from './memory-copy.ts'

describe('memory page copy', () => {
  it('says nothing about how search ranks while it works as asked', () => {
    expect(MemoryCopy.searchNotice({ requested: 'bm25', active: 'bm25', model: null, reason: null })).toBeNull()
    expect(MemoryCopy.searchNotice({ requested: 'hybrid', active: 'hybrid', model: 'embed-small', reason: null })).toBeNull()
  })
  it('names a fallback in plain words, with what to do next', () => {
    const notice = MemoryCopy.searchNotice({ requested: 'hybrid', active: 'bm25', model: null, reason: 'No embedding provider is loaded.' })
    expect(notice?.label).toBe('Semantic search unavailable')
    expect(notice?.detail).toContain('No embedding provider is loaded.')
    expect(notice?.detail).toContain('Settings › Memory')
  })
  it('keeps every tab description to 72 characters', () => {
    for (const tab of ['notes', 'threads', 'analytics'] as const) expect(MemoryCopy.description(tab).length, tab).toBeLessThanOrEqual(72)
  })
  it('keeps the ranking algorithm and tool names out of the page', () => {
    for (const file of ['memory-panel.tsx', 'notes-tab.tsx', 'threads-tab.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/BM25|memory_note\b/u)
    }
  })
})
