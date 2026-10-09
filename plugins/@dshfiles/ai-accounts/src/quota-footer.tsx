import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ChartColumnIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useRef, useState, type RefObject } from 'react'
import { ProviderGlyph } from './provider-glyph.js'
import { QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { ArrangeableAccount, useUsageLayout } from './usage-arrangement.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences, type MeterLabel } from './use-preferences.js'
import { UsageOverview, useNow } from './usage-overview.js'
import { formatResetShort, meterLines, mostCritical, stripItems, type QuotaSummaryItem } from './usage-overview-model.js'

const describeItem = (item: QuotaSummaryItem, now: number): string => {
  const reset = formatResetShort(item.resetsAt, now)
  const resetText = reset === null ? '' : reset === 'now' ? ', resetting now' : `, resets in ${reset}`
  if (item.exhausted) return `${item.displayName}: ${item.windowLabel} limit reached${resetText}`
  const reserve = item.onReserve ? ' (weekly limit spent)' : ''
  return `${item.displayName}: ${String(Math.round(item.percentRemaining))}% left on ${item.windowLabel}${reserve}${resetText}`
}

/** Glyph, then percent left over the time to its reset, stacked like a menubar meter; the setting may keep one line. */
const SummaryItem = (props: { readonly item: QuotaSummaryItem; readonly now: number; readonly label: MeterLabel }): JSX.Element => {
  const lines = meterLines(props.item, props.now, props.label)
  const tone = props.item.exhausted ? 'critical' : quotaTone(props.item.percentRemaining)
  return (
    <span
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded dshx:px-0.5',
        props.item.exhausted && 'dshx:bg-destructive/10 dshx:px-1 dshx:ring-1 dshx:ring-destructive/40',
        props.item.onReserve && 'dshx:bg-info/10 dshx:px-1 dshx:ring-1 dshx:ring-info/40',
      )}
    >
      <ProviderGlyph className="dshx:size-3.5" kind={props.item.kind} />
      <span className="dshx:flex dshx:flex-col dshx:items-start dshx:leading-none">
        {lines.percent === null ? null : (
          <span className={cn('dshx:text-[11px] dshx:font-semibold dshx:tabular-nums', props.item.onReserve ? 'dshx:text-info' : QUOTA_TONE_TEXT[tone])}>
            {lines.percent}
          </span>
        )}
        {lines.reset === null ? null : (
          <span
            className={cn(
              'dshx:tabular-nums',
              lines.percent === null ? 'dshx:text-[11px] dshx:font-semibold' : 'dshx:text-[10px]',
              props.item.exhausted ? 'dshx:text-destructive' : lines.percent === null ? QUOTA_TONE_TEXT[tone] : 'dshx:text-muted-foreground',
            )}
          >
            {lines.reset}
          </span>
        )}
      </span>
    </span>
  )
}

const meterButtonClass =
  'dshx-root dshx:inline-flex dshx:h-8 dshx:max-w-full dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-1 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50'

/** The usage popover, anchored on whichever surface opened it; clicks inside `keepOpenWithin` do not dismiss it. */
const UsagePopoverContent = (props: {
  readonly keepOpenWithin?: RefObject<HTMLElement | null>
  readonly onOpenUsageHistory: () => void
  readonly close: () => void
}): JSX.Element => {
  const { usage, refreshing, failed, refresh } = useAccountsUsage()
  return (
    <PopoverContent
      align="start"
      className="dshx-root dshx:w-[min(400px,calc(100vw-16px))] dshx:p-0"
      collisionPadding={8}
      onInteractOutside={event => {
        if (event.target instanceof Node && props.keepOpenWithin?.current?.contains(event.target) === true) event.preventDefault()
      }}
      side="top"
      sideOffset={8}
    >
      <UsageOverview
        failed={failed}
        onOpenHistory={() => {
          props.close()
          props.onOpenUsageHistory()
        }}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        usage={usage}
      />
    </PopoverContent>
  )
}

