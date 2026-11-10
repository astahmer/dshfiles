import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi, useApiEvent, useApiQuery } from '@dshfiles/dshx/client'
import { useCallback, useMemo } from 'react'
import { threadSubscriptionsApi, type ThreadSubscription } from './subscriptions-api.js'

export interface ThreadSubscriptionsState {
  /** False while a Host that predates the subscription API answers; every affordance then stays hidden. */
  readonly available: boolean
  readonly subscriptions: readonly ThreadSubscription[]
  /** The edges that end at one thread, i.e. who is notified when it finishes. */
  readonly notifiersOf: (targetSessionId: string) => readonly ThreadSubscription[]
  readonly isSubscribed: (input: { readonly subscriberSessionId: string; readonly targetSessionId: string }) => boolean
  readonly setSubscription: (input: { readonly subscriberSessionId: string; readonly targetSessionId: string; readonly subscribed: boolean }) => void
}

/**
 * The Host's thread subscriptions as the sidebar's thread menu reads them. The state lives on the Host, so a
 * subscription an Agent made shows in every browser, and a change published by one surface refreshes the others
 * instead of waiting for a poll.
 */
export const useThreadSubscriptions = (): ThreadSubscriptionsState => {
  const query = useApiQuery(threadSubscriptionsApi, 'state', { input: {} })
  const api = useApi(threadSubscriptionsApi)
  const refetch = query.refetch
  useApiEvent(threadSubscriptionsApi, 'changed', () => {
    void refetch()
  })

  const subscriptions = useMemo(() => query.data?.subscriptions ?? [], [query.data])
  const byTarget = useMemo(() => {
    const grouped = new Map<string, ThreadSubscription[]>()
    for (const row of subscriptions) {
      const bucket = grouped.get(row.targetSessionId)
      if (bucket === undefined) grouped.set(row.targetSessionId, [row])
      else bucket.push(row)
    }
    return grouped
  }, [subscriptions])
  const keys = useMemo(() => new Set(subscriptions.map(row => `${row.subscriberSessionId}\u001f${row.targetSessionId}`)), [subscriptions])

  const setSubscription = useCallback(
    (input: { readonly subscriberSessionId: string; readonly targetSessionId: string; readonly subscribed: boolean }) => {
      const request = input.subscribed
        ? api.subscribe({ sessionId: input.targetSessionId, subscriberSessionId: input.subscriberSessionId })
        : api.unsubscribe({ sessionId: input.targetSessionId, subscriberSessionId: input.subscriberSessionId })
      void request.then(
        () => refetch(),
        () => undefined,
      )
    },
    [api, refetch],
  )

  return {
    available: query.error === null ? query.data !== undefined : !isApiOwnerMissing(query.error),
    subscriptions,
    notifiersOf: (targetSessionId: string) => byTarget.get(targetSessionId) ?? [],
    isSubscribed: input => keys.has(`${input.subscriberSessionId}\u001f${input.targetSessionId}`),
    setSubscription,
  }
}
