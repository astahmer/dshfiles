import type { Events } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subprocess'
import { DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { SessionId } from '@dshfiles/dshx/ids'
import { Context, Effect, Layer, Option, Schema, type Scope } from 'effect'
import type { ProjectHookEvent } from './api.js'
import type { ProjectChecksVerifiedTurn } from './completion-event.js'
import { projectChecksConfigSchema, type ProjectChecksConfig } from './core.js'
import { ExecutableUnresolved, ProfileConfigUnavailable, SessionEventsUnavailable, SessionPathUnavailable } from './errors.js'
import type { ProjectChecksActivityEvent } from './receipt-activity.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: ProjectChecksActivityEvent): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
    'dshfiles/activity/source-ready'(payload: { readonly source: 'project-checks-receipts'; readonly version: 1 }): void
  }
}

const ENTRY_ID = 'dshfiles-project-checks'
const PACKAGE_NAME = '@dshfiles/project-checks'
const MAX_HOOK_EVENTS = 12

export type TurnStopping = Parameters<Events['agent/turn-stopping']>[0]

const decodeConfig = Schema.decodeUnknownEffect(projectChecksConfigSchema, { onExcessProperty: 'error' })
const decodeSessionId = Schema.decodeUnknownEffect(SessionId)
const decodeBackfill = Schema.decodeUnknownOption(
  Schema.Struct({ since: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))) }),
  { onExcessProperty: 'error' },
)

/** Resolves a command name to an absolute executable the way DSH subprocesses resolve them. */
export class Executables extends Context.Service<Executables, { readonly resolve: (command: string) => Effect.Effect<string, ExecutableUnresolved> }>()(
  '@dshfiles/project-checks/Executables',
) {
  static readonly layer = Layer.effect(
    Executables,
    Effect.gen(function* () {
      const subprocess = yield* hostService('subprocess')
      return Executables.of({
        resolve: Effect.fn('project-checks executable resolve')(function* (command) {
          return yield* Effect.tryPromise({
            try: signal => subprocess.resolveExecutable(command, undefined, signal),
            catch: cause => new ExecutableUnresolved({ command, cause }),
          })
        }),
      })
    }),
  )
}

/** The Host services Project Checks reads: its live profile row, session directories and hook events, and its events. */
export class ChecksHost extends Context.Service<
  ChecksHost,
  {
    readonly config: Effect.Effect<ProjectChecksConfig, ProfileConfigUnavailable>
    readonly sessionDirectory: (sessionId: string) => Effect.Effect<string, SessionPathUnavailable>
    readonly hookEvents: (sessionId: string) => Effect.Effect<ReadonlyArray<ProjectHookEvent>, SessionEventsUnavailable>
    readonly emitActivity: (event: ProjectChecksActivityEvent) => Effect.Effect<void>
    readonly announceVerified: (turn: ProjectChecksVerifiedTurn) => Effect.Effect<void>
    /** Each well-formed `dshfiles/activity/backfill` request, as the receipt time to replay from. */
    readonly onBackfill: <R>(handler: (since: number) => Effect.Effect<void, never, R>) => Effect.Effect<void, never, R | Scope.Scope>
    readonly onTurnStopping: <E, R>(handler: (event: TurnStopping) => Effect.Effect<void, E, R>) => Effect.Effect<void, never, R | Scope.Scope>
  }
