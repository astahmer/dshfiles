import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { StatusCount } from '@dshfiles/plugin-ui/components/work-status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'

interface ThreadGroupHeaderProps {
  readonly label: string
  readonly count: number
  readonly collapsed: boolean
  readonly projectId: string | undefined
  readonly className: string
  readonly onToggle: () => void
  readonly startProjectSession: (projectId: string) => void
  readonly t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  /** A group-wide verb (Needs you offers Resume all); it sits beside the toggle, not inside it. */
  readonly action?: ReactNode
  /** The project's own mark, before its name; absent for groups that are not a project. */
  readonly icon?: ReactNode
  /** Local checkouts this row stands for; above one, the row names the repository rather than a path. */
  readonly checkoutCount?: number
  /**
   * The Needs you group's split (round five T2, B3): one StatusCount chip per state, the status glyph beside the number
   * on its tint, so the two counts read apart without their colour. The label stays muted; the spoken name keeps the
   * plain total.
   */
  readonly statusCounts?: { readonly needsYou: number; readonly failed: number }
  /**
   * The status a status group stands for (Working, Ready, Idle, Done): its count is the kit's muted StatusCount with the
   * 10px status glyph, like the Needs you chips, with no new hue (council round 15 B2); Drafts count with the idle glyph
   * (round 16 B2). Other groups keep "(n)".
   */
  readonly status?: GroupCountStatus
}

/** The status groups whose count carries its glyph; Needs you splits its count by `statusCounts` instead. */
export type GroupCountStatus = 'working' | 'ready' | 'idle' | 'done'

/**
 * The glyph a status group's count carries, from the group's status (`state:<status>` without its prefix). Drafts are
 * never-prompted threads whose rows draw the idle glyph, so their count carries it too (council round 16 B2).
 */
export const groupCountStatusOf = (status: string): GroupCountStatus | undefined => {
  switch (status) {
    case 'working':
    case 'ready':
    case 'idle':
    case 'done':
      return status
    case 'draft':
      return 'idle'
    default:
      return undefined
  }
}

export const ThreadGroupHeader = ({
  label,
  count,
  collapsed,
  projectId,
  className,
  onToggle,
  startProjectSession,
  t,
  action,
  icon,
  checkoutCount,
  statusCounts,
  status,
}: ThreadGroupHeaderProps) => {
  const tinted = statusCounts !== undefined && statusCounts.needsYou + statusCounts.failed > 0
  const createLabel = t('threadSidebarNewChatInProject', { project: label })
  // Nothing after the toggle: its chevron may take the row's trailing edge.
  const lastOnRow = projectId === undefined && (action === undefined || action === null)
  return (
    <div className={cn(className, 'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-2.5 dshx:pointer-coarse:h-7 dshx:phone:px-3')}>
      <button
        type="button"
        data-thread-section-header=""
        // Recessive (T1.3): a quiet 12px label and count, no rule; spacing separates the groups.
        className="dshx:group/header dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {icon}
        <span className="dshx:min-w-0 dshx:truncate">{label}</span>
        {checkoutCount === undefined || checkoutCount < 2 ? null : (
          <span className="dshx:shrink-0 dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:text-2xs dshx:font-medium dshx:text-muted-foreground">
            {checkoutCount} checkouts
          </span>
        )}
        {tinted ? (
          <>
            <span className="dshx:sr-only">({count})</span>
            <StatusCount aria-hidden="true" data-group-count="needs-you" status="needs-you" count={statusCounts.needsYou} />
            <StatusCount aria-hidden="true" data-group-count="failed" status="failed" count={statusCounts.failed} />
          </>
        ) : status !== undefined && count > 0 ? (
          <>
            <span className="dshx:sr-only">({count})</span>
            <StatusCount aria-hidden="true" data-group-count={status} status={status} count={count} />
          </>
        ) : (
          <span className="dshx:shrink-0 dshx:font-normal dshx:tabular-nums dshx:text-(--dsw-alias-label-tertiary)">({count})</span>
        )}
        <span className="dshx:flex-1" aria-hidden="true" />
        {/* Phone (council round 18 B1.3): a 44pt seat ending on the row edge, so the chevron stands on the row ⋯ axis
            (x ≈ 349 at 390pt) instead of 6pt beside it. */}
        <span
          className={cn(
            'dshx:inline-flex dshx:shrink-0 dshx:opacity-60 dshx:group-hover/header:opacity-100 dshx:pointer-coarse:phone:w-11 dshx:pointer-coarse:phone:justify-center',
            lastOnRow && 'dshx:pointer-coarse:phone:-mr-3',
          )}
          data-group-chevron=""
          aria-hidden="true"
        >
          {collapsed ? <ChevronDownIcon size={12} /> : <ChevronUpIcon size={12} />}
        </span>
      </button>
      {action}
      {projectId === undefined ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="dshx:shrink-0"
              aria-label={createLabel}
              onClick={() => startProjectSession(projectId)}
            >
              <PlusIcon size={14} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{createLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
