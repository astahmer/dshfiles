/** Client Session object layer, Agent scopes, and Remote lifecycle wiring. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import { typertOwnedValue } from '@deepseek-ai/dsh-typert-protocol'
import { createSessionControlStream } from './transport.ts'
import { ClientSessions } from './sessions/service.ts'
import type { SessionRemotes } from './sessions/remotes.ts'
import type {} from '../remote-events.ts'

export {
  createSessionControlStream,
  SessionEventStream,
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './transport.ts'
export type {
  ClientSessionPageRequest,
  SessionControlStream,
  SessionControlStreamOptions,
  SessionEventStreamOptions,
  SessionJournalChange,
  SessionRemote,
} from './transport.ts'
export { createScope, scopeOf } from './scope.ts'
export type { AgentContext, AgentScopeHandle } from './scope.ts'
export { SessionCreateError, SessionForkError } from './sessions/service.ts'
export type { SessionBinding, SessionListState, SessionSummary } from './sessions/service.ts'
export type {
  SessionListPhase,
  SessionListSnapshot,
  SessionSearchResultItem,
  SessionProjectionSnapshot,
} from './sessions/manager.ts'
export type { Session } from './sessions/session.ts'
export type {
  ProjectionsBaseline,
  ProjectionValueStore,
  SessionProjectionMap,
  UseProjection,
} from './sessions/projection-store.ts'
export type {
  BeginSubmissionInput,
  ISession,
  PendingSubmissionRetirement,
  ProjectionsFace,
  SessionFace,
  SubmissionHandle,
} from './contract/session.ts'
export type {
  ISessions, SessionReference, SessionRetainInfo, SessionRetainOptions, SessionTarget,
} from './contract/sessions.ts'
export { MutableSessionEventSource } from './contract/events.ts'
export type {
  AssistantLiveChunkEvent,
  SessionAssistantSettlementEntry,
  SessionEventChange,
  SessionEventLike,
  SessionEventLikeEntry,
  SessionEventSource,
  SessionEventWindow,
  SessionLiveEventEntry,
  SessionTransientEventEntry,
} from './contract/events.ts'
export type {
  OpenState,
  PendingSubmission,
  PendingSubmissionAttachment,
  PendingSubmissionFileAttachment,
  PendingSubmissionImage,
  PendingSubmissionImageAttachment,
  PendingSubmissionPlacement,
  PromptError,
  SessionSnapshot,
} from './contract/snapshot.ts'

/** Consumer-owned reference labels; extend this map through the package's canonical /client entry. */
export interface SessionReferenceSourceMap {
  /** Temporary Client Controller work, including fork-title preparation. */
  controllerOperation: unknown
  /** A Client Gateway invocation's synchronous Context ownership. */
  gateway: unknown
}

/** Declaration-merge-extensible labels carried by independent Client references. */
export type SessionReferenceSource = Extract<keyof SessionReferenceSourceMap, string>

/** Required Remote and Context projection services. */
export const inject = [
  'connection',
  'workspaces',
  'fileUpload',
  'typert',
  'remote',
  'remote.agentPresets',
  'remote.commands',
  'remote.session',
  'remote.subagents',
]

/**
 * Call back when the page's connection owner (settings-shell) clears `html[data-host-connection]`:
 * the Host answers HTTP again. The socket can stay up through an HTTP outage (a silent tunnel), so
 * the generation alone never says the list can be pulled again. Read through the attribute, the
 * documented mirror, so this fork takes no kit dependency.
 * @param reachable - called on each set-to-absent transition.
 * @returns stops watching.
 */
function watchHostReachable(reachable: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const root = document.documentElement
  let away = root.hasAttribute('data-host-connection')
  const observer = new MutationObserver(() => {
    const now = root.hasAttribute('data-host-connection')
    if (away && !now) reachable()
    away = now
  })
  observer.observe(root, { attributes: true, attributeFilter: ['data-host-connection'] })
  return () => { observer.disconnect() }
}

/**
 * Install Client Session state and its reconnecting control stream.
 * @param ctx - Client Cordis context.
 */
export function apply(ctx: Context): void {
  const remotes = ctx.remote as unknown as SessionRemotes
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const sessions = new ClientSessions(ctx, remotes)
  ctx.remote.$on('api-session/added', (summary) => { sessions.handleSessionAdded(summary) })
  ctx.remote.$on('api-session/removed', (sessionId) => { sessions.handleSessionRemoved(sessionId) })
  ctx.remote.$on('api-session/status', (sessionId, running) => {
    sessions.handleSessionStatus(sessionId, running)
  })
  ctx.remote.$on('api-session/activity', (sessionId, updatedAt) => {
    sessions.handleSessionActivity(sessionId, updatedAt)
  })
  ctx.remote.$on('api-session/error', (sessionId, message) => {
    sessions.handleSessionError(sessionId, message)
  })

  const control = createSessionControlStream(remotes, {
    accept: (frame) => { sessions.handleControlFrame(frame) },
    failed: (error) => { console.error('[session-controller] control stream failed:', error) },
  })
  const connected = (): void => {
    if (connection.generation.getSnapshot() === undefined) return
    // A ready control baseline may arrive before Cordis delivers connection/reset.
    sessions.handleConnected()
    control.restart()
    control.start()
  }
  ctx.effect(() => connection.generation.subscribe(connected), 'session-controller.client.generation')
  connected()
  ctx.effect(() => watchHostReachable(() => { sessions.handleHostReachable() }), 'session-controller.client.reachable')
  ctx.typert.contexts.registerClient('agent', {
    identity: candidate => sessions.sessionOf(candidate)?.sessionId,
    resolve: (sessionId) => {
      const reference = sessions.retainAgentScope(sessionId)
      return typertOwnedValue(reference.binding.ctx, () => { reference.release() })
    },
  })
  ctx.effect(() => async () => { await control.dispose() }, 'session-controller.client.control')
}
