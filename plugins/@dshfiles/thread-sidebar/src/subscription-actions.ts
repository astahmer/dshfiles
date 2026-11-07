import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { SidebarHost } from './sidebar-host-promise.js'
import { SubscriptionStorageFailed } from './sidebar-errors.js'
import { hostCall } from './subscription-host-promise.js'
import { ThreadSubscriptions, ThreadSubscriptionsModel } from './subscriptions-store.js'
import type { ThreadSubscription, ThreadSubscriptionsSnapshot } from './subscriptions-api.js'

/** The snapshot filter: both ends are optional, so a caller can list one side or every edge. */
type ThreadSubscriptionFilter = {
  subscriberSessionId?: string
  targetSessionId?: string
}

/** A row under construction: the optional titles are set only when the Host knows one. */
type ThreadSubscriptionDraft = {
  subscriberSessionId: string
  targetSessionId: string
  createdAt: number
  subscriberTitle?: string
  targetTitle?: string
}

const callerSessionId = (caller: ApiCaller): string | undefined => (caller.kind === 'agent' ? caller.sessionId : undefined)

const notFound = (): PluginApiError => new PluginApiError('No thread with that id exists.', { code: 'thread-not-found' })

const archived = (sessionId: string): PluginApiError =>
  new PluginApiError(`Thread ${sessionId} is archived. Restore it before subscribing or unsubscribing.`, { code: 'thread-archived' })

const unknownSubscriber = (): PluginApiError =>
  new PluginApiError('Pass subscriberSessionId: this call cannot tell which thread should get the notice.', { code: 'subscriber-unknown' })

const threadListUnavailable = (cause: unknown): PluginApiError =>
  new PluginApiError('Thread subscriptions could not read the thread list. Retry, or restart DSH if it keeps failing.', {
    code: 'thread-list-unavailable',
    cause,
  })

export type SubscriptionActionError = PluginApiError | SubscriptionStorageFailed

export interface ThreadSubscriptionActionSet {
  readonly state: (
    input: { readonly subscriberSessionId?: string | undefined; readonly targetSessionId?: string | undefined },
    caller: ApiCaller,
  ) => Effect.Effect<ThreadSubscriptionsSnapshot, SubscriptionActionError>
  readonly subscribe: (
    input: { readonly subscriberSessionId?: string | undefined; readonly sessionId: string },
    caller: ApiCaller,
  ) => Effect.Effect<ThreadSubscriptionsSnapshot, SubscriptionActionError>
  readonly unsubscribe: (
    input: { readonly subscriberSessionId?: string | undefined; readonly sessionId: string },
    caller: ApiCaller,
  ) => Effect.Effect<ThreadSubscriptionsSnapshot, SubscriptionActionError>
}

/**
 * The thread-subscription verbs as the Agent tools and the sidebar's thread menu read them: resolve the two threads,
 * refuse an edge that cannot exist, store it durably, and answer the snapshot with titles for display.
 */
