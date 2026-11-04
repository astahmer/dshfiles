import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import WorkspaceRegistryPlugin from '@deepseek-ai/dsh-workspace'
import { HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { GitWorktrees } from './git-worktrees.js'
import gitWorktreesHost from './host.js'
import { gitWorktreesSettings } from './settings.js'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** A committed repository with one tracked file and one ignored path, in a fresh temporary directory. */
const repository = Effect.acquireRelease(
  Effect.sync(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'git-worktrees-')))
    const repo = join(root, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    writeFileSync(join(repo, 'shared.txt'), 'one\n')
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
    return { root, repo }
  }),
  fixture => Effect.sync(() => rmSync(fixture.root, { recursive: true, force: true })),
)

/** A real test Host with the native local subprocess runtime and the workspace registry over JSON storage. */
const testHost = Effect.acquireRelease(
  Effect.promise(async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'git-worktrees-storage-'))
    const host = await createTestHost()
    await host.ctx.plugin(LocalSubprocessRuntime)
    await host.ctx.plugin(Storage)
    await host.ctx.plugin(StorageJson, { root: storageRoot })
    await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    await host.ctx.plugin(JsonlPersistence, { root: join(storageRoot, 'sessions') })
    await host.ctx.plugin(WorkspaceRegistryPlugin)
    host.ctx.provide('settings', { configure: () => () => undefined, describe: () => [], update: async () => undefined, replace: async () => undefined })
    return { host, storageRoot }
  }),
  created =>
    Effect.promise(async () => {
      await created.host.dispose()
      rmSync(created.storageRoot, { recursive: true, force: true })
    }),
)

const worktreesLayer = Layer.unwrap(
  Effect.map(testHost, ({ host }) =>
    GitWorktrees.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          DshChildProcessSpawner.layer.pipe(Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/git-worktrees' }))),
          nodeFileSystemLayer,
          nodePathLayer,
          Settings.layerTest(gitWorktreesSettings.namespace, { isolate: false, threadsDirectory: '' }),
        ),
      ),
    ),
  ),
)

const wireEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

type ApiInput = Parameters<TestHost['connection']['requestApi']>[0]['input']

describe('git worktrees against real git', () => {
  it.layer(worktreesLayer)(it => {
    it.effect('provisions a thread worktree on its own branch and recognises it', () =>
      Effect.gen(function* () {
        const { repo } = yield* repository
        const worktrees = yield* GitWorktrees
        const thread = yield* worktrees.provision(repo, undefined)

        expect(thread.path).toBe(join(`${repo}-threads`, thread.name))
        expect(readFileSync(join(thread.path, 'shared.txt'), 'utf8')).toBe('one\n')
        expect(yield* worktrees.locate(thread.path)).toEqual({ repoRoot: repo, workspaceRoot: thread.path, threadName: thread.name })
        expect(yield* worktrees.locate(repo)).toEqual({ repoRoot: repo, workspaceRoot: repo, threadName: undefined })
        expect(yield* worktrees.worktrees(repo)).toEqual([{ name: thread.name, path: thread.path, branch: `dsh/${thread.name}` }])

        yield* worktrees.remove(thread.path, false)
        expect(existsSync(thread.path)).toBe(false)
        expect(yield* worktrees.worktrees(repo)).toEqual([])
      }),
    )

    it.effect('restores files to a snapshot and back, leaving the index, HEAD and ignored files alone', () =>
      Effect.gen(function* () {
        const { repo } = yield* repository
        const worktrees = yield* GitWorktrees
        const head = git(repo, 'rev-parse', 'HEAD')
        writeFileSync(join(repo, 'untracked.txt'), 'kept\n')
        const before = yield* worktrees.snapshot(repo)
        writeFileSync(join(repo, 'shared.txt'), 'two\n')
        writeFileSync(join(repo, 'added.txt'), 'new\n')
        writeFileSync(join(repo, 'ignored.txt'), 'local\n')
        rmSync(join(repo, 'untracked.txt'))

        const redo = yield* worktrees.restore(repo, before)

        expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('one\n')
        expect(readFileSync(join(repo, 'untracked.txt'), 'utf8')).toBe('kept\n')
        expect(existsSync(join(repo, 'added.txt'))).toBe(false)
        expect(readFileSync(join(repo, 'ignored.txt'), 'utf8')).toBe('local\n')
        expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
        expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')

        yield* worktrees.restore(repo, redo)
        expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('two\n')
        expect(readFileSync(join(repo, 'added.txt'), 'utf8')).toBe('new\n')
        expect(existsSync(join(repo, 'untracked.txt'))).toBe(false)
        const invalid = yield* Effect.flip(worktrees.restore(repo, 'HEAD~1'))
        expect(invalid.message).toBe('That snapshot is not a git commit id.')
      }),
    )
  })

  it.effect('is not a repository outside git and refuses to remove the project checkout', () =>
    Effect.gen(function* () {
      const { root, repo } = yield* repository
      const { host } = yield* testHost
      yield* Effect.promise(() => host.mount(gitWorktreesHost, { packageId: '@dshfiles/git-worktrees' }))
      const call = (method: string, input: ApiInput) =>
        Effect.promise(async () => {
          const response = await host.connection.requestApi({ packageId: '@dshfiles/git-worktrees', apiId: 'git-worktrees', method, version: 1, input })
          return Schema.decodeUnknownSync(wireEnvelope)(await response.json()).result
        })

      using recorder = recordSpans()
      expect(yield* call('worktrees', { path: root })).toEqual({ ok: true, value: { output: { worktrees: [] } } })
      const span = recorder.span('git rev-parse')
      expect(span.status.code).toBe('error')
      expect(JSON.stringify(span.attributes)).not.toContain(root)

      expect(yield* call('remove', { path: repo, force: true })).toEqual({
        ok: false,
        error: { code: 'not-a-thread', message: `${repo} is not a thread worktree this plugin created.` },
      })

      const thread = join(`${repo}-threads`, 'thread-abc123')
      git(repo, 'worktree', 'add', '-q', '-b', 'dsh/thread-abc123', thread)
      const registry = host.ctx.get('workspaceRegistry')
      if (registry === undefined) return expect.fail('the test Host serves the workspace registry')
      const registered = yield* Effect.promise(() => registry.create(thread, 'repo · thread-abc123'))
      expect(yield* call('worktrees', { path: repo })).toEqual({
        ok: true,
        value: { output: { worktrees: [{ name: 'thread-abc123', path: thread, branch: 'dsh/thread-abc123' }] } },
      })
      expect(yield* call('remove', { path: thread, force: false })).toEqual({ ok: true, value: { output: { removed: true } } })
      expect(existsSync(thread)).toBe(false)
      expect(registry.get(registered.id)).toBeUndefined()
    }),
  )
})
