import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
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
}: ThreadGroupHeaderProps) => {
  const createLabel = t('threadSidebarNewChatInProject', { project: label })
  return (
    <div className={cn(className, 'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-2.5')}>
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
        <span className="dshx:shrink-0 dshx:font-normal dshx:tabular-nums dshx:text-(--dsw-alias-label-tertiary)">({count})</span>
        <span className="dshx:flex-1" aria-hidden="true" />
        <span className="dshx:inline-flex dshx:shrink-0 dshx:opacity-60 dshx:group-hover/header:opacity-100" aria-hidden="true">
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
