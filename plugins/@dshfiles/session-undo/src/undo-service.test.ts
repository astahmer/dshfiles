import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Fiber, Layer, Option, Ref } from 'effect'
import { SessionForkFailed, SessionUndo, UndoFiles, UndoSessions } from './undo-service.js'

const storageHost = Layer.effect(
  HostContext,
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'session-undo-'))),
      directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    )
    const ctx = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const context = new CordisContext()
        await context.plugin(Storage)
        await context.plugin(StorageJson, { root })
        await context.plugin(StorageDomainPlugin, { backend: 'json' })
        return context
      }),
      context => Effect.promise(() => context.fiber.dispose()),
    )
    return HostContext.of({ ctx, packageId: '@dshfiles/session-undo' })
  }),
)

/** A VCS provider is external to the plugin: this workspace's "files" are one string and snapshots are numbered copies. */
const workspace = (initial: string, snapshot?: Effect.Effect<void>) => {
  const state = { files: initial, snapshots: new Map<string, string>() }
  const take = (): string => {
    const id = `snap-${String(state.snapshots.size + 1)}`
    state.snapshots.set(id, state.files)
    return id
  }
  const files = UndoFiles.of({
    snapshot: () =>
      Effect.andThen(
        snapshot ?? Effect.void,
        Effect.sync(() => (snapshot === undefined ? Option.some({ provider: '@test/vcs', snapshot: take() }) : Option.none())),
      ),
    restore: input =>
      Effect.sync(() => {
        const previous = take()
        state.files = state.snapshots.get(input.snapshot) ?? state.files
        return previous
      }),
  })
  return { state, files }
}

/** The Session controller and workspace registry are external too: forks are numbered, archives a set. */
const sessionsFake = () => {
  const forks: Array<{ readonly sessionId: string; readonly atSeq: number }> = []
  const state = { archived: new Set<string>(), forks, failFork: false }
  const sessions = UndoSessions.of({
    fork: input =>
      Effect.suspend(() => {
        if (state.failFork) return Effect.fail(new SessionForkFailed({ cause: new Error('fork refused') }))
        state.forks.push(input)
        return Effect.succeed(`fork-${String(state.forks.length)}`)
      }),
    copyModel: () => Effect.void,
    archive: sessionId => Effect.sync(() => state.archived.add(sessionId)),
    unarchive: sessionId => Effect.sync(() => state.archived.delete(sessionId)),
  })
  return { state, sessions }
}

const undoWith = (input: { readonly files: UndoFiles['Service']; readonly sessions: UndoSessions['Service'] }) =>
  Effect.map(
    Layer.build(
      SessionUndo.layer.pipe(
        Layer.provide(Layer.mergeAll(Layer.succeed(UndoFiles, input.files), Layer.succeed(UndoSessions, input.sessions), StorageDomain.layer)),
        Layer.provide(storageHost),
      ),
    ),
    Context.get(SessionUndo),
  )

const setup = Effect.gen(function* () {
  const files = workspace('v0')
  const sessions = sessionsFake()
  const service = yield* undoWith({ files: files.files, sessions: sessions.sessions })
  const turn = (input: { readonly sessionId: string; readonly turn: number; readonly forkAtSeq: number }) =>
    Effect.andThen(service.turnStarted({ ...input, cwd: '/repo' }), service.whenReady(input.sessionId))
  return { files, sessions, service, turn }
})

