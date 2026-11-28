import { describe, expect, it } from 'vitest'

// Test the matchesFilter function logic
const matchesFilter = (name: string, filter: string): boolean => {
  if (!filter) return true
  const lowerName = name.toLowerCase()
  const lowerFilter = filter.toLowerCase()
  // Support fuzzy matching: each character in filter should appear in order in name
  let filterIndex = 0
  for (const char of lowerName) {
    if (char === lowerFilter[filterIndex]) {
      filterIndex++
      if (filterIndex === lowerFilter.length) return true
    }
  }
  return filterIndex === lowerFilter.length
}

describe('file-tree filter', () => {
  describe('matchesFilter', () => {
    it('returns true for empty filter', () => {
      expect(matchesFilter('anything.ts', '')).toBe(true)
    })

    it('matches exact substring', () => {
      expect(matchesFilter('editor-panel.tsx', 'editor')).toBe(true)
      expect(matchesFilter('editor-panel.tsx', 'panel')).toBe(true)
      expect(matchesFilter('editor-panel.tsx', 'tsx')).toBe(true)
    })

    it('matches fuzzy characters in order', () => {
      expect(matchesFilter('editor-panel.tsx', 'edpnl')).toBe(true)
      expect(matchesFilter('file-tree.tsx', 'ftt')).toBe(true)
      expect(matchesFilter('package.json', 'pkj')).toBe(true)
    })

    it('is case-insensitive', () => {
      expect(matchesFilter('EditorPanel.tsx', 'editor')).toBe(true)
      expect(matchesFilter('editor-panel.tsx', 'EDITOR')).toBe(true)
      expect(matchesFilter('FileTree.tsx', 'filetree')).toBe(true)
    })

    it('rejects non-matching filters', () => {
      expect(matchesFilter('editor.ts', 'xyz')).toBe(false)
      expect(matchesFilter('file.txt', 'json')).toBe(false)
      expect(matchesFilter('abc', 'abcd')).toBe(false)
    })

    it('rejects out-of-order characters', () => {
      expect(matchesFilter('abc', 'cba')).toBe(false)
      expect(matchesFilter('editor', 'rtodie')).toBe(false)
    })

    it('handles single character filter', () => {
      expect(matchesFilter('editor.ts', 'e')).toBe(true)
      expect(matchesFilter('editor.ts', 'z')).toBe(false)
    })

    it('handles extension filtering', () => {
      expect(matchesFilter('component.tsx', '.tsx')).toBe(true)
      expect(matchesFilter('styles.css', 'css')).toBe(true)
      expect(matchesFilter('config.json', 'json')).toBe(true)
    })
  })
})
