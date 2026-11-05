import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Git } from '@dshfiles/git-cli'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { AutoFetchModel } from './auto-fetch.js'

const gitAvailable = spawnSync('git', ['--version']).status === 0
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const advanceOrigin = (origin: string, content: string): void => {
  writeFileSync(join(origin, 'file.txt'), content)
  git(origin, 'add', '--all')
  git(origin, 'commit', '-q', '-m', content)
}

/** A git origin with one commit and a plain git clone of it (no `.jj`), removed when the test's scope closes. */
const repositories = Effect.acquireRelease(
  Effect.sync(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'git-auto-fetch-')))
    const origin = join(root, 'origin')
    const clone = join(root, 'clone')
    execFileSync('git', ['init', '-q', '-b', 'main', origin], { env })
    advanceOrigin(origin, 'one')
    execFileSync('git', ['clone', '-q', origin, clone], { env })
    return { root, origin, clone }
  }),
  created => Effect.sync(() => rmSync(created.root, { recursive: true, force: true })),
)

const fetch = (input: { readonly clone: string; readonly fastForward: boolean; readonly remote?: string }) =>
  AutoFetchModel.fetchGitRepository({ repoRoot: input.clone, remote: input.remote ?? 'origin', bookmark: 'main', fastForward: input.fastForward })

describe.skipIf(!gitAvailable)('auto fetch against real git', () => {
  it.layer(Layer.provideMerge(Git.layer, NodeServices.layer), { timeout: 120_000 })(it => {
    it.effect('skips a git repository without the configured remote', () =>
      Effect.gen(function* () {
        const { clone } = yield* repositories
        expect(yield* fetch({ clone, fastForward: false, remote: 'upstream' })).toEqual({ status: 'no-remote', repoRoot: clone })
      }).pipe(Effect.scoped),
    )

    it.effect('refreshes origin/main without moving the local branch unless fast-forward is opted in', () =>
      Effect.gen(function* () {
        const { origin, clone } = yield* repositories
        const before = git(clone, 'rev-parse', 'main')
        advanceOrigin(origin, 'two')
        expect(yield* fetch({ clone, fastForward: false })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: false })
        expect(git(clone, 'rev-parse', 'origin/main')).toBe(git(origin, 'rev-parse', 'main'))
        expect(git(clone, 'rev-parse', 'main')).toBe(before)

        const tip = git(origin, 'rev-parse', 'main')
        expect(yield* fetch({ clone, fastForward: true })).toEqual({ status: 'fast-forwarded', repoRoot: clone, from: before, to: tip })
        // main is checked out in the clone, so its files followed the branch.
        expect(git(clone, 'rev-parse', 'main')).toBe(tip)
        expect(readFileSync(join(clone, 'file.txt'), 'utf8')).toBe('two')
      }).pipe(Effect.scoped),
    )

    it.effect('moves the branch ref when the only worktree holding it is prunable', () =>
      Effect.gen(function* () {
        const { root, origin, clone } = yield* repositories
        git(clone, 'switch', '-q', '-c', 'work')
        const side = join(root, 'side')
        git(clone, 'worktree', 'add', '-q', side, 'main')
        rmSync(side, { recursive: true, force: true })
        const before = git(clone, 'rev-parse', 'main')
        advanceOrigin(origin, 'two')
        const tip = git(origin, 'rev-parse', 'main')
        expect(yield* fetch({ clone, fastForward: true })).toEqual({ status: 'fast-forwarded', repoRoot: clone, from: before, to: tip })
        expect(git(clone, 'rev-parse', 'main')).toBe(tip)
      }).pipe(Effect.scoped),
    )

    it.effect('keeps a local branch with its own commits where it is', () =>
      Effect.gen(function* () {
        const { origin, clone } = yield* repositories
        writeFileSync(join(clone, 'local.txt'), 'local')
        git(clone, 'add', '--all')
        git(clone, 'commit', '-q', '-m', 'local work')
        const local = git(clone, 'rev-parse', 'main')
        advanceOrigin(origin, 'two')
        expect(yield* fetch({ clone, fastForward: true })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: false })
        expect(git(clone, 'rev-parse', 'main')).toBe(local)
      }).pipe(Effect.scoped),
    )

    it.effect('reports a failed git fetch with the git command to rerun and an error span', () =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        const { origin, clone } = yield* repositories
        rmSync(origin, { recursive: true, force: true })
        const outcome = yield* fetch({ clone, fastForward: false }).pipe(Effect.provide(DshxEffect.tracerLayer))
        expect(outcome.status).toBe('failed')
        if (outcome.status !== 'failed') return
        expect(outcome.step).toBe('fetch')
        expect(AutoFetchModel.failureDetail(outcome, 'origin')).toContain('git fetch origin')
        const span = recorder.span('jj-integration auto fetch')
        expect(span.attributes['dshx.fetch.vcs']).toBe('git')
        expect(span.status.code).toBe('error')
      }).pipe(Effect.scoped),
    )
  })
})
