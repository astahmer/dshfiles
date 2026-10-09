import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { ChevronDownIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useState } from 'react'
import { KIND_GROUPS, KIND_LABEL } from './account-labels.js'
import type { AccountsUsage } from './api.js'
import { ProviderGlyph } from './provider-glyph.js'
import { QUOTA_TONE_PROGRESS, QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { ArrangeableAccount, useUsageLayout, type UsageArrangement } from './usage-arrangement.js'
import {
  bankedExpiries,
  formatAge,
  formatResetIn,
  isCardLimited,
  isExhausted,
  overviewProviders,
  overviewSections,
  reserveInUse,
  type OverviewCard,
  type ProviderTab,
} from './usage-overview-model.js'

/** Ticks every second while the page is visible; a hidden tab stops re-rendering and catches up on return. */
export const useNow = (): number => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = (): void => {
      clearInterval(timer)
      timer = undefined
      if (document.hidden) return
      setNow(Date.now())
      timer = setInterval(() => setNow(Date.now()), 1_000)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return now
}

const BankedResets = (props: { readonly count: number; readonly expiries: readonly (number | null)[] }): JSX.Element => {
  const ordered = bankedExpiries(props.expiries)
  const earliest = ordered[0]
  return (
    <Collapsible>
      <CollapsibleTrigger className="dshx:group dshx:flex dshx:max-w-full dshx:items-center dshx:gap-1 dshx:text-left dshx:text-[11px] dshx:text-info dshx:outline-none dshx:focus-visible:underline">
        <span className="dshx:truncate">
          ▣ {String(props.count)} banked reset{props.count === 1 ? '' : 's'}
          {earliest === undefined || earliest === null ? '' : ` · earliest expires ${new Date(earliest).toLocaleString()}`}
        </span>
        <ChevronDownIcon className="dshx:size-3 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform dshx:group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="dshx:mt-1.5 dshx:flex dshx:flex-col dshx:gap-1 dshx:pl-4 dshx:text-[11px]">
          {Array.from({ length: props.count }, (_, index) => {
            const expiry = ordered[index]
            return (
              <li key={index}>
                Reset {String(index + 1)} · {expiry === undefined || expiry === null ? 'no reported expiry' : `expires ${new Date(expiry).toLocaleString()}`}
              </li>
            )
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

const AccountUsageCard = (props: { readonly card: OverviewCard; readonly hostName: string; readonly readAt: number; readonly now: number }): JSX.Element => {
  const usage = props.card.usage
  const limited = usage.status === 'ok' && isCardLimited(usage.windows)
  const onReserve = usage.status === 'ok' && reserveInUse(usage.windows) !== undefined
  return (
    <article
      className={cn(
        'dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3',
        limited && 'dshx:border-destructive/50 dshx:bg-destructive/5',
      )}
    >
      <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <ProviderGlyph className="dshx:size-3.5" kind={props.card.kind} />
        <strong className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-semibold">{props.card.displayName}</strong>
        {limited ? (
          <Badge className="dshx:h-5 dshx:px-1.5 dshx:text-[10px]" variant="destructive">
            Limit reached
          </Badge>
        ) : onReserve ? (
          <Badge
            className="dshx:h-5 dshx:bg-info/15 dshx:px-1.5 dshx:text-[10px] dshx:text-info"
            title="The weekly limit is spent; Codex requests draw on Luna Reserve."
            variant="secondary"
          >
            On Luna Reserve
          </Badge>
        ) : null}
        <span className="dshx:max-w-[45%] dshx:truncate dshx:text-[11px] dshx:text-muted-foreground" title={props.hostName}>
          {props.hostName}
        </span>
      </header>
      {usage.windows.map(window => {
        const tone = quotaTone(window.percentRemaining)
        const spent = isExhausted(window.percentRemaining)
        const resetLabel = window.reserve === true ? 'Reserve refills' : null
        return (
          <div className="dshx:flex dshx:flex-col dshx:gap-1" key={window.label}>
            <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:text-xs">
              <span className={cn('dshx:truncate', spent ? 'dshx:font-medium dshx:text-destructive' : 'dshx:text-muted-foreground')}>{window.label}</span>
              <strong className={cn('dshx:font-semibold dshx:tabular-nums', QUOTA_TONE_TEXT[tone])}>
                {spent ? '0% left · limit reached' : `${String(Math.round(window.percentRemaining))}% left`}
              </strong>
            </div>
            <Progress
              aria-label={`${props.card.displayName} ${window.label} remaining`}
              className={cn('dshx:h-1.5 dshx:bg-muted', QUOTA_TONE_PROGRESS[tone])}
              value={Math.max(0, Math.min(100, window.percentRemaining))}
            />
            <div className="dshx:flex dshx:justify-between dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">
              <span
                className={spent ? 'dshx:font-semibold dshx:text-destructive' : undefined}
                title={window.resetsAt === null ? undefined : new Date(window.resetsAt).toLocaleString()}
              >
                {resetLabel === null ? formatResetIn(window.resetsAt, props.now) : `${resetLabel} · ${formatResetIn(window.resetsAt, props.now)}`}
              </span>
              <span title="Age of this usage snapshot">Age {formatAge(props.readAt, props.now)}</span>
            </div>
          </div>
        )
      })}
      {usage.bankedResets > 0 ? <BankedResets count={usage.bankedResets} expiries={usage.bankedResetExpiries} /> : null}
      {limited && usage.bankedResets > 0 && props.card.kind === 'codex' ? (
        <p className="dshx:text-[11px] dshx:text-muted-foreground">Spend a banked reset with “Reset usage” in the Codex app; it is not used automatically.</p>
      ) : null}
    </article>
  )
}

const unavailableReason = (card: OverviewCard): string =>
  card.usage.message ??
  (card.usage.status === 'unauthenticated' ? 'Not signed in.' : card.usage.status === 'ok' ? 'No quota windows reported.' : 'Usage is not available.')

/** One collapsed line for accounts the popover leaves out: no quota data, or hidden by the user. */
const HiddenAccounts = (props: {
  readonly unavailable: readonly OverviewCard[]
  readonly hidden: readonly OverviewCard[]
  readonly arrangement: UsageArrangement
}): JSX.Element | null => {
  const count = props.unavailable.length + props.hidden.length
  if (count === 0) return null
  const reasons = [
    props.unavailable.length > 0 ? `${String(props.unavailable.length)} without quota data` : null,
    props.hidden.length > 0 ? `${String(props.hidden.length)} hidden by you` : null,
  ].filter(reason => reason !== null)
  return (
    <Collapsible className="dshx:shrink-0 dshx:border-t dshx:px-3 dshx:py-1.5">
      <CollapsibleTrigger className="dshx:group dshx:flex dshx:w-full dshx:items-center dshx:gap-1 dshx:text-left dshx:text-[11px] dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:underline">
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
          {String(count)} hidden ({reasons.join(', ')})
        </span>
        <ChevronDownIcon className="dshx:size-3 dshx:shrink-0 dshx:transition-transform dshx:group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="dshx:mt-1.5 dshx:flex dshx:max-h-40 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto">
          {props.unavailable.map(card => (
            <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-xs" key={card.instanceId}>
              <ProviderGlyph className="dshx:size-3.5" kind={card.kind} />
              <span className="dshx:shrink-0 dshx:font-medium">{card.displayName}</span>
              <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground" title={unavailableReason(card)}>
                {unavailableReason(card)}
              </span>
            </li>
          ))}
          {props.hidden.map(card => (
            <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-xs" key={card.instanceId}>
              <ProviderGlyph className="dshx:size-3.5" kind={card.kind} />
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-medium">{card.displayName}</span>
              <Button
                className="dshx:h-5 dshx:px-1.5 dshx:text-[11px]"
                onClick={() => props.arrangement.show(card.instanceId)}
                size="xs"
                type="button"
                variant="ghost"
              >
                Show
              </Button>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The usage popover body, shared by the sidebar footer button and the edge
 * overlay: provider tabs, history and refresh actions, one card per enabled
 * account with quota in the user's order, then the ones it leaves out.
 */
export const UsageOverview = (props: {
  readonly usage: AccountsUsage | null
  readonly failed: boolean
  readonly refreshing: boolean
  readonly onRefresh: () => void
  readonly onOpenHistory: () => void
}): JSX.Element => {
  const [tab, setTab] = useState<ProviderTab>('all')
  const now = useNow()
  const providers = overviewProviders(props.usage)
  const activeTab = tab !== 'all' && !providers.includes(tab) ? 'all' : tab
  const arrangement = useUsageLayout()
  const sections = overviewSections(props.usage, activeTab, arrangement.layout)
  const shownIds = sections.cards.map(card => card.instanceId)
  return (
    <section aria-label="AI account usage" className="dshx-root dshx:flex dshx:max-h-[min(640px,75vh)] dshx:min-h-0 dshx:flex-col">
      <header className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:border-b dshx:px-2 dshx:py-1.5">
        <ToggleGroup
          aria-label="Provider"
          className="dshx:min-w-0 dshx:overflow-x-auto"
          onValueChange={value => {
            const next = KIND_GROUPS.find(kind => kind === value)
            setTab(next ?? 'all')
          }}
          size="sm"
          type="single"
          value={activeTab}
        >
          <ToggleGroupItem className="dshx:px-2 dshx:text-xs" value="all">
            All
          </ToggleGroupItem>
          {providers.map(kind => (
            <ToggleGroupItem aria-label={KIND_LABEL[kind]} className="dshx:px-1.5" key={kind} title={KIND_LABEL[kind]} value={kind}>
              <ProviderGlyph kind={kind} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button className="dshx:ml-auto dshx:shrink-0 dshx:text-xs" onClick={props.onOpenHistory} size="xs" type="button" variant="ghost">
          Open usage history
        </Button>
        <Button
          aria-label={props.refreshing ? 'Refreshing usage' : 'Refresh usage'}
          className="dshx:shrink-0"
          disabled={props.refreshing}
          onClick={props.onRefresh}
          size="icon-xs"
          title="Refresh usage"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon className={props.refreshing ? 'dshx:animate-spin' : undefined} />
        </Button>
      </header>
      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-2 dshx:overflow-y-auto dshx:overscroll-contain dshx:p-2">
        {props.usage === null ? (
          <p className="dshx:p-2 dshx:text-xs dshx:text-muted-foreground">{props.failed ? 'The account host did not answer.' : 'Reading usage…'}</p>
        ) : sections.cards.length === 0 ? (
          <p className="dshx:p-2 dshx:text-xs dshx:text-muted-foreground">
            {sections.unavailable.length + sections.hidden.length === 0 ? 'No enabled account for this provider.' : 'No account with quota to show.'}
          </p>
        ) : (
          sections.cards.map(card => (
            <ArrangeableAccount
              arrangement={arrangement}
              className="dshx:rounded-lg dshx:outline-none dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
              direction="column"
              focusable
              id={card.instanceId}
              key={card.instanceId}
              name={card.displayName}
              shownIds={shownIds}
            >
              <AccountUsageCard card={card} hostName={props.usage?.hostName ?? ''} now={now} readAt={props.usage?.readAt ?? now} />
            </ArrangeableAccount>
          ))
        )}
      </div>
      {props.usage === null ? null : <HiddenAccounts arrangement={arrangement} hidden={sections.hidden} unavailable={sections.unavailable} />}
    </section>
  )
}
