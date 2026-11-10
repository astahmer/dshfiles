import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Jj, JjViewReads } from '@dshfiles/jj-cli'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { jjSettingsTest } from './jj-settings.js'
import { ProjectBookmarks } from './project-bookmarks.js'
import type { JjIntegrationSettings } from './settings.js'

const gitAvailable = spawnSync('git', ['--version']).status === 0
const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  JJ_CONFIG: '',
  JJ_USER: 'Test',
  JJ_EMAIL: 'test@example.com',
}
const run = (cwd: string, command: string, ...args: string[]): void => {
  execFileSync(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** An origin whose default branch is `develop`, a plain git clone and a colocated jj clone of it. */
const repositories = Effect.acquireRelease(
  Effect.sync(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-bookmarks-')))
    const origin = join(root, 'origin')
    run(root, 'git', 'init', '-q', '-b', 'develop', origin)
    writeFileSync(join(origin, 'file.txt'), 'one')
    run(origin, 'git', 'add', '--all')
    run(origin, 'git', 'commit', '-q', '-m', 'one')
    const gitClone = join(root, 'git-clone')
    run(root, 'git', 'clone', '-q', origin, gitClone)
    const bare = join(root, 'bare')
    run(root, 'git', 'init', '-q', '-b', 'main', bare)
    return { root, origin, gitClone, bare }
  }),
  created => Effect.sync(() => rmSync(created.root, { recursive: true, force: true })),
)

const layer = (settings: Partial<JjIntegrationSettings> = {}) =>
  ProjectBookmarks.layer.pipe(
    Layer.provide(Layer.mergeAll(jjSettingsTest(settings), JjViewReads.layer.pipe(Layer.provide(Jj.layer)))),
    Layer.provideMerge(NodeServices.layer),
  )

describe.skipIf(!gitAvailable)('project main branch against real git', () => {
  it.live("uses origin's default branch when the project chose none", () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      const resolved = yield* ProjectBookmarks.use(bookmarks => bookmarks.resolve(repos.gitClone)).pipe(Effect.provide(layer()))
      expect(resolved).toMatchObject({ bookmark: 'develop', source: 'detected', detected: 'develop', override: null, declared: null })
    }).pipe(Effect.scoped),
  )

  it.live('lets the per-project choice win over dsh.project.json and the detected branch', () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      writeFileSync(join(repos.gitClone, 'dsh.project.json'), JSON.stringify({ bookmark: 'release' }))
      const declared = yield* ProjectBookmarks.use(bookmarks => bookmarks.resolve(repos.gitClone)).pipe(Effect.provide(layer()))
      expect(declared).toMatchObject({ bookmark: 'release', source: 'file' })
      const chosen = yield* ProjectBookmarks.use(bookmarks => bookmarks.describe(repos.gitClone)).pipe(
        Effect.provide(layer({ repositoryBookmarks: [{ repository: `${repos.gitClone}/`, bookmark: 'staging' }] })),
      )
      expect(chosen).toMatchObject({ bookmark: 'staging', source: 'project', declared: 'release', detected: 'develop' })
    }).pipe(Effect.scoped),
  )

  it.live('ignores an origin default branch that has no local branch: status and cleanup compare local bookmarks', () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      run(repos.gitClone, 'git', 'checkout', '-q', '--detach')
      run(repos.gitClone, 'git', 'branch', '-q', '-D', 'develop')
      const resolved = yield* ProjectBookmarks.use(bookmarks => bookmarks.resolve(repos.gitClone)).pipe(Effect.provide(layer({ bookmark: 'main' })))
      expect(resolved).toMatchObject({ bookmark: 'main', source: 'global', detected: null })
    }).pipe(Effect.scoped),
  )

  it.live('saves concurrent choices for two projects without dropping either, and clears one with null', () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      const program = Effect.gen(function* () {
        const bookmarks = yield* ProjectBookmarks
        const [clone, bare] = yield* Effect.all(
          [bookmarks.choose({ repositoryRoot: repos.gitClone, bookmark: 'staging' }), bookmarks.choose({ repositoryRoot: repos.bare, bookmark: 'trunk' })],
          { concurrency: 'unbounded' },
        )
        expect(clone).toMatchObject({ bookmark: 'staging', source: 'project' })
        expect(bare).toMatchObject({ bookmark: 'trunk', source: 'project' })
        expect(yield* bookmarks.resolve(repos.gitClone)).toMatchObject({ bookmark: 'staging', source: 'project' })
        expect(yield* bookmarks.choose({ repositoryRoot: repos.gitClone, bookmark: null })).toMatchObject({ bookmark: 'develop', source: 'detected' })
        expect(yield* bookmarks.resolve(repos.bare)).toMatchObject({ bookmark: 'trunk', source: 'project' })
      })
      yield* program.pipe(Effect.provide(layer()))
    }).pipe(Effect.scoped),
  )

  it.live('falls back to the global setting for a repository without an origin', () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      const resolved = yield* ProjectBookmarks.use(bookmarks => bookmarks.resolve(repos.bare)).pipe(Effect.provide(layer({ bookmark: 'trunk' })))
      expect(resolved).toMatchObject({ bookmark: 'trunk', source: 'global', detected: null })
    }).pipe(Effect.scoped),
  )

  it.live.skipIf(!jjAvailable)("reads origin's default branch from a jj clone's trunk() alias", () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      const jjClone = join(repos.root, 'jj-clone')
      run(repos.root, 'jj', 'git', 'clone', '--colocate', repos.origin, jjClone)
      const resolved = yield* ProjectBookmarks.use(bookmarks => bookmarks.resolve(jjClone)).pipe(Effect.provide(layer()))
      expect(resolved).toMatchObject({ bookmark: 'develop', source: 'detected' })
    }).pipe(Effect.scoped),
  )

  it.live("reads origin's default branch from the common git directory of a linked worktree", () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      const worktree = join(repos.root, 'worktree')
      run(repos.gitClone, 'git', 'worktree', 'add', '-q', '-b', 'topic', worktree)
      const resolved = yield* ProjectBookmarks.use(bookmarks => bookmarks.resolve(worktree)).pipe(Effect.provide(layer()))
      expect(resolved).toMatchObject({ bookmark: 'develop', source: 'detected' })
    }).pipe(Effect.scoped),
  )

  it.live.skipIf(!jjAvailable)('ignores a trunk() alias from the user configuration: only the repository records origin’s default', () =>
    Effect.gen(function* () {
      const repos = yield* repositories
      const jjRepo = join(repos.root, 'jj-init')
      run(repos.root, 'jj', 'git', 'init', '--colocate', jjRepo)
      run(jjRepo, 'git', 'remote', 'add', 'origin', repos.origin)
      run(jjRepo, 'git', 'fetch', '-q', 'origin')
      // git 2.48+ records origin/HEAD on fetch; without it, only a trunk() alias could name the default branch.
      run(jjRepo, 'git', 'remote', 'set-head', 'origin', '--delete')
      const userConfig = join(repos.root, 'user-config.toml')
      writeFileSync(userConfig, 'revset-aliases."trunk()" = "develop@origin"\n')
      const previous = process.env.JJ_CONFIG
      process.env.JJ_CONFIG = userConfig
      const resolved = yield* ProjectBookmarks.use(bookmarks => bookmarks.resolve(jjRepo)).pipe(
        Effect.provide(layer({ bookmark: 'main' })),
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.JJ_CONFIG
            else process.env.JJ_CONFIG = previous
          }),
        ),
      )
      expect(resolved).toMatchObject({ bookmark: 'main', source: 'global', detected: null })
    }).pipe(Effect.scoped),
  )
})
