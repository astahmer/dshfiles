import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ChartColumnIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ProviderGlyph } from './provider-glyph.js'
import { QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { ArrangeableAccount, useUsageLayout } from './usage-arrangement.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences } from './use-preferences.js'
import { UsageOverview, useNow } from './usage-overview.js'
import { formatResetShort, mostCritical, stripItems, type QuotaSummaryItem } from './usage-overview-model.js'

const describeItem = (item: QuotaSummaryItem, now: number): string => {
  const reset = formatResetShort(item.resetsAt, now)
  const resetText = reset === null ? '' : reset === 'now' ? ', resetting now' : `, resets in ${reset}`
  if (item.exhausted) return `${item.displayName}: ${item.windowLabel} limit reached${resetText}`
  const reserve = item.onReserve ? ' (weekly limit spent)' : ''
  return `${item.displayName}: ${String(Math.round(item.percentRemaining))}% left on ${item.windowLabel}${reserve}${resetText}`
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
        props.item.onReserve && 'dshx:bg-info/10 dshx:px-1 dshx:ring-1 dshx:ring-info/40',
      )}
    >
      <ProviderGlyph className="dshx:size-3.5" kind={props.item.kind} />
      <span className="dshx:flex dshx:flex-col dshx:items-start dshx:leading-none">
        <span className={cn('dshx:text-[11px] dshx:font-semibold dshx:tabular-nums', props.item.onReserve ? 'dshx:text-info' : QUOTA_TONE_TEXT[tone])}>
          {props.item.exhausted ? 'Limit reached' : `${props.item.onReserve ? '☾ ' : ''}${String(Math.round(props.item.percentRemaining))}%`}
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

const meterButtonClass =
  'dshx-root dshx:inline-flex dshx:h-8 dshx:max-w-full dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-1 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50'

/**
 * Finds the sidebar foot this footer action renders in and mounts the strip in
 * a node just above it. The thread sidebar's foot is a single non-wrapping row
 * that folds overflow behind "…", so the strip cannot live inside it; the stock
 * sidebar already stacks footer actions above Settings, so there it renders in
 * place. No slot exists above the foot today; this is the client-side stand-in.
 */
const useStripHost = (enabled: boolean) => {
  const markerRef = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const foot = markerRef.current?.closest('footer')
    if (!enabled || foot === null || foot === undefined || foot.parentElement === null) {
      setHost(null)
      return
    }
    const node = document.createElement('div')
    node.dataset.aiAccountsUsageStrip = ''
    node.className = 'dshx:w-full dshx:min-w-0 dshx:shrink-0'
    foot.parentElement.insertBefore(node, foot)
    setHost(node)
    return () => {
      node.remove()
      setHost(null)
    }
  }, [enabled])
  return { markerRef, host }
}

/**
 * The sidebar usage surface. Wide: a wrapping strip above the sidebar foot
 * with one meter per visible account (its binding window's percent left and
 * time to reset), in the user's order; drag to reorder, right-click to move or
 * hide. Collapsed rail: one button with the most critical account. Either
 * opens the usage popover; the "Sidebar usage" switch hides both.
 */
export const QuotaFooter = (props: { readonly wide: boolean; readonly onOpenUsageHistory: () => void }): JSX.Element | null => {
  const { footerButton } = usePreferences()
  const arrangement = useUsageLayout()
  const [open, setOpen] = useState(false)
  const { usage, refreshing, failed, refresh } = useAccountsUsage({ enabled: footerButton })
  const now = useNow()
  const stripRef = useRef<HTMLDivElement>(null)
  const { markerRef, host } = useStripHost(footerButton && props.wide)

  if (!footerButton) return null
  const items = stripItems(usage, arrangement.layout)
  const shownIds = items.map(item => item.instanceId)
  const label = items.length === 0 ? 'AI accounts usage' : `AI accounts usage. ${items.map(item => describeItem(item, now)).join('. ')}`

  const content = (
    <PopoverContent
      align="start"
      className="dshx-root dshx:w-[min(400px,calc(100vw-16px))] dshx:p-0"
      collisionPadding={8}
      onInteractOutside={event => {
        if (event.target instanceof Node && stripRef.current?.contains(event.target) === true) event.preventDefault()
      }}
      side="top"
      sideOffset={8}
    >
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
  )

  if (!props.wide) {
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
            {critical === undefined ? <ChartColumnIcon className="dshx:size-4 dshx:shrink-0" /> : <SummaryItem item={critical} now={now} />}
          </button>
        </PopoverTrigger>
        {content}
      </Popover>
    )
  }

  const strip = (
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
          <ArrangeableAccount arrangement={arrangement} direction="row" id={item.instanceId} key={item.instanceId} name={item.displayName} shownIds={shownIds}>
            <button
              aria-expanded={open}
              aria-label={describeItem(item, now)}
              className={cn(meterButtonClass, open && 'dshx:text-foreground')}
              onClick={() => setOpen(current => !current)}
              title={describeItem(item, now)}
              type="button"
            >
              <SummaryItem item={item} now={now} />
            </button>
          </ArrangeableAccount>
        ))
      )}
    </div>
  )

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <span hidden ref={markerRef} />
      {host === null ? <PopoverAnchor asChild>{strip}</PopoverAnchor> : createPortal(<PopoverAnchor asChild>{strip}</PopoverAnchor>, host)}
      {content}
    </Popover>
  )
}
