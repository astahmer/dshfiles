import { Popover, PopoverAnchor } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ChartColumnIcon, PlusIcon, Settings2Icon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ProviderGlyph } from './provider-glyph.js'
import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { describeItem, UsagePopoverContent } from './quota-footer.js'
import { usePreferences } from './use-preferences.js'
import { useQuotaClock } from './quota-clock.js'
import { ArrangeableAccount, useUsageLayout } from './usage-arrangement.js'
import { UsageOverviewModel, type AccountSummaryItem } from './usage-overview-model.js'
import { useAccountsUsage } from './use-accounts-usage.js'

/**
 * Quota in the frame's status strip (polish pass, b:r4et): one quiet line per account — glyph · name · a thin meter ·
 * "51% left" — with no box (a hover fill only) and no colour while the account is healthy. Amber at 15% left or less,
 * red once the limit is reached. The reset lives in the tooltip ("Resets in 1 d 21 h · Thu 03:00"); every account and
 * window is in the popover a click opens. One compact segment per account (b:hbtt): glyph · short name · 28 px meter ·
 * "51%", every account in the user's order, as many as the strip leaves room for, then `+N`; the tooltip says the full
 * name, "51% left" and the reset. Accounts that are off are dimmed in their place and fold into `+N` first. Pinned
 * accounts are an optional filter. The phone pill names at least three ("CC1 10% · CC2 12% · CC3 limit +3") and its
 * sheet lists every account. The free-docking sidebar keeps the arrangeable `QuotaStrip`.
 *
 * Reset times (b:jaz6): each segment ends with its binding window's reset, muted and compact, on the same line
 * ("CC1 ▬ 51% · 1d 21h", "CC3 limit · 2h 40m"). When they do not all fit, healthy accounts drop theirs first; limited and
 * low ones keep it; only then does `+N` take accounts. The phone pill names a reset only for an account at its limit;
 * the sheet shows every one. The `showResetTimes` setting turns them off; the tooltip lists every window with its reset.
 */

export interface QuotaStatusLineProps {
  readonly compact: boolean
  readonly onOpenUsageHistory: () => void
  readonly onConnectAccount: (accountId: string) => void
  readonly activeAccountId: string | null
  readonly activeAccountRunning: boolean
  /** Route the open thread's next requests through an account (its right-click menu), when a thread is on stage. */
  readonly onUseForThread?: (accountId: string) => void
  /** The strip's two quiet tools at its end: add an account, open AI account settings. */
  readonly onAddAccount: () => void
  readonly onOpenAccounts: () => void
}

const TONE_TEXT = { ok: 'dshx:text-muted-foreground', low: 'dshx:text-warning', critical: 'dshx:text-destructive' } as const
const TONE_FILL = { ok: 'dshx:bg-muted-foreground', low: 'dshx:bg-warning', critical: 'dshx:bg-destructive' } as const

/** "51% left", "limit reached", "Sign in again": what the line and the pill say after the name. */
const statusWords = (item: AccountSummaryItem): string => {
  if ('unavailable' in item) return item.unavailable.label
  if (item.exhausted && item.disabled !== true) return 'limit reached'
  return UsageOverviewModel.leftText(item)
}

/** A thin 36 px meter of what is left: the track is the raised step, the fill neutral ink unless the tone says more. */
const Meter = (props: { readonly item: AccountSummaryItem }): JSX.Element | null => {
  if ('unavailable' in props.item) return null
  const left = props.item.disabled === true ? 0 : Math.max(0, Math.min(100, props.item.percentRemaining))
  const tone = UsageOverviewModel.stripTone(props.item)
  return (
    <span
      aria-hidden="true"
      className="dshx:relative dshx:inline-block dshx:h-1 dshx:w-9 dshx:shrink-0 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted"
      data-quota-meter=""
    >
      <span className={cn('dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:rounded-full', TONE_FILL[tone])} style={{ width: `${String(left)}%` }} />
    </span>
  )
}

