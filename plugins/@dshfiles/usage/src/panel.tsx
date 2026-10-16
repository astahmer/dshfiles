import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import { z } from 'zod'
import { purposeSchema, usageApi } from './api.js'
import { UsageCharts } from './charts.js'
import { REQUEST_PURPOSES, type RequestPurpose } from './fold.js'
import { UsageFormattingModel, type OpenThread } from './format.js'
import { RequestLog } from './request-log.js'

const DAY_MS = 86_400_000

const preferencesSchema = z.object({
  tab: z.enum(['log', 'charts']).catch('log'),
  preset: z.enum(['today', '7d', '30d', 'custom']).catch('7d'),
  customFrom: z.string().catch(''),
  customTo: z.string().catch(''),
  bucket: z.enum(['hour', 'day']).catch('day'),
  groupBy: z.enum(['model', 'provider', 'project']).catch('model'),
  purposes: z.array(purposeSchema).catch([]),
})

type Preferences = z.infer<typeof preferencesSchema>

const DEFAULT_PREFERENCES: Preferences = { tab: 'log', preset: '7d', customFrom: '', customTo: '', bucket: 'day', groupBy: 'model', purposes: [] }

const storedPreferences = createStoredValue({ key: 'dshfiles-usage:view.v1', schema: preferencesSchema, fallback: DEFAULT_PREFERENCES })

const startOfDay = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const dateInputValue = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const parseDateInput = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match === null ? null : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
}

/** A half-open `[from, to)` range in ms; the minute-rounded `now` keeps query keys stable between renders. */
const rangeOf = (preferences: Preferences, now: number): { readonly from: number; readonly to: number } => {
  const today = startOfDay(now)
  if (preferences.preset === 'today') return { from: today, to: today + DAY_MS }
  if (preferences.preset === '30d') return { from: today - 29 * DAY_MS, to: today + DAY_MS }
  if (preferences.preset === 'custom') {
    const from = parseDateInput(preferences.customFrom) ?? today - 6 * DAY_MS
    const to = (parseDateInput(preferences.customTo) ?? today) + DAY_MS
    return to > from ? { from, to } : { from: to - DAY_MS, to }
  }
  return { from: today - 6 * DAY_MS, to: today + DAY_MS }
}

const statusKey = ['dshfiles-usage', 'status'] as const

