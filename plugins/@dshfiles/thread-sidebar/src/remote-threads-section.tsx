import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { GripVerticalIcon, ServerIcon } from '@dshfiles/plugin-ui/icons'
import type { RemoteSidebarThread } from './remote-thread-inventory.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

export const RemoteThreadItem = (props: {
  readonly runtimeId: string
  readonly sessionId: string
  readonly label: string
  readonly cwd: string | undefined
  readonly hostName: string
  readonly connected: boolean
  readonly onOpen: () => void
}): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        data-remote-thread-id={`${props.runtimeId}:${props.sessionId}`}
        className={cn(
          'dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-left dshx:text-sm dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
        )}
        onClick={props.onOpen}
      >
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{props.label}</span>
        <span className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:border dshx:px-1 dshx:text-[11px] dshx:text-muted-foreground">
          <StatusDot size="sm" className={props.connected ? 'dshx:bg-emerald-500' : 'dshx:bg-muted-foreground/50'} />
          {props.hostName}
        </span>
      </button>
    </TooltipTrigger>
    <TooltipContent className="dshx:whitespace-pre-line" side="bottom">
      {`${props.label}\n${props.hostName}${props.cwd === undefined ? '' : `: ${props.cwd}`}`}
    </TooltipContent>
  </Tooltip>
)

export const RemoteThreadsSection = (props: {
  readonly threads: readonly RemoteSidebarThread[]
  readonly headerClassName: string
  readonly onOpen: () => void
  readonly onOpenSession?: ((sessionId: string) => void) | undefined
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
      {props.threads.map(thread => (
        <RemoteThreadItem
          key={`${thread.runtimeId}:${thread.sessionId}`}
          runtimeId={thread.runtimeId}
          sessionId={thread.sessionId}
          label={thread.title}
          cwd={thread.cwd}
          hostName={thread.hostName}
          connected={thread.connected}
          onOpen={() => (props.onOpenSession === undefined ? props.onOpen() : props.onOpenSession(thread.sessionId))}
        />
      ))}
    </section>
  )
}
