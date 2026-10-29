import { describe, expect, it } from 'vitest'
import { resolveBookmarkDrop, resolveRevisionDrop, resolveWorkspaceDrop } from './revision-drop.js'

const revision = (
  commitId: string,
  parents: readonly string[] = [],
  localBookmarks: readonly string[] = [],
  workspaces: readonly string[] = [],
  workingCopy = false,
) => ({ commitId, parents, immutable: false, localBookmarks, workspaces, workingCopy })

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

  it('moves one named workspace even when several share its current revision', () => {
    const sharedRevision = revision('shared', [], [], ['default', 'review-a', 'review-b'], true)
    const destination = revision('destination', ['shared'])
    expect(resolveWorkspaceDrop({ workspace: 'review-b', target: destination, revisions: [sharedRevision, destination] })).toEqual({
      kind: 'action',
      action: { kind: 'workspace-edit', name: 'review-b', commitId: 'destination' },
      presentation: { kind: 'workspace-move', sourceId: 'shared', destinationId: 'destination', workspace: 'review-b' },
    })
  })

  it('resolves the default workspace and ignores a drop onto its current revision', () => {
    const current = revision('current', [], [], [], true)
    expect(resolveWorkspaceDrop({ workspace: 'default', target: current, revisions: [current, other] }).kind).toBe('noop')
    expect(resolveWorkspaceDrop({ workspace: 'unknown', target: other, revisions: [current, other] })).toEqual({ kind: 'noop' })
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
