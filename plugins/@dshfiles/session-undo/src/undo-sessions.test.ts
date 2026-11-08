import { Context as CordisContext } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { HostContext } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { undoSessionsLayer } from './host-edge-promise.js'
import { UndoSessions } from './undo-service.js'

const hostWith = (ctx: CordisContext, archived: readonly string[]) => {
  // SAFETY: liveThreads reads only archivedSessionIds from the workspace registry.
  ctx.provide('workspaceRegistry', { archivedSessionIds: archived } as never)
  return Layer.succeed(HostContext, HostContext.of({ ctx, packageId: '@dshfiles/session-undo' }))
}

const liveThreadsOf = (ctx: CordisContext, archived: readonly string[]) =>
  Effect.provide(UndoSessions.use(sessions => sessions.liveThreads), Layer.provide(undoSessionsLayer, hostWith(ctx, archived)))

describe('undo sessions', () => {
  it.effect('reads the shared-directory guard from the attached Sessions only', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Effect.acquireRelease(
          Effect.promise(async () => new CordisContext()),
          context => Effect.promise(() => context.fiber.dispose()),
        )
        yield* Effect.promise(() => ctx.plugin(SessionStore))
        const started = (id: string, cwd: string, parent?: string) => {
          const session = ctx.sessions.create(SessionId(id), {
            meta: parent === undefined ? { cwd } : { cwd, parentSession: SessionId(parent) },
          })
          session.append('turn/start', { turn: 1 })
          return session
        }
        started('session-shared', '/workspace/shared')
        ctx.sessions.create(SessionId('session-blank'), { meta: { cwd: '/workspace/shared' } })
        started('session-archived', '/workspace/shared')
        started('session-child', '/workspace/shared', 'session-shared')
        started('session-elsewhere', '/workspace/elsewhere')
        const noFolder = ctx.sessions.create(SessionId('session-no-folder'))
        noFolder.append('turn/start', { turn: 1 })

        expect(yield* liveThreadsOf(ctx, ['session-archived'])).toEqual([
          { sessionId: 'session-shared', cwd: '/workspace/shared', parentSessionId: null },
          { sessionId: 'session-child', cwd: '/workspace/shared', parentSessionId: 'session-shared' },
          { sessionId: 'session-elsewhere', cwd: '/workspace/elsewhere', parentSessionId: null },
        ])
      }),
    ),
  )

  it.effect('names every attached thread once nothing is archived', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Effect.acquireRelease(
          Effect.promise(async () => new CordisContext()),
          context => Effect.promise(() => context.fiber.dispose()),
        )
        yield* Effect.promise(() => ctx.plugin(SessionStore))
        const session = ctx.sessions.create(SessionId('session-live'), { meta: { cwd: '/workspace/shared' } })
        session.append('turn/start', { turn: 1 })
        expect(yield* liveThreadsOf(ctx, [])).toEqual([
          { sessionId: 'session-live', cwd: '/workspace/shared', parentSessionId: null },
        ])
      }),
    ),
  )
})
