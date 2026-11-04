import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Page } from '@dshfiles/plugin-ui/components/page'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { Effect, Option } from 'effect'
import type * as SchemaTypes from 'effect/Schema'
import * as Schema from 'effect/Schema'
import { useState } from 'react'
import { purposeSchema, usageApi } from './api.js'
import { UsageCharts } from './charts.js'
import { UsageFoldModel, type RequestPurpose } from './fold.js'
import { UsageFormattingModel, type OpenThread } from './format.js'
import { RequestLog } from './request-log.js'
import { UsageToolsTab } from './tools-tab.js'

const PRESETS = ['today', '7d', '30d', '365d', 'custom'] as const

/** A stored view preference keeps the value it had when one field is stale, the rule `.catch(...)` carried. */
const withFallback = <ValueSchema extends SchemaTypes.Top>(schema: ValueSchema, fallback: ValueSchema['Type']) =>
  schema.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback))))

const preferencesSchema = Schema.Struct({
  tab: withFallback(Schema.Literals(['log', 'charts', 'activity']), 'log'),
  preset: withFallback(Schema.Literals(PRESETS), '7d'),
  customFrom: withFallback(Schema.String, ''),
  customTo: withFallback(Schema.String, ''),
  bucket: withFallback(Schema.Literals(['hour', 'day']), 'day'),
  groupBy: withFallback(Schema.Literals(['model', 'provider', 'project', 'purpose']), 'model'),
  purposes: withFallback(Schema.Array(purposeSchema), []),
})

type Preferences = typeof preferencesSchema.Type

const DEFAULT_PREFERENCES: Preferences = { tab: 'log', preset: '7d', customFrom: '', customTo: '', bucket: 'day', groupBy: 'model', purposes: [] }
type UsageDateRange = { readonly from: number; readonly to: number }

const storedPreferences = createStoredValue({
  key: 'dshfiles-usage:view.v1',
  schema: preferencesSchema,
  fallback: DEFAULT_PREFERENCES,
})

const startOfDay = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const moveDays = (at: number, days: number): number => {
  const date = new Date(at)
  date.setDate(date.getDate() + days)
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

/** A half-open `[from, to)` range in ms; it snaps to day boundaries, so query keys stay stable between renders. */
const rangeOf = (preferences: Preferences, now: number): UsageDateRange => {
  const today = startOfDay(now)
  const tomorrow = moveDays(today, 1)
  if (preferences.preset === 'today') return { from: today, to: tomorrow }
  if (preferences.preset === '30d') return { from: moveDays(today, -29), to: tomorrow }
  if (preferences.preset === '365d') return { from: moveDays(today, -364), to: tomorrow }
  if (preferences.preset === 'custom') {
    const from = parseDateInput(preferences.customFrom) ?? moveDays(today, -6)
    const to = moveDays(parseDateInput(preferences.customTo) ?? today, 1)
    return to > from ? { from, to } : { from: moveDays(to, -1), to }
  }
  return { from: moveDays(today, -6), to: tomorrow }
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
  const [mountedAt] = useState(() => Date.now())

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

  const now = statusQuery.dataUpdatedAt === 0 ? mountedAt : statusQuery.dataUpdatedAt
  const range = rangeOf(preferences, now)
  const purposes = preferences.purposes.length === 0 ? undefined : preferences.purposes
  const status = statusQuery.data
  const togglePurpose = (purpose: RequestPurpose): void => {
    const current = new Set(preferences.purposes)
    if (current.has(purpose)) current.delete(purpose)
    else current.add(purpose)
    update({ purposes: UsageFoldModel.REQUEST_PURPOSES.filter(item => current.has(item)) })
  }

  const indexState =
    status === undefined
      ? 'Connecting…'
      : status.indexing
        ? 'Indexing thread logs…'
        : `${status.indexedFiles.toLocaleString()} logs indexed${status.lastIndexedAt === null ? '' : ` · ${UsageFormattingModel.formatAgo(status.lastIndexedAt, now, relativeTime)}`}`
  const indexError = status?.lastError == null ? null : `Indexing failed: ${status.lastError}`
  const refreshError = refresh.isError ? errorMessage(refresh.error, 'Re-indexing failed.') : null

  return (
    <Page
      scroll
      className="dshx:bg-background dshx:text-foreground"
      heading="Usage"
      description={
        <>
          Every model request from thread logs, side calls included. Costs are list-price estimates from the models.dev price catalog
          {status?.pricingFetchedAt == null
            ? ' (no catalog cached yet)'
            : ` (updated ${UsageFormattingModel.formatAgo(status.pricingFetchedAt, now, relativeTime)})`}
          ; subscription traffic is priced as if it were metered.
        </>
      }
      meta={
        <span aria-live="polite" className="dshx:text-xs dshx:text-muted-foreground">
          {indexState}
        </span>
      }
      actions={[
        { id: 'reindex', label: 'Re-index thread logs', icon: <RefreshCwIcon aria-hidden />, pending: refresh.isPending, onSelect: () => refresh.mutate() },
      ]}
      tabs={{
        label: 'Usage views',
        value: preferences.tab,
        onValueChange: value => update({ tab: value === 'charts' || value === 'activity' ? value : 'log' }),
        items: [
          { value: 'log', label: 'Request log' },
          { value: 'charts', label: 'Charts' },
          { value: 'activity', label: 'Tools & Jev' },
        ],
      }}
    >
      {[indexError, refreshError].map(message =>
        message === null ? null : (
          <Alert key={message} variant="destructive">
            <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
              <span className="dshx:min-w-0 dshx:flex-1">{message}</span>
              <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ),
      )}

      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2" role="group" aria-label="Date range">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={preferences.preset}
          onValueChange={value => {
            const preset = Schema.decodeUnknownOption(Schema.Literals(PRESETS))(value)
            if (Option.isNone(preset)) return
            update({
              preset: preset.value,
              bucket: preset.value === 'today' ? 'hour' : preferences.bucket === 'hour' && preferences.preset === 'today' ? 'day' : preferences.bucket,
              ...(preset.value === 'custom' &&
                preferences.customFrom === '' && { customFrom: dateInputValue(range.from), customTo: dateInputValue(moveDays(range.to, -1)) }),
            })
          }}
        >
          <ToggleGroupItem value="today">Today</ToggleGroupItem>
          <ToggleGroupItem value="7d">7 d</ToggleGroupItem>
          <ToggleGroupItem value="30d">30 d</ToggleGroupItem>
          <ToggleGroupItem value="365d">1 y</ToggleGroupItem>
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
        {UsageFoldModel.REQUEST_PURPOSES.map(purpose => (
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

      {preferences.tab === 'log' ? (
        <RequestLog range={range} purposes={purposes} search={logSearch} onSearch={setLogSearch} openThread={props.openThread} />
      ) : preferences.tab === 'charts' ? (
        <UsageCharts
          range={range}
          purposes={purposes}
          bucket={preferences.bucket}
          groupBy={preferences.groupBy}
          onGroupBy={groupBy => update({ groupBy })}
          onShowRequests={(search, groupBy) => {
            if (groupBy === 'purpose') {
              const purpose = Schema.decodeUnknownOption(purposeSchema)(search)
              if (Option.isNone(purpose)) return
              setLogSearch('')
              update({ tab: 'log', purposes: [purpose.value] })
              return
            }
            setLogSearch(search)
            update({ tab: 'log' })
          }}
          openThread={props.openThread}
        />
      ) : (
        <UsageToolsTab range={range} bucket={preferences.bucket} />
      )}
    </Page>
  )
}
