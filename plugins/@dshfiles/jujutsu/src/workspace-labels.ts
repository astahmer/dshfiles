const MAX_ROW_WORKSPACE_LABELS = 4

interface RowWorkspaces {
  readonly shown: readonly string[]
  readonly hidden: readonly string[]
}

/** A row stays one line: the first workspaces get labels, the rest collapse into one "+N more" chip. */
const forRow = (revision: { readonly commitId: string; readonly workspaces: readonly string[] }, defaultWorkspaceCommitId: string | null): RowWorkspaces => {
  const names = revision.workspaces.filter(name => name !== 'default' || defaultWorkspaceCommitId === null || revision.commitId === defaultWorkspaceCommitId)
  if (revision.commitId === defaultWorkspaceCommitId && !names.includes('default')) names.unshift('default')
  const shown = names.slice(0, MAX_ROW_WORKSPACE_LABELS)
  const hidden = names.slice(MAX_ROW_WORKSPACE_LABELS)
  return { shown, hidden }
}

export const WorkspaceLabels = { forRow }
