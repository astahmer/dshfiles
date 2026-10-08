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
import {
  bankedExpiries,
  formatAge,
  formatResetIn,
  overviewCards,
  overviewProviders,
  type OverviewCard,
  type ProviderTab,
} from './usage-overview-model.js'

const useNow = (): number => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
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
  return (
    <article className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3">
      <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <ProviderGlyph className="dshx:size-3.5" kind={props.card.kind} />
        <strong className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-semibold">{props.card.displayName}</strong>
        <span className="dshx:max-w-[45%] dshx:truncate dshx:text-[11px] dshx:text-muted-foreground" title={props.hostName}>
          {props.hostName}
        </span>
      </header>
      {usage.status === 'ok' && usage.windows.length > 0 ? (
        usage.windows.map(window => {
          const tone = quotaTone(window.percentRemaining)
          return (
            <div className="dshx:flex dshx:flex-col dshx:gap-1" key={window.label}>
              <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:text-xs">
                <span className="dshx:truncate dshx:text-muted-foreground">{window.label}</span>
                <strong className={cn('dshx:font-semibold dshx:tabular-nums', QUOTA_TONE_TEXT[tone])}>{Math.round(window.percentRemaining)}% left</strong>
              </div>
              <Progress
                aria-label={`${props.card.displayName} ${window.label} remaining`}
                className={cn('dshx:h-1.5 dshx:bg-muted', QUOTA_TONE_PROGRESS[tone])}
                value={Math.max(0, Math.min(100, window.percentRemaining))}
              />
              <div className="dshx:flex dshx:justify-between dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">
                <span title={window.resetsAt === null ? undefined : new Date(window.resetsAt).toLocaleString()}>{formatResetIn(window.resetsAt, props.now)}</span>
                <span title="Age of this usage snapshot">Age {formatAge(props.readAt, props.now)}</span>
              </div>
            </div>
          )
        })
      ) : (
        <p className="dshx:text-xs dshx:text-muted-foreground">
          {usage.message ?? (usage.status === 'unauthenticated' ? 'Not signed in.' : usage.status === 'ok' ? 'No quota windows reported.' : 'Usage is not available.')}
        </p>
      )}
      {usage.bankedResets > 0 ? <BankedResets count={usage.bankedResets} expiries={usage.bankedResetExpiries} /> : null}
    </article>
  )
}

/**
 * The usage popover body, shared by the sidebar footer button and the edge
 * overlay: provider tabs, history and refresh actions, then one card per
 * enabled account.
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
  const cards = overviewCards(props.usage, activeTab)
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
        ) : cards.length === 0 ? (
          <p className="dshx:p-2 dshx:text-xs dshx:text-muted-foreground">No enabled account for this provider.</p>
        ) : (
          cards.map(card => <AccountUsageCard card={card} hostName={props.usage?.hostName ?? ''} key={card.instanceId} now={now} readAt={props.usage?.readAt ?? now} />)
        )}
      </div>
    </section>
  )
}
