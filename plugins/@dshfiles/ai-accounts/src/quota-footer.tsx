import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ChartColumnIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import { ProviderGlyph } from './provider-glyph.js'
import { QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences } from './use-preferences.js'
import { UsageOverview, useNow } from './usage-overview.js'
import { footerSummary, formatResetShort, type QuotaSummaryItem } from './usage-overview-model.js'

const describeItem = (item: QuotaSummaryItem, now: number): string => {
  const reset = formatResetShort(item.resetsAt, now)
  const resetText = reset === null ? '' : reset === 'now' ? ', resetting now' : `, resets in ${reset}`
  return item.exhausted
    ? `${item.displayName}: ${item.windowLabel} limit reached${resetText}`
    : `${item.displayName}: ${String(Math.round(item.percentRemaining))}% left on ${item.windowLabel}${resetText}`
}

/** Glyph, then percent left over the time to its reset, stacked like a menubar meter. */
const SummaryItem = (props: { readonly item: QuotaSummaryItem; readonly now: number }): JSX.Element => {
  const reset = formatResetShort(props.item.resetsAt, props.now)
  const tone = props.item.exhausted ? 'critical' : quotaTone(props.item.percentRemaining)
  return (
    <span
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded dshx:px-0.5',
        props.item.exhausted && 'dshx:bg-destructive/10 dshx:px-1 dshx:ring-1 dshx:ring-destructive/40',
      )}
    >
      <ProviderGlyph className="dshx:size-3.5" kind={props.item.kind} />
      <span className="dshx:flex dshx:flex-col dshx:items-start dshx:leading-none">
        <span className={cn('dshx:text-[11px] dshx:font-semibold dshx:tabular-nums', QUOTA_TONE_TEXT[tone])}>
          {props.item.exhausted ? 'Limit reached' : `${String(Math.round(props.item.percentRemaining))}%`}
        </span>
        {reset === null ? null : (
          <span className={cn('dshx:text-[10px] dshx:tabular-nums', props.item.exhausted ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>
            {reset === 'now' ? 'resetting' : `↻ ${reset}`}
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * The sidebar-foot usage button.
 *
 * One meter per chosen account (its binding window's percent left and time to
 * reset), most critical first; past the configured count, or when the sidebar
 * is narrow, the rest collapse into "+N". A spent limit draws as a red pill.
 * The account cards live in its popover; the "Sidebar foot" switch hides it.
 */
export const QuotaFooter = (props: { readonly wide: boolean; readonly onOpenUsageHistory: () => void }): JSX.Element | null => {
  const { footerButton, footerAccounts, footerMaxItems } = usePreferences()
  const [open, setOpen] = useState(false)
  const { usage, refreshing, failed, refresh } = useAccountsUsage({ enabled: footerButton })
  const now = useNow()

  if (!footerButton) return null
  const summary = footerSummary({ usage, accountIds: footerAccounts, maxItems: props.wide ? footerMaxItems : 1 })
  const all = [...summary.shown, ...summary.hidden]
  const label = all.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${all.map(item => describeItem(item, now)).join('. ')}`

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            'dshx-root dshx:inline-flex dshx:h-7 dshx:max-w-full dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:rounded-md dshx:px-1.5 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50',
            open && 'dshx:bg-accent dshx:text-foreground',
          )}
          title={all.length === 0 ? label : all.map(item => describeItem(item, now)).join('\n')}
          type="button"
        >
          {summary.shown.length === 0 ? (
            <>
              <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" />
              {props.wide ? <span>Usage</span> : null}
            </>
          ) : (
            summary.shown.map(item => <SummaryItem item={item} key={item.instanceId} now={now} />)
          )}
          {summary.hidden.length > 0 ? (
            <span
              className={cn(
                'dshx:text-[11px] dshx:font-medium dshx:tabular-nums',
                summary.hidden.some(item => item.exhausted) && 'dshx:text-destructive',
              )}
            >
              +{String(summary.hidden.length)}
            </span>
          ) : null}
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
