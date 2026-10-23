import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { CopyIcon, FolderIcon, LinkIcon, MessagesSquareIcon, PinIcon, Trash2Icon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { BacklogItems } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { deleteSelection as deleteSelectedItems } from './delete-selection.js'
import { startThreadItemOf, type StartThreadItem } from './start-thread.js'
import { useBacklogActions, type BacklogUpdateInput } from './use-backlog-actions.js'

const NO_PROJECT = 'no-project'
type BacklogMenuItem = Pick<BacklogSummaryView, 'id' | 'title' | 'kind' | 'status' | 'project' | 'pinned'> & {
  readonly attention?: BacklogSummaryView['attention'] | undefined
  readonly preview?: BacklogSummaryView['preview'] | undefined
  readonly body?: string | undefined
}

/** One consistent right-click menu for every backlog item presentation. */
export const BacklogItemMenu = (props: {
  readonly item: BacklogMenuItem
  readonly projectPaths: readonly string[]
  readonly update: (input: BacklogUpdateInput) => void
  readonly triage: (id: number) => void
  readonly triageOff: boolean
  readonly startThread: (items: readonly StartThreadItem[]) => void
  /** The whole selection when this row is part of one, so repeatable actions apply to every item. */
  readonly selection?: readonly StartThreadItem[] | undefined
  readonly clearSelection?: (() => void) | undefined
  readonly openItem?: (id: number) => void
  readonly children: ReactNode
}): JSX.Element => {
  const item = props.item
  const [deleteOpen, setDeleteOpen] = useState(false)
  const actions = useBacklogActions()
  const attention = item.attention ?? 'none'
  const selection = props.selection !== undefined && props.selection.length > 1 ? props.selection : [startThreadItemOf(item)]
  const applyToSelection = (action: (id: number) => void): void => {
    for (const selected of selection) action(selected.id)
    if (selection.length > 1) props.clearSelection?.()
  }
  const update = (change: Omit<BacklogUpdateInput, 'id'>): void => applyToSelection(id => props.update({ id, ...change }))
  const many = selection.length > 1
  /** Every action applies to the whole selection; the count says so before the click. */
  const countSuffix = many ? ` (${String(selection.length)})` : ''
  const selectedIds = selection.map(selected => selected.id)
  const deleteSelection = async (): Promise<void> => {
    await deleteSelectedItems({
      ids: selectedIds,
      remove: id => actions.delete.mutateAsync({ id, confirm: true }),
    })
    setDeleteOpen(false)
    if (many) props.clearSelection?.()
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild data-backlog-item-id={String(item.id)}>
          {props.children}
        </ContextMenuTrigger>
        <ContextMenuContent className="dshx-root dshx:min-w-52">
          <ContextMenuLabel className="dshx:max-w-64 dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
            {selection.length > 1 ? `${String(selection.length)} selected · ` : null}b:{item.id} · {item.title}
          </ContextMenuLabel>
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => props.startThread(selection)}>
            <MessagesSquareIcon aria-hidden className="dshx:size-3.5" />
            Start thread{countSuffix}…
          </ContextMenuItem>
          {props.openItem === undefined ? null : (
            <ContextMenuItem className="dshx:text-[13px]" onSelect={() => props.openItem?.(item.id)}>
              <span aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
              Open item
            </ContextMenuItem>
          )}
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => void writeClipboard(selectedIds.map(String).join(', '))}>
            <CopyIcon aria-hidden className="dshx:size-3.5" />
            {many ? 'Copy item IDs' : 'Copy item ID'}
            {countSuffix}
          </ContextMenuItem>
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => void writeClipboard(selectedIds.map(id => `b:${String(id)}`).join(' '))}>
            <LinkIcon aria-hidden className="dshx:size-3.5" />
            {many ? 'Copy item links' : 'Copy item link'}
            {countSuffix}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger className="dshx:gap-2 dshx:text-[13px]">
              <ItemGlyphs.StatusIcon status={item.status} />
              Status
              {countSuffix}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="dshx-root dshx:min-w-44">
              <ContextMenuRadioGroup
                value={item.status}
                onValueChange={value => {
                  const status = BacklogItems.statuses.find(candidate => candidate === value)
                  if (status !== undefined) update({ status })
                }}
              >
                {BacklogItems.statuses.map(status => (
                  <ContextMenuRadioItem key={status} value={status} className="dshx:text-[13px]">
                    <ItemGlyphs.StatusIcon status={status} />
                    {ItemGlyphs.statusLabels[status]}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="dshx:gap-2 dshx:text-[13px]">
              <ItemGlyphs.KindIcon kind={item.kind} />
              Kind
              {countSuffix}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="dshx-root dshx:min-w-44">
              <ContextMenuRadioGroup
                value={item.kind}
                onValueChange={value => {
                  const kind = BacklogItems.kinds.find(candidate => candidate === value)
                  if (kind !== undefined) update({ kind })
                }}
              >
                {BacklogItems.kinds.map(kind => (
                  <ContextMenuRadioItem key={kind} value={kind} className="dshx:text-[13px]">
                    <ItemGlyphs.KindIcon kind={kind} />
                    {ItemGlyphs.kindLabels[kind]}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="dshx:gap-2 dshx:text-[13px]">
              {attention === 'none' ? (
                <span aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
              ) : (
                <ItemGlyphs.AttentionBadge attention={attention} compact />
              )}
              Attention
              {countSuffix}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="dshx-root dshx:min-w-44">
              <ContextMenuRadioGroup
                value={attention}
                onValueChange={value => {
                  const attention = BacklogItems.attentions.find(candidate => candidate === value)
                  if (attention !== undefined) update({ attention })
                }}
              >
                {BacklogItems.attentions.map(attention => (
                  <ContextMenuRadioItem key={attention} value={attention} className="dshx:text-[13px]">
                    {attention === 'none' ? <span className="dshx:w-3.5" /> : <ItemGlyphs.AttentionBadge attention={attention} compact />}
                    {ItemGlyphs.attentionLabels[attention]}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="dshx:gap-2 dshx:text-[13px]">
              <FolderIcon aria-hidden className="dshx:size-3.5" />
              Project
              {countSuffix}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="dshx-root dshx:min-w-52">
              <ContextMenuRadioGroup value={item.project ?? NO_PROJECT} onValueChange={value => update({ project: value === NO_PROJECT ? null : value })}>
                <ContextMenuRadioItem value={NO_PROJECT} className="dshx:text-[13px]">
                  No project
                </ContextMenuRadioItem>
                {props.projectPaths.map(project => (
                  <ContextMenuRadioItem key={project} value={project} title={project} className="dshx:max-w-72 dshx:text-[13px]">
                    <ItemGlyphs.ProjectDot project={project} />
                    <span className="dshx:min-w-0 dshx:truncate">{ItemGlyphs.projectName(project)}</span>
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => update({ pinned: !item.pinned })}>
            <PinIcon aria-hidden className="dshx:size-3.5" />
            {item.pinned ? 'Unpin' : 'Pin'} {many ? 'items' : 'item'}
            {countSuffix}
          </ContextMenuItem>
          {props.triageOff ? null : (
            <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => applyToSelection(props.triage)}>
              <WandSparklesIcon aria-hidden className="dshx:size-3.5" />
              Run triage
              {countSuffix}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px] dshx:text-destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2Icon aria-hidden className="dshx:size-3.5" />
            Delete permanently{countSuffix}…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={deleteOpen} onOpenChange={open => (actions.delete.isPending ? undefined : setDeleteOpen(open))}>
        <DialogContent className="dshx-root">
          <DialogHeader>
            <DialogTitle>{many ? `Delete ${String(selection.length)} items permanently?` : `Delete b:${String(item.id)} permanently?`}</DialogTitle>
            <DialogDescription>
              {many
                ? `This permanently removes ${selectedIds.map(id => `b:${String(id)}`).join(', ')} and their attachments. This cannot be undone. Dropping them keeps them in your backlog.`
                : `This permanently removes “${item.title}” and its attachments. This cannot be undone. Dropping the item keeps it in your backlog.`}
            </DialogDescription>
          </DialogHeader>
          {actions.delete.error === null ? null : (
            <p className="dshx:text-xs dshx:text-destructive">{errorMessage(actions.delete.error, 'Could not delete this item.')}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={actions.delete.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={actions.delete.isPending} onClick={() => void deleteSelection().catch(() => undefined)}>
              <Trash2Icon aria-hidden className="dshx:size-3.5" />
              Delete permanently{countSuffix}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