export class ThreadSubscriptionActions extends Context.Service<ThreadSubscriptionActions, ThreadSubscriptionActionSet>()(
  '@dshfiles/thread-sidebar/ThreadSubscriptionActions',
) {
  static readonly layer = Layer.effect(
    ThreadSubscriptionActions,
    Effect.gen(function* () {
      const { ctx } = yield* HostContext
      const sidebar = yield* SidebarHost
      const store = yield* ThreadSubscriptions

      const titlesOf = (sessionIds: ReadonlyArray<string>) =>
        hostCall(signal =>
          ctx.sessionQuery.readTitleSnapshots(
            sessionIds.map(id => SessionId(id)),
            signal,
          ),
        ).pipe(
          Effect.map(results => {
            const titles = new Map<string, string>()
            for (const result of results) {
              if (result.status !== 'fulfilled' || result.value.title === undefined) continue
              titles.set(result.sessionId, result.value.title.title)
            }
            return titles
          }),
          Effect.catch(() => Effect.succeed(new Map<string, string>())),
        )

      /** The stored edges with titles, filtered to the rows the caller asked for. */
      const snapshot = (filter: { readonly subscriberSessionId?: string; readonly targetSessionId?: string }) =>
        Effect.gen(function* () {
          const stored = yield* store.snapshot
          const rows = stored.subscriptions.filter(
            row =>
              (filter.subscriberSessionId === undefined || row.subscriberSessionId === filter.subscriberSessionId) &&
              (filter.targetSessionId === undefined || row.targetSessionId === filter.targetSessionId),
          )
          if (rows.length === 0) return { subscriptions: [] } as ThreadSubscriptionsSnapshot
          const titles = yield* titlesOf([...new Set(rows.flatMap(row => [row.subscriberSessionId, row.targetSessionId]))])
          return {
            subscriptions: rows.map(row => {
              const subscriberTitle = titles.get(row.subscriberSessionId)
              const targetTitle = titles.get(row.targetSessionId)
              const view: ThreadSubscriptionDraft = {
                subscriberSessionId: row.subscriberSessionId,
                targetSessionId: row.targetSessionId,
                createdAt: row.createdAt,
              }
              if (subscriberTitle !== undefined) view.subscriberTitle = subscriberTitle
              if (targetTitle !== undefined) view.targetTitle = targetTitle
              return view satisfies ThreadSubscription
            }),
          }
        })

      /** Both ends must be threads this Host lists and neither may be archived, so an edge never outlives its use. */
      const requireThreads = (subscriberSessionId: string, targetSessionId: string) =>
        Effect.gen(function* () {
          const listed = new Set((yield* sidebar.sessions).map(session => session.sessionId))
          const archivedIds = new Set(yield* sidebar.archivedSessionIds)
          for (const sessionId of [subscriberSessionId, targetSessionId]) {
            if (!listed.has(sessionId)) return yield* Effect.fail(notFound())
            if (archivedIds.has(sessionId)) return yield* Effect.fail(archived(sessionId))
          }
          return undefined
        }).pipe(Effect.mapError(cause => (cause instanceof PluginApiError ? cause : threadListUnavailable(cause))))

      const resolvedSubscriber = (subscriberSessionId: string | undefined, caller: ApiCaller): string | undefined =>
        subscriberSessionId ?? callerSessionId(caller)

      return ThreadSubscriptionActions.of({
        state: (input, caller) => {
          const subscriberSessionId = resolvedSubscriber(input.subscriberSessionId, caller)
          const filter: ThreadSubscriptionFilter = {}
          if (subscriberSessionId !== undefined) filter.subscriberSessionId = subscriberSessionId
          if (input.targetSessionId !== undefined) filter.targetSessionId = input.targetSessionId
          return snapshot(filter)
        },
        subscribe: Effect.fn('thread subscriptions subscribe action')(function* (input, caller) {
          const subscriberSessionId = resolvedSubscriber(input.subscriberSessionId, caller)
          if (subscriberSessionId === undefined) return yield* Effect.fail(unknownSubscriber())
          yield* requireThreads(subscriberSessionId, input.sessionId)
          const current = yield* store.snapshot
          const refusal = ThreadSubscriptionsModel.refusalOf({ subscriberSessionId, targetSessionId: input.sessionId, subscriptions: current.subscriptions })
          if (refusal !== undefined) return yield* Effect.fail(new PluginApiError(refusal, { code: 'subscription-refused' }))
          yield* store.subscribe({ subscriberSessionId, targetSessionId: input.sessionId })
          return yield* snapshot({ subscriberSessionId })
        }),
        unsubscribe: Effect.fn('thread subscriptions unsubscribe action')(function* (input, caller) {
          const subscriberSessionId = resolvedSubscriber(input.subscriberSessionId, caller)
          if (subscriberSessionId === undefined) return yield* Effect.fail(unknownSubscriber())
          yield* store.unsubscribe({ subscriberSessionId, targetSessionId: input.sessionId })
          return yield* snapshot({ subscriberSessionId })
        }),
      })
    }),
  )
}
