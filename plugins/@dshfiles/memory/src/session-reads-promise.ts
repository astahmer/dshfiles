import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionListRequest } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { HostEvents } from '@dshfiles/dshx/effect'
import { hostService } from '@dshfiles/dshx/effect/host-context'
import { Cache, Context, Duration, Effect, Layer, Option, Schema } from 'effect'

import type { ThreadHeader } from './digest.ts'
import { SessionLogUnavailable } from './errors.ts'
import { sessionContentHits, type SessionContentHits } from './session-content.ts'

export type SessionLog = { readonly header: ThreadHeader; readonly inheritedEventCount: number; readonly events: readonly SessionEvent[] }

export type SessionTitleRead = { readonly sessionId: string; readonly title: string | undefined; readonly updatedAt: number | undefined }

export type SessionListEntry = {
  readonly header: ThreadHeader & { readonly createdAt: number }
  readonly live: boolean
  readonly persisted: boolean
}

/** The full-text backend refused or failed one content search; `code` is its own failure code. */
export class ContentSearchFailed extends Schema.TaggedError<ContentSearchFailed>()('ContentSearchFailed', {
  code: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason
  }
}

export class SessionListUnavailable extends Schema.TaggedError<SessionListUnavailable>()('SessionListUnavailable', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'DSH could not list Sessions; retry shortly.'
  }
}

/** The owned session-controller fork reads the `projections` field; the native request type does not name it. */
const sessionTitleListRequest: SessionListRequest & { readonly projections: readonly ['title'] } = { projections: ['title'] }

const failureCode = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }))
const listedTitle = Schema.decodeUnknownOption(Schema.String.check(Schema.isMinLength(1)))

/** The finder's Session list stays fresh through create/dispose events; the clock only bounds header drift. */
const sessionListTtl = Duration.seconds(60)

/**
 * Session reads memory needs from DSH's Promise services (`sessionQuery`, `sessionController`, `agents`). This is the
 * one edge that adapts them: interruption aborts each read, failures are typed, nothing else in memory sees a Promise.
 */
export class SessionReads extends Context.Service<
  SessionReads,
  {
    readonly read: (sessionId: string) => Effect.Effect<SessionLog, SessionLogUnavailable>
    /** The last few logs read for message excerpts and ranges, so paging one thread does not decode it again. */
    readonly readRecent: (sessionId: string) => Effect.Effect<SessionLog, SessionLogUnavailable>
    /** Every Session header, kept until a Session is created or disposed (or a minute passed). */
    readonly list: Effect.Effect<readonly SessionListEntry[], SessionListUnavailable>
    /** Folded titles from the projection cache; a Session without one stays untitled instead of failing the batch. */
    readonly titles: (sessionIds: readonly string[]) => Effect.Effect<readonly SessionTitleRead[]>
    readonly searchContent: (request: { readonly query: string; readonly limit: number }) => Effect.Effect<SessionContentHits, ContentSearchFailed>
    /** A subagent's parent: the live Agent registry first (no I/O), then its Session log. */
    readonly parentOf: (sessionId: string) => Effect.Effect<string | undefined>
    /** The provider of the thread's last request, for a digest that borrows the thread's route. */
    readonly providerOf: (sessionId: string) => Effect.Effect<string | undefined>
  }
