import { describe, expect, it } from 'vitest'
import { resolveBookmarkDrop, resolveRevisionDrop } from './revision-drop.js'

const revision = (commitId: string, parents: readonly string[] = [], localBookmarks: readonly string[] = []) => ({
  commitId,
  parents,
  immutable: false,
  localBookmarks,
})

const trunk = revision('trunk')
const feature = revision('feature', ['trunk'], ['feature/bookmark'])
const featureChild = revision('feature-child', ['feature'])
const other = revision('other', ['trunk'])
const revisions = [trunk, feature, featureChild, other]

describe('revision drop resolution', () => {
  it('prepares a rebase and records its source and destination for the preview', () => {
    expect(resolveRevisionDrop({ sourceRevisionId: 'feature', target: other, revisions })).toEqual({
      kind: 'action',
      action: { kind: 'rebase', sourceId: 'feature', destinationId: 'other' },
      presentation: { kind: 'rebase', sourceId: 'feature', destinationId: 'other' },
    })
  })

  it('explains a branch drop onto its own descendant', () => {
    expect(resolveRevisionDrop({ sourceRevisionId: 'feature', target: featureChild, revisions })).toEqual({
      kind: 'invalid',
      message: 'A branch cannot be rebased onto one of its own revisions.',
    })
  })

  it('treats dropping a revision onto itself as a no-op', () => {
    expect(resolveRevisionDrop({ sourceRevisionId: 'feature', target: feature, revisions })).toEqual({ kind: 'noop' })
  })

  it('prepares local bookmark moves with the bookmark source revision', () => {
    expect(
      resolveBookmarkDrop({
        bookmark: 'feature/bookmark',
        sourceRevisionId: 'feature',
        target: revisions[3]!,
        revisions,
      }),
    ).toEqual({
      kind: 'action',
      action: { kind: 'bookmark-move', bookmark: 'feature/bookmark', destinationId: 'other' },
      presentation: {
        kind: 'bookmark-move',
        bookmark: 'feature/bookmark',
        sourceId: 'feature',
        destinationId: 'other',
      },
    })
  })

  it('ignores missing, remote, and already-present bookmarks', () => {
    expect(resolveBookmarkDrop({ bookmark: 'stale', sourceRevisionId: 'feature', target: other, revisions })).toEqual({ kind: 'noop' })
    expect(resolveBookmarkDrop({ bookmark: 'feature/bookmark', sourceRevisionId: 'missing', target: other, revisions })).toEqual({ kind: 'noop' })
    expect(resolveBookmarkDrop({ bookmark: 'feature/bookmark', sourceRevisionId: 'feature', target: feature, revisions })).toEqual({ kind: 'noop' })
  })
})
