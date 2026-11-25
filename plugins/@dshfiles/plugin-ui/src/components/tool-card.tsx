import { DisclosureRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import {
  BotIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  ClockAlertIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MinusIcon,
  PencilIcon,
  SearchIcon,
  SquareTerminalIcon,
  XIcon,
} from '../icons.js'
import { cn } from '../lib/utils.js'

export type ToolStatus = 'running' | 'passed' | 'failed' | 'timeout' | 'skipped'

const ROW_ICONS = {
  running: <LoaderCircleIcon className="dshx:size-3.5 dshx:animate-spin dshx:text-muted-foreground" />,
  passed: <CheckIcon className="dshx:size-3.5 dshx:text-success" />,
  failed: <XIcon className="dshx:size-3.5 dshx:text-destructive" />,
  timeout: <ClockAlertIcon className="dshx:size-3.5 dshx:text-destructive" />,
  skipped: <MinusIcon className="dshx:size-3.5 dshx:text-muted-foreground" />,
} satisfies Record<ToolStatus, ReactNode>

const GROUP_ICONS = {
  running: <LoaderCircleIcon className="dshx:size-3.5 dshx:animate-spin dshx:text-muted-foreground" />,
  passed: <CircleCheckIcon className="dshx:size-3.5 dshx:text-success" />,
  failed: <CircleXIcon className="dshx:size-3.5 dshx:text-destructive" />,
  timeout: <CircleXIcon className="dshx:size-3.5 dshx:text-destructive" />,
  skipped: <CircleMinusIcon className="dshx:size-3.5 dshx:text-muted-foreground" />,
} satisfies Record<ToolStatus, ReactNode>

/** What a tool call did, for its kind glyph (council round 3 C1). */
export type ToolKind = 'edit' | 'shell' | 'subagent' | 'read' | 'search'

/**
 * The kind glyph a succeeded call shows in place of its check: 16px, the work kinds in an identity tone (edit copper,
 * shell teal, subagent violet; DESIGN.md › Colour roles 5, never a status hue), reading and searching neutral. A call
 * that runs, failed, timed out or was skipped keeps its status glyph.
 */
const KIND_ICONS = {
  edit: <PencilIcon aria-hidden className="dshx:size-4 dshx:text-identity-3" />,
  shell: <SquareTerminalIcon aria-hidden className="dshx:size-4 dshx:text-identity-1" />,
  subagent: <BotIcon aria-hidden className="dshx:size-4 dshx:text-identity-2" />,
  read: <FileTextIcon aria-hidden className="dshx:size-4 dshx:text-muted-foreground" />,
  search: <SearchIcon aria-hidden className="dshx:size-4 dshx:text-muted-foreground" />,
} satisfies Record<ToolKind, ReactNode>

/** One status glyph for every agent card: `row` for a single step (check, cross), `group` for a file or a whole run (circled). */
export const StatusIcon = (props: { readonly status: ToolStatus; readonly variant?: 'row' | 'group' }): ReactNode =>
  (props.variant === 'group' ? GROUP_ICONS : ROW_ICONS)[props.status]

/**
 * A tool-call card that reads like the native ones: the Host's 24px `DisclosureRow` with a status icon, the title, a
 * one-line summary and right-aligned metadata (counts, duration) while collapsed and open alike.
 */
export const ToolCard = (props: {
  readonly status: ToolStatus
  /** Draws the kind glyph once the call succeeded; the status glyph stays while it runs or when it failed. */
  readonly kind?: ToolKind
  readonly title: string
  readonly summary?: ReactNode
  readonly meta?: ReactNode
  readonly open: boolean
  readonly onToggle: () => void
  readonly expandable?: boolean
  readonly className?: string
  readonly children?: ReactNode
}): JSX.Element => (
  <DisclosureRow
    className={cn('dshx-root', props.className)}
    collapsedContent={
      <span className="dshx:ml-2 dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2">
        {props.summary !== undefined && (
          <span aria-hidden className="dshx:shrink-0 dshx:text-muted-foreground">
            ·
          </span>
        )}
        {props.summary !== undefined && (
          <span className={cn('dshx:min-w-0 dshx:truncate', props.status === 'failed' || props.status === 'timeout' ? 'dshx:text-destructive' : undefined)}>
            {props.summary}
          </span>
        )}
        {props.meta !== undefined && <span className="dshx:ml-auto dshx:shrink-0 dshx:text-xs dshx:tabular-nums">{props.meta}</span>}
      </span>
    }
    contentClassName="dshx:min-w-0 dshx:flex-1"
    contentLayoutClassName="dshx:w-full"
    expandOnRowClick
    expandable={props.expandable ?? props.children !== undefined}
    icon={props.kind !== undefined && props.status === 'passed' ? KIND_ICONS[props.kind] : <StatusIcon status={props.status} variant="group" />}
    keepContentWhenOpen
    onToggle={props.onToggle}
    open={props.open}
    previewChevron
    running={props.status === 'running'}
    title={props.title}
  >
    {props.children}
  </DisclosureRow>
)
