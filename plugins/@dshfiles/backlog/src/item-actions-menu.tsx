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
import { FolderIcon, MessagesSquareIcon, PinIcon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { BacklogItems } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { startThreadItemOf, type StartThreadItem } from './start-thread.js'
import type { BacklogUpdateInput } from './use-backlog-actions.js'

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
  readonly startThread: (items: readonly StartThreadItem[]) => void
  /** The whole selection when this row is part of one, so the menu starts a single thread for all of it. */
  readonly selection?: readonly StartThreadItem[] | undefined
  readonly openItem?: (id: number) => void
  readonly children: ReactNode
}): JSX.Element => {
  const item = props.item
  const attention = item.attention ?? 'none'
  const selection = props.selection !== undefined && props.selection.length > 1 ? props.selection : [startThreadItemOf(item)]
  const update = (change: Omit<BacklogUpdateInput, 'id'>): void => props.update({ id: item.id, ...change })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent className="dshx-root dshx:min-w-52">
        <ContextMenuLabel className="dshx:max-w-64 dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
          b:{item.id} · {item.title}
        </ContextMenuLabel>
        <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => props.startThread(selection)}>
          <MessagesSquareIcon aria-hidden className="dshx:size-3.5" />
          {selection.length > 1 ? `Start thread for ${String(selection.length)} items…` : 'Start thread…'}
        </ContextMenuItem>
        {props.openItem === undefined ? null : (
          <ContextMenuItem className="dshx:text-[13px]" onSelect={() => props.openItem?.(item.id)}>
            <span aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
            Open item
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger className="dshx:gap-2 dshx:text-[13px]">
            <ItemGlyphs.StatusIcon status={item.status} />
            Status
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
            {attention === 'none' ? <span aria-hidden className="dshx:size-3.5 dshx:shrink-0" /> : <ItemGlyphs.AttentionBadge attention={attention} compact />}
            Attention
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
          {item.pinned ? 'Unpin item' : 'Pin item'}
        </ContextMenuItem>
        <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => props.triage(item.id)}>
          <WandSparklesIcon aria-hidden className="dshx:size-3.5" />
          Run triage
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
