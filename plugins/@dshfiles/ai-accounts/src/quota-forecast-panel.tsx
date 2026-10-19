import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader } from '@dshfiles/plugin-ui/components/ui/empty'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { ChevronLeftIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useQueries } from '@dshfiles/plugin-ui/query'
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

type View = 'forecast' | 'pace' | 'table' | 'coverage' | 'handoff'

/**
 * Where each account's quota is heading at the current pace, whether accounts
 * of one kind kept covering for each other week by week, and the order to use
 * them in over the coming week. Every view
 * read the stored quota snapshots, so the forecast needs the collector to have
 * run for a while before it says anything.
 */
export const QuotaForecastPanel = (props: { readonly onBack: () => void }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const { usageRefreshMs, workHours } = usePreferences()
  const { usage, refresh, refreshing } = useAccountsUsage()
  const [view, setView] = useState<View>('forecast')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [coverageSelection, setCoverageSelection] = useState<CoverageSelection | null>(null)

  const cards = useMemo(() => (usage?.cards ?? []).filter(card => card.enabled), [usage])
  const histories = useQueries({
    queries: cards.map(card => aiAccountsQueries.forecastHistory(accounts, { instanceId: card.instanceId, refetchInterval: usageRefreshMs })),
  })
  const loading = usage === null || histories.some(history => history.isLoading)
  // The sweep time, not render time: the board is a reading of that moment.
  const now = usage?.readAt ?? 0
  const inputs = cards.map((card, index) => ({
    instanceId: card.instanceId,
    displayName: card.displayName || card.instanceId,
    kind: card.kind,
    usage: card.usage,
    points: histories[index]?.data?.points ?? [],
  }))
  const board = QuotaForecastModel.board({ accounts: inputs, now })
  const pace = QuotaPaceModel.current(board)
  const pointsById = new Map(inputs.map(input => [input.instanceId, input.points]))
  const forecasts = new Map(board.accounts.map(account => [account.instanceId, account]))
  const coverageInputs = inputs.map(input => ({ ...input, forecast: forecasts.get(input.instanceId) }))
  const report = QuotaCoverageModel.report({ accounts: coverageInputs, now, workHours })
  const plans = QuotaCoverageModel.handoffs({ accounts: coverageInputs, now, workHours })

  const headline =
    view === 'coverage'
      ? CoverageBoardView.headline(report)
      : view === 'handoff'
        ? HandoffBoardView.headline(plans, now)
        : view === 'pace'
          ? PaceBoardView.headline(pace, now)
          : ForecastBoardView.headline(board)

  return (
    <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:w-full dshx:flex-col dshx:gap-5 dshx:overflow-auto dshx:px-6 dshx:py-5 dshx:@max-pane-narrow:px-3">
      <Tabs
        className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1500px] dshx:flex-col dshx:gap-5"
        onValueChange={value => setView(value === 'pace' || value === 'table' || value === 'coverage' || value === 'handoff' ? value : 'forecast')}
        value={view}
      >
        <header className="dshx:flex dshx:flex-wrap dshx:items-end dshx:justify-between dshx:gap-4">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:items-start dshx:gap-1">
            <Button className="dshx:-ml-2 dshx:text-muted-foreground" onClick={props.onBack} size="xs" type="button" variant="ghost">
              <ChevronLeftIcon />
              AI Accounts
            </Button>
            <h1 className="dshx:text-xl dshx:font-semibold dshx:tracking-tight">{headline.title}</h1>
            <p className="dshx:text-sm dshx:text-muted-foreground">{headline.subtitle}</p>
          </div>
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <Button disabled={refreshing} onClick={() => void refresh()} size="sm" type="button" variant="ghost">
              {refreshing ? <Spinner /> : <RefreshCwIcon />}
              <span className="dshx:@max-pane-narrow:sr-only">Refresh</span>
            </Button>
            <TabsList>
              <TabsTrigger value="forecast">Forecast</TabsTrigger>
              <TabsTrigger value="pace">Pace</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="coverage">Coverage</TabsTrigger>
              <TabsTrigger value="handoff">Hand-off</TabsTrigger>
            </TabsList>
          </div>
        </header>

        {loading && board.accounts.length === 0 ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
            <Spinner className="dshx:size-3.5" />
            Loading quota history…
          </p>
        ) : board.accounts.length === 0 ? (
          <Empty className="dshx:flex-none dshx:border">
            <EmptyHeader>
              <EmptyDescription>Enable an account with quota to see where it is heading.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <TabsContent value="forecast">
              <ForecastBoardView.Board board={board} onSelect={setSelectedId} selectedId={selectedId} />
            </TabsContent>
            <TabsContent value="pace">
              <PaceBoardView.Board accounts={pace} now={now} pointsById={pointsById} />
            </TabsContent>
            <TabsContent value="table">
              <ForecastBoardView.Table board={board} />
            </TabsContent>
            <TabsContent value="coverage">
              <CoverageBoardView.Board onSelect={setCoverageSelection} report={report} selection={coverageSelection} workHours={workHours} />
            </TabsContent>
            <TabsContent value="handoff">
              <HandoffBoardView.Board now={now} plans={plans} workHours={workHours} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </main>
  )
}
