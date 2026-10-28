import type { Revision, Mutation } from './api.js'
import type { DragOrigin, DropPresentation } from './revision-action-machine.js'
import { SourceControlModel } from './source-control.js'

export const REVISION_MIME = 'application/x-jujutsu-revision'
export const BOOKMARK_MIME = 'application/x-jujutsu-bookmark'
export const BOOKMARK_SOURCE_MIME = 'application/x-jujutsu-bookmark-source'
export const WORKSPACE_MIME = 'application/x-jujutsu-workspace'

export type RevisionDropResolution =
  | { readonly kind: 'action'; readonly action: Mutation; readonly presentation: DropPresentation }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'noop' }

type DragRevision = {
  readonly commitId: Revision['commitId']
  readonly parents: readonly Revision['commitId'][]
  readonly immutable: Revision['immutable']
  readonly localBookmarks: readonly string[]
  readonly workspaces: readonly string[]
  readonly workingCopy: boolean
}

export const resolveRevisionDrop = (input: {
  readonly sourceRevisionId: string
  readonly target: DragRevision
  readonly revisions: readonly DragRevision[]
}): RevisionDropResolution => {
  const source = input.revisions.find(revision => revision.commitId === input.sourceRevisionId)
  if (source === undefined || source.commitId === input.target.commitId) return { kind: 'noop' }
  if (source.immutable) return { kind: 'invalid', message: 'Immutable revisions cannot be rebased.' }
  if (SourceControlModel.descendantCommitIds(input.revisions, source.commitId).has(input.target.commitId)) {
    return { kind: 'invalid', message: 'A branch cannot be rebased onto one of its own revisions.' }
  }
  return {
    kind: 'action',
    action: { kind: 'rebase', sourceId: source.commitId, destinationId: input.target.commitId },
    presentation: { kind: 'rebase', sourceId: source.commitId, destinationId: input.target.commitId },
  }
}

export const resolveWorkspaceDrop = (input: {
  readonly workspace: string
  readonly target: DragRevision
  readonly revisions: readonly DragRevision[]
}): RevisionDropResolution => {
  const source =
    input.revisions.find(revision => revision.workspaces.includes(input.workspace)) ??
    (input.workspace === 'default' ? input.revisions.find(revision => revision.workingCopy) : undefined)
  if (source === undefined || source.commitId === input.target.commitId) return { kind: 'noop' }
  return {
    kind: 'action',
    action: { kind: 'workspace-edit', name: input.workspace, commitId: input.target.commitId },
    presentation: {
      kind: 'workspace-move',
      sourceId: source.commitId,
      destinationId: input.target.commitId,
      workspace: input.workspace,
    },
  }
}

export const resolveBookmarkDrop = (input: {
  readonly bookmark: string
  readonly sourceRevisionId: string
  readonly target: DragRevision
  readonly revisions: readonly DragRevision[]
}): RevisionDropResolution => {
  const source = input.revisions.find(revision => revision.commitId === input.sourceRevisionId)
  if (source === undefined || !source.localBookmarks.includes(input.bookmark)) return { kind: 'noop' }
  if (input.target.localBookmarks.includes(input.bookmark)) return { kind: 'noop' }
  return {
    kind: 'action',
    action: { kind: 'bookmark-move', bookmark: input.bookmark, destinationId: input.target.commitId },
    presentation: {
      kind: 'bookmark-move',
      sourceId: source.commitId,
      destinationId: input.target.commitId,
      bookmark: input.bookmark,
    },
  }
}

export const resolveDragOriginDrop = (input: {
  readonly origin: DragOrigin
  readonly target: DragRevision
  readonly revisions: readonly DragRevision[]
}): RevisionDropResolution => {
  if (input.origin.kind === 'revision') {
    return resolveRevisionDrop({ sourceRevisionId: input.origin.sourceId, target: input.target, revisions: input.revisions })
  }
  if (input.origin.kind === 'bookmark') {
    return resolveBookmarkDrop({
      bookmark: input.origin.bookmark,
      sourceRevisionId: input.origin.sourceId,
      target: input.target,
      revisions: input.revisions,
    })
  }
  return resolveWorkspaceDrop({ workspace: input.origin.workspace, target: input.target, revisions: input.revisions })
}
