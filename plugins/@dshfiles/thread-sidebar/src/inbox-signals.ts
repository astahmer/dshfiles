/**
 * The thread list's read of the inbox (plan `docs/ade-ux` §4.8): row emphasis is a projection of inbox state, never a
 * counter of its own. Every open inbox item whose subject is a thread (`kind: 'session'`) becomes that thread's signal;
 * the most urgent one wins (blocking, then failed, then ready). An inline verb on the row runs the item's provider verb
 * through the inbox's own `act`, so the row and the Inbox page always do the same thing.
 */
import { attentionApi, type AttentionItem, type AttentionProviderVerb } from '@dshfiles/activity-timeline/attention-api'
import { useApi, useApiEvent } from '@dshfiles/dshx/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useMemo } from 'react'
import { INLINE_VERBS, type InboxThreadSignal, type InlineVerb } from './thread-status.js'

const SEVERITY_RANK = { blocking: 3, failed: 2, ready: 1 } as const

const inboxKeys = {
  all: ['thread-sidebar', 'inbox-signals'] as const,
  view: (view: 'needs-you' | 'other') => ['thread-sidebar', 'inbox-signals', view] as const,
}

/** The most urgent open item per thread. Info, done, snoozed, resolved and muted items never reach these views. */
const signalsOf = (items: readonly AttentionItem[]): ReadonlyMap<string, InboxThreadSignal> => {
  const signals = new Map<string, InboxThreadSignal>()
  for (const item of items) {
    if (item.subject.kind !== 'session' || item.severity === 'info') continue
    if (item.resolvedAt !== null || item.doneAt !== null) continue
    const severity = item.severity
    const verb = INLINE_VERBS.find((candidate: InlineVerb) => item.verbs.includes(candidate))
    const next: InboxThreadSignal = { itemId: item.id, severity, reason: item.reason, verb, openedAt: item.openedAt }
    const current = signals.get(item.subject.id)
    if (
      current === undefined ||
      SEVERITY_RANK[severity] > SEVERITY_RANK[current.severity] ||
      (SEVERITY_RANK[severity] === SEVERITY_RANK[current.severity] && next.openedAt > current.openedAt)
    ) {
      signals.set(item.subject.id, next)
    }
  }
  return signals
}

const EMPTY: ReadonlyMap<string, InboxThreadSignal> = new Map()

export interface InboxThreadSignals {
  readonly signals: ReadonlyMap<string, InboxThreadSignal>
  /** False until both views answered once, so an empty list can say it is empty instead of still loading. */
  readonly loaded: boolean
  /** Run a provider verb on one item; resolves to the provider's outcome. */
  readonly act: (itemId: string, verb: AttentionProviderVerb) => Promise<{ readonly ok: boolean; readonly message: string }>
  /** Mark one item done, the way the Inbox page's Done does; a provider may clear its own record too. */
  readonly done: (itemId: string) => Promise<void>
}

/** Needs you and Other, refreshed by the inbox's `changed` event; empty while the inbox plugin is absent. */
export const useInboxThreadSignals = (options: { readonly enabled: boolean }): InboxThreadSignals => {
  const api = useApi(attentionApi)
  const queryClient = useQueryClient()
  const eventStatus = useApiEvent(attentionApi, 'changed', () => void queryClient.invalidateQueries({ queryKey: inboxKeys.all }))
  const refetchInterval = eventStatus === 'live' ? 60_000 : 15_000
  const needsYou = useQuery({
    queryKey: inboxKeys.view('needs-you'),
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.list({ view: 'needs-you', limit: 200 }, { signal: hostSignal }) }),
    enabled: options.enabled,
    refetchInterval,
    retry: 1,
  })
  const other = useQuery({
    queryKey: inboxKeys.view('other'),
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.list({ view: 'other', limit: 200 }, { signal: hostSignal }) }),
    enabled: options.enabled,
    refetchInterval,
    retry: 1,
  })
  const signals = useMemo(() => {
    const items = [...(needsYou.data?.items ?? []), ...(other.data?.items ?? [])]
    return items.length === 0 ? EMPTY : signalsOf(items)
  }, [needsYou.data, other.data])
  const act = useCallback(
    async (itemId: string, verb: AttentionProviderVerb) => {
      const outcome = await api.act({ id: itemId, verb })
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
      return outcome
    },
    [api, queryClient],
  )
  const done = useCallback(
    async (itemId: string) => {
      await api.done({ id: itemId })
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
    },
    [api, queryClient],
  )
  return { signals, act, done, loaded: needsYou.isSuccess && other.isSuccess }
}

export class InboxSignalsModel {
  static readonly signalsOf = signalsOf
}
