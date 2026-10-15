import type { Revision } from './api.js'

interface GraphSelectionInput {
  readonly selection: Pick<Revision, 'commitId' | 'changeId'> | undefined
  readonly revisions: readonly Revision[]
  readonly extraRevisions: readonly Revision[]
}

export const resolveGraphSelection = (input: GraphSelectionInput): Revision | undefined => {
  const selection = input.selection
  if (selection === undefined) return undefined
  const exact = input.revisions.find(row => row.commitId === selection.commitId)
  if (exact !== undefined) return exact
  const matches = input.revisions.filter(row => row.changeId === selection.changeId)
  if (matches.length > 0) return matches.length === 1 ? matches[0] : undefined
  return input.extraRevisions.find(row => row.commitId === selection.commitId)
}
