import { useApi } from '@dshfiles/dshx/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ChevronLeftIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useMemo, useState } from 'react'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { CoverageBoardView, type CoverageSelection } from './quota-coverage-board.js'
import { QuotaCoverageModel } from './quota-coverage-model.js'
import { ForecastBoardView } from './quota-forecast-board.js'
import { HandoffBoardView } from './quota-handoff-board.js'
import { PaceBoardView } from './quota-pace-board.js'
import { QuotaPaceModel } from './quota-pace-model.js'
import { QuotaForecastModel } from './quota-forecast-model.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences } from './use-preferences.js'
import { QuotaViewFrame } from './quota-view-frame.js'

type View = 'forecast' | 'pace' | 'table' | 'coverage' | 'handoff'

/**
 * Where each account's quota is heading at the current pace, whether accounts
 * of one kind kept covering for each other week by week, and the order to use
 * them in over the coming week. Every view
 * read the stored quota snapshots, so the forecast needs the collector to have
 * run for a while before it says anything.
 */
export const QuotaForecastPanel = (props: { readonly onBack: () => void; readonly embedded?: boolean }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const { usageRefreshMs, workHours } = usePreferences()
  const { usage, refresh, refreshing } = useAccountsUsage()
  const [view, setView] = useState<View>('forecast')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [coverageSelection, setCoverageSelection] = useState<CoverageSelection | null>(null)

  const cards = useMemo(() => (usage?.cards ?? []).filter(card => card.enabled), [usage])
  const histories = useQuery(
    aiAccountsQueries.forecastHistories(accounts, { instanceIds: cards.map(card => card.instanceId), refetchInterval: usageRefreshMs }),
  )
  const historiesById = new Map(histories.data?.histories.map(history => [history.instanceId, history.points]))
  const loading = usage === null || (cards.length > 0 && histories.isLoading)
  // The sweep time, not render time: the board is a reading of that moment.
  const now = usage?.readAt ?? 0
  const inputs = cards.map(card => ({
    instanceId: card.instanceId,
    displayName: card.displayName || card.instanceId,
    kind: card.kind,
    usage: card.usage,
    points: historiesById.get(card.instanceId) ?? [],
  }))
  const board = QuotaForecastModel.board({ accounts: inputs, now })
  const pace = QuotaPaceModel.current(board)
  const pointsById = new Map(inputs.map(input => [input.instanceId, input.points]))
  const forecasts = new Map(board.accounts.map(account => [account.instanceId, account]))
  const coverageInputs = inputs.map(input => ({ ...input, forecast: forecasts.get(input.instanceId) }))
  const report = QuotaCoverageModel.report({ accounts: coverageInputs, now, workHours })
  const plans = QuotaCoverageModel.handoffs({ accounts: coverageInputs, now, workHours })

  const headlineByView = {
    forecast: () => ForecastBoardView.headline(board),
    table: () => ForecastBoardView.headline(board),
    pace: () => PaceBoardView.headline(pace, now),
    coverage: () => CoverageBoardView.headline(report),
    handoff: () => HandoffBoardView.headline(plans, now),
  }
  const headline = headlineByView[view]()

  const views: readonly { readonly value: View; readonly label: string }[] = [
    { value: 'forecast', label: 'Forecast' },
    { value: 'pace', label: 'Pace' },
    { value: 'table', label: 'Table' },
    { value: 'coverage', label: 'Coverage' },
    { value: 'handoff', label: 'Hand-off' },
  ]

  return (
    <QuotaViewFrame
      embedded={props.embedded === true}
      heading={headline.title}
      description={headline.subtitle}
      actions={[
        ...(props.embedded === true ? [] : [{ id: 'back', label: 'Accounts', icon: <ChevronLeftIcon aria-hidden />, onSelect: props.onBack }]),
        { id: 'refresh', label: 'Refresh', icon: <RefreshCwIcon aria-hidden />, pending: refreshing, onSelect: () => void refresh() },
      ]}
      tabs={{
        label: 'Forecast views',
        value: view,
        onValueChange: value => setView(value === 'pace' || value === 'table' || value === 'coverage' || value === 'handoff' ? value : 'forecast'),
        items: views,
      }}
      bodyClassName="dshx:mx-auto dshx:w-full dshx:max-w-[1500px]"
    >
      {(() => {
        if (loading && board.accounts.length === 0) {
          return (
            <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
              <Spinner className="dshx:size-3.5" />
              Loading quota history…
            </p>
          )
        }
        if (board.accounts.length === 0) {
          return (
            <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border" action={{ label: 'Open accounts', onSelect: props.onBack }}>
              Enable an account with quota to see where it is heading.
            </EmptyState>
          )
        }
        switch (view) {
          case 'forecast':
            return <ForecastBoardView.Board board={board} onSelect={setSelectedId} selectedId={selectedId} />
          case 'pace':
            return <PaceBoardView.Board accounts={pace} now={now} pointsById={pointsById} />
          case 'table':
            return <ForecastBoardView.Table board={board} />
          case 'coverage':
            return <CoverageBoardView.Board onSelect={setCoverageSelection} report={report} selection={coverageSelection} workHours={workHours} />
          default:
            return <HandoffBoardView.Board now={now} plans={plans} workHours={workHours} />
        }
      })()}
    </QuotaViewFrame>
  )
}
