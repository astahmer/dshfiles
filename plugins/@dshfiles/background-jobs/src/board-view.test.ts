import { describe, expect, it } from 'vitest'
import { BoardView } from './board-view.js'
import { jobCategoryValues } from './classify.js'

const counts = (patch: Record<string, number> = {}) => ({ ...Object.fromEntries(jobCategoryValues.map(category => [category, 0])), ...patch }) as never

describe('Processes with nothing running', () => {
  it('offers a category filter only for a category that has jobs', () => {
    expect(BoardView.shownCategories({ counts: counts(), selected: [] })).toEqual([])
    expect(BoardView.shownCategories({ counts: counts({ tests: 2, build: 1 }), selected: [] })).toEqual(['tests', 'build'])
  })
  it('keeps a selected category so its filter can be cleared', () => {
    expect(BoardView.shownCategories({ counts: counts({ tests: 2 }), selected: ['build'] })).toEqual(['tests', 'build'])
  })
  it('knows when no job exists at all, as opposed to none matching the view', () => {
    expect(BoardView.nothingExists({ board: { runningCount: 0, finishedCount: 0 }, search: '', categories: [] })).toBe(true)
    expect(BoardView.nothingExists({ board: { runningCount: 0, finishedCount: 3 }, search: '', categories: [] })).toBe(false)
    expect(BoardView.nothingExists({ board: { runningCount: 0, finishedCount: 0 }, search: 'pnpm', categories: [] })).toBe(false)
    expect(BoardView.nothingExists({ board: undefined, search: '', categories: [] })).toBe(false)
  })
})
