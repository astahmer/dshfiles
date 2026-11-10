import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Schema } from 'effect'
import { MAX_FILES, reviewResultSchema } from '../src/api.js'
import { JjReadFailed, ReviewJj, type JjReadInput, type JjReadOutput } from '../src/jj.js'
import { ProjectBase } from '../src/project-base.js'
import { ReviewWorkspace, type ReviewInput } from '../src/review.js'

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1 +1 @@',
  '-const answer = 1',
  '+const answer = 2',
  '',
].join('\n')

interface FakeOptions {
  readonly revisions: readonly string[]
  readonly patch?: string
  readonly fail?: JjReadFailed
}

type JjRead = (input: JjReadInput) => Effect.Effect<JjReadOutput, JjReadFailed>

/** The jj CLI is the external system; everything above it is the real review service. */
const reviewOver = (input: ReviewInput & { readonly read: JjRead }) =>
  ReviewWorkspace.use(workspace => workspace.review(input)).pipe(
    Effect.provide(ReviewWorkspace.layer.pipe(Layer.provide(Layer.merge(Layer.succeed(ReviewJj, ReviewJj.of({ read: input.read })), NodeFileSystem.layer)))),
  )

const fakeRun =
  (options: FakeOptions): JjRead =>
  input => {
    if (options.fail !== undefined) return Effect.fail(options.fail)
    if (input.args[0] === 'log') {
      const revision = input.args[2] ?? ''
      return options.revisions.includes(revision)
        ? Effect.succeed({ stdout: `${revision === '@' ? 'abc1234' : 'def5678'}\n`, truncated: false })
        : Effect.fail(new JjReadFailed({ reason: 'jj-failed' }))
    }
    return Effect.succeed({ stdout: options.patch ?? PATCH, truncated: false })
  }

const logOr =
  (diff: (input: JjReadInput) => Effect.Effect<JjReadOutput, JjReadFailed>): JjRead =>
  input =>
    input.args[0] === 'log' ? Effect.succeed({ stdout: input.args[2] === '@' ? 'abc1234\n' : 'def5678\n', truncated: false }) : diff(input)

