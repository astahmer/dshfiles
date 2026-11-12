import type { Mutation } from './api.js'

export const revisionIdsFor = (action: Mutation): readonly string[] => {
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
