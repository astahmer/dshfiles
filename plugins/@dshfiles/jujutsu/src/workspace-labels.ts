const MAX_ROW_WORKSPACE_LABELS = 4

interface RowWorkspaces {
  readonly shown: readonly string[]
  readonly hidden: readonly string[]
}

/** A row stays one line: the first workspaces get labels, the rest collapse into one "+N more" chip. */
const forRow = (revision: { readonly workingCopy: boolean; readonly workspaces: readonly string[] }): RowWorkspaces => {
  const names = revision.workingCopy && revision.workspaces.length === 0 ? ['default'] : revision.workspaces
  const shown = names.slice(0, MAX_ROW_WORKSPACE_LABELS)
  const hidden = names.slice(MAX_ROW_WORKSPACE_LABELS)
  return { shown, hidden }
}

export const WorkspaceLabels = { forRow }
