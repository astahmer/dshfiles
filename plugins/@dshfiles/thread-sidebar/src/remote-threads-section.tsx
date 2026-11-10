import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CircleCheckIcon, CirclePauseIcon, CirclePlayIcon, GripVerticalIcon, MonitorIcon, ServerIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { SidebarSection } from './organization.js'
import type { RemoteSidebarThread } from './remote-thread-inventory.js'

/** Localized names of the verbs a remote row offers; the sidebar owns the wording, like it does for local rows. */
export interface RemoteThreadRowLabels {
  readonly settle: string
  readonly unsettle: string
  readonly park: string
  readonly unpark: string
  readonly moveToSection: string
  readonly copyId: string
  readonly contextMenu: string
  readonly sectionLabels: Readonly<Record<SidebarSection, string>>
}

/**
 * One remote thread's right-click menu. It carries the verbs this sidebar owns for a mirrored Session — parked and
 * settled are its own preference sets, and a section move applies the same plan a local drop does — and leaves out
 * every verb that runs on the runtime owning the Session (archive, pin, rename, mention, follow-up, continue-in, side
 * panel, references) plus mute, which anchors on a local Session's activity time.
 */
export const RemoteThreadMenuItems = (props: {
  readonly running: boolean
  readonly settled: boolean
  readonly parked: boolean
  readonly section: SidebarSection | undefined
  readonly dropSections: readonly SidebarSection[]
  readonly labels: RemoteThreadRowLabels
  readonly onToggleSettled: () => void
  readonly onToggleParked: () => void
  readonly onMoveToSection: (section: SidebarSection) => void
  readonly onCopyId: () => void
}): JSX.Element => (
  <>
    <ContextMenuItem disabled={props.running} onSelect={props.onToggleSettled}>
      {props.settled ? props.labels.unsettle : props.labels.settle}
    </ContextMenuItem>
    <ContextMenuItem disabled={props.running} onSelect={props.onToggleParked}>
      {props.parked ? props.labels.unpark : props.labels.park}
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuSub>
      <ContextMenuSubTrigger>{props.labels.moveToSection}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="dshx-root dshx:min-w-44" aria-label={props.labels.moveToSection}>
        {props.dropSections.map(section => (
          <ContextMenuItem key={section} disabled={section === props.section} onSelect={() => props.onMoveToSection(section)}>
            {props.labels.sectionLabels[section]}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={props.onCopyId}>{props.labels.copyId}</ContextMenuItem>
  </>
)

/**
 * One remote thread, drawn with the local row's shape: a status dot, the title, the age, and one muted meta line naming
 * the host. Only the verbs this sidebar owns for a remote id (Settle, Park, the section move, Copy ID) join the strip
 * and the menu, because archive and pin live on the runtime that owns the Session.
 */
export const RemoteThreadItem = (props: {
  readonly runtimeId: string
  readonly sessionId: string
  readonly label: string
  readonly cwd: string | undefined
  readonly hostName: string
  readonly workspaceTitle: string | undefined
  readonly connected: boolean
  readonly running: boolean
  readonly settled: boolean
  readonly parked: boolean
  readonly selected: boolean
  readonly compact: boolean
  readonly age: string
  readonly section: SidebarSection | undefined
  readonly dropSections: readonly SidebarSection[]
  readonly labels: RemoteThreadRowLabels
  readonly dragging?: boolean | undefined
  readonly onOpen: () => void
  readonly onToggleSettled: () => void
  readonly onToggleParked: () => void
  readonly onMoveToSection: (section: SidebarSection) => void
  readonly onCopyId: () => void
}): JSX.Element => {
  const actionClass = 'dshx:h-6 dshx:w-6 dshx:shrink-0 dshx:text-muted-foreground dshx:hover:text-foreground'
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          className={cn('dshx:group/row dshx:relative dshx:min-w-0', props.dragging === true && 'dshx:opacity-50')}
          data-remote-thread-id={`${props.runtimeId}:${props.sessionId}`}
          data-remote-thread-session-id={props.sessionId}
          data-remote-thread-section-row={props.section === undefined ? undefined : ''}
          data-selected={props.selected}
        >
          <div className={cn('dshx:relative dshx:rounded-md dshx:hover:bg-accent/60', props.selected && 'dshx:bg-accent')}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  draggable
                  data-remote-thread-id={`${props.runtimeId}:${props.sessionId}`}
                  aria-current={props.selected ? 'page' : undefined}
                  className={cn(
                    'dshx:relative dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
                    props.compact ? 'dshx:gap-0.5 dshx:px-2 dshx:py-1.5' : 'dshx:gap-1 dshx:px-2.5 dshx:py-2.5',
                  )}
                  onClick={props.onOpen}
                >
                  <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                    <StatusDot className={props.running ? 'dshx:bg-info' : props.connected ? 'dshx:bg-emerald-500' : 'dshx:bg-muted-foreground/50'} />
                    <span
                      className={cn(
                        'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground',
                        props.compact ? 'dshx:text-sm' : 'dshx:text-base',
                        props.settled && 'dshx:text-muted-foreground',
                      )}
                    >
                      {props.label}
                    </span>
                    <span
                      className={cn(
                        'dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground',
                        props.running && 'dshx:font-medium dshx:text-info',
                      )}
                    >
                      {props.age}
                    </span>
                  </span>
                  <span className="dshx:flex dshx:min-h-4 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:pl-4 dshx:text-xs dshx:text-muted-foreground">
                    <MonitorIcon className="dshx:size-3 dshx:shrink-0" aria-hidden="true" />
                    <span className="dshx:truncate">{props.hostName}</span>
                    {props.workspaceTitle === undefined ? null : <span className="dshx:min-w-0 dshx:truncate">· {props.workspaceTitle}</span>}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="dshx:whitespace-pre-line" side="bottom">
                {`${props.label}\n${props.hostName}${props.cwd === undefined ? '' : `: ${props.cwd}`}`}
              </TooltipContent>
            </Tooltip>
            {props.running ? null : (
              <div
                data-testid="remote-thread-row-actions"
                className="dshx:pointer-events-none dshx:absolute dshx:top-1 dshx:right-1.5 dshx:flex dshx:gap-0.5 dshx:rounded-md dshx:border dshx:bg-popover dshx:p-0.5 dshx:opacity-0 dshx:shadow-xs dshx:transition-opacity dshx:group-hover/row:pointer-events-auto dshx:group-hover/row:opacity-100 dshx:focus-within:pointer-events-auto dshx:focus-within:opacity-100 dshx:pointer-coarse:pointer-events-auto dshx:pointer-coarse:opacity-100"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={actionClass}
                      aria-label={props.settled ? props.labels.unsettle : props.labels.settle}
                      onClick={event => {
                        event.stopPropagation()
                        props.onToggleSettled()
                      }}
                    >
                      {props.settled ? <CirclePlayIcon className="dshx:size-3.5" /> : <CircleCheckIcon className="dshx:size-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{props.settled ? props.labels.unsettle : props.labels.settle}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={actionClass}
                      aria-label={props.parked ? props.labels.unpark : props.labels.park}
                      onClick={event => {
                        event.stopPropagation()
                        props.onToggleParked()
                      }}
                    >
                      {props.parked ? <CirclePlayIcon className="dshx:size-3.5" /> : <CirclePauseIcon className="dshx:size-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{props.parked ? props.labels.unpark : props.labels.park}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent className="dshx-root dshx:min-w-44" aria-label={props.labels.contextMenu}>
        <RemoteThreadMenuItems
          running={props.running}
          settled={props.settled}
          parked={props.parked}
          section={props.section}
          dropSections={props.dropSections}
          labels={props.labels}
          onToggleSettled={props.onToggleSettled}
          onToggleParked={props.onToggleParked}
          onMoveToSection={props.onMoveToSection}
          onCopyId={props.onCopyId}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const RemoteThreadsSection = (props: {
  readonly threads: readonly RemoteSidebarThread[]
  readonly renderRow: (thread: RemoteSidebarThread) => JSX.Element
  readonly headerClassName: string
  readonly onOpen: () => void
  readonly onHeaderRef?: ((element: HTMLButtonElement | null) => void) | undefined
  readonly onHeaderPointerDown?: ((event: PointerEvent<HTMLButtonElement>) => void) | undefined
  readonly onHeaderPointerMove?: ((event: PointerEvent<HTMLButtonElement>) => void) | undefined
  readonly onHeaderPointerUp?: ((event: PointerEvent<HTMLButtonElement>) => void) | undefined
  readonly onHeaderPointerCancel?: (() => void) | undefined
  readonly onHeaderLostPointerCapture?: (() => void) | undefined
  readonly onHeaderKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined
  readonly onHeaderClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined
  readonly hint?: string | undefined
  readonly dragging?: boolean | undefined
  readonly keepEmpty?: boolean | undefined
}): JSX.Element | null => {
  if (props.threads.length === 0 && !props.keepEmpty) return null
  return (
    <section className="dshx:mt-1" data-remote-threads="">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={props.onHeaderRef}
            type="button"
            data-thread-section-header=""
            aria-label="Remote threads started from this DSH"
            className={cn(
              props.headerClassName,
              'dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
              props.dragging === true && 'dshx:cursor-grabbing dshx:bg-accent dshx:opacity-70',
            )}
            onPointerDown={props.onHeaderPointerDown}
            onPointerMove={props.onHeaderPointerMove}
            onPointerUp={props.onHeaderPointerUp}
            onPointerCancel={props.onHeaderPointerCancel}
            onLostPointerCapture={props.onHeaderLostPointerCapture}
            onKeyDown={props.onHeaderKeyDown}
            onClick={event => {
              if (props.onHeaderClick !== undefined) {
                props.onHeaderClick(event)
                return
              }
              props.onOpen()
            }}
          >
            <GripVerticalIcon className="dshx:size-3 dshx:cursor-grab dshx:active:cursor-grabbing" aria-hidden />
            <ServerIcon className="dshx:size-3" aria-hidden />
            <span className="dshx:whitespace-nowrap">Remote</span>
            <span className="dshx:text-xs dshx:tabular-nums">({props.threads.length})</span>
            <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{props.hint ?? 'Threads started here on remote hosts'}</TooltipContent>
      </Tooltip>
      {props.threads.map(thread => props.renderRow(thread))}
    </section>
  )
}
