import { execFileSync, spawnSync } from 'node:child_process'
import { Jj, JjViewReads } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath, NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, FileSystem, Layer, Path } from 'effect'
import { TestClock } from 'effect/testing'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { ComposerContext } from './composer-context-host.js'
import { JujutsuServicesLive } from './jujutsu-services.js'
import { Mutations } from './mutations.js'
import { Repositories } from './repositories.js'
import { RevisionReader } from './revision-reader.js'

/**
 * The panel and composer services over real jj processes and a TestClock: a command still running after 30 s is
 * stopped as a timeout, a preview is refused once it is five minutes old, and the composer reads jj again only after
 * an operation lands (or its two-second snapshot read expires). A `diff` can be swapped for `sleep 60` to reach the
 * command timeout; `started` resolves once that stand-in is running, so time moves only after its timer exists.
 */

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '' }

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })

const slowDiffSpawner = (input: { readonly slow: { current: boolean }; readonly started: Deferred.Deferred<void> }) =>
  Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const node = yield* ChildProcessSpawner.ChildProcessSpawner
      return ChildProcessSpawner.make(command => {
        if (command._tag !== 'StandardCommand' || !input.slow.current || !command.args.includes('diff')) return node.spawn(command)
        return node
          .spawn(ChildProcess.make('sleep', ['60'], { cwd: command.options.cwd, stdin: 'ignore' }))
          .pipe(Effect.tap(() => Deferred.succeed(input.started, undefined)))
      })
    }),
  ).pipe(Layer.provide(NodeServices.layer))

const servicesWith = (spawner: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>) =>
  JujutsuServicesLive.pipe(
    Layer.provideMerge(JjViewReads.layer),
    Layer.provideMerge(Jj.layer),
    Layer.provideMerge(Layer.mergeAll(spawner, NodeFileSystem.layer, NodePath.layer)),
  )

const temporaryRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.realPath(yield* fileSystem.makeTempDirectoryScoped({ prefix: 'jujutsu-services-' }))
  const repo = path.join(root, 'repo')
  execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env })
  jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
  jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
  yield* fileSystem.writeFileString(path.join(repo, 'shared.txt'), 'one\n')
  jj(repo, 'commit', '-m', 'base')
  return repo
}).pipe(Effect.provide(NodeServices.layer))

const countingSpawner = (spawned: string[]) =>
  Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const node = yield* ChildProcessSpawner.ChildProcessSpawner
      return ChildProcessSpawner.make(command => {
        if (command._tag === 'StandardCommand') spawned.push(command.args.join(' '))
        return node.spawn(command)
      })
    }),
  ).pipe(Layer.provide(NodeServices.layer))

const withRemoteMain = (repo: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const remote = path.join(path.dirname(repo), 'remote.git')
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })
    jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
    jj(repo, 'git', 'remote', 'add', 'origin', remote)
    jj(repo, 'bookmark', 'track', 'main@origin')
    jj(repo, 'git', 'export')
    const gitDir = (yield* fileSystem.exists(path.join(repo, '.git'))) ? path.join(repo, '.git') : path.join(repo, '.jj', 'repo', 'store', 'git')
    execFileSync('git', ['--git-dir', gitDir, 'push', remote, 'refs/heads/main:refs/heads/main'], { stdio: 'ignore' })
    jj(repo, 'git', 'fetch', '--remote', 'origin')
  }).pipe(Effect.provide(NodeServices.layer))

