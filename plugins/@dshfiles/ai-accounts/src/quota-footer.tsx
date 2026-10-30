import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChartColumnIcon, PlusIcon, Settings2Icon } from '@dshfiles/plugin-ui/icons'

interface QuotaSurfaceProps {
  readonly onOpenAccounts: () => void
  readonly onUseForThread?: (accountId: string) => void
  readonly onOpenUsageHistory: () => void
  readonly onAddAccount: () => void
  readonly onConnectAccount: (accountId: string) => void
  readonly activeAccountId: string | null
  readonly activeAccountRunning: boolean
}
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
import { UsageOverviewModel, type AccountSummaryItem } from './usage-overview-model.js'

const RESET_UNIT = { now: 'now', minutes: 'min', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

/** Each account's strip short name: its override in settings, then its picker tag, then its initials. */
const useShortNames = (): ((item: AccountSummaryItem) => AccountSummaryItem) => {
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
const AccountUsageTooltip = (props: { readonly item: AccountSummaryItem; readonly now: number }): JSX.Element => {
  if ('unavailable' in props.item)
    return (
      <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
        <span className="dshx:font-semibold">{props.item.displayName}</span>
        {props.item.disabled ? <span>OFF · Disabled for model routing</span> : null}
        <span>{props.item.unavailable.label}</span>
        <span>{props.item.unavailable.reason}</span>
      </div>
    )
  const windows = props.item.windows ?? [{ label: props.item.windowLabel, percentRemaining: props.item.percentRemaining, resetsAt: props.item.resetsAt }]
  const nextReset = windows
    .flatMap(window => (window.resetsAt === null || window.resetsAt <= props.now ? [] : [window.resetsAt]))
    .sort((left, right) => left - right)[0]
  const resetIn = nextReset === undefined ? null : relativeTime(props.now, nextReset)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
      <span className="dshx:font-semibold">{props.item.displayName}</span>
      {props.item.disabled ? <span>OFF · Disabled for model routing</span> : null}
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

const describeItem = (item: AccountSummaryItem, now: number, windowLayout: UsageWindowLayout = 'binding'): string => {
  const availability = item.disabled ? '. OFF. Disabled for model routing' : ''
  if ('unavailable' in item) return `${item.displayName}: ${item.unavailable.label}. ${item.unavailable.reason}${availability}`
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
  return `${item.displayName}: ${descriptions.join('; ')}${availability}`
}

/** Keep OFF under the name without adding a row to the preview strip. */
const SummaryName = (props: { readonly name: string | null; readonly off: boolean }): JSX.Element | null => {
  if (props.name === null && !props.off) return null
  return (
    <span className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-0.5 dshx:leading-none">
      {props.name === null ? null : (
        <span className={cn('dshx:text-[10px] dshx:font-semibold dshx:tracking-wide', props.off ? 'dshx:text-muted-foreground' : 'dshx:text-foreground')}>
          {props.name}
        </span>
      )}
      {props.off ? <span className="dshx:text-[9px] dshx:font-medium dshx:tracking-wide dshx:text-muted-foreground">OFF</span> : null}
    </span>
  )
}

/** One provider glyph followed by the selected account quota windows. */
const SummaryItem = (props: {
  readonly item: AccountSummaryItem
  readonly now: number
  readonly label: MeterLabel
  readonly windowLayout?: UsageWindowLayout
  readonly showShortName: boolean
}): JSX.Element => {
  if ('unavailable' in props.item)
    return (
      <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
        <ProviderGlyph className="dshx:size-3.5" kind={props.item.kind} />
        <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:items-start dshx:leading-none">
          <SummaryName name={props.showShortName ? props.item.shortName : props.item.displayName} off={props.item.disabled === true} />
          <span className="dshx:text-[10px] dshx:text-muted-foreground">{props.item.unavailable.label}</span>
        </span>
      </span>
    )
  const lines = UsageOverviewModel.meterLines(props.item, props.now, props.label)
  const tone = props.item.exhausted ? 'critical' : quotaTone(props.item.percentRemaining)
  const windowLayout = props.windowLayout ?? 'binding'
  const windows = windowLayout === 'binding' ? [] : (props.item.windows ?? [])
  return (
    <span
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded dshx:px-0.5',
        (props.item.exhausted || props.item.onReserve) && 'dshx:px-1',
      )}
    >
      <ProviderGlyph className="dshx:size-3.5" kind={props.item.kind} />
      <SummaryName
        name={!props.showShortName || (!props.item.disabled && props.item.exhausted && windowLayout === 'binding') ? null : props.item.shortName}
        off={props.item.disabled === true}
      />
      {windowLayout === 'binding' ? (
        <span className="dshx:flex dshx:flex-col dshx:items-start dshx:leading-none">
          {lines.percent === null ? null : (
            <span
              className={cn(
                'dshx:text-[11px] dshx:font-semibold dshx:tabular-nums',
                props.item.disabled ? 'dshx:text-muted-foreground' : props.item.onReserve ? 'dshx:text-info' : QUOTA_TONE_TEXT[tone],
              )}
            >
              {lines.percent}
            </span>
          )}
          {lines.reset === null ? null : (
            <span
              className={cn(
                'dshx:tabular-nums',
                lines.percent === null ? 'dshx:text-[11px] dshx:font-semibold' : 'dshx:text-[10px]',
                !props.item.disabled && props.item.exhausted
                  ? 'dshx:text-destructive'
                  : !props.item.disabled && lines.percent === null
                    ? QUOTA_TONE_TEXT[tone]
                    : 'dshx:text-muted-foreground',
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
              <Tooltip key={window.label}>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'dshx:text-[11px] dshx:font-semibold dshx:tabular-nums',
                      props.item.disabled ? 'dshx:text-muted-foreground' : QUOTA_TONE_TEXT[windowTone],
                    )}
                  >
                    {String(Math.round(window.percentRemaining))}%
                  </span>
                </TooltipTrigger>
                <TooltipContent>{window.label}</TooltipContent>
              </Tooltip>
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
  readonly onConnectAccount: (accountId: string) => void
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
        onConnectAccount={accountId => {
          props.close()
          props.onConnectAccount(accountId)
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
export const QuotaStrip = (props: QuotaSurfaceProps): JSX.Element | null => {
  const { footerButton } = usePreferences()
  // A disabled strip mounts nothing: no usage query, no clock and no layout subscription behind an empty surface.
  if (!footerButton) return null
  return <QuotaStripBody {...props} />
}

const QuotaStripBody = (props: QuotaSurfaceProps): JSX.Element => {
  const { meterLabel, usageWindowLayout, usageShortNames } = usePreferences()
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const { usage } = useAccountsUsage()
  const withShortName = useShortNames()
  const stripRef = useRef<HTMLDivElement>(null)
  const items = UsageOverviewModel.stripItems(usage, arrangement.layout).map(withShortName)
  const activeLabel = props.activeAccountRunning ? 'In use by active chat' : 'Last used by active chat'
  // Minutes and reset countdowns are all the closed strip shows, so its clock wakes on those boundaries instead of
  // every second; the open overview keeps its own second-resolution clock.
  const now = useQuotaClock({ resetsAt: items.map(item => ('unavailable' in item ? null : item.resetsAt)) })
  const shownIds = items.map(item => item.instanceId)
  const label = items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(item => describeItem(item, now, usageWindowLayout)).join('. ')}`

  return (
    <TooltipProvider delayDuration={300}>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverAnchor asChild>
          <div
            aria-label={label}
            className="dshx-root dshx:flex dshx:w-full dshx:flex-wrap dshx:items-center dshx:gap-x-1 dshx:gap-y-0.5 dshx:px-2 dshx:py-0.5"
            ref={stripRef}
            role="group"
          >
            {props.activeAccountId !== null && !items.some(item => item.instanceId === props.activeAccountId) ? (
              <ActiveAccountWithoutQuota accountId={props.activeAccountId} label={activeLabel} onClick={() => setOpen(current => !current)} />
            ) : null}
            {items.length === 0 ? (
              <button aria-label={label} className={meterButtonClass} onClick={() => setOpen(current => !current)} type="button">
                <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" />
                <span>Usage</span>
              </button>
            ) : (
              items.map(item => (
                <ArrangeableAccount
                  threadAction={{
                    disabled: props.onUseForThread === undefined || ('disabled' in item && item.disabled === true),
                    onSelect: () => {
                      setOpen(false)
                      props.onUseForThread?.(item.instanceId)
                    },
                  }}
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
                        aria-current={props.activeAccountId === item.instanceId ? 'true' : undefined}
                        data-active-account={props.activeAccountId === item.instanceId ? item.instanceId : undefined}
                        aria-label={`${describeItem(item, now, usageWindowLayout)}${props.activeAccountId === item.instanceId ? `. ${activeLabel}` : ''}`}
                        className={cn(
                          meterButtonClass,
                          'disabled' in item && item.disabled === true && 'dshx:opacity-50',
                          usageWindowLayout === 'vertical' && 'dshx:h-auto dshx:min-h-8 dshx:py-1',
                          open && 'dshx:text-foreground',
                          !item.disabled && !('unavailable' in item) && item.exhausted && 'dshx:bg-destructive/10 dshx:ring-1 dshx:ring-destructive/40',
                          !item.disabled && !('unavailable' in item) && item.onReserve && 'dshx:bg-info/10 dshx:ring-1 dshx:ring-info/40',
                          !item.disabled && props.activeAccountId === item.instanceId && 'dshx:text-foreground dshx:ring-1 dshx:ring-primary/60',
                          !item.disabled &&
                            props.activeAccountId === item.instanceId &&
                            ('unavailable' in item || (!item.exhausted && !item.onReserve)) &&
                            'dshx:bg-primary/10',
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
                        {props.activeAccountId === item.instanceId ? <p className="dshx:mt-1 dshx:text-xs dshx:font-semibold">{activeLabel}</p> : null}
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="AI account settings"
                  className={cn(meterButtonClass, 'dshx:size-8 dshx:justify-center')}
                  onClick={() => {
                    setOpen(false)
                    props.onOpenAccounts()
                  }}
                  type="button"
                >
                  <Settings2Icon aria-hidden className="dshx:size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="dshx-root" side="top">
                AI account settings
              </TooltipContent>
            </Tooltip>
            {arrangement.error === null ? null : (
              <p className="dshx:w-full dshx:text-xs dshx:text-destructive" role="alert">
                {arrangement.error}
              </p>
            )}
          </div>
        </PopoverAnchor>
        <UsagePopoverContent
          close={() => setOpen(false)}
          keepOpenWithin={stripRef}
          onOpenUsageHistory={props.onOpenUsageHistory}
          onConnectAccount={props.onConnectAccount}
        />
      </Popover>
    </TooltipProvider>
  )
}

/** Collapsed rail: one button with the most critical account, opening the usage popover. */
const QuotaRailButton = (props: QuotaSurfaceProps): JSX.Element => {
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const { usage } = useAccountsUsage()
  const withShortName = useShortNames()
  const items = UsageOverviewModel.stripItems(usage, arrangement.layout).map(withShortName)
  const now = useQuotaClock({ resetsAt: items.map(item => ('unavailable' in item ? null : item.resetsAt)) })
  const label = items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(item => describeItem(item, now)).join('. ')}`
  const api = useApi(aiAccountsApi)
  const file = useQuery(aiAccountsQueries.file(api))
  const activeProfile = file.data?.accounts.find(account => account.instanceId === props.activeAccountId)
  const critical =
    props.activeAccountId === null ? (UsageOverviewModel.mostCritical(items) ?? items[0]) : items.find(item => item.instanceId === props.activeAccountId)
  const activeLabel =
    activeProfile === undefined ? label : `${activeProfile.displayName}. ${props.activeAccountRunning ? 'In use by active chat' : 'Last used by active chat'}`
  const stripTitle = items.map(item => describeItem(item, now)).join('\n') || label
  return (
    <TooltipProvider delayDuration={500}>
      <Popover onOpenChange={setOpen} open={open}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                aria-label={activeLabel}
                aria-current={activeProfile === undefined ? undefined : 'true'}
                data-active-account={activeProfile?.instanceId}
                className={cn(
                  meterButtonClass,
                  'dshx:h-auto dshx:min-h-8 dshx:flex-col dshx:gap-0.5 dshx:overflow-hidden dshx:py-1',
                  open && 'dshx:bg-accent dshx:text-foreground',
                  activeProfile !== undefined && 'dshx:bg-primary/10 dshx:ring-1 dshx:ring-primary/60',
                )}
                type="button"
              >
                {/* The rail is ~56px wide: the glyph over the percent, no account tag or reset, so nothing clips. */}
                {critical === undefined ? (
                  activeProfile === undefined ? (
                    <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" />
                  ) : (
                    <ProviderGlyph kind={activeProfile.kind} className="dshx:size-4 dshx:shrink-0" />
                  )
                ) : 'unavailable' in critical ? (
                  <>
                    <ProviderGlyph className="dshx:size-3.5" kind={critical.kind} />
                    <span className="dshx:text-[10px] dshx:text-muted-foreground">
                      {critical.unavailable.label === 'Sign in again' ? 'Sign in' : 'No quota'}
                    </span>
                  </>
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
          </TooltipTrigger>
          <TooltipContent className="dshx-root dshx:whitespace-pre-line">{stripTitle}</TooltipContent>
        </Tooltip>
        <UsagePopoverContent close={() => setOpen(false)} onOpenUsageHistory={props.onOpenUsageHistory} onConnectAccount={props.onConnectAccount} />
      </Popover>
    </TooltipProvider>
  )
}

/**
 * The sidebar footer action: the rail button when collapsed; when wide, the
 * strip in place unless a seat above the foot already holds it. The "Sidebar
 * usage" switch hides both.
 */
export const QuotaFooter = (props: QuotaSurfaceProps & { readonly wide: boolean; readonly stripSeated: boolean }): JSX.Element | null => {
  const { footerButton } = usePreferences()
  if (!footerButton) return null
  if (!props.wide)
    return (
      <div className="dshx-root dshx:flex dshx:flex-col dshx:items-center dshx:gap-1">
        <QuotaRailButton {...props} />
        <AddAccountPreviewButton onClick={props.onAddAccount} />
      </div>
    )
  return props.stripSeated ? null : <QuotaStrip {...props} />
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

const ActiveAccountWithoutQuota = (props: { readonly accountId: string; readonly label: string; readonly onClick: () => void }): JSX.Element | null => {
  const api = useApi(aiAccountsApi)
  const file = useQuery(aiAccountsQueries.file(api))
  const account = file.data?.accounts.find(candidate => candidate.instanceId === props.accountId)
  if (account === undefined) return null
  return (
    <button
      aria-current="true"
      aria-label={`${account.displayName}. ${props.label}. Quota unavailable or hidden.`}
      data-active-account={account.instanceId}
      className={cn(meterButtonClass, 'dshx:bg-primary/10 dshx:text-foreground dshx:ring-1 dshx:ring-primary/60')}
      onClick={props.onClick}
      type="button"
    >
      <ProviderGlyph kind={account.kind} className="dshx:size-3.5" />
      <span className="dshx:max-w-28 dshx:truncate">{account.displayName}</span>
      <span className="dshx:text-[10px]">{props.label}</span>
    </button>
  )
}
