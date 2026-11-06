/**
 * Stages of the two browser-owned Workspace dialogs. Each dialog is one union so
 * a draft can never be edited mid-rename, and a committed delete can never be
 * confirmed twice: the stage is the state, not a set of parallel flags.
 */
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** The Workspace a rename targets, with the stored title the draft is compared against. */
export interface RenameTarget {
  readonly workspaceId: WorkspaceId
  readonly storedTitle: string
}

/** Closed, editing the draft, renaming on the Host, or holding the Host's error with the draft kept. */
export type RenameDialog =
  | { readonly kind: 'closed' }
  | ({ readonly kind: 'editing'; readonly draft: string } & RenameTarget)
  | ({ readonly kind: 'renaming'; readonly draft: string } & RenameTarget)
  | ({ readonly kind: 'failed'; readonly draft: string; readonly error: string } & RenameTarget)

/** The Workspace a delete targets, with the title its confirmation shows. */
export interface DeleteTarget {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Closed, confirming, deleting on the Host, waiting for the list to drop the id, or failed. */
export type DeleteDialog =
  | { readonly kind: 'closed' }
  | ({ readonly kind: 'confirming' } & DeleteTarget)
  | ({ readonly kind: 'deleting' } & DeleteTarget)
  | ({ readonly kind: 'awaitingList' } & DeleteTarget)
  | ({ readonly kind: 'failed'; readonly error: string } & DeleteTarget)

export interface WorkspaceTitles {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

export interface RenameDialogView {
  readonly open: boolean
  readonly target: RenameTarget | null
  readonly draft: string
  readonly renaming: boolean
  readonly error: string | null
}

export const renameDialogView = (dialog: RenameDialog): RenameDialogView => {
  if (dialog.kind === 'closed') return { open: false, target: null, draft: '', renaming: false, error: null }
  return {
    open: true,
    target: dialog,
    draft: dialog.draft,
    renaming: dialog.kind === 'renaming',
    error: dialog.kind === 'failed' ? dialog.error : null,
  }
}

/**
 * Whether the rename button must stay disabled: mid-rename, empty, unchanged, or
 * colliding with another Workspace. Self is excluded by identity, not by title,
 * because an automatically titled Workspace displays the prefill as its own name.
 */
export const renameDialogBlocked = (input: { readonly dialog: RenameDialog; readonly workspaces: readonly WorkspaceTitles[] }): boolean => {
  const view = renameDialogView(input.dialog)
  if (view.renaming || view.target === null) return true
  const draft = view.draft.trim()
  if (draft === '' || draft === view.target.storedTitle) return true
  return input.workspaces.some(workspace => workspace.workspaceId !== view.target?.workspaceId && workspace.title === draft)
}

export const renameDialogDraft = (dialog: RenameDialog): string => (dialog.kind === 'closed' ? '' : dialog.draft)

export const deleteDialogOpen = (dialog: DeleteDialog): boolean => dialog.kind !== 'closed'

/** A committed delete keeps its confirmation pending until the list drops the id. */
export const deleteDialogPending = (dialog: DeleteDialog): boolean => dialog.kind === 'deleting' || dialog.kind === 'awaitingList'

export const deleteDialogTitle = (dialog: DeleteDialog): string | undefined => (dialog.kind === 'closed' ? undefined : dialog.title)

export const deleteDialogError = (dialog: DeleteDialog): string | null => (dialog.kind === 'failed' ? dialog.error : null)

export const deleteDialogSettled = (input: { readonly dialog: DeleteDialog; readonly workspaces: readonly WorkspaceTitles[] }): boolean => {
  const dialog = input.dialog
  if (dialog.kind !== 'awaitingList') return false
  return !input.workspaces.some(workspace => workspace.workspaceId === dialog.workspaceId)
}
