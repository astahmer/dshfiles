import type { BacklogEvent } from './item.js'
import { BacklogSyncModel } from './sync-model.js'

/** `user`, `system`, `agent:<sessionId>` or `remote:<backend>`. */
export type BacklogOrigin = string

/**
 * Who wrote an event. New events carry `origin`; older ones derive it from their actor, and a comment a remote tracker
 * carried over before `origin` existed reads as `remote:<backend>` from its `Linear · author:` prefix.
 */
const of = (event: Pick<BacklogEvent, 'origin' | 'actor' | 'kind' | 'detail'>): BacklogOrigin => {
  if (event.origin !== undefined) return event.origin
  if (event.actor !== 'system' || event.kind !== 'commented') return event.actor
  const backend = BacklogSyncModel.importedCommentBackend(event.detail)
  return backend === undefined ? event.actor : `remote:${backend}`
}

const isAgent = (origin: BacklogOrigin): boolean => origin.startsWith('agent:')
const isRemote = (origin: BacklogOrigin): boolean => origin.startsWith('remote:')

/** The event with its origin filled, so an API reader never derives it itself. */
const stamped = <Event extends BacklogEvent>(event: Event): Event => (event.origin === undefined ? { ...event, origin: of(event) } : event)

export class BacklogOrigins {
  static readonly of = of
  static readonly isAgent = isAgent
  static readonly isRemote = isRemote
  static readonly stamped = stamped
}
