import { describe, expect, it } from 'vitest'
import { RevisionReviewModel, type GraphNode } from '../src/revision-review.js'

const node = (commitId: string, parents: readonly string[], bookmarks: readonly string[] = []): GraphNode => ({
  commitId,
  shortChangeId: `s-${commitId}`,
  bookmarks,
  parents,
})

/** main ← a ← b ← c ← d, plus x on main: what `connected(...) | parents(roots(...))` prints, newest first. */
const history = [node('d', ['c']), node('c', ['b']), node('b', ['a']), node('a', ['main']), node('x', ['main']), node('main', ['root'], ['main'])]

describe('revision placements', () => {
  it('links a revision across left-out revisions and counts them', () => {
    const placed = RevisionReviewModel.placements(
      [
        { commitId: 'a', parents: ['main'] },
        { commitId: 'd', parents: ['c'] },
      ],
      history,
    )
    expect(placed.get('d')).toEqual({ links: [{ commitId: 'a', hidden: 2 }], base: [], unplaced: [] })
    expect(placed.get('a')).toEqual({ links: [], base: [{ commitId: 'main', shortChangeId: 's-main', bookmarks: ['main'] }], unplaced: [] })
  })

  it('stops at the nearest selected revision, so a stack links each to the one below', () => {
    const placed = RevisionReviewModel.placements(
      [
        { commitId: 'a', parents: ['main'] },
        { commitId: 'b', parents: ['a'] },
        { commitId: 'd', parents: ['c'] },
      ],
      history,
    )
    expect(placed.get('d')?.links).toEqual([{ commitId: 'b', hidden: 1 }])
    expect(placed.get('b')?.links).toEqual([{ commitId: 'a', hidden: 0 }])
  })

  it('names the base of each unrelated run', () => {
    const placed = RevisionReviewModel.placements(
      [
        { commitId: 'a', parents: ['main'] },
        { commitId: 'x', parents: ['main'] },
      ],
      [node('a', ['main']), node('x', ['main']), node('main', ['root'], ['main'])],
    )
    expect(placed.get('x')).toEqual({ links: [], base: [{ commitId: 'main', shortChangeId: 's-main', bookmarks: ['main'] }], unplaced: [] })
  })

  it('does not name the outside parent of a merge inside a gap as a base', () => {
    // main ← a ← m ← d, where m also merges y from another branch; only a and d are reviewed.
    const placed = RevisionReviewModel.placements(
      [
        { commitId: 'a', parents: ['main'] },
        { commitId: 'd', parents: ['m'] },
      ],
      [node('d', ['m']), node('m', ['a', 'y']), node('a', ['main']), node('main', ['root'], ['main'])],
    )
    expect(placed.get('d')).toEqual({ links: [{ commitId: 'a', hidden: 1 }], base: [], unplaced: [] })
  })

  it('keeps a merge linked to both selected parents', () => {
    const placed = RevisionReviewModel.placements(
      [
        { commitId: 'a', parents: ['main'] },
        { commitId: 'x', parents: ['main'] },
        { commitId: 'm', parents: ['a', 'x'] },
      ],
      [node('m', ['a', 'x']), node('a', ['main']), node('x', ['main']), node('main', ['root'], ['main'])],
    )
    expect(placed.get('m')?.links).toEqual([
      { commitId: 'a', hidden: 0 },
      { commitId: 'x', hidden: 0 },
    ])
  })

  it('without a graph read links direct parents only and leaves the rest unplaced rather than call it a base', () => {
    const placed = RevisionReviewModel.placements(
      [
        { commitId: 'a', parents: ['main'] },
        { commitId: 'b', parents: ['a'] },
        { commitId: 'd', parents: ['c'] },
      ],
      undefined,
    )
    expect(placed.get('b')?.links).toEqual([{ commitId: 'a', hidden: 0 }])
    expect(placed.get('d')).toEqual({ links: [], base: [], unplaced: ['c'] })
    expect(placed.get('a')).toEqual({ links: [], base: [], unplaced: ['main'] })
  })

  it('refuses a graph read that hit the limit', () => {
    const lines = Array.from({ length: 401 }, (_, index) => JSON.stringify(node(String(index), [])))
    expect(RevisionReviewModel.decodeGraph(lines.join('\n'))).toBeUndefined()
    expect(RevisionReviewModel.decodeGraph(lines.slice(0, 3).join('\n'))).toHaveLength(3)
  })
})