describe.skipIf(!jjAvailable)('jujutsu services', () => {
  it.effect('composer context decodes remote bookmarks and re-reads only after an operation lands', () =>
    Effect.gen(function* () {
      const spawned: string[] = []
      const repo = yield* temporaryRepository
      yield* withRemoteMain(repo)
      yield* Effect.gen(function* () {
        const context = ComposerContext.use(composer => composer.context({ cwd: repo, base: { kind: 'bookmark', name: 'main' } }))
        const first = yield* context
        expect(first.repository?.remoteBookmarks).toContainEqual({ name: 'main', remote: 'origin' })
        expect(first.repository?.base).toEqual({ label: 'main', found: true })
        const spawnedForFirst = spawned.length
        expect(spawnedForFirst).toBeGreaterThan(0)

        yield* context
        expect(spawned).toHaveLength(spawnedForFirst)

        jj(repo, 'describe', '-m', 'landed')
        yield* TestClock.adjust('2 seconds')
        const landed = yield* context
        expect(landed.repository?.description.trim()).toBe('landed')
        expect(spawned.length).toBeGreaterThan(spawnedForFirst)
      }).pipe(Effect.provide(servicesWith(countingSpawner(spawned))))
    }).pipe(Effect.scoped),
  )

  it.effect('display loads share one in-flight snapshot and reuse evolution flags of an unchanged page', () =>
    Effect.gen(function* () {
      const spawned: string[] = []
      const repo = yield* temporaryRepository
      yield* Effect.gen(function* () {
        const { id: repoId } = yield* Repositories.use(repositories => repositories.register(repo))
        const load = RevisionReader.use(reader => reader.load({ repoId, limit: 10 }))
        const count = (verb: string, from: number) => spawned.slice(from).filter(args => args.split(' ').includes(verb)).length

        let mark = spawned.length
        const together = yield* Effect.all([load, load, load, load], { concurrency: 'unbounded' })
        expect(new Set(together.map(state => JSON.stringify(state))).size).toBe(1)
        expect(count('status', mark)).toBe(1)
        expect(count('evolog', mark)).toBe(1)

        mark = spawned.length
        yield* load
        expect(count('status', mark)).toBe(1)
        expect(count('evolog', mark)).toBe(0)

        jj(repo, 'new', '-m', 'next')
        mark = spawned.length
        const next = yield* load
        expect(next.revisions[0]?.description.trim()).toBe('next')
        expect(count('evolog', mark)).toBe(1)
      }).pipe(Effect.provide(servicesWith(countingSpawner(spawned))))
    }).pipe(Effect.scoped),
  )

  it.effect('the last push is found again from only the operations newer than the previous scan', () =>
    Effect.gen(function* () {
      const spawned: string[] = []
      const repo = yield* temporaryRepository
      yield* withRemoteMain(repo)
      yield* Effect.gen(function* () {
        const { id: repoId } = yield* Repositories.use(repositories => repositories.register(repo))
        const load = RevisionReader.use(reader => reader.load({ repoId, limit: 10 }))
        const operationLimits = (from: number) =>
          spawned
            .slice(from)
            .filter(args => args.includes(' op log '))
            .map(args => args.split(' ')[args.split(' ').indexOf('--limit') + 1])

        let mark = spawned.length
        expect((yield* load).lastPushAt).toBeNull()
        expect(operationLimits(mark)).toEqual(['1000'])

        jj(repo, 'describe', '-m', 'pushed')
        jj(repo, 'bookmark', 'set', 'main', '-r', '@')
        jj(repo, 'git', 'push', '--remote', 'origin', '--bookmark', 'main')
        mark = spawned.length
        const pushed = yield* load
        expect(pushed.lastPushAt).not.toBeNull()
        expect(operationLimits(mark)).toEqual(['64'])

        jj(repo, 'new', '-m', 'after the push')
        mark = spawned.length
        const later = yield* load
        expect(later.lastPushAt).toBe(pushed.lastPushAt)
        expect(operationLimits(mark)).toEqual(['64'])
      }).pipe(Effect.provide(servicesWith(countingSpawner(spawned))))
    }).pipe(Effect.scoped),
  )

  it.effect('a shared composer read keeps running for the caller that stays when another one leaves', () =>
    Effect.gen(function* () {
      const repo = yield* temporaryRepository
      yield* Effect.gen(function* () {
        const diff = ComposerContext.use(composer => composer.diff({ cwd: repo, base: { kind: 'parent' } }))
        const leaving = yield* Effect.forkChild(diff)
        const staying = yield* Effect.forkChild(diff)
        yield* Fiber.interrupt(leaving)
        expect((yield* Fiber.join(staying)).truncated).toBe(false)
      }).pipe(Effect.provide(servicesWith(NodeServices.layer)))
    }).pipe(Effect.scoped),
  )
  it.effect('stops a command that outlived the 30 s command timeout', () =>
    Effect.gen(function* () {
      const slow = { current: false }
      const started = yield* Deferred.make<void>()
      const repo = yield* temporaryRepository
      yield* Effect.gen(function* () {
        const { id: repoId } = yield* Repositories.use(repositories => repositories.register(repo))
        slow.current = true
        const diff = yield* Effect.forkChild(RevisionReader.use(reader => reader.workingDiff(repoId)))
        yield* Deferred.await(started)
        yield* TestClock.adjust('29 seconds')
        expect(diff.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust('1 second')
        const error = yield* Effect.flip(Fiber.join(diff))
        expect({ tag: error._tag, message: error.message }).toEqual({ tag: 'JujutsuTimedOut', message: 'Jujutsu command timed out.' })
      }).pipe(Effect.provide(servicesWith(slowDiffSpawner({ slow, started }))))
    }).pipe(Effect.scoped),
  )

  it.effect('refuses a preview once it is five minutes old', () =>
    Effect.gen(function* () {
      const repo = yield* temporaryRepository
      yield* Effect.gen(function* () {
        const { id: repoId } = yield* Repositories.use(repositories => repositories.register(repo))
        const state = yield* RevisionReader.use(reader => reader.load({ repoId, limit: 50 }))
        const workingCopy = state.revisions.find(revision => revision.workingCopy)
        if (workingCopy === undefined) return yield* Effect.die('no working-copy revision')
        const action = { kind: 'describe', commitId: workingCopy.commitId, message: 'feat: described through a preview' } as const
        const stale = yield* Mutations.use(mutations => mutations.prepare({ repoId, action }))
        expect(stale.expiresAt).toBe(5 * 60_000)
        yield* TestClock.adjust('5 minutes')
        const error = yield* Effect.flip(Mutations.use(mutations => mutations.confirm({ repoId, previewId: stale.id })))
        expect({ tag: error._tag, message: error.message }).toEqual({
          tag: 'PreviewExpired',
          message: 'Preview expired or repository state changed. Refresh and preview again.',
        })

        const fresh = yield* Mutations.use(mutations => mutations.prepare({ repoId, action }))
        yield* TestClock.adjust('4 minutes')
        expect((yield* Mutations.use(mutations => mutations.confirm({ repoId, previewId: fresh.id }))).message).toBe('Update description completed.')
      }).pipe(Effect.provide(servicesWith(NodeServices.layer)))
    }).pipe(Effect.scoped),
  )
})
