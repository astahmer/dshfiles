import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { panelOccurrence } from '@dshfiles/workbench/panel-occurrence'
import { Effect, Option } from 'effect'
import type * as SchemaTypes from 'effect/Schema'
import * as Schema from 'effect/Schema'
import { REQUEST_PURPOSES } from './fold-contracts.js'

/**
 * The Usage page's per-panel view state, apart from the page itself: the entry selects a tab from outside (the Quota
 * navigation contract, palette rows, the Cost facet) without loading the page's lazy chunk.
 */

export const PRESETS = ['today', '7d', '30d', '365d', 'custom'] as const

/** A stored view preference keeps the value it had when one field is stale, the rule `.catch(...)` carried. */
const withFallback = <ValueSchema extends SchemaTypes.Top>(schema: ValueSchema, fallback: ValueSchema['Type']) =>
  schema.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback))))

const purposeSchema = Schema.Literals(REQUEST_PURPOSES)

const preferencesSchema = Schema.Struct({
  // Stored names predate the tab labels: charts is Overview, log is Requests, activity is Tools.
  tab: withFallback(Schema.Literals(['log', 'charts', 'quota', 'activity']), 'charts'),
  preset: withFallback(Schema.Literals(PRESETS), '7d'),
  customFrom: withFallback(Schema.String, ''),
  customTo: withFallback(Schema.String, ''),
  bucket: withFallback(Schema.Literals(['hour', 'day']), 'day'),
  groupBy: withFallback(Schema.Literals(['model', 'provider', 'project', 'purpose']), 'model'),
  purposes: withFallback(Schema.Array(purposeSchema), []),
})

export type Preferences = typeof preferencesSchema.Type

const DEFAULT_PREFERENCES: Preferences = { tab: 'charts', preset: '7d', customFrom: '', customTo: '', bucket: 'day', groupBy: 'model', purposes: [] }

/** Requests narrowed to one thread, set by its Cost facet; a session detail, so not stored. */
interface ThreadFilter {
  readonly sessionId: string
  readonly label: string
}

const createPanelState = (key: string | undefined) => {
  const preferences = createStoredValue({
    key: key === undefined ? 'dshfiles-usage:view.v1' : `dshfiles-usage:view.v1/panel/${encodeURIComponent(key)}`,
    schema: preferencesSchema,
    fallback: DEFAULT_PREFERENCES,
  })
  let thread: ThreadFilter | null = null
  const listeners = new Set<() => void>()
  return {
    preferences,
    thread: () => thread,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setThread: (next: ThreadFilter | null) => {
      thread = next
      for (const listener of listeners) listener()
    },
  }
}
const panelStates = new Map<string | undefined, ReturnType<typeof createPanelState>>()
export const panelState = (panelId?: string, scopeKey?: string) => {
  const key = panelId === undefined ? undefined : panelOccurrence({ panelId, scopeKey })
  const existing = panelStates.get(key)
  if (existing !== undefined) return existing
  const state = createPanelState(key)
  panelStates.set(key, state)
  return state
}

type UsageTab = Preferences['tab']
export const USAGE_TABS: readonly UsageTab[] = ['charts', 'quota', 'log', 'activity']

/** Select a tab of the Usage page from outside it (the Quota navigation contract, palette rows). */
const showTab = (tab: UsageTab, panelId?: string): void => {
  const store = panelState(panelId).preferences
  store.set({ ...store.get(), tab })
}

export class UsageTabs {
  static readonly show = showTab
  /** Requests of one thread: the Requests tab with that thread's filter on. */
  static readonly showRequestsFor = (filter: ThreadFilter, panelId?: string): void => {
    const state = panelState(panelId)
    state.setThread(filter)
    // A thread's requests can be older than the current preset; the year preset holds its whole history.
    state.preferences.set({ ...state.preferences.get(), tab: 'log', preset: '365d', bucket: 'day' })
  }
}