>()('@dshfiles/project-checks/ChecksHost') {
  static readonly layer = Layer.effect(
    ChecksHost,
    Effect.gen(function* () {
      const host = yield* HostContext
      const configEditor = yield* hostService('configEditor')
      const sessionQuery = yield* hostService('sessionQuery')

      const config = Effect.gen(function* () {
        const matches = configEditor.entries().filter(entry => entry.options.id === ENTRY_ID && entry.options.name === PACKAGE_NAME)
        const entry = matches[0]
        if (matches.length !== 1 || entry?.fiber === undefined) return yield* new ProfileConfigUnavailable({ reason: 'row-missing' })
        return yield* decodeConfig(entry.options.config ?? {}).pipe(Effect.mapError(cause => new ProfileConfigUnavailable({ reason: 'invalid', cause })))
      })

      const sessionDirectory = Effect.fn('project-checks session directory')(function* (sessionId: string) {
        const id = yield* decodeSessionId(sessionId).pipe(Effect.orDie)
        const observed = yield* Effect.tryPromise({
          try: signal => sessionQuery.readTitleSnapshot(id, signal),
          catch: cause => new SessionPathUnavailable({ reason: 'unreadable', cause }),
        })
        const cwd = observed.session.cwd
        if (cwd === undefined) return yield* new SessionPathUnavailable({ reason: 'no-directory' })
        return cwd
      })

      const hookEvents = Effect.fn('project-checks hook events read')(function* (sessionId: string) {
        const id = yield* decodeSessionId(sessionId).pipe(Effect.orDie)
        const observations = yield* Effect.tryPromise({
          try: async signal => {
            const listed = await sessionQuery.listEvents(id)
            const selected = listed.filter(event => event.type === 'hook/invoked' || event.type === 'hook/result').slice(-MAX_HOOK_EVENTS)
            return Promise.all(selected.map(event => sessionQuery.readEvent({ sessionId: id, seq: event.seq }, signal)))
          },
          catch: cause => new SessionEventsUnavailable({ cause }),
        })
        const summaries = observations.flatMap((observation): ReadonlyArray<ProjectHookEvent> => {
          const event = observation.target
          if (event.type === 'hook/invoked')
            return [
              {
                seq: event.seq,
                time: event.time,
                kind: 'invoked',
                turn: event.data.turn,
                point: event.data.point,
                dialect: event.data.dialect,
                decision: null,
                exitCode: null,
                durationMs: null,
                stderrPresent: false,
              },
            ]
          if (event.type === 'hook/result')
            return [
              {
                seq: event.seq,
                time: event.time,
                kind: 'result',
                turn: event.data.turn,
                point: event.data.point,
                dialect: null,
                decision: event.data.decision,
                exitCode: event.data.exitCode ?? null,
                durationMs: event.data.durationMs,
                stderrPresent: event.data.stderrSummary !== undefined && event.data.stderrSummary.length > 0,
              },
            ]
          return []
        })
        return summaries.toSorted((left, right) => left.seq - right.seq).slice(-MAX_HOOK_EVENTS)
      })

      const listen = <K extends 'dshfiles/activity/backfill' | 'agent/turn-stopping'>(name: K, listener: Events[K]) =>
        Effect.acquireRelease(
          Effect.sync(() => host.ctx.on(name, listener)),
          dispose => Effect.sync(dispose),
        ).pipe(Effect.asVoid)

      return ChecksHost.of({
        config,
        sessionDirectory,
        hookEvents,
        emitActivity: event => Effect.sync(() => host.ctx.emit('dshfiles/activity/event', event)),
        announceVerified: Effect.fn('project-checks verified announce')(function* (turn) {
          yield* Effect.promise(() => host.ctx.serial('dshfiles/project-checks/verified', turn))
        }),
        onBackfill: handler =>
          Effect.gen(function* () {
            const run = yield* DshxPlugin.callback(handler)
            yield* listen('dshfiles/activity/backfill', payload => {
              const request = decodeBackfill(payload)
              if (Option.isSome(request)) void run(request.value.since ?? 0)
            })
            yield* Effect.sync(() => host.ctx.emit('dshfiles/activity/source-ready', { source: 'project-checks-receipts', version: 1 }))
          }),
        onTurnStopping: handler =>
          Effect.gen(function* () {
            const run = yield* DshxPlugin.callback(handler)
            yield* listen('agent/turn-stopping', event => run(event))
          }),
      })
    }),
  )
}