describe('session undo', () => {
  it.effect('undoes the last turn into a fork cut before it with its files restored, and redoes it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { files, sessions, service, turn } = yield* setup
        yield* turn({ sessionId: 's1', turn: 1, forkAtSeq: 4 })
        yield* service.promptEntered({ sessionId: 's1', turn: 1, text: 'add a feature' })
        yield* service.promptEntered({ sessionId: 's1', turn: 1, text: 'a later message of the same turn' })
        files.state.files = 'v1'
        yield* turn({ sessionId: 's1', turn: 2, forkAtSeq: 20 })
        files.state.files = 'v2'

        expect((yield* service.history('s1')).checkpoints.map(checkpoint => [checkpoint.turn, checkpoint.prompt, checkpoint.files])).toEqual([
          [1, 'add a feature', true],
          [2, '', true],
        ])

        const undone = yield* service.undo('s1')
        expect(undone).toEqual({ sessionId: 'fork-1', filesRestored: true, prompt: '' })
        expect(files.state.files).toBe('v1')
        expect(sessions.state.forks).toEqual([{ sessionId: 's1', atSeq: 20 }])
        expect(sessions.state.archived).toEqual(new Set(['s1']))
        expect(yield* service.history('fork-1')).toMatchObject({ checkpoints: [{ turn: 1, prompt: 'add a feature', files: true }], redoTo: 's1' })

        const again = yield* service.undo('fork-1')
        expect(files.state.files).toBe('v0')
        expect(sessions.state.forks.at(-1)).toEqual({ sessionId: 'fork-1', atSeq: 4 })

        expect(yield* service.redo(again.sessionId)).toEqual({ sessionId: 'fork-1', filesRestored: true })
        expect(files.state.files).toBe('v1')
        expect(yield* service.redo('fork-1')).toEqual({ sessionId: 's1', filesRestored: true })
        expect(files.state.files).toBe('v2')
        expect(sessions.state.archived.has('s1')).toBe(false)
        expect(sessions.state.archived.has('fork-1')).toBe(true)
        expect((yield* Effect.flip(service.redo('fork-1'))).message).toMatch('nothing to redo')
      }),
    ),
  )

  it.effect('refuses while the thread runs, and with nothing recorded', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, turn } = yield* setup
        expect(yield* Effect.flip(service.undo('s1'))).toMatchObject({ _tag: 'NothingToUndo' })
        yield* turn({ sessionId: 's1', turn: 1, forkAtSeq: 4 })
        yield* service.turnRunning('s1')
        const running = yield* Effect.flip(service.undo('s1'))
        expect(running._tag).toBe('Running')
        expect(running.message).toMatch('still running')
        yield* service.turnEnded('s1')
        expect((yield* service.undo('s1')).sessionId).toBe('fork-1')
      }),
    ),
  )

  it.effect('a new turn in the fork drops its redo', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, turn } = yield* setup
        yield* turn({ sessionId: 's1', turn: 1, forkAtSeq: 4 })
        const { sessionId } = yield* service.undo('s1')
        yield* turn({ sessionId, turn: 1, forkAtSeq: 4 })
        expect((yield* service.history(sessionId)).redoTo).toBeNull()
      }),
    ),
  )

  it.effect('puts the files back when the conversation cannot be forked', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { files, sessions, service, turn } = yield* setup
        yield* turn({ sessionId: 's1', turn: 1, forkAtSeq: 4 })
        files.state.files = 'v1'
        sessions.state.failFork = true
        expect((yield* Effect.flip(service.undo('s1')))._tag).toBe('SessionForkFailed')
        expect(files.state.files).toBe('v1')
        expect(sessions.state.archived.size).toBe(0)
      }),
    ),
  )

  it.effect('records a turn without files when no provider claims the folder, and holds tool calls until the snapshot is taken', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const files = workspace('v0', Deferred.await(gate))
        const service = yield* undoWith({ files: files.files, sessions: sessionsFake().sessions })
        yield* service.turnStarted({ sessionId: 's1', turn: 1, forkAtSeq: 4, cwd: '/scratch' })
        const ready = yield* Ref.make(false)
        const waiting = yield* Effect.forkChild(Effect.andThen(service.whenReady('s1'), Ref.set(ready, true)))
        yield* Effect.yieldNow
        expect(yield* Ref.get(ready)).toBe(false)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(waiting)
        expect(yield* Ref.get(ready)).toBe(true)
        expect((yield* service.history('s1')).checkpoints[0]?.files).toBe(false)
        expect(yield* service.undo('s1')).toMatchObject({ filesRestored: false })
      }),
    ),
  )
})
