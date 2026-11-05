import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Effect, Layer, Stream } from 'effect'
import { BacklogSettingsTag } from './backlog-settings.js'
import type { BacklogEvent, BacklogItem } from './item.js'
import { BacklogStore } from './store.js'
import { BacklogReference } from './backlog-reference.js'

type BacklogActivityType = 'backlog.created' | 'backlog.moved' | 'backlog.linked' | 'backlog.commented' | 'backlog.attention' | 'backlog.triaged'

/** The `backlog` kind of `@dshfiles/activity-timeline`'s ingest event, matching its `backlogActivitySchema`. */
interface BacklogActivityPayload {
  readonly kind: 'backlog'
  readonly value: {
    readonly id: string
    readonly at: number
    readonly type: BacklogActivityType
    readonly level: 'routine' | 'notable' | 'attention'
    readonly summary: string
    readonly detail: string | null
    readonly itemId: number
    readonly sessionId: string | null
    readonly revision: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: BacklogActivityPayload): void
  }
}

const activityType = (event: BacklogEvent): BacklogActivityType | null => {
  if (event.kind === 'created') return 'backlog.created'
  if (event.kind === 'moved') return 'backlog.moved'
  if (event.kind === 'linked') return 'backlog.linked'
  if (event.kind === 'commented') return 'backlog.commented'
  if (event.kind === 'triaged') return 'backlog.triaged'
  if (event.kind === 'edited' && event.detail.startsWith('attention')) return 'backlog.attention'
  return null
}

/** One timeline event per meaningful change; plain edits (titles, tags, unlinks) stay in the item's own history. */
export const backlogActivityPayload = (item: BacklogItem, event: BacklogEvent): BacklogActivityPayload | null => {
  const type = activityType(event)
  if (type === null) return null
  const attention = item.attention ?? 'none'
  const sessionId = event.actor.startsWith('agent:') ? event.actor.slice('agent:'.length) : null
  const revision = /^(?:\S+ )?revision:(\S+)/.exec(event.detail)?.[1] ?? /closed by jj:(\S+)\)$/.exec(event.detail)?.[1] ?? null
  const attentionPhrase = attention === 'none' ? 'cleared the request on' : attention === 'needs-input' ? 'asked for your input on' : `marked ${attention}`
  const phrase = type === 'backlog.attention' ? attentionPhrase : type.slice('backlog.'.length)
  const who = event.actor === 'user' ? 'You' : event.actor === 'system' ? 'Automatic' : `Agent ${(sessionId ?? '').replace(/^session-/, '').slice(0, 6)}`
  const level =
    type === 'backlog.attention' && attention !== 'none' ? 'attention' : type === 'backlog.moved' || type === 'backlog.created' ? 'notable' : 'routine'
  return {
    kind: 'backlog',
    value: {
      id: `backlog:${String(item.id)}:${String(event.at)}:${event.kind}`,
      at: event.at,
      type,
      level,
      summary: `${who} ${phrase} ${BacklogReference.labelOf(item)} ${item.title}`.slice(0, 500),
      detail: event.kind === 'commented' || event.kind === 'moved' ? event.detail.slice(0, 2_000) : null,
      itemId: item.id,
      sessionId,
      revision,
    },
  }
}

/** Reports every stored backlog event to the Activity timeline while `publishActivity` is on. */
export const ActivityPublisher = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const store = yield* BacklogStore
    const settings = yield* BacklogSettingsTag
    yield* DshxPlugin.worker(
      Stream.runForEach(store.changes, notice =>
        Effect.gen(function* () {
          if (!(yield* settings.get).publishActivity) return
          const payload = backlogActivityPayload(notice.item, notice.event)
          if (payload !== null) host.ctx.emit('dshfiles/activity/event', payload)
        }),
      ),
    )
  }),
)
