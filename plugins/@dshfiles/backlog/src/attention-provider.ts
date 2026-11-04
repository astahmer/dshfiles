import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Effect, Layer, Stream } from 'effect'
import type { BacklogSummaryView } from './api.js'
import { BacklogStore } from './store.js'

/** The inbox source of backlog items whose attention asks the user for something. */
export const BACKLOG_ATTENTION_SOURCE = 'backlog.attention'

const RECONCILE_DEBOUNCE = '300 millis'
/** A snooze on an item ends without a write, so a slow pass brings it back. */
const RECONCILE_SAFETY_INTERVAL = '60 seconds'
/** The inbox stores at most this many items per reconcile. */
const MAX_ITEMS = 500

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

const COPY = {
  'needs-input': { severity: 'blocking', reason: (title: string, id: string) => `b:${id} ${title} needs your input.` },
  blocked: { severity: 'blocking', reason: (title: string, id: string) => `b:${id} ${title} is blocked.` },
  waiting: { severity: 'ready', reason: (title: string, id: string) => `b:${id} ${title} is waiting.` },
} as const satisfies Record<Exclude<BacklogSummaryView['attention'], 'none'>, unknown>

/**
 * One open, unsnoozed item with attention as an inbox item: needs-input and blocked ask the user to act (Needs you),
 * waiting is Other. Triage suggestions stay in the backlog's own Inbox filter; they are not a request from anyone.
 */
const draftsOf = (items: readonly BacklogSummaryView[]): readonly AttentionDraft[] =>
  items.flatMap(item => {
    if (item.attention === 'none' || item.status === 'done' || item.status === 'dropped') return []
    const copy = COPY[item.attention]
    const id = String(item.id)
    const last = item.activity.last?.detail.trim() ?? ''
    return [
      {
        dedupeKey: `${id}:${item.attention}`,
        subject: { kind: 'backlog-item', id, label: clamp(item.title, 200) },
        reason: clamp(copy.reason(item.title, id), 500),
        ...(last.length > 0 && { detail: clamp(last, 2000) }),
        severity: copy.severity,
        verbs: ['Done', 'Snooze', 'MuteSource'],
      } satisfies AttentionDraft,
    ]
  })

const make = Effect.gen(function* () {
  const store = yield* BacklogStore
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)

  /** Clearing an item's attention in the backlog (or closing the item) resolves it here on the next pass. */
  const reconcile = Effect.fn('backlog attention reconcile')(function* () {
    if (!(yield* apis.isServed(attentionApi))) return
    const listed = yield* store.list({ inbox: true, freshness: 'all', limit: MAX_ITEMS })
    const items = draftsOf(listed.items).slice(0, MAX_ITEMS)
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
    yield* inbox.reconcile({ source: BACKLOG_ATTENTION_SOURCE, items: [...items] })
  })

  yield* Stream.mergeAll(
    [
      Stream.succeed(undefined),
      Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined),
      Stream.map(store.changes, () => undefined),
      Stream.map(Stream.tick(RECONCILE_SAFETY_INTERVAL), () => undefined),
    ],
    { concurrency: 'unbounded' },
  ).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('backlog: inbox reconcile failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )
})

/** backlog as an inbox provider: items asking for input or blocked are Needs you, waiting items are Other. */
export class BacklogAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly draftsOf = draftsOf
}
