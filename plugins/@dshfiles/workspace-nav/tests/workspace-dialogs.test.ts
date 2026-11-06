import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { describe, expect, it } from 'vitest'
import {
  deleteDialogError,
  deleteDialogOpen,
  deleteDialogPending,
  deleteDialogSettled,
  deleteDialogTitle,
  renameDialogBlocked,
  renameDialogDraft,
  renameDialogView,
} from '../src/native/rows/workspace-dialogs.ts'

// SAFETY: WorkspaceId is a branded string; these fixtures stand for real Workspace ids.
const workspaceId = (value: string): WorkspaceId => value as WorkspaceId

const target = { workspaceId: workspaceId('workspace-a'), title: 'Project A' }
const renameTarget = { workspaceId: workspaceId('workspace-a'), storedTitle: 'Project A' }
const workspaces = [target, { workspaceId: workspaceId('workspace-b'), title: 'Project B' }]

describe('rename dialog', () => {
  it('reports a closed dialog with nothing to edit', () => {
    expect(renameDialogView({ kind: 'closed' })).toEqual({ open: false, target: null, draft: '', renaming: false, error: null })
    expect(renameDialogDraft({ kind: 'closed' })).toBe('')
  })

  it('carries the target and draft through the stages', () => {
    expect(renameDialogView({ ...renameTarget, kind: 'editing', draft: 'Project A renamed' })).toMatchObject({
      open: true,
      draft: 'Project A renamed',
      renaming: false,
      error: null,
    })
    expect(renameDialogView({ ...renameTarget, kind: 'renaming', draft: 'Project A renamed' })).toMatchObject({ open: true, renaming: true, error: null })
    expect(renameDialogView({ ...renameTarget, kind: 'failed', draft: 'Project A renamed', error: 'Host unavailable' })).toMatchObject({
      renaming: false,
      error: 'Host unavailable',
      draft: 'Project A renamed',
    })
  })

  it('blocks an empty, unchanged, colliding or in-flight draft', () => {
    expect(renameDialogBlocked({ dialog: { ...renameTarget, kind: 'editing', draft: '   ' }, workspaces })).toBe(true)
    expect(renameDialogBlocked({ dialog: { ...renameTarget, kind: 'editing', draft: 'Project A' }, workspaces })).toBe(true)
    expect(renameDialogBlocked({ dialog: { ...renameTarget, kind: 'editing', draft: 'Project B' }, workspaces })).toBe(true)
    expect(renameDialogBlocked({ dialog: { ...renameTarget, kind: 'renaming', draft: 'Project A renamed' }, workspaces })).toBe(true)
    expect(renameDialogBlocked({ dialog: { kind: 'closed' }, workspaces })).toBe(true)
  })

  it('allows a new name and excludes the Workspace itself from the collision check', () => {
    expect(renameDialogBlocked({ dialog: { ...renameTarget, kind: 'editing', draft: 'Project A renamed' }, workspaces })).toBe(false)
    expect(
      renameDialogBlocked({
        dialog: { workspaceId: workspaceId('workspace-a'), storedTitle: 'Automatic title', kind: 'editing', draft: 'Project A' },
        workspaces,
      }),
    ).toBe(false)
  })
})

describe('delete dialog', () => {
  it('stays pending until the list drops the deleted id', () => {
    expect(deleteDialogOpen({ kind: 'closed' })).toBe(false)
    expect(deleteDialogPending({ ...target, kind: 'confirming' })).toBe(false)
    expect(deleteDialogPending({ ...target, kind: 'deleting' })).toBe(true)
    expect(deleteDialogPending({ ...target, kind: 'awaitingList' })).toBe(true)
    expect(deleteDialogSettled({ dialog: { ...target, kind: 'confirming' }, workspaces })).toBe(false)
    expect(deleteDialogSettled({ dialog: { ...target, kind: 'awaitingList' }, workspaces })).toBe(false)
    expect(deleteDialogSettled({ dialog: { ...target, kind: 'awaitingList' }, workspaces: workspaces.slice(1) })).toBe(true)
    expect(deleteDialogSettled({ dialog: { kind: 'closed' }, workspaces: [] })).toBe(false)
  })

  it('derives the title and the Host error from the stage', () => {
    expect(deleteDialogOpen({ ...target, kind: 'confirming' })).toBe(true)
    expect(deleteDialogTitle({ kind: 'closed' })).toBeUndefined()
    expect(deleteDialogTitle({ ...target, kind: 'deleting' })).toBe('Project A')
    expect(deleteDialogError({ ...target, kind: 'confirming' })).toBeNull()
    expect(deleteDialogError({ ...target, kind: 'failed', error: 'Workspace is in use' })).toBe('Workspace is in use')
  })
})
