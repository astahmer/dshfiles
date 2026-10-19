import { describe, expect, it } from 'vitest'
import type { PromptStashSnapshot } from './library-api.js'
import { PromptLibraryQueries } from './library-queries.js'

const snapshot = (revision: number): PromptStashSnapshot => ({ revision, prompts: [] })

describe('prompt library query snapshots', () => {
  it('keeps a newer Host snapshot when a slower request returns older data', () => {
    const current = snapshot(4)
    expect(PromptLibraryQueries.newest(current, snapshot(3))).toBe(current)
  })

  it('accepts the newest Host snapshot', () => {
    expect(PromptLibraryQueries.newest(snapshot(3), snapshot(4))).toEqual(snapshot(4))
  })
})
