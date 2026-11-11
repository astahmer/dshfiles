import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi, useApiEvent, useApiQuery } from '@dshfiles/dshx/client'
import { useCallback, useMemo } from 'react'
import type { SubscriptionNoticeLevel } from './subscription-levels.js'
import { threadSubscriptionsApi, type ThreadSubscription } from './subscriptions-api.js'

/** What the thread menu offers for one pair: no subscription, one that follows the default level, or a fixed level. */
export type ThreadNotifyChoice = 'off' | 'default' | SubscriptionNoticeLevel

export const THREAD_NOTIFY_CHOICES = ['off', 'default', 'all', 'outcomes', 'stuck', 'never'] as const satisfies readonly ThreadNotifyChoice[]

export interface ThreadSubscriptionsState {
  /** False while a Host that predates the subscription API answers; every affordance then stays hidden. */
  readonly available: boolean
  readonly subscriptions: readonly ThreadSubscription[]
  /** The edges that end at one thread, i.e. who is notified when it finishes. */
  readonly notifiersOf: (targetSessionId: string) => readonly ThreadSubscription[]
  readonly isSubscribed: (input: { readonly subscriberSessionId: string; readonly targetSessionId: string }) => boolean
  readonly choiceOf: (input: { readonly subscriberSessionId: string; readonly targetSessionId: string }) => ThreadNotifyChoice
  /** Subscribe, change the level of, or unsubscribe one subscriber from several targets at once. */
  readonly setNotify: (input: {
    readonly subscriberSessionId: string
    readonly targetSessionIds: readonly string[]
    readonly choice: ThreadNotifyChoice
  }) => void
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
  const bySubscriberAndTarget = useMemo(
    () => new Map(subscriptions.map(row => [`${row.subscriberSessionId}\u001f${row.targetSessionId}`, row] as const)),
    [subscriptions],
  )

  const setNotify = useCallback(
    (input: { readonly subscriberSessionId: string; readonly targetSessionIds: readonly string[]; readonly choice: ThreadNotifyChoice }) => {
      const targets = input.targetSessionIds.filter(targetSessionId => targetSessionId !== input.subscriberSessionId)
      const requests = targets.map(targetSessionId =>
        input.choice === 'off'
          ? api.unsubscribe({ sessionId: targetSessionId, subscriberSessionId: input.subscriberSessionId })
          : api.subscribe({ sessionId: targetSessionId, subscriberSessionId: input.subscriberSessionId, level: input.choice }),
      )
      void Promise.allSettled(requests).then(() => refetch())
    },
    [api, refetch],
  )

  return {
    available: query.error === null ? query.data !== undefined : !isApiOwnerMissing(query.error),
    subscriptions,
    notifiersOf: (targetSessionId: string) => byTarget.get(targetSessionId) ?? [],
    isSubscribed: input => bySubscriberAndTarget.has(`${input.subscriberSessionId}\u001f${input.targetSessionId}`),
    choiceOf: input => {
      const row = bySubscriberAndTarget.get(`${input.subscriberSessionId}\u001f${input.targetSessionId}`)
      return row === undefined ? 'off' : (row.level ?? 'default')
    },
    setNotify,
  }
}