>()('@dshfiles/memory/SessionReads') {
  static readonly layer = Layer.effect(
    SessionReads,
    Effect.gen(function* () {
      const sessionQuery = Option.getOrUndefined(yield* Effect.option(hostService('sessionQuery')))
      const sessionController = Option.getOrUndefined(yield* Effect.option(hostService('sessionController')))
      const agents = Option.getOrUndefined(yield* Effect.option(hostService('agents')))

      const read = Effect.fn('memory session read')(function* (sessionId: string) {
        yield* Effect.annotateCurrentSpan('dsh.session.id', sessionId)
        if (sessionQuery === undefined) return yield* new SessionLogUnavailable({ sessionId })
        const log = yield* Effect.tryPromise({
          try: () => sessionQuery.readSession(SessionId(sessionId)),
          catch: cause => new SessionLogUnavailable({ sessionId, cause }),
        })
        const result: SessionLog = { header: log.session, inheritedEventCount: log.inheritedEventCount, events: log.events }
        return result
      })

      const recent = yield* Cache.makeWith(read, { capacity: 4, timeToLive: exit => (exit._tag === 'Success' ? Duration.infinity : Duration.zero) })

      const listAll = Effect.gen(function* () {
        if (sessionQuery === undefined) return yield* new SessionListUnavailable({})
        const records = yield* Effect.tryPromise({
          try: signal => sessionQuery.listSessions(signal),
          catch: cause => new SessionListUnavailable({ cause }),
        })
        return records.map((record): SessionListEntry => ({ header: record.header, live: record.live, persisted: record.persisted }))
      }).pipe(Effect.withSpan('memory session list'))
      const listed = yield* Cache.makeWith((_: 'sessions') => listAll, {
        capacity: 1,
        timeToLive: exit => (exit._tag === 'Success' ? sessionListTtl : Duration.zero),
      })
      const sessionsChanged = () => Cache.invalidate(listed, 'sessions')
      yield* HostEvents.on('session/created', sessionsChanged)
      yield* HostEvents.on('session/disposed', sessionsChanged)

      const titles = Effect.fn('memory session titles')(function* (sessionIds: readonly string[]) {
        if (sessionIds.length === 0) return []
        // The Session list serves each title from the projection cache (a log-prefix read, kept until the Session
        // changes). A Session it has no title for is left untitled here, so the finder falls back to its digest's title:
        // core's title fold decodes the whole log, 57 of them took 3.1 s of the first search after a restart.
        const listedPage =
          sessionController === undefined
            ? undefined
            : yield* Effect.tryPromise(signal => sessionController.list(sessionTitleListRequest, signal)).pipe(
                Effect.timeoutOption('10 seconds'),
                Effect.map(Option.getOrUndefined),
                Effect.orElseSucceed(() => undefined),
              )
        const fromList = new Map<string, SessionTitleRead>()
        for (const item of listedPage?.items ?? []) {
          const title = listedTitle(item.projections?.values['title'])
          if (title._tag === 'Some') fromList.set(item.sessionId, { sessionId: item.sessionId, title: title.value, updatedAt: item.updatedAt })
        }
        return sessionIds.map(id => fromList.get(id) ?? { sessionId: id, title: undefined, updatedAt: undefined })
      })

      const searchContent = Effect.fn('memory session content search')(function* (request: { readonly query: string; readonly limit: number }) {
        if (sessionQuery === undefined) return yield* new ContentSearchFailed({ code: 'unavailable', reason: 'the DSH sessionQuery service is unavailable' })
        const page = yield* Effect.tryPromise({
          try: signal =>
            sessionQuery.searchSessions(
              {
                query: request.query,
                eventFilters: [
                  { kind: 'type', values: ['user/message', 'assistant/message'] },
                  { kind: 'surface', values: ['current'] },
                ],
                limit: request.limit,
              },
              { signal },
            ),
          catch: cause =>
            new ContentSearchFailed({
              code: Option.match(failureCode(cause), { onNone: () => 'unknown', onSome: failure => failure.code }),
              reason: cause instanceof Error ? cause.message : 'Session content search failed.',
              cause,
            }),
        })
        return sessionContentHits(page)
      })

      const parentOf = (sessionId: string) =>
        Effect.gen(function* () {
          const live = agents?.list().find(agent => agent.id === sessionId)
          if (live !== undefined) return live.session.header.parentSession
          const log = yield* Effect.option(read(sessionId))
          return Option.getOrUndefined(log)?.header.parentSession
        })

      const providerOf = (sessionId: string) =>
        Effect.map(Effect.option(read(sessionId)), log => {
          const header = Option.getOrUndefined(log)?.events.findLast(event => event.type === 'request/header')
          return header?.type === 'request/header' ? header.data.header.config.provider : undefined
        })

      return SessionReads.of({
        read,
        readRecent: sessionId => Cache.get(recent, sessionId),
        list: Cache.get(listed, 'sessions'),
        titles,
        searchContent,
        parentOf,
        providerOf,
      })
    }),
  )
}