/** Name, every window and the reset of one account, for its tooltip. */
const AccountTooltip = (props: { readonly item: AccountSummaryItem; readonly now: number; readonly active: string | null }): JSX.Element => {
  const { item } = props
  if ('unavailable' in item)
    return (
      <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
        <span className="dshx:font-semibold">{item.displayName}</span>
        <span>{item.unavailable.label}</span>
        <span>{item.unavailable.reason}</span>
        {props.active === null ? null : <span>{props.active}</span>}
      </div>
    )
  // Every window with its own reset (b:jaz6): "Weekly limit: 51% left · resets in 1 d 21 h · Thu 03:00".
  const windows = item.windows ?? [{ label: item.windowLabel, percentRemaining: item.percentRemaining, resetsAt: item.resetsAt }]
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
      <span className="dshx:font-semibold">{item.displayName}</span>
      {item.disabled === true ? <span>Off · not used for model routing</span> : null}
      {windows.map(window => (
        <span className="dshx:tabular-nums" data-quota-window={window.label} key={window.label}>
          {UsageOverviewModel.windowTooltipLine(window, props.now)}
        </span>
      ))}
      {props.active === null ? null : <span>{props.active}</span>}
    </div>
  )
}

const lineClass =
  'dshx-root dshx:inline-flex dshx:h-5 dshx:min-w-0 dshx:shrink dshx:items-center dshx:gap-1.5 dshx:rounded-sm dshx:px-1 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:data-[state=open]:bg-accent'

/**
 * One account's quiet line: glyph · name · meter · "51% left". The name is the account's own, or the short name the
 * user set for the strip (Short names on); the derived initials are no longer shown, the glyph says the provider.
 * A disabled account keeps its numbers, muted, with OFF after them.
 */
/** The muted compact reset after a segment's words (b:jaz6): "· 1d 21h"; one line, no glyph. */
const ResetText = (props: { readonly reset: string | null }): JSX.Element | null =>
  props.reset === null ? null : (
    <span className="dshx:shrink-0 dshx:font-normal dshx:text-muted-foreground dshx:tabular-nums" data-quota-reset="">
      {`· ${props.reset}`}
    </span>
  )

const AccountLine = (props: {
  readonly item: AccountSummaryItem
  readonly active: boolean
  readonly name: string
  readonly reset: string | null
}): JSX.Element => {
  const { item } = props
  const tone = UsageOverviewModel.stripTone(item)
  const words = statusWords(item)
  const signIn = 'unavailable' in item && item.disabled !== true && item.unavailable.label === 'Sign in again'
  return (
    <span className="dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1.5" data-quota-account={item.instanceId}>
      <ProviderGlyph className="dshx:size-3 dshx:shrink-0" kind={item.kind} monochrome />
      <span className={cn('dshx:max-w-28 dshx:min-w-0 dshx:truncate', props.active && 'dshx:font-medium dshx:text-foreground')}>{props.name}</span>
      <Meter item={item} />
      <span
        className={cn(
          'dshx:shrink-0 dshx:tabular-nums',
          signIn ? 'dshx:text-warning' : TONE_TEXT[tone],
          (tone !== 'ok' || signIn) && 'dshx:font-medium',
          item.disabled === true && 'dshx:text-(--dsw-alias-label-tertiary)',
        )}
        data-quota-tone={tone}
      >
        {words}
      </span>
      <ResetText reset={props.reset} />
      {item.disabled === true ? <span className="dshx:shrink-0 dshx:text-2xs dshx:font-medium dshx:tracking-wide dshx:text-muted-foreground">OFF</span> : null}
    </span>
  )
}

// No open-state fill: every segment opens the same popover, so shading them all would only add noise.
const segmentClass =
  'dshx-root dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:rounded-sm dshx:px-1 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

/**
 * One account's compact segment (b:hbtt): glyph · short name · 28 px meter · "51%". Neutral while healthy, amber at
 * 15% left or less, red "limit" once reached; an account that is off is dimmed and reads "off".
 */
