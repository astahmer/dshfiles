import { useApi } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
import { useQuery } from '@dshfiles/plugin-ui/query'
import type { TurnUsageCostOwnerProps } from '@dshfiles/chat/turn-usage-cost'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { CostEstimateModel, SESSION_COST_PROJECTION_KEY, sessionCostViewSchema } from './cost-estimate.js'
import { usePreferences } from './use-preferences.js'

/** Render an exact, turn-local list-price estimate when the Host projection and pricing are available. */
export const TurnCostEstimate = (props: TurnUsageCostOwnerProps): JSX.Element | null => {
  const { costEstimates } = usePreferences()
  if (!costEstimates) return null
  return <TurnCostEstimateReadout {...props} />
}

const TurnCostEstimateReadout = ({ turn, useProjection }: TurnUsageCostOwnerProps): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const { pricingOverrides } = usePreferences()
  const raw = useProjection(SESSION_COST_PROJECTION_KEY)
  const view = useMemo(() => {
    const parsed = sessionCostViewSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, [raw])
  const groups = view?.turns?.find(candidate => candidate.turn === turn)?.groups ?? (view?.turn?.turn === turn ? view.turn.groups : undefined)
  const routes = useMemo(() => {
    const unique = new Map((groups ?? []).map(group => [CostEstimateModel.routeKey(group), { provider: group.provider, model: group.model }]))
    return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, route]) => route)
  }, [groups])
  const quotesQuery = useQuery({
    ...aiAccountsQueries.routeQuotes(accounts, { routes, overrides: pricingOverrides }),
    enabled: groups !== undefined && routes.length > 0,
  })
  const quotes = quotesQuery.data
  const estimate = useMemo(() => {
    if (groups === undefined || quotes === undefined || quotes === null) return null
    const quoteMap = new Map(quotes.quotes.map(quote => [CostEstimateModel.routeKey(quote), quote]))
    return CostEstimateModel.estimateCost({ groups, quotes: quoteMap })
  }, [groups, quotes])

  if (estimate === null || !estimate.priced) return null
  return <>{CostEstimateModel.formatEstimate(estimate)}</>
}
