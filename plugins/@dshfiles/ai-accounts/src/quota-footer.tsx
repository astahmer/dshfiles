import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChartColumnIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useRef, useState, type RefObject } from 'react'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { ProviderGlyph } from './provider-glyph.js'
import { QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { ArrangeableAccount, useUsageLayout } from './usage-arrangement.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences, type MeterLabel, type UsageWindowLayout } from './use-preferences.js'
import { useQuotaClock } from './quota-clock.js'
import { UsageOverview } from './usage-overview.js'
import { UsageOverviewModel, type QuotaSummaryItem } from './usage-overview-model.js'

const RESET_UNIT = { now: 'now', minutes: 'min', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

/** Each account's strip short name: its override in settings, then its picker tag, then its initials. */
const useShortNames = (): ((item: QuotaSummaryItem) => QuotaSummaryItem) => {
  const accounts = useApi(aiAccountsApi)
  const { usageShortNameOverrides } = usePreferences()
  const file = useQuery({ ...aiAccountsQueries.file(accounts), retry: false })
  const tags = new Map((file.data?.accounts ?? []).map(account => [account.instanceId, account.badge]))
  return item => ({
    ...item,
    shortName: UsageOverviewModel.stripShortName({
      displayName: item.displayName,
      tag: tags.get(item.instanceId) ?? '',
      override: usageShortNameOverrides[item.instanceId],
    }),
  })
}

/** Name, every quota window and the soonest reset of one strip account. */
const AccountUsageTooltip = (props: { readonly item: QuotaSummaryItem; readonly now: number }): JSX.Element => {
  const windows = props.item.windows ?? [{ label: props.item.windowLabel, percentRemaining: props.item.percentRemaining, resetsAt: props.item.resetsAt }]
  const nextReset = windows
    .flatMap(window => (window.resetsAt === null || window.resetsAt <= props.now ? [] : [window.resetsAt]))
    .sort((left, right) => left - right)[0]
  const resetIn = nextReset === undefined ? null : relativeTime(props.now, nextReset)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
      <span className="dshx:font-semibold">{props.item.displayName}</span>
      {windows.map(window => (
        <span className="dshx:tabular-nums" key={window.label}>
          {window.label}: {UsageOverviewModel.isExhausted(window.percentRemaining) ? 'limit reached' : `${String(Math.round(window.percentRemaining))}% left`}
        </span>
      ))}
      {resetIn === null || nextReset === undefined ? null : (
        <span className="dshx:tabular-nums">
          Next reset {resetIn.unit === 'now' ? 'now' : `in ${String(resetIn.n)}${RESET_UNIT[resetIn.unit]}`} (
          {new Date(nextReset).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })})
        </span>
      )}
    </div>
  )
}

const describeItem = (item: QuotaSummaryItem, now: number, windowLayout: UsageWindowLayout = 'binding'): string => {
  const accountWindows = item.windows ?? [{ label: item.windowLabel, percentRemaining: item.percentRemaining, resetsAt: item.resetsAt }]
  const windows = windowLayout === 'binding' ? [accountWindows.find(window => window.label === item.windowLabel)] : accountWindows
  const descriptions = windows.flatMap(window => {
    if (window === undefined) return []
    const reset = UsageOverviewModel.formatResetShort(window.resetsAt, now)
    const resetText = reset === null ? '' : reset === 'now' ? ', resetting now' : `, resets in ${reset}`
    const percent = Math.round(window.percentRemaining)
    const status = percent <= 0 ? 'limit reached' : `${String(percent)}% left`
    return [`${window.label}: ${status}${resetText}`]
  })
  return `${item.displayName}: ${descriptions.join('; ')}`
}

/** One provider glyph followed by the selected account quota windows. */
const SummaryItem = (props: {
  readonly item: QuotaSummaryItem
  readonly now: number
  readonly label: MeterLabel
  readonly windowLayout?: UsageWindowLayout
  readonly showShortName: boolean
}): JSX.Element => {
  const lines = UsageOverviewModel.meterLines(props.item, props.now, props.label)
  const tone = props.item.exhausted ? 'critical' : quotaTone(props.item.percentRemaining)
  const windowLayout = props.windowLayout ?? 'binding'
  const windows = windowLayout === 'binding' ? [] : (props.item.windows ?? [])
  return (
    <span
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded dshx:px-0.5',
        props.item.exhausted && 'dshx:bg-destructive/10 dshx:px-1 dshx:ring-1 dshx:ring-destructive/40',
        props.item.onReserve && 'dshx:bg-info/10 dshx:px-1 dshx:ring-1 dshx:ring-info/40',
      )}
    >
      <ProviderGlyph className="dshx:size-3.5" kind={props.item.kind} />
      {!props.showShortName || (props.item.exhausted && windowLayout === 'binding') ? null : (
        <span className="dshx:text-[10px] dshx:font-semibold dshx:tracking-wide dshx:text-foreground">{props.item.shortName}</span>
      )}
      {windowLayout === 'binding' ? (
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
      ) : (
        <span className={cn('dshx:flex dshx:gap-1', windowLayout === 'vertical' ? 'dshx:flex-col' : 'dshx:flex-row dshx:items-center')}>
          {windows.map(window => {
            const exhausted = Math.round(window.percentRemaining) <= 0
            const windowTone = exhausted ? 'critical' : quotaTone(window.percentRemaining)
            return (
              <span
                className={cn('dshx:text-[11px] dshx:font-semibold dshx:tabular-nums', QUOTA_TONE_TEXT[windowTone])}
                key={window.label}
                title={window.label}
              >
                {String(Math.round(window.percentRemaining))}%
              </span>
            )
          })}
        </span>
      )}
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
      className="dshx-root dshx:w-auto dshx:p-0"
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
 * (the governing window by default), in the user's order;
 * drag to reorder, right-click to move or hide, click to open the popover. The
 * thread sidebar seats it above its foot; the stock sidebar stacks footer
 * actions above Settings, so there it renders in place.
 */