const AccountSegment = (props: {
  readonly item: AccountSummaryItem
  readonly active: boolean
  readonly label: string
  readonly long?: boolean
  /** The compact reset to show after the words, or null when it is off, unknown or dropped for room (b:jaz6). */
  readonly reset: string | null
}): JSX.Element => {
  const { item } = props
  const tone = UsageOverviewModel.stripTone(item)
  const signIn = 'unavailable' in item && item.disabled !== true && item.unavailable.label === 'Sign in again'
  return (
    <span
      className={cn('dshx:inline-flex dshx:items-center dshx:gap-1', item.disabled === true && 'dshx:text-(--dsw-alias-label-tertiary)')}
      data-quota-account={item.instanceId}
      data-quota-off={item.disabled === true ? '' : undefined}
    >
      <ProviderGlyph className="dshx:size-3 dshx:shrink-0" kind={item.kind} monochrome />
      <span className={cn(props.long === true ? 'dshx:max-w-28' : 'dshx:max-w-12', 'dshx:truncate', props.active && 'dshx:font-medium dshx:text-foreground')}>
        {props.label}
      </span>
      <span
        aria-hidden="true"
        className="dshx:relative dshx:inline-block dshx:h-1 dshx:w-7 dshx:shrink-0 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted"
        data-quota-meter=""
      >
        {'unavailable' in item ? null : (
          <span
            className={cn('dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:rounded-full', TONE_FILL[tone])}
            style={{ width: `${String(item.disabled === true ? 0 : Math.max(0, Math.min(100, item.percentRemaining)))}%` }}
          />
        )}
      </span>
      <span
        className={cn(
          'dshx:tabular-nums',
          signIn ? 'dshx:text-warning' : TONE_TEXT[tone],
          (tone !== 'ok' || signIn) && 'dshx:font-medium',
          item.disabled === true && 'dshx:text-(--dsw-alias-label-tertiary)',
        )}
        data-quota-tone={tone}
      >
        {UsageOverviewModel.segmentWords(item)}
      </span>
      <ResetText reset={props.reset} />
    </span>
  )
}

type SegmentPlan = { readonly count: number; readonly resets: 'all' | 'urgent' }
const UNMEASURED: SegmentPlan = { count: Number.POSITIVE_INFINITY, resets: 'all' }

/**
 * How many segments fit in the desktop strip (b:hbtt) and which keep their reset time (b:jaz6). The strip spans the
 * window and also seats Working, Update, Restart and the thread's items: the budget is the strip's width minus every
 * other item's natural width and this item's own tools; the segments are measured, with and without their reset, in an
 * invisible row that holds them all. Every segment with its reset until measured (and outside the strip), so the first
 * paint and tests show every account.
 */