/**
 * The wide usage surface: a wrapping strip with one meter per visible account
 * (its binding window's percent left and time to reset), in the user's order;
 * drag to reorder, right-click to move or hide, click to open the popover. The
 * thread sidebar seats it above its foot; the stock sidebar stacks footer
 * actions above Settings, so there it renders in place.
 */
export const QuotaStrip = (props: { readonly onOpenUsageHistory: () => void }): JSX.Element | null => {
  const { footerButton, meterLabel } = usePreferences()
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const { usage } = useAccountsUsage({ enabled: footerButton })
  const now = useNow()
  const stripRef = useRef<HTMLDivElement>(null)

  if (!footerButton) return null
  const items = stripItems(usage, arrangement.layout)
  const shownIds = items.map(item => item.instanceId)
  const label = items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(item => describeItem(item, now)).join('. ')}`

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverAnchor asChild>
        <div
          aria-label={label}
          className="dshx-root dshx:flex dshx:w-full dshx:flex-wrap dshx:items-center dshx:gap-x-1 dshx:gap-y-0.5 dshx:border-t dshx:px-2 dshx:py-1"
          ref={stripRef}
          role="group"
        >
          {items.length === 0 ? (
            <button aria-label={label} className={meterButtonClass} onClick={() => setOpen(current => !current)} type="button">
              <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" />
              <span>Usage</span>
            </button>
          ) : (
            items.map(item => (
              <ArrangeableAccount
                arrangement={arrangement}
                direction="row"
                id={item.instanceId}
                key={item.instanceId}
                name={item.displayName}
                shownIds={shownIds}
              >
                <button
                  aria-expanded={open}
                  aria-label={describeItem(item, now)}
                  className={cn(meterButtonClass, open && 'dshx:text-foreground')}
                  onClick={() => setOpen(current => !current)}
                  title={describeItem(item, now)}
                  type="button"
                >
                  <SummaryItem item={item} label={meterLabel} now={now} />
                </button>
              </ArrangeableAccount>
            ))
          )}
        </div>
      </PopoverAnchor>
      <UsagePopoverContent close={() => setOpen(false)} keepOpenWithin={stripRef} onOpenUsageHistory={props.onOpenUsageHistory} />
    </Popover>
  )
}

/** Collapsed rail: one button with the most critical account, opening the usage popover. */
const QuotaRailButton = (props: { readonly onOpenUsageHistory: () => void }): JSX.Element => {
  const { meterLabel } = usePreferences()
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const { usage } = useAccountsUsage()
  const now = useNow()
  const items = stripItems(usage, arrangement.layout)
  const label = items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(item => describeItem(item, now)).join('. ')}`
  const critical = mostCritical(items)
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className={cn(meterButtonClass, open && 'dshx:bg-accent dshx:text-foreground')}
          title={items.map(item => describeItem(item, now)).join('\n') || label}
          type="button"
        >
          {critical === undefined ? <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" /> : <SummaryItem item={critical} label={meterLabel} now={now} />}
        </button>
      </PopoverTrigger>
      <UsagePopoverContent close={() => setOpen(false)} onOpenUsageHistory={props.onOpenUsageHistory} />
    </Popover>
  )
}

/**
 * The sidebar footer action: the rail button when collapsed; when wide, the
 * strip in place unless a seat above the foot already holds it. The "Sidebar
 * usage" switch hides both.
 */
export const QuotaFooter = (props: { readonly wide: boolean; readonly stripSeated: boolean; readonly onOpenUsageHistory: () => void }): JSX.Element | null => {
  const { footerButton } = usePreferences()
  if (!footerButton) return null
  if (!props.wide) return <QuotaRailButton onOpenUsageHistory={props.onOpenUsageHistory} />
  return props.stripSeated ? null : <QuotaStrip onOpenUsageHistory={props.onOpenUsageHistory} />
}
