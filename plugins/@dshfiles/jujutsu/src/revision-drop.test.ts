import { describe, expect, it } from 'vitest'
import { RevisionDropModel } from './revision-drop.js'

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
    expect(RevisionDropModel.resolveRevision({ sourceRevisionId: 'feature', target: other, revisions })).toEqual({
      kind: 'action',
      action: { kind: 'rebase', sourceId: 'feature', destinationId: 'other' },
      presentation: { kind: 'rebase', sourceId: 'feature', destinationId: 'other' },
    })
  })

  it('explains a branch drop onto its own descendant', () => {
    expect(RevisionDropModel.resolveRevision({ sourceRevisionId: 'feature', target: featureChild, revisions })).toEqual({
      kind: 'invalid',
      message: 'A branch cannot be rebased onto one of its own revisions.',
    })
  })

  it('treats dropping a revision onto itself as a no-op', () => {
    expect(RevisionDropModel.resolveRevision({ sourceRevisionId: 'feature', target: feature, revisions })).toEqual({ kind: 'noop' })
  })

  it('moves one named workspace even when several share its current revision', () => {
    const sharedRevision = revision('shared', [], [], ['default', 'review-a', 'review-b'], true)
    const destination = revision('destination', ['shared'])
    expect(RevisionDropModel.resolveWorkspace({ workspace: 'review-b', target: destination, revisions: [sharedRevision, destination] })).toEqual({
      kind: 'action',
      action: { kind: 'workspace-edit', name: 'review-b', commitId: 'destination' },
      presentation: { kind: 'workspace-move', sourceId: 'shared', destinationId: 'destination', workspace: 'review-b' },
    })
  })

  it('resolves the default workspace and ignores a drop onto its current revision', () => {
    const current = revision('current', [], [], [], true)
    expect(RevisionDropModel.resolveWorkspace({ workspace: 'default', target: current, revisions: [current, other] }).kind).toBe('noop')
    expect(RevisionDropModel.resolveWorkspace({ workspace: 'unknown', target: other, revisions: [current, other] })).toEqual({ kind: 'noop' })
  })

  it('resolves a locally started revision drag when the drop event has no transfer data', () => {
    expect(RevisionDropModel.resolveDragOrigin({ origin: { kind: 'revision', sourceId: 'feature' }, target: other, revisions })).toEqual({
      kind: 'action',
      action: { kind: 'rebase', sourceId: 'feature', destinationId: 'other' },
      presentation: { kind: 'rebase', sourceId: 'feature', destinationId: 'other' },
    })
  })

  it('resolves local bookmark drags from their origin', () => {
    expect(
      RevisionDropModel.resolveDragOrigin({ origin: { kind: 'bookmark', sourceId: 'feature', bookmark: 'feature/bookmark' }, target: other, revisions }),
    ).toEqual({
      kind: 'action',
      action: { kind: 'bookmark-move', bookmark: 'feature/bookmark', destinationId: 'other' },
      presentation: { kind: 'bookmark-move', bookmark: 'feature/bookmark', sourceId: 'feature', destinationId: 'other' },
    })
  })

  it('resolves workspace drags from their origin', () => {
    const current = revision('current', [], [], ['review'], true)
    const destination = revision('destination')
    expect(
      RevisionDropModel.resolveDragOrigin({
        origin: { kind: 'workspace', sourceId: 'current', workspace: 'review' },
        target: destination,
        revisions: [current, destination],
      }),
    ).toEqual({
      kind: 'action',
      action: { kind: 'workspace-edit', name: 'review', commitId: 'destination' },
      presentation: { kind: 'workspace-move', sourceId: 'current', destinationId: 'destination', workspace: 'review' },
    })
  })

  it('prepares local bookmark moves with the bookmark source revision', () => {
    expect(
      RevisionDropModel.resolveBookmark({
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
    expect(RevisionDropModel.resolveBookmark({ bookmark: 'stale', sourceRevisionId: 'feature', target: other, revisions })).toEqual({ kind: 'noop' })
    expect(RevisionDropModel.resolveBookmark({ bookmark: 'feature/bookmark', sourceRevisionId: 'missing', target: other, revisions })).toEqual({ kind: 'noop' })
    expect(RevisionDropModel.resolveBookmark({ bookmark: 'feature/bookmark', sourceRevisionId: 'feature', target: feature, revisions })).toEqual({
      kind: 'noop',
    })
  })
})