const useSegmentCapacity = (input: {
  readonly root: HTMLElement | null
  readonly measure: HTMLElement | null
  readonly enabled: boolean
  /** Account ids in the order segments are kept when not all fit ({@link UsageOverviewModel.segmentPriority}). */
  readonly order: readonly string[]
  /** Ids whose reset stays when room runs short ({@link UsageOverviewModel.resetMatters}). */
  readonly urgent: readonly string[]
  readonly key: string
}): SegmentPlan => {
  const [plan, setPlan] = useState<SegmentPlan>(UNMEASURED)
  const { root, measure, enabled, key } = input
  const orderKey = input.order.join('|')
  const urgentKey = input.urgent.join('|')
  useLayoutEffect(() => {
    if (!enabled || root === null || measure === null) return
    const strip = root.closest<HTMLElement>('[data-status-strip="full"]')
    if (strip === null) return
    const own = root.closest<HTMLElement>('[data-status-item]')
    const compute = (): void => {
      const stripWidth = strip.clientWidth
      if (stripWidth === 0) return setPlan(UNMEASURED)
      let others = 0
      for (const element of strip.querySelectorAll<HTMLElement>('[data-status-item], [data-status-restore]')) {
        if (element === own || element.contains(root) || own?.contains(element) === true) continue
        others += element.scrollWidth
      }
      let fixed = 0
      for (const child of Array.from(root.children) as HTMLElement[]) {
        if (child.matches('[data-quota-segment], [data-quota-overflow], [data-quota-measure]')) continue
        fixed += child.offsetWidth + 4
      }
      const ownStyle = own === null ? null : getComputedStyle(own)
      const ownPadding = ownStyle === null ? 0 : parseFloat(ownStyle.paddingLeft) + parseFloat(ownStyle.paddingRight)
      const stripStyle = getComputedStyle(strip)
      const stripPadding = parseFloat(stripStyle.paddingLeft) + parseFloat(stripStyle.paddingRight)
      // 12 px between the strip's two sides, 8 px slack against sub-pixel rounding.
      const budget = stripWidth - stripPadding - 12 - 8 - others - ownPadding - fixed
      const bare = new Map(
        Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-segment]'), element => [element.dataset.measureSegment ?? '', element.offsetWidth]),
      )
      const full = new Map(
        Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-full]'), element => [element.dataset.measureFull ?? '', element.offsetWidth]),
      )
      const ids = orderKey === '' ? [] : orderKey.split('|')
      const urgent = new Set(urgentKey === '' ? [] : urgentKey.split('|'))
      const more = measure.querySelector<HTMLElement>('[data-measure-more]')?.offsetWidth ?? 24
      const next = UsageOverviewModel.segmentPlan({
        bare: ids.map(id => bare.get(id) ?? 0),
        full: ids.map(id => full.get(id) ?? bare.get(id) ?? 0),
        urgent: ids.map(id => urgent.has(id)),
        budget,
        moreWidth: more,
        gap: 2,
      })
      // Read by journeys and evidence drivers when a strip shows fewer segments than expected.
      root.dataset.quotaBudget = `${String(Math.round(budget))}/${String(stripWidth)}`
      root.dataset.quotaResets = next.resets
      setPlan(current => (current.count === next.count && current.resets === next.resets ? current : next))
    }
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(compute)
    }
    compute()
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    resize?.observe(strip)
    resize?.observe(measure)
    // Other items change their text (Working counts, Restart notices): the room left changes with them.
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
    mutations?.observe(strip, { subtree: true, childList: true, characterData: true })
    return () => {
      cancelAnimationFrame(frame)
      resize?.disconnect()
      mutations?.disconnect()
    }
  }, [root, measure, enabled, key, orderKey, urgentKey])
  return plan
}

/** The window's width, for the phone pill (it is at most `min(80vw, 320px)` wide). */
const useViewportWidth = (enabled: boolean): number => {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 390 : window.innerWidth))
  useEffect(() => {
    if (!enabled) return
    const read = (): void => setWidth(window.innerWidth)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [enabled])
  return width
}

/** The thread's account when its quota is hidden or unread: the same quiet line, name and "in use", no numbers. */
const ActiveWithoutQuota = (props: { readonly accountId: string; readonly label: string; readonly onClick: () => void }): JSX.Element | null => {
  const api = useApi(aiAccountsApi)
  const file = useQuery(aiAccountsQueries.file(api))
  const account = file.data?.accounts.find(candidate => candidate.instanceId === props.accountId)
  if (account === undefined) return null
  return (
    <button
      aria-current="true"
      aria-label={`${account.displayName}. ${props.label}. Quota unavailable or hidden.`}
      className={lineClass}
      data-active-account={account.instanceId}
      onClick={props.onClick}
      type="button"
    >
      <ProviderGlyph className="dshx:size-3 dshx:shrink-0" kind={account.kind} monochrome />
      <span className="dshx:max-w-28 dshx:min-w-0 dshx:truncate dshx:font-medium dshx:text-foreground">{account.displayName}</span>
      <span className="dshx:shrink-0">{props.label === 'In use by this thread' ? 'in use' : 'last used'}</span>
    </button>
  )
}

const toolClass =
  'dshx-root dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

/** A quiet icon tool at the strip's end, named for assistive technology and in its tooltip. */
const StripTool = (props: { readonly label: string; readonly tooltip: string; readonly onClick: () => void; readonly children: JSX.Element }): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button aria-label={props.label} className={toolClass} onClick={props.onClick} type="button">
        {props.children}
      </button>
    </TooltipTrigger>
    <TooltipContent className="dshx-root" side="top">
      {props.tooltip}
    </TooltipContent>
  </Tooltip>
)

