import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { ArrowUpRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useState } from 'react'
import { aiAccountsApi, type AccountsUsage } from './api.js'
import { QUOTA_TONE_FILL, QUOTA_TONE_PROGRESS, QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'

/**
 * Quota in the sidebar foot.
 *
 * The footer owns its whole surface, so this is its own disclosure rather than a
 * control that opens something: the number you want without navigating. It shows
 * only the tightest window per account, because a foot affordance that lists six
 * rows is a panel wearing a hat.
 *
 * Nothing renders until an account actually reports quota, so an unconfigured
 * profile shows no dangling empty state.
 */
export const QuotaFooter = (props: { readonly wide: boolean; readonly onOpenUsageHistory: () => void }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const [usage, setUsage] = useState<AccountsUsage | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void accounts
        .usage()
        .then(next => {
          if (!cancelled) setUsage(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [accounts])

  const rows = (usage?.cards ?? [])
    .map(card => {
      const tightest = card.usage.windows.reduce<{ label: string; percent: number; resetsAt: number | null } | undefined>((current, window) => {
        if (current !== undefined && current.percent <= window.percentRemaining) return current
        return {
          label: window.label,
          percent: window.percentRemaining,
          resetsAt: window.resetsAt,
        }
      }, undefined)
      return { instanceId: card.instanceId, tightest }
    })
    .filter(row => row.tightest !== undefined)

  if (rows.length === 0) return null

  if (!props.wide) {
    // Rail: a dot per account and a compact, labelled history action.
    return (
      <div aria-label="Account quota" className="dshx-root dshx:flex dshx:items-center dshx:gap-2" role="group">
        {rows.map(row => (
          <span
            className={cn('dshx:size-1.5 dshx:flex-none dshx:rounded-full', QUOTA_TONE_FILL[quotaTone(row.tightest?.percent ?? 0)])}
            key={row.instanceId}
            title={`${row.instanceId}: ${String(row.tightest?.percent ?? 0)}% left`}
          />
        ))}
        <Button aria-label="Open usage history" onClick={props.onOpenUsageHistory} size="icon-xs" title="Open usage history" type="button" variant="ghost">
          <ArrowUpRightIcon />
        </Button>
      </div>
    )
  }

  return (
    <div className="dshx-root dshx:flex dshx:max-w-full dshx:items-center dshx:gap-3 dshx:overflow-x-auto dshx:text-xs" title="Tightest window per account.">
      {rows.map(row => {
        const percent = row.tightest?.percent ?? 0
        const tone = quotaTone(percent)
        return (
          <div className="dshx:flex dshx:flex-none dshx:items-center dshx:gap-2" key={row.instanceId}>
            <span className="dshx:max-w-28 dshx:truncate dshx:text-muted-foreground">{row.instanceId}</span>
            <Progress
              aria-label={`${row.instanceId} remaining`}
              className={cn('dshx:h-1 dshx:w-12 dshx:bg-muted', QUOTA_TONE_PROGRESS[tone])}
              value={Math.max(0, Math.min(100, percent))}
            />
            <span className={cn('dshx:font-medium dshx:tabular-nums', QUOTA_TONE_TEXT[tone])}>{String(percent)}%</span>
          </div>
        )
      })}
      <Button className="dshx:h-auto dshx:flex-none dshx:px-0" onClick={props.onOpenUsageHistory} size="xs" type="button" variant="link">
        Open usage history
      </Button>
    </div>
  )
}
