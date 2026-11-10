import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@dshfiles/plugin-ui/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CoinsIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import type { SessionUsageCostOwnerProps } from '@dshfiles/chat/session-usage-cost'
import { useMemo } from 'react'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { CostEstimateModel, SESSION_COST_PROJECTION_KEY, sessionCostViewSchema } from './cost-estimate.js'
import { AiAccountsSchema } from './effect-schema.js'
import { fetchedAgo } from './pricing-status.js'
import { usePreferences } from './use-preferences.js'

/** What the composer's projection hook hands over before `sessionCostViewSchema` decodes it. */
type ProjectionSnapshot = typeof sessionCostViewSchema.Encoded

type ProjectionHook = (key: string) => ProjectionSnapshot | undefined

const isProjectionHook = (value: unknown): value is ProjectionHook => typeof value === 'function'

const compactTokens = (tokens: number): string =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1)}k` : String(tokens)

const MATCH_LABEL = {
  override: 'override',
  exact: 'models.dev',
  fuzzy: 'models.dev, closest id',
  none: 'no price',
}

/**
 * The estimated session cost as its own dock entry beside the composer's token stats (`separate` placement).
 *
 * The composer supplies `useProjection` to every dock entry; an older composer
 * that does not, or a Host without the cost projection or the quote method,
 * renders nothing rather than a guess.
 */
export const SessionCostDockEntry = (props: { readonly useProjection?: unknown }): JSX.Element | null => {
  const { costEstimates, costPlacement } = usePreferences()
  if (!costEstimates || costPlacement !== 'separate' || !isProjectionHook(props.useProjection)) return null
  return <SessionCostReadout useProjection={props.useProjection} />
}

/**
 * The estimate inside Chat's usage pill (`inside` placement): after its label, and beside each bucket of its dialog.
 * Chat renders one contribution per placement; each reads the same quote cache.
 */
export const SessionUsageCost = (props: SessionUsageCostOwnerProps): JSX.Element | null => {
  const { costEstimates, costPlacement } = usePreferences()
  if (!costEstimates || costPlacement !== 'inside') return null
  return <SessionUsageCostAmount placement={props.placement} useProjection={props.useProjection} />
}

const SessionUsageCostAmount = (props: SessionUsageCostOwnerProps): JSX.Element | null => {
  const { session } = useSessionCostEstimate(props.useProjection)
  if (session === null || !session.priced) return null
  if (props.placement === 'pill') return <span data-ai-accounts-session-cost="">{` · ${CostEstimateModel.formatEstimate(session)}`}</span>
  const bucket = { input: session.cost.input, cacheRead: session.cost.cacheRead, cacheWrite: session.cost.cacheWrite, output: session.cost.output }[
    props.placement
  ]
  return (
    <span className="dshx:ml-1.5 dshx:inline-block dshx:min-w-14 dshx:text-right dshx:font-medium" data-ai-accounts-session-cost="">
      {CostEstimateModel.formatUsd(bucket)}
    </span>
  )
}

const useSessionCostEstimate = (useProjection: ProjectionHook) => {
  const accounts = useApi(aiAccountsApi)
  const { pricingOverrides } = usePreferences()
  const raw = useProjection(SESSION_COST_PROJECTION_KEY)
  const view = useMemo(() => {
    const parsed = AiAccountsSchema.decodeResult(sessionCostViewSchema, raw)
    return parsed._tag === 'Success' ? parsed.success : null
  }, [raw])
  const routes = useMemo(() => {
    const unique = new Map((view?.groups ?? []).map(group => [CostEstimateModel.routeKey(group), { provider: group.provider, model: group.model }]))
    return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, route]) => route)
  }, [view])
  const quotesQuery = useQuery({ ...aiAccountsQueries.routeQuotes(accounts, { routes, overrides: pricingOverrides }), enabled: routes.length > 0 })
  const quotes = quotesQuery.data
  const quoteMap = useMemo(() => new Map((quotes?.quotes ?? []).map(quote => [CostEstimateModel.routeKey(quote), quote])), [quotes])

  const session = useMemo(
    () => (view === null || quotes === undefined || quotes === null ? null : CostEstimateModel.estimateCost({ groups: view.groups, quotes: quoteMap })),
    [quoteMap, quotes, view],
  )
  return { view, quotes, quoteMap, quotesQuery, session }
}

const SessionCostReadout = (props: { readonly useProjection: ProjectionHook }): JSX.Element | null => {
  const { view, quotes, quoteMap, quotesQuery, session } = useSessionCostEstimate(props.useProjection)
  const turn = useMemo(
    () => (session === null || view === null || view.turn === null ? null : CostEstimateModel.estimateCost({ groups: view.turn.groups, quotes: quoteMap })),
    [quoteMap, session, view],
  )
  if (session === null || !session.priced || quotes === undefined || quotes === null) return null
  const fetchedAt = quotes.fetchedAt

  return (
    <HoverCard closeDelay={80} openDelay={150}>
      <HoverCardTrigger asChild>
        <button
          aria-label={`Estimated thread cost ${CostEstimateModel.formatEstimate(session)}`}
          className="dshx-root dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-full dshx:px-2 dshx:py-px dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:tabular-nums dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
          type="button"
        >
          <CoinsIcon className="dshx:size-3.5 dshx:shrink-0" />
          {CostEstimateModel.formatEstimate(session)}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="center" className="dshx-root dshx:flex dshx:w-80 dshx:flex-col dshx:gap-3 dshx:p-3 dshx:text-xs" side="top">
        <header className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
          <span className="dshx:font-semibold">Estimated thread cost</span>
          <span className="dshx:font-semibold dshx:tabular-nums">{CostEstimateModel.formatEstimate(session)}</span>
        </header>
        <dl className="dshx:grid dshx:grid-cols-[1fr_auto_auto] dshx:gap-x-3 dshx:gap-y-1 dshx:tabular-nums">
          {(
            [
              ['Input', session.tokens.uncachedInputTokens, session.cost.input],
              ['Output', session.tokens.outputTokens, session.cost.output],
              ['Cache read', session.tokens.cacheReadTokens, session.cost.cacheRead],
              ['Cache write', session.tokens.cacheWriteTokens, session.cost.cacheWrite],
            ] as const
          )
            .filter(([, tokens]) => tokens > 0)
            .map(([label, tokens, cost]) => (
              <div className="dshx:contents" key={label}>
                <dt className="dshx:text-muted-foreground">{label}</dt>
                <dd className="dshx:text-right dshx:text-muted-foreground">{compactTokens(tokens)} tok</dd>
                <dd className="dshx:text-right">{CostEstimateModel.formatUsd(cost)}</dd>
              </div>
            ))}
          {turn === null || !turn.priced ? null : (
            <div className="dshx:contents">
              <dt className="dshx:text-muted-foreground">Last turn</dt>
              <dd />
              <dd className="dshx:text-right">{CostEstimateModel.formatEstimate(turn)}</dd>
            </div>
          )}
        </dl>
        <TooltipProvider delayDuration={500}>
          <ul className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-t dshx:border-border dshx:pt-2">
            {session.routes.map(route => (
              <li className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2" key={CostEstimateModel.routeKey(route)}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="dshx:min-w-0 dshx:truncate">
                      {route.provider}/{route.model}
                      <span className="dshx:text-muted-foreground">
                        {' · '}
                        {route.free ? 'free' : MATCH_LABEL[route.match]}
                      </span>
                    </span>
                  </TooltipTrigger>
                  {route.modelsDevId === null ? null : <TooltipContent>{route.modelsDevId}</TooltipContent>}
                </Tooltip>
                <span className="dshx:shrink-0 dshx:tabular-nums">{route.cost === null ? '—' : CostEstimateModel.formatUsd(route.cost.total)}</span>
              </li>
            ))}
          </ul>
        </TooltipProvider>
        <p className="dshx:text-muted-foreground">
          Estimate from published API prices (models.dev{fetchedAt === null ? '' : `, ${fetchedAgo(relativeTime(fetchedAt, quotesQuery.dataUpdatedAt))}`}), not
          an invoice.
          {session.partial ? ' Routes without a price are left out.' : ''}
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}