export const QuotaStatusLine = (props: QuotaStatusLineProps): JSX.Element | null => {
  const { usage } = useAccountsUsage()
  const { settings, usageShortNames, usageShortNameOverrides, usageStripPinned, usageWindowLayout, showResetTimes } = usePreferences()
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  // The line mounts only once usage arrives, so the strip is measured from callback refs, not on first render.
  const [root, setRoot] = useState<HTMLSpanElement | null>(null)
  const [measure, setMeasure] = useState<HTMLSpanElement | null>(null)
  const items = UsageOverviewModel.stripItems(usage, arrangement.layout)
  // One minute ticker for every segment, the pill, the sheet and the tooltips; paused in a hidden tab and, on desktop,
  // while the strip is off screen (the phone pill copies this text, so it keeps ticking with the tab).
  const now = useQuotaClock({ resetsAt: items.map(item => ('unavailable' in item ? null : item.resetsAt)), element: props.compact ? null : root })
  const resetOf = (item: AccountSummaryItem): string | null => (showResetTimes ? UsageOverviewModel.segmentReset(item, now) : null)
  const activeLabel = props.activeAccountRunning ? 'In use by this thread' : 'Last used by this thread'
  const nameOf = (item: AccountSummaryItem): string => {
    const override = usageShortNameOverrides[item.instanceId]?.trim() ?? ''
    return usageShortNames && override !== '' ? override : item.displayName
  }
  // A segment says the short name the user set, else the account's initials ("CC1"); the glyph says the provider.
  // Short names off (the strip's right-click menu) brings the account's own name back, truncated.
  const labelOf = (item: AccountSummaryItem): string => {
    if (!usageShortNames) return item.displayName
    const override = usageShortNameOverrides[item.instanceId]?.trim() ?? ''
    return override !== '' ? override : item.shortName
  }
  // Every enabled account in the user's order (b:hbtt); pins filter; the thread's account keeps a segment.
  const segmentable = UsageOverviewModel.stripSegments({
    items,
    pinned: usageStripPinned,
    activeId: props.activeAccountId,
    capacity: Number.POSITIVE_INFINITY,
  }).inline
  const plan = useSegmentCapacity({
    root,
    measure,
    enabled: !props.compact,
    order: UsageOverviewModel.segmentPriority(segmentable, props.activeAccountId).map(item => item.instanceId),
    urgent: segmentable.filter(UsageOverviewModel.resetMatters).map(item => item.instanceId),
    key: segmentable.map(item => `${item.instanceId}:${labelOf(item)}:${UsageOverviewModel.segmentWords(item)}:${resetOf(item) ?? ''}`).join('|'),
  })
  // A segment's reset: every one while they all fit with it, else only limited and low accounts keep theirs (b:jaz6).
  const segmentResetOf = (item: AccountSummaryItem): string | null => (plan.resets === 'all' || UsageOverviewModel.resetMatters(item) ? resetOf(item) : null)
  const viewport = useViewportWidth(props.compact)
  // The phone pill stays compact: only an account at its limit names its reset ("CC3 limit 2h 40m"); the sheet has all.
  const pillText = (item: AccountSummaryItem): string => {
    const reset = 'unavailable' in item || !item.exhausted ? null : resetOf(item)
    return `${labelOf(item)} ${UsageOverviewModel.segmentWords(item)}${reset === null ? '' : ` ${reset}`}`
  }
  const pillTexts = segmentable.map(pillText)
  const { inline, overflow } = UsageOverviewModel.stripSegments({
    items,
    pinned: usageStripPinned,
    activeId: props.activeAccountId,
    capacity: props.compact ? UsageOverviewModel.pillCount(pillTexts, viewport) : plan.count,
  })
  const pinAction = (id: string) => ({
    pinned: usageStripPinned.includes(id),
    onSelect: () => void settings.set('usageStripPinned', UsageOverviewModel.togglePinned(usageStripPinned, id)),
  })
  // The accessible names stay the usage strip's ("Command Code 1: Weekly limit: 10% left, resets in 2d 3h"), which the
  // window label makes exact for a screen reader; the visible segment keeps only what is left.
  const describe = (item: AccountSummaryItem): string =>
    `${describeItem(item, now, usageWindowLayout)}${props.activeAccountId === item.instanceId ? `. ${activeLabel}` : ''}`
  const shownIds = items.map(item => item.instanceId)
  const toggle = (): void => setOpen(current => !current)
  const activeWithoutQuota = props.activeAccountId !== null && !items.some(item => item.instanceId === props.activeAccountId) ? props.activeAccountId : null
  const attachRoot = (element: HTMLSpanElement | null): void => {
    rootRef.current = element
    setRoot(current => (current === element ? current : element))
  }
  const tools = (
    // Phone: the tools sit in the opened list, never in the pill text.
    <span className="dshx:inline-flex dshx:shrink-0 dshx:items-center" {...(props.compact ? { 'data-status-detail': '' } : {})}>
      <StripTool
        label="Add AI account"
        onClick={() => {
          setOpen(false)
          props.onAddAccount()
        }}
        tooltip="Add account"
      >
        <PlusIcon aria-hidden className="dshx:size-3.5" />
      </StripTool>
      <StripTool
        label="AI account settings"
        onClick={() => {
          setOpen(false)
          props.onOpenAccounts()
        }}
        tooltip="AI account settings"
      >
        <Settings2Icon aria-hidden className="dshx:size-3.5" />
      </StripTool>
    </span>
  )
  return (
    <TooltipProvider delayDuration={300}>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverAnchor asChild>
          <span
            aria-label={items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(describe).join('. ')}`}
            className={cn(
              'dshx-root dshx:min-w-0',
              // The phone list stacks one account per line; the desktop strip keeps its segments on one line.
              props.compact ? 'dshx:flex dshx:flex-col dshx:items-start dshx:gap-0.5' : 'dshx:relative dshx:inline-flex dshx:items-center dshx:gap-0.5',
            )}
            data-quota-status-line=""
            data-quota-segments={props.compact ? undefined : inline.length}
            ref={attachRoot}
            role="group"
          >
            {activeWithoutQuota === null ? null : <ActiveWithoutQuota accountId={activeWithoutQuota} label={activeLabel} onClick={toggle} />}
            {items.length === 0 ? (
              <button aria-label="AI accounts usage" className={lineClass} onClick={toggle} type="button">
                <ChartColumnIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
                <span>Usage</span>
              </button>
            ) : null}
            {props.compact ? (
              <>
                {/* The pill text only ("CC1 10% · CC2 12% · CC3 limit +3"): the frame reads it, the opened list hides it. */}
                <span className="dshx:hidden" data-quota-pill="">
                  {[inline.map(pillText).join(' · '), overflow.length === 0 ? '' : ` +${String(overflow.length)}`].join('')}
                </span>
                {/* Capped at the sheet's width so a long name truncates before the words and reset clip (b:jaz6). */}
                <span className="dshx:flex dshx:max-w-full dshx:min-w-0 dshx:flex-col dshx:items-start dshx:gap-0.5" data-status-detail="">
                  {items.map(item => (
                    // The sheet keeps the strip's right-click (long-press) verbs: use for this thread, pin, move, hide.
                    <ArrangeableAccount
                      arrangement={arrangement}
                      className="dshx:flex dshx:max-w-full dshx:min-w-0"
                      direction="column"
                      id={item.instanceId}
                      key={item.instanceId}
                      name={item.displayName}
                      shortNames={usageShortNames}
                      shownIds={shownIds}
                      pinAction={pinAction(item.instanceId)}
                      threadAction={{
                        disabled: props.onUseForThread === undefined || item.disabled === true,
                        onSelect: () => {
                          setOpen(false)
                          props.onUseForThread?.(item.instanceId)
                        },
                      }}
                    >
                      <button
                        aria-current={props.activeAccountId === item.instanceId ? 'true' : undefined}
                        aria-label={describe(item)}
                        className={cn(lineClass, 'dshx:max-w-full')}
                        data-active-account={props.activeAccountId === item.instanceId ? item.instanceId : undefined}
                        onClick={toggle}
                        type="button"
                      >
                        <AccountLine active={props.activeAccountId === item.instanceId} item={item} name={nameOf(item)} reset={resetOf(item)} />
                      </button>
                    </ArrangeableAccount>
                  ))}
                </span>
              </>
            ) : (
              <>
                {inline.map(item => (
                  // Right-click keeps the strip's verbs: use this account for the thread, pin, move, hide or show accounts.
                  <ArrangeableAccount
                    arrangement={arrangement}
                    className="dshx:flex dshx:shrink-0"
                    direction="row"
                    id={item.instanceId}
                    key={item.instanceId}
                    name={item.displayName}
                    shortNames={usageShortNames}
                    shownIds={shownIds}
                    stripSegment
                    pinAction={pinAction(item.instanceId)}
                    threadAction={{
                      disabled: props.onUseForThread === undefined || item.disabled === true,
                      onSelect: () => {
                        setOpen(false)
                        props.onUseForThread?.(item.instanceId)
                      },
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          aria-current={props.activeAccountId === item.instanceId ? 'true' : undefined}
                          aria-expanded={open}
                          aria-label={describe(item)}
                          className={segmentClass}
                          data-active-account={props.activeAccountId === item.instanceId ? item.instanceId : undefined}
                          data-state={open ? 'open' : 'closed'}
                          onClick={toggle}
                          type="button"
                        >
                          <AccountSegment
                            active={props.activeAccountId === item.instanceId}
                            item={item}
                            label={labelOf(item)}
                            long={!usageShortNames}
                            reset={segmentResetOf(item)}
                          />
                        </button>
                      </TooltipTrigger>
                      {open ? null : (
                        <TooltipContent className="dshx-root" side="top" sideOffset={6}>
                          <AccountTooltip active={props.activeAccountId === item.instanceId ? activeLabel : null} item={item} now={now} />
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </ArrangeableAccount>
                ))}
                {overflow.length === 0 ? null : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-expanded={open}
                        aria-label={`${String(overflow.length)} more: ${overflow.map(describe).join('. ')}`}
                        className={cn(segmentClass, 'dshx:tabular-nums')}
                        data-quota-overflow={overflow.length}
                        data-state={open ? 'open' : 'closed'}
                        onClick={toggle}
                        type="button"
                      >
                        {`+${String(overflow.length)}`}
                      </button>
                    </TooltipTrigger>
                    {open ? null : (
                      <TooltipContent className="dshx-root dshx:flex dshx:flex-col dshx:gap-1" side="top" sideOffset={6}>
                        {overflow.map(item => (
                          <span className="dshx:tabular-nums" key={item.instanceId}>
                            {nameOf(item)}: {statusWords(item)}
                            {resetOf(item) === null ? '' : ` · ${resetOf(item) ?? ''}`}
                          </span>
                        ))}
                      </TooltipContent>
                    )}
                  </Tooltip>
                )}
                {/* Every candidate segment, invisible, so the strip knows how many fit before it draws them. */}
                <span
                  aria-hidden="true"
                  className="dshx:pointer-events-none dshx:invisible dshx:absolute dshx:top-0 dshx:left-0 dshx:inline-flex dshx:items-center"
                  data-quota-measure=""
                  ref={setMeasure}
                >
                  {segmentable.map(item => {
                    const segment = (reset: string | null): JSX.Element => (
                      <AccountSegment
                        active={props.activeAccountId === item.instanceId}
                        item={item}
                        label={labelOf(item)}
                        long={!usageShortNames}
                        reset={reset}
                      />
                    )
                    const reset = resetOf(item)
                    return (
                      <span className="dshx:contents" key={item.instanceId}>
                        <span className={segmentClass} data-measure-segment={item.instanceId}>
                          {segment(null)}
                        </span>
                        {reset === null ? null : (
                          <span className={segmentClass} data-measure-full={item.instanceId}>
                            {segment(reset)}
                          </span>
                        )}
                      </span>
                    )
                  })}
                  <span className={segmentClass} data-measure-more="">{`+${String(Math.max(segmentable.length, overflow.length))}`}</span>
                </span>
              </>
            )}
            {tools}
            {arrangement.error === null ? null : (
              <span className="dshx:text-xs dshx:text-destructive" role="alert">
                {arrangement.error}
              </span>
            )}
          </span>
        </PopoverAnchor>
        <UsagePopoverContent
          close={() => setOpen(false)}
          keepOpenWithin={rootRef}
          onConnectAccount={props.onConnectAccount}
          onOpenUsageHistory={props.onOpenUsageHistory}
          order="remaining"
        />
      </Popover>
    </TooltipProvider>
  )
}
