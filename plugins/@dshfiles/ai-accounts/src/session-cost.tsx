import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@dshfiles/plugin-ui/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CoinsIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef } from 'react'
import type { z } from 'zod'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { CostEstimateModel, SESSION_COST_PROJECTION_KEY, sessionCostViewSchema, type CostEstimate } from './cost-estimate.js'
import { fetchedAgo } from './pricing-status.js'
import { SessionCostDisplay, sessionCostDockScope } from './session-cost-display.js'
import { usePreferences } from './use-preferences.js'

/** What the composer's projection hook hands over before `sessionCostViewSchema` decodes it. */
type ProjectionSnapshot = z.input<typeof sessionCostViewSchema>

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

const amountText = (estimate: CostEstimate): string => `${estimate.partial ? '≥' : '≈'}${CostEstimateModel.formatUsd(estimate.cost.total)}`

/**
 * The estimated session cost beside the composer's own token stats.
 *
 * The composer supplies `useProjection` to every dock entry; an older composer
 * that does not, or a Host without the cost projection or the quote method,
 * renders nothing rather than a guess.
 */
export const SessionCostDockEntry = (props: { readonly useProjection?: unknown }): JSX.Element | null => {
  const { costEstimates } = usePreferences()
  if (!costEstimates || !isProjectionHook(props.useProjection)) return null
  return <SessionCostReadout useProjection={props.useProjection} />
}

const SessionCostReadout = (props: { readonly useProjection: ProjectionHook }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const { costPlacement, pricingOverrides } = usePreferences()
  const markerRef = useRef<HTMLSpanElement | null>(null)
  const displayRef = useRef<SessionCostDisplay | null>(null)
  const raw = props.useProjection(SESSION_COST_PROJECTION_KEY)
  const view = useMemo(() => {
    const parsed = sessionCostViewSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
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
  const turn = useMemo(
    () => (session === null || view === null || view.turn === null ? null : CostEstimateModel.estimateCost({ groups: view.turn.groups, quotes: quoteMap })),
    [quoteMap, session, view],
  )
  const inlineValue = useMemo(
    () =>
      session === null || !session.priced
        ? undefined
        : {
            amount: amountText(session),
            description: `Estimated session cost ${amountText(session)}. Estimate from published API prices, not an invoice.`,
            rows: [
              ...(session.tokens.uncachedInputTokens + session.tokens.cacheReadTokens + session.tokens.cacheWriteTokens > 0
                ? [{ tokens: undefined, amount: undefined }]
                : []),
              { tokens: session.tokens.uncachedInputTokens, amount: CostEstimateModel.formatUsd(session.cost.input) },
              { tokens: session.tokens.cacheReadTokens, amount: CostEstimateModel.formatUsd(session.cost.cacheRead) },
              ...(session.tokens.cacheWriteTokens > 0
                ? [{ tokens: session.tokens.cacheWriteTokens, amount: CostEstimateModel.formatUsd(session.cost.cacheWrite) }]
                : []),
              { tokens: session.tokens.outputTokens, amount: CostEstimateModel.formatUsd(session.cost.output) },
            ],
          },
    [session],
  )
  const hasInlineValue = inlineValue !== undefined

  useEffect(() => {
    if (costPlacement !== 'inside' || !hasInlineValue || typeof document === 'undefined') return
    const display = new SessionCostDisplay(document, () => sessionCostDockScope(markerRef.current))
    displayRef.current = display
    display.start()
    return () => {
      displayRef.current = null
      display.dispose()
    }
  }, [costPlacement, hasInlineValue])

  useEffect(() => {
    displayRef.current?.sync(inlineValue)
  }, [inlineValue])

  if (session === null || !session.priced || quotes === undefined || quotes === null) return null
  if (costPlacement === 'inside') return <span ref={markerRef} style={{ display: 'none' }} />
  const fetchedAt = quotes.fetchedAt

  return (
    <HoverCard closeDelay={80} openDelay={150}>
      <HoverCardTrigger asChild>
        <button
          aria-label={`Estimated session cost ${amountText(session)}`}
          className="dshx-root dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-full dshx:px-2 dshx:py-px dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:tabular-nums dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
          type="button"
        >
          <CoinsIcon className="dshx:size-3.5 dshx:shrink-0" />
          {amountText(session)}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="center" className="dshx-root dshx:flex dshx:w-80 dshx:flex-col dshx:gap-3 dshx:p-3 dshx:text-xs" side="top">
        <header className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
          <span className="dshx:font-semibold">Estimated session cost</span>
          <span className="dshx:font-semibold dshx:tabular-nums">{amountText(session)}</span>
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
              <dd className="dshx:text-right">{amountText(turn)}</dd>
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
