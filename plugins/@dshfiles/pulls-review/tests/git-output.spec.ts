import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Git } from '@dshfiles/git-cli'
import { Jj } from '@dshfiles/jj-cli'
import { NodeServices } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Schema } from 'effect'
import { reviewResultSchema } from '../src/api.js'
import { ReviewGit } from '../src/git.js'
import { ReviewJj } from '../src/jj.js'
import { ReviewWorkspace, type ReviewInput } from '../src/review.js'

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

/** The review service the Host builds, over real git and jj CLIs and the Node process spawner. */
const reviewWithRealGit = (input: ReviewInput) =>
  ReviewWorkspace.use(workspace => workspace.review(input)).pipe(
    Effect.provide(
      ReviewWorkspace.layer.pipe(
        Layer.provide(Layer.mergeAll(ReviewJj.layer.pipe(Layer.provide(Jj.layer)), ReviewGit.layer.pipe(Layer.provide(Git.layer)))),
        Layer.provide(NodeServices.layer),
      ),
    ),
  )

describe.skipIf(!gitAvailable)('git review scopes', () => {
  let root = ''
  let repo = ''
  let thread = ''
  let base = ''
  let tip = ''

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'pulls-review-git-')))
    repo = join(root, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env })
    writeFileSync(join(repo, 'README.md'), '# Title\n')
    writeFileSync(join(repo, 'src-app.ts'), 'export const answer = 1\n')
    git(repo, 'add', '--all')
    git(repo, 'commit', '-q', '-m', 'base')
    base = git(repo, 'rev-parse', 'HEAD')
    thread = join(root, 'repo-threads', 'thread-abcdef')
    git(repo, 'worktree', 'add', '-q', '-b', 'dsh/thread-abcdef', thread, 'main')
    writeFileSync(join(thread, 'src-app.ts'), 'export const answer = 2\n')
    git(thread, 'commit', '-q', '-am', 'feat: answer two')
    tip = git(thread, 'rev-parse', 'HEAD')
    // Uncommitted work counts in a live review, an untracked file too.
    writeFileSync(join(thread, 'README.md'), '# Title\n\nMore.\n')
    writeFileSync(join(thread, 'src-app.test.ts'), "it('works', () => {})\n")
  })

  afterAll(() => {
    if (root.length > 0) rmSync(root, { recursive: true, force: true })
  })

  it.effect('reviews a git worktree from its merge base with main, uncommitted and untracked files included', () =>
    Effect.gen(function* () {
      const result = yield* reviewWithRealGit({ path: thread })
      expect(result).toMatchObject({ status: 'ok', base: 'main', range: 'main..HEAD', head: tip.slice(0, 12), fileCount: 3, truncated: false })
      expect(Option.isSome(Schema.decodeUnknownOption(reviewResultSchema)(result))).toBe(true)
      expect(result.status === 'ok' ? result.files.map(file => file.path).sort() : []).toEqual(['README.md', 'src-app.test.ts', 'src-app.ts'])
      // The real index is untouched: the untracked test file is still untracked.
      expect(git(thread, 'status', '--porcelain')).toContain('?? src-app.test.ts')
    }),
  )

  it.effect('reviews a saved land range of commit ids from the repository root', () =>
    Effect.gen(function* () {
      const result = yield* reviewWithRealGit({ path: repo, fromChangeId: base, toChangeId: tip })
      expect(result).toMatchObject({ status: 'ok', base, range: `${base}..${tip}`, fileCount: 1, additions: 1, deletions: 1 })
      const stale = yield* reviewWithRealGit({ path: repo, fromChangeId: '0'.repeat(40), toChangeId: tip })
      expect(stale).toMatchObject({ status: 'failed', reason: 'no-base' })
    }),
  )

  it.effect('lists git base branches when the base is missing and refuses a revision that looks like an option', () =>
    Effect.gen(function* () {
      const missing = yield* reviewWithRealGit({ path: thread, base: 'no-such-branch' })
      expect(missing).toMatchObject({ status: 'failed', reason: 'no-base' })
      expect(missing.status === 'failed' ? missing.message : '').toContain('origin/main')
      const option = yield* reviewWithRealGit({ path: repo, fromChangeId: '--output=/tmp/x', toChangeId: tip })
      expect(option).toMatchObject({ status: 'failed', reason: 'no-base' })
    }),
  )

  it.effect('says how to see and fix a git read failure instead of a dead end', () =>
    Effect.gen(function* () {
      // A base with no common history: merge-base exits non-zero, so the read fails as a whole.
      const orphan = git(repo, 'commit-tree', git(repo, 'rev-parse', 'HEAD^{tree}'), '-m', 'unrelated root')
      git(repo, 'branch', '-f', 'unrelated', orphan)
      const failed = yield* reviewWithRealGit({ path: thread, base: 'unrelated' })
      expect(failed).toMatchObject({ status: 'failed', reason: 'jj-failed' })
      expect(failed.status === 'failed' ? failed.message : '').toMatch(/Run `git status`.*then refresh the review/u)
    }),
  )
})
