import type { Mutation, Revision } from './api.js'

const revisionIdsFor = (action: Mutation): readonly string[] => {
  switch (action.kind) {
    case 'squash':
    case 'rebase':
      return [action.sourceId, action.destinationId]
    case 'revert':
      return [action.commitId, action.destinationId]
    case 'bookmark-move':
    case 'bookmark-set':
      return [action.destinationId]
    case 'abandon':
      return action.commitIds
    case 'describe':
    case 'split':
    case 'workspace-add':
    case 'workspace-edit':
    case 'edit':
    case 'new':
    case 'commit':
    case 'duplicate':
    case 'restore':
      return [action.commitId]
    case 'fetch':
    case 'push':
    case 'workspace-forget':
    case 'bookmark-delete':
      return []
  }
}

export const missingMutationRevisionIds = (action: Mutation, revisions: readonly Pick<Revision, 'commitId'>[]): readonly string[] => {
  const visibleIds = new Set(revisions.map(revision => revision.commitId))
  return [...new Set(revisionIdsFor(action).filter(commitId => !visibleIds.has(commitId)))]
}
