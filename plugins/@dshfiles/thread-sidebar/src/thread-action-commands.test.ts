import { HostContext } from '@dshfiles/dshx/effect'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Ref } from 'effect'
import { ThreadHostCallFailed } from './sidebar-errors.js'
import { createThreadActions, type ThreadActionDeps } from './thread-actions.js'
import { ThreadActions, threadCommandsLayer } from './thread-host-promise.js'

const unused = () => Effect.die('not used by the slash commands')

/** Thread actions over a Host whose settle and archive outcomes the test sets. */
const actionsLayer = (input: { readonly settled: Ref.Ref<ReadonlyArray<string>>; readonly archiveRefusal: boolean }) => {
  const deps: ThreadActionDeps = {
    listSessions: unused,
    readTitles: unused,
    listThreadRelations: unused,
    searchThreadContent: unused,
    projects: () => [],
    archivedSessionIds: () => [],
    pinnedSessionIds: () => [],
    settledSessionIds: () => [],
    setSettled: sessionId => Ref.updateAndGet(input.settled, ids => [...ids, sessionId]),
    archive: sessionId =>
      input.archiveRefusal
        ? Effect.fail(new ThreadHostCallFailed({ cause: { code: 'workspace/session-active', details: { activity: [{ kind: 'turn' }] } } }))
        : Effect.succeed([sessionId]),
    unarchive: unused,
    pin: unused,
    unpin: unused,
    rename: unused,
    fork: unused,
    continueIn: unused,
    create: unused,
    prompt: unused,
    ownWorkspaceFor: unused,
    stop: unused,
    selectModel: unused,
    inspectProject: unused,
    registerProject: unused,
    renameProject: unused,
    deleteProject: unused,
    reorderProject: unused,
    moveSession: unused,
  }
  return Layer.succeed(ThreadActions, ThreadActions.of(createThreadActions(deps)))
}

/** dshx's in-memory Host with DSH's real command runtime. */
class TestCommands extends Context.Service<TestCommands, TestHost['commands']>()('test/TestCommands') {}

const testHost = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      host => Effect.promise(() => host.dispose()),
    ),
    host =>
      Layer.mergeAll(
        Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/thread-sidebar' })),
        Layer.succeed(TestCommands, host.commands),
      ),
  ),
)

const run = (name: string, rawInput: string) =>
  Effect.gen(function* () {
    const command = (yield* TestCommands).get(name)
    if (command === undefined) return yield* Effect.die(`/${name} is not registered`)
    const invocation = { rawInput, agent: { id: 'session-self' }, signal: new AbortController().signal }
    // SAFETY: the slash commands read only rawInput, agent.id and signal of their invocation.
    return yield* Effect.promise(async () => command.handler(invocation as unknown as Parameters<typeof command.handler>[0]))
  })

describe('thread lifecycle slash commands', () => {
  it.effect('/settle settles the calling thread and /archive archives it', () =>
    Effect.gen(function* () {
      const settled = yield* Ref.make<ReadonlyArray<string>>([])
      yield* Effect.gen(function* () {
        expect(yield* run('settle', '')).toEqual({ kind: 'success', text: 'Settled thread session-self.' })
        expect(yield* Ref.get(settled)).toEqual(['session-self'])
        expect(yield* run('settle', 'extra')).toEqual({ kind: 'error', text: 'Usage: /settle' })
        expect(yield* run('archive', '')).toEqual({ kind: 'success', text: 'Archived thread session-self.' })
      }).pipe(Effect.provide(threadCommandsLayer.pipe(Layer.provideMerge(actionsLayer({ settled, archiveRefusal: false })), Layer.provideMerge(testHost))))
    }),
  )

  it.effect('/archive explains a refusal while the thread still runs', () =>
    Effect.gen(function* () {
      const settled = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run('archive', '').pipe(
        Effect.provide(threadCommandsLayer.pipe(Layer.provideMerge(actionsLayer({ settled, archiveRefusal: true })), Layer.provideMerge(testHost))),
      )
      expect(result).toEqual({
        kind: 'error',
        text: 'Cannot archive thread session-self while it has running work (turn). Stop it first, then run /archive again.',
      })
    }),
  )
})
