/** Workspace rename and removal dialogs, keyed by their captured request. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceActionRequest, WorkspaceBrowserProps } from '../contract/slots.ts'
import {
  deleteDialogError, deleteDialogOpen, deleteDialogPending, deleteDialogSettled, deleteDialogTitle,
  renameDialogBlocked, renameDialogView, type DeleteDialog, type RenameDialog,
} from './workspace-dialogs.ts'
import css from './WorkspaceBrowser.module.css'

type Props = Pick<WorkspaceBrowserProps, 'renameWorkspace' | 'deleteWorkspace' | 'settleWorkspaceAction' | 't'> & {
  request: WorkspaceActionRequest
  workspaces: readonly WorkspaceView[]
}

/** @param props - captured request, current Workspace list, and existing mutations. @returns the active dialog. */
export function WorkspaceDialogs({ request, workspaces, renameWorkspace, deleteWorkspace, settleWorkspaceAction, t }: Props) {
  const composingRef = useRef(false)
  // Local delta (dshfiles): each dialog is one stage union (workspace-dialogs.ts), not parallel flags.
  const [renameDialog, setRenameDialog] = useState<RenameDialog>(() => request.action === 'rename'
    ? { kind: 'editing', workspaceId: request.workspaceId, storedTitle: request.storedTitle, draft: request.displayTitle }
    : { kind: 'closed' })
  const rename = renameDialogView(renameDialog)
  const renameTargetId = rename.target?.workspaceId
  const renameTrimmed = rename.draft.trim()
  const renameDuplicate = renameTargetId !== undefined && renameTrimmed !== ''
    && workspaces.some(w => w.workspaceId !== renameTargetId && w.title === renameTrimmed)
  const renameBlocked = renameDialogBlocked({ dialog: renameDialog, workspaces })
  const closeRename = () => {
    if (rename.renaming) return
    setRenameDialog({ kind: 'closed' })
    settleWorkspaceAction()
  }
  const confirmRename = () => {
    const target = rename.target
    if (target === null || renameBlocked) return
    setRenameDialog({ ...target, kind: 'renaming', draft: rename.draft })
    renameWorkspace(target.workspaceId, renameTrimmed).then(() => {
      setRenameDialog({ kind: 'closed' })
      settleWorkspaceAction()
    }).catch((reason: unknown) => {
      setRenameDialog({ ...target, kind: 'failed', draft: rename.draft, error: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  const [deleteDialog, setDeleteDialog] = useState<DeleteDialog>(() => request.action === 'delete'
    ? { kind: 'confirming', workspaceId: request.workspaceId, title: request.displayTitle }
    : { kind: 'closed' })
  const deleteOpen = deleteDialogOpen(deleteDialog)
  const deletePending = deleteDialogPending(deleteDialog)
  const deleteTitle = deleteDialogTitle(deleteDialog)
  const deleteError = deleteDialogError(deleteDialog)
  useEffect(() => {
    if (!deleteDialogSettled({ dialog: deleteDialog, workspaces })) return
    setDeleteDialog({ kind: 'closed' })
    settleWorkspaceAction()
  }, [deleteDialog, workspaces, settleWorkspaceAction])
  const closeDelete = () => {
    if (deletePending) return
    setDeleteDialog({ kind: 'closed' })
    settleWorkspaceAction()
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deletePending || deleteDialog.kind !== 'confirming') return
    const target = deleteDialog
    setDeleteDialog({ ...target, kind: 'deleting' })
    deleteWorkspace(target.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteDialog({ ...target, kind: 'awaitingList' })
    }).catch((reason: unknown) => {
      setDeleteDialog({ ...target, kind: 'failed', error: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  return <>
    <Modal
      open={rename.open}
      onClose={closeRename}
      closeLabel={t('close')}
      title={t('rename.workspace.title')}
      footer={(
        <>
          <Button variant="outline" disabled={rename.renaming} onClick={closeRename}>{t('cancel')}</Button>
          <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
        </>
      )}
    >
      <input
        className={css.renameInput}
        value={rename.draft}
        aria-label={t('field.workspaceName')}
        data-modal-autofocus
        disabled={rename.renaming}
        onFocus={(e) => { e.target.select() }}
        onChange={(e) => {
          const draft = e.target.value
          setRenameDialog(current => current.kind === 'closed' ? current : { ...current, kind: 'editing', draft })
        }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault()
            confirmRename()
          }
        }}
      />
      {renameDuplicate && (
        <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
      )}
      {rename.error !== null && <div className={css.renameError} role="alert">{rename.error}</div>}
    </Modal>

    <Modal
      open={deleteOpen}
      onClose={closeDelete}
      closeLabel={t('close')}
      title={t('delete.workspace')}
      {...deleteTitle === undefined
        ? {}
        : { description: t('delete.desc', { name: deleteTitle }) }}
      footer={(
        <>
          <Button variant="outline" disabled={deletePending} onClick={closeDelete}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={css.deleteAction}
            disabled={deletePending}
            onClick={confirmDelete}
          >
            {t('delete.workspace')}
          </Button>
        </>
      )}
    >
      {deletePending && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
      {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
    </Modal>
  </>
}