describe('reviewWorkspace', () => {
  let workspace: string

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pulls-review-'))
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it.effect('reads the first resolvable base bookmark and groups the diff', () =>
    Effect.gen(function* () {
      const result = yield* reviewOver({ read: fakeRun({ revisions: ['main', '@'] }), path: workspace })
      expect(result).toMatchObject({
        status: 'ok',
        path: workspace,
        base: 'main',
        head: 'abc1234',
        range: 'main..@',
        fileCount: 1,
        additions: 1,
        deletions: 1,
        truncated: false,
      })
      expect(result.status === 'ok' ? result.scopes.map(scope => scope.key) : []).toEqual(['code'])
    }),
  )

  it.effect("starts from the project's main branch before main, then its origin copy, when the project names one", () =>
    Effect.gen(function* () {
      const develop = Layer.succeed(ProjectBase, ProjectBase.of({ defaultFor: () => Effect.succeed('develop') }))
      const local = yield* reviewOver({ read: fakeRun({ revisions: ['main', 'develop', '@'] }), path: workspace }).pipe(Effect.provide(develop))
      expect(local).toMatchObject({ status: 'ok', base: 'develop', range: 'develop..@' })
      const remote = yield* reviewOver({ read: fakeRun({ revisions: ['main', 'develop@origin', '@'] }), path: workspace }).pipe(Effect.provide(develop))
      expect(remote).toMatchObject({ status: 'ok', base: 'develop@origin' })
      const absent = yield* reviewOver({ read: fakeRun({ revisions: ['main', '@'] }), path: workspace }).pipe(Effect.provide(develop))
      expect(absent).toMatchObject({ status: 'ok', base: 'main' })
      const explicit = yield* reviewOver({ read: fakeRun({ revisions: ['main', 'develop', '@'] }), path: workspace, base: 'main' }).pipe(
        Effect.provide(develop),
      )
      expect(explicit).toMatchObject({ status: 'ok', base: 'main' })
    }),
  )

  it.effect('falls back to the origin bookmark when no local base bookmark exists', () =>
    Effect.gen(function* () {
      const result = yield* reviewOver({ read: fakeRun({ revisions: ['main@origin', '@'] }), path: workspace })
      expect(result).toMatchObject({ status: 'ok', base: 'main@origin', range: 'main@origin..@' })
    }),
  )

  it.effect('prefers an explicit base and refuses one that does not resolve', () =>
    Effect.gen(function* () {
      const explicit = yield* reviewOver({ read: fakeRun({ revisions: ['release', '@'] }), path: workspace, base: 'release' })
      expect(explicit).toMatchObject({ status: 'ok', base: 'release' })

      const unknown = yield* reviewOver({ read: fakeRun({ revisions: ['@'] }), path: workspace, base: 'nope' })
      expect(unknown).toMatchObject({ status: 'failed', reason: 'no-base' })

      const incompleteRange = yield* reviewOver({ read: fakeRun({ revisions: ['main', '@'] }), path: workspace, fromChangeId: 'saved-base' })
      expect(incompleteRange).toMatchObject({ status: 'failed', reason: 'jj-failed' })
    }),
  )

  it.effect('reports a missing base, a missing workspace and a missing jj without leaking command output', () =>
    Effect.gen(function* () {
      const noBase = yield* reviewOver({ read: fakeRun({ revisions: ['@'] }), path: workspace })
      expect(noBase).toMatchObject({ status: 'failed', reason: 'no-base' })

      const missing = yield* reviewOver({ read: fakeRun({ revisions: ['main'] }), path: join(workspace, 'gone') })
      expect(missing).toMatchObject({ status: 'failed', reason: 'workspace-missing' })

      const unavailable = yield* reviewOver({ read: fakeRun({ revisions: [], fail: new JjReadFailed({ reason: 'jj-missing' }) }), path: workspace })
      expect(unavailable).toMatchObject({ status: 'failed', reason: 'jj-missing' })
    }),
  )

  it.effect('classifies a repository failure without surfacing stderr', () =>
    Effect.gen(function* () {
      const notARepo = yield* reviewOver({ read: fakeRun({ revisions: [], fail: new JjReadFailed({ reason: 'not-a-repository' }) }), path: workspace })
      expect(notARepo).toMatchObject({ status: 'failed', reason: 'not-a-repository' })
      expect(notARepo.status === 'failed' ? notARepo.message : '').not.toContain('stderr')

      const failingDiff = logOr(() => Effect.fail(new JjReadFailed({ reason: 'jj-failed' })))
      const failed = yield* reviewOver({ read: failingDiff, path: workspace })
      expect(failed).toMatchObject({ status: 'failed', reason: 'jj-failed' })
    }),
  )

  it.effect('carries the truncation flag of a bounded diff', () =>
    Effect.gen(function* () {
      const run = logOr(() => Effect.succeed({ stdout: PATCH, truncated: true }))
      const result = yield* reviewOver({ read: run, path: workspace })
      expect(result).toMatchObject({ status: 'ok', truncated: true })
    }),
  )

  it.effect('clips a diff with more files than one message carries instead of failing output validation', () =>
    Effect.gen(function* () {
      const files = Array.from({ length: MAX_FILES + 1 }, (_, index) => [`diff --git a/f${index}.txt b/f${index}.txt`, '@@ -0,0 +1 @@', '+x', ''].join('\n'))
      const run = logOr(() => Effect.succeed({ stdout: files.join(''), truncated: false }))
      const result = yield* reviewOver({ read: run, path: workspace })
      expect(result).toMatchObject({ status: 'ok', fileCount: MAX_FILES + 1, truncated: true })
      expect(result.status === 'ok' ? result.files : []).toHaveLength(MAX_FILES)
      expect(Option.isSome(Schema.decodeUnknownOption(reviewResultSchema)(result))).toBe(true)
    }),
  )
})