export const QuotaStrip = (props: { readonly onOpenUsageHistory: () => void; readonly onAddAccount: () => void }): JSX.Element | null => {
  const { footerButton } = usePreferences()
  // A disabled strip mounts nothing: no usage query, no clock and no layout subscription behind an empty surface.
  if (!footerButton) return null
  return <QuotaStripBody {...props} />
}

const QuotaStripBody = (props: { readonly onOpenUsageHistory: () => void; readonly onAddAccount: () => void }): JSX.Element => {
  const { meterLabel, usageWindowLayout, usageShortNames } = usePreferences()
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const { usage } = useAccountsUsage()
  const withShortName = useShortNames()
  const stripRef = useRef<HTMLDivElement>(null)
  const items = UsageOverviewModel.stripItems(usage, arrangement.layout).map(withShortName)
  // Minutes and reset countdowns are all the closed strip shows, so its clock wakes on those boundaries instead of
  // every second; the open overview keeps its own second-resolution clock.
  const now = useQuotaClock({ resetsAt: items.map(item => item.resetsAt) })
  const shownIds = items.map(item => item.instanceId)
  const label = items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(item => describeItem(item, now, usageWindowLayout)).join('. ')}`

  return (
    <TooltipProvider delayDuration={300}>
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
                  shortNames={usageShortNames}
                  direction="row"
                  id={item.instanceId}
                  key={item.instanceId}
                  name={item.displayName}
                  shownIds={shownIds}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-expanded={open}
                        aria-label={describeItem(item, now, usageWindowLayout)}
                        className={cn(
                          meterButtonClass,
                          usageWindowLayout === 'vertical' && 'dshx:h-auto dshx:min-h-8 dshx:py-1',
                          open && 'dshx:text-foreground',
                        )}
                        onClick={() => setOpen(current => !current)}
                        type="button"
                      >
                        <SummaryItem item={item} label={meterLabel} now={now} showShortName={usageShortNames} windowLayout={usageWindowLayout} />
                      </button>
                    </TooltipTrigger>
                    {open ? null : (
                      <TooltipContent className="dshx-root" side="top" sideOffset={6}>
                        <AccountUsageTooltip item={item} now={now} />
                      </TooltipContent>
                    )}
                  </Tooltip>
                </ArrangeableAccount>
              ))
            )}
            <AddAccountPreviewButton
              onClick={() => {
                setOpen(false)
                props.onAddAccount()
              }}
            />
          </div>
        </PopoverAnchor>
        <UsagePopoverContent close={() => setOpen(false)} keepOpenWithin={stripRef} onOpenUsageHistory={props.onOpenUsageHistory} />
      </Popover>
    </TooltipProvider>
  )
}

/** Collapsed rail: one button with the most critical account, opening the usage popover. */
const QuotaRailButton = (props: { readonly onOpenUsageHistory: () => void }): JSX.Element => {
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const { usage } = useAccountsUsage()
  const withShortName = useShortNames()
  const items = UsageOverviewModel.stripItems(usage, arrangement.layout).map(withShortName)
  const now = useQuotaClock({ resetsAt: items.map(item => item.resetsAt) })
  const label = items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(item => describeItem(item, now)).join('. ')}`
  const critical = UsageOverviewModel.mostCritical(items)
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            meterButtonClass,
            'dshx:h-auto dshx:min-h-8 dshx:flex-col dshx:gap-0.5 dshx:overflow-hidden dshx:py-1',
            open && 'dshx:bg-accent dshx:text-foreground',
          )}
          title={items.map(item => describeItem(item, now)).join('\n') || label}
          type="button"
        >
          {/* The rail is ~56px wide: the glyph over the percent, no account tag or reset, so nothing clips. */}
          {critical === undefined ? (
            <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" />
          ) : (
            <>
              <ProviderGlyph className="dshx:size-3.5" kind={critical.kind} />
              <span
                className={cn(
                  'dshx:text-[10px] dshx:leading-none dshx:font-semibold dshx:tabular-nums',
                  critical.exhausted ? 'dshx:text-destructive' : QUOTA_TONE_TEXT[quotaTone(critical.percentRemaining)],
                )}
              >
                {critical.exhausted ? '0%' : `${String(Math.round(critical.percentRemaining))}%`}
              </span>
            </>
          )}
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
export const QuotaFooter = (props: {
  readonly wide: boolean
  readonly stripSeated: boolean
  readonly onAddAccount: () => void
  readonly onOpenUsageHistory: () => void
}): JSX.Element | null => {
  const { footerButton } = usePreferences()
  if (!footerButton) return null
  if (!props.wide)
    return (
      <div className="dshx-root dshx:flex dshx:flex-col dshx:items-center dshx:gap-1">
        <QuotaRailButton onOpenUsageHistory={props.onOpenUsageHistory} />
        <AddAccountPreviewButton onClick={props.onAddAccount} />
      </div>
    )
  return props.stripSeated ? null : <QuotaStrip onOpenUsageHistory={props.onOpenUsageHistory} onAddAccount={props.onAddAccount} />
}

const AddAccountPreviewButton = (props: { readonly onClick: () => void }): JSX.Element => (
  <TooltipProvider delayDuration={200}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="Add AI account"
          className={cn(meterButtonClass, 'dshx:size-8 dshx:justify-center dshx:border dshx:border-dashed')}
          onClick={props.onClick}
          type="button"
        >
          <PlusIcon className="dshx:size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="dshx-root" side="top">
        Add account
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)
