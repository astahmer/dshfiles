import { Context as CordisContext } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { HostContext } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { undoSessionsLayer } from './host-edge-promise.js'
import { UndoSessions } from './undo-service.js'

const hostWith = (ctx: CordisContext, archived: readonly string[], plugin: CordisContext) => {
  // SAFETY: liveThreads reads only archivedSessionIds from the workspace registry.
  ctx.provide('workspaceRegistry', { archivedSessionIds: archived } as never)
  return Layer.succeed(HostContext, HostContext.of({ ctx: plugin, packageId: '@dshfiles/session-undo' }))
}

const prompted = (session: Session): Session => {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'write a file' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  return session
}

const liveThreadsOf = (ctx: CordisContext, archived: readonly string[], plugin: CordisContext = ctx) =>
  Effect.provide(
    UndoSessions.use(sessions => sessions.liveThreads),
    Layer.provide(undoSessionsLayer, hostWith(ctx, archived, plugin)),
  )

describe('undo sessions', () => {
  it.effect('reads the shared-directory guard from the attached Sessions only', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Effect.acquireRelease(
          Effect.promise(async () => new CordisContext()),
          context => Effect.promise(() => context.fiber.dispose()),
        )
        yield* Effect.promise(() => ctx.plugin(SessionStore))
        const started = (id: string, cwd: string, parent?: string) =>
          prompted(ctx.sessions.create(SessionId(id), { meta: parent === undefined ? { cwd } : { cwd, parentSession: SessionId(parent) } }))
        started('session-shared', '/workspace/shared')
        ctx.sessions.create(SessionId('session-blank'), { meta: { cwd: '/workspace/shared' } })
        // A New thread draft logs its settings before any message, and a turn can end before one enters it.
        ctx.sessions.create(SessionId('session-no-message'), { meta: { cwd: '/workspace/shared' } }).append('turn/start', { turn: 1 })
        started('session-archived', '/workspace/shared')
        started('session-child', '/workspace/shared', 'session-shared')
        started('session-elsewhere', '/workspace/elsewhere')
        prompted(ctx.sessions.create(SessionId('session-no-folder')))

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
        prompted(ctx.sessions.create(SessionId('session-live'), { meta: { cwd: '/workspace/shared' } }))
        expect(yield* liveThreadsOf(ctx, [])).toEqual([{ sessionId: 'session-live', cwd: '/workspace/shared', parentSessionId: null }])
      }),
    ),
  )

  it.effect('reads the Sessions from a plugin context that does not inject them, as the Host activates this plugin', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(async () => new CordisContext()),
          context => Effect.promise(() => context.fiber.dispose()),
        )
        yield* Effect.promise(() => root.plugin(SessionStore))
        prompted(root.sessions.create(SessionId('session-live'), { meta: { cwd: '/workspace/shared' } }))
        const plugin = yield* Effect.promise(
          () => new Promise<CordisContext>(resolve => void root.plugin({ name: 'session-undo-probe', apply: resolve })),
        )
        expect(yield* liveThreadsOf(root, [], plugin)).toEqual([{ sessionId: 'session-live', cwd: '/workspace/shared', parentSessionId: null }])
      }),
    ),
  )
})
