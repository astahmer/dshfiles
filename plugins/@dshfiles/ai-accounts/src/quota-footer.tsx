import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ChartColumnIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import { QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences } from './use-preferences.js'
import { UsageOverview } from './usage-overview.js'
import { tightestRemaining } from './usage-overview-model.js'

/**
 * The sidebar-foot usage button.
 *
 * The footer row belongs to the sidebar, so this stays one fixed-size button —
 * glyph, label and the tightest percent left — that never wraps or shrinks.
 * Everything else lives in its popover. The "Sidebar foot" switch hides it.
 */
export const QuotaFooter = (props: { readonly wide: boolean; readonly onOpenUsageHistory: () => void }): JSX.Element | null => {
  const { footerButton } = usePreferences()
  const [open, setOpen] = useState(false)
  const { usage, refreshing, failed, refresh } = useAccountsUsage({ enabled: footerButton })

  if (!footerButton) return null
  const tightest = tightestRemaining(usage)
  const tone = quotaTone(tightest ?? 100)
  const label = tightest === undefined ? 'AI accounts usage' : `AI accounts usage, ${String(Math.round(tightest))}% left on the tightest window`

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            'dshx-root dshx:inline-flex dshx:h-7 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-1.5 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50',
            open && 'dshx:bg-accent dshx:text-foreground',
          )}
          title={label}
          type="button"
        >
          <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" />
          {props.wide ? <span>Usage</span> : null}
          {tightest === undefined ? null : <span className={cn('dshx:font-semibold dshx:tabular-nums', QUOTA_TONE_TEXT[tone])}>{String(Math.round(tightest))}%</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="dshx-root dshx:w-[min(400px,calc(100vw-16px))] dshx:p-0" collisionPadding={8} side="top" sideOffset={8}>
        <UsageOverview
          failed={failed}
          onOpenHistory={() => {
            setOpen(false)
            props.onOpenUsageHistory()
          }}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          usage={usage}
        />
      </PopoverContent>
    </Popover>
  )
}
