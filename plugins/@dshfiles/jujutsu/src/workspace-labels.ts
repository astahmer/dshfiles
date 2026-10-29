const MAX_ROW_WORKSPACE_LABELS = 4
const MAX_OVERFLOW_HINT_NAMES = 20

interface RowWorkspaces {
  readonly shown: readonly string[]
  readonly hidden: readonly string[]
  readonly overflowHint: string
}

/** A row stays one line: the first workspaces get labels, the rest collapse into one "+N more" chip. */
const forRow = (revision: { readonly workingCopy: boolean; readonly workspaces: readonly string[] }): RowWorkspaces => {
  const names = revision.workingCopy && revision.workspaces.length === 0 ? ['default'] : revision.workspaces
  const shown = names.slice(0, MAX_ROW_WORKSPACE_LABELS)
  const hidden = names.slice(MAX_ROW_WORKSPACE_LABELS)
  const listed = hidden.slice(0, MAX_OVERFLOW_HINT_NAMES).join(', ')
  const unlisted = hidden.length - MAX_OVERFLOW_HINT_NAMES
  const overflowHint = hidden.length === 0 ? '' : `Also the working copy of ${listed}${unlisted > 0 ? ` and ${unlisted} more` : ''}`
  return { shown, hidden, overflowHint }
}

export const WorkspaceLabels = { forRow }