export const UsagePanel = (props: { readonly openThread: OpenThread }): JSX.Element => {
  const api = useApi(usageApi)
  const queryClient = useQueryClient()
  const preferences = storedPreferences.useValue()
  const update = (patch: Partial<Preferences>): void => {
    storedPreferences.set({ ...storedPreferences.get(), ...patch })
  }
  const [logSearch, setLogSearch] = useState('')
  const now = Math.floor(Date.now() / 60_000) * 60_000
  const range = rangeOf(preferences, now)
  const purposes = preferences.purposes.length === 0 ? undefined : preferences.purposes

  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.status({}, { signal: hostSignal }) }),
    refetchInterval: 15_000,
    retry: 1,
  })
  const refresh = useMutation({
    mutationFn: () => runHostRequest({ request: hostSignal => api.refresh({}, { signal: hostSignal }) }),
    onSuccess: status => {
      queryClient.setQueryData(statusKey, status)
      void queryClient.invalidateQueries({ queryKey: ['dshfiles-usage'] })
    },
  })

  const status = statusQuery.data
  const togglePurpose = (purpose: RequestPurpose): void => {
    const current = new Set(preferences.purposes)
    if (current.has(purpose)) current.delete(purpose)
    else current.add(purpose)
    update({ purposes: REQUEST_PURPOSES.filter(item => current.has(item)) })
  }

  return (
    <section className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:overflow-auto dshx:bg-background dshx:p-4 dshx:text-foreground dshx:sm:p-6">
      <header className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <h1 className="dshx:text-lg dshx:font-semibold">Usage analytics</h1>
          <p className="dshx:text-xs dshx:text-muted-foreground">
            Every model request from the session logs, side calls included. Costs are list-price estimates from the models.dev catalog AI Accounts keeps
            {status?.pricingFetchedAt == null
              ? ' (no catalog cached yet)'
              : ` (updated ${UsageFormattingModel.formatAgo(status.pricingFetchedAt, Date.now(), relativeTime)})`}
            ; subscription traffic is priced as if it were metered.
          </p>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
          <span aria-live="polite">
            {status === undefined
              ? 'Connecting…'
              : status.indexing
                ? 'Indexing session logs…'
                : `${status.indexedFiles.toLocaleString()} logs indexed${status.lastIndexedAt === null ? '' : ` · ${UsageFormattingModel.formatAgo(status.lastIndexedAt, Date.now(), relativeTime)}`}`}
          </span>
          <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="Re-index session logs">
            <RefreshCwIcon className={refresh.isPending ? 'dshx:animate-spin' : undefined} /> Refresh
          </Button>
        </div>
      </header>
      {status?.lastError == null ? null : <p className="dshx:text-xs dshx:text-destructive">Indexing failed: {status.lastError}</p>}
      {refresh.isError ? <p className="dshx:text-xs dshx:text-destructive">{errorMessage(refresh.error, 'Re-indexing failed.')}</p> : null}

      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2" role="group" aria-label="Date range">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={preferences.preset}
          onValueChange={value => {
            const preset = z.enum(['today', '7d', '30d', 'custom']).safeParse(value)
            if (!preset.success) return
            update({
              preset: preset.data,
              bucket: preset.data === 'today' ? 'hour' : preferences.bucket === 'hour' && preferences.preset === 'today' ? 'day' : preferences.bucket,
              ...(preset.data === 'custom' && preferences.customFrom === ''
                ? { customFrom: dateInputValue(range.from), customTo: dateInputValue(range.to - DAY_MS) }
                : {}),
            })
          }}
        >
          <ToggleGroupItem value="today">Today</ToggleGroupItem>
          <ToggleGroupItem value="7d">7 d</ToggleGroupItem>
          <ToggleGroupItem value="30d">30 d</ToggleGroupItem>
          <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
        </ToggleGroup>
        {preferences.preset === 'custom' ? (
          <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs">
            <Input
              type="date"
              aria-label="From date"
              className="dshx:h-7 dshx:w-36"
              value={preferences.customFrom}
              onChange={event => update({ customFrom: event.target.value })}
            />
            <span aria-hidden>→</span>
            <Input
              type="date"
              aria-label="To date"
              className="dshx:h-7 dshx:w-36"
              value={preferences.customTo}
              onChange={event => update({ customTo: event.target.value })}
            />
          </span>
        ) : null}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Group by time"
          value={preferences.bucket}
          onValueChange={value => {
            if (value === 'hour' || value === 'day') update({ bucket: value })
          }}
        >
          <ToggleGroupItem value="hour">Hourly</ToggleGroupItem>
          <ToggleGroupItem value="day">Daily</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5" role="group" aria-label="Purpose">
        <span className="dshx:text-xs dshx:text-muted-foreground">Purpose</span>
        <Button
          size="xs"
          variant={purposes === undefined ? 'secondary' : 'ghost'}
          aria-pressed={purposes === undefined}
          onClick={() => update({ purposes: [] })}
        >
          All
        </Button>
        {REQUEST_PURPOSES.map(purpose => (
          <Button
            key={purpose}
            size="xs"
            variant={preferences.purposes.includes(purpose) ? 'secondary' : 'ghost'}
            aria-pressed={preferences.purposes.includes(purpose)}
            onClick={() => togglePurpose(purpose)}
          >
            {UsageFormattingModel.purposeLabels[purpose]}
          </Button>
        ))}
      </div>

      <Tabs value={preferences.tab} onValueChange={value => update({ tab: value === 'charts' ? 'charts' : 'log' })} className="dshx:min-h-0 dshx:flex-1">
        <TabsList>
          <TabsTrigger value="log">Request log</TabsTrigger>
          <TabsTrigger value="charts">Charts</TabsTrigger>
        </TabsList>
        <TabsContent value="log" className="dshx:min-h-0">
          <RequestLog range={range} purposes={purposes} search={logSearch} onSearch={setLogSearch} openThread={props.openThread} />
        </TabsContent>
        <TabsContent value="charts">
          <UsageCharts
            range={range}
            purposes={purposes}
            bucket={preferences.bucket}
            groupBy={preferences.groupBy}
            onGroupBy={groupBy => update({ groupBy })}
            onShowRequests={search => {
              setLogSearch(search)
              update({ tab: 'log' })
            }}
            openThread={props.openThread}
          />
        </TabsContent>
      </Tabs>
    </section>
  )
}
