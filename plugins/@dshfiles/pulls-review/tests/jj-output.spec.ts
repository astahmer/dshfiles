import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Jj } from '@dshfiles/jj-cli'
import { NodeServices } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Schema } from 'effect'
import { reviewResultSchema } from '../src/api.js'
import { ReviewJj } from '../src/jj.js'
import { ReviewWorkspace, ReviewWorkspaceModel, type ReviewInput } from '../src/review.js'

const run = promisify(execFile)

const CONFIG = ['--config', 'user.name=Test', '--config', 'user.email=test@example.com']

/**
 * The review service over the real jj CLI and the real Node process spawner: a wrong flag or range fails this test
 * rather than the browser.
 */
const reviewWithRealJj = (input: ReviewInput) =>
  ReviewWorkspace.use(workspace => workspace.review(input)).pipe(
    Effect.provide(ReviewWorkspace.layer.pipe(Layer.provide(ReviewJj.layer), Layer.provide(Jj.layer), Layer.provide(NodeServices.layer))),
  )

const jj = async (cwd: string, args: readonly string[]): Promise<void> => {
  await run('jj', [...CONFIG, ...args], { cwd })
}

let available = true
let workspace = ''

describe('jj diff output', () => {
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pulls-review-jj-'))
    try {
      await jj(workspace, ['git', 'init'])
    } catch {
      available = false
      return
    }
    await writeFile(join(workspace, 'README.md'), '# Title\n')
    await writeFile(join(workspace, 'src-app.ts'), 'export const answer = 1\n')
    await jj(workspace, ['commit', '-m', 'base'])
    await jj(workspace, ['bookmark', 'create', 'main', '-r', '@-'])
    await writeFile(join(workspace, 'src-app.ts'), 'export const answer = 2\n')
    await writeFile(join(workspace, 'src-app.test.ts'), "it('works', () => {})\n")
  })

  afterAll(async () => {
    if (workspace.length > 0) await rm(workspace, { recursive: true, force: true })
  })

  it.effect.skipIf(!available)('reviews a real workspace through the argv the Host builds', () =>
    Effect.gen(function* () {
      const result = yield* reviewWithRealJj({ path: workspace })
      expect(result).toMatchObject({ status: 'ok', base: 'main', range: 'main..@', fileCount: 2, additions: 2, deletions: 1, truncated: false })
      expect(Option.isSome(Schema.decodeUnknownOption(reviewResultSchema)(result))).toBe(true)
      expect(result.status === 'ok' ? result.scopes.map(scope => scope.key).sort() : []).toEqual(['code', 'tests'])
      expect(result.status === 'ok' ? result.head : '').toMatch(/^[a-f0-9]{8,}$/)
    }),
  )

  it.effect.skipIf(!available)('reviews an exact saved change-id range after forgetting and deleting its workspace', () =>
    Effect.gen(function* () {
      const repository = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'pulls-review-removed-')))
      yield* Effect.addFinalizer(() => Effect.promise(() => rm(repository, { recursive: true, force: true })))
      const threadPath = join(repository, '.threads', 'thread-a1b2c3')
      yield* Effect.promise(() => jj(repository, ['git', 'init']))
      yield* Effect.promise(() => writeFile(join(repository, 'README.md'), '# Base\\n'))
      yield* Effect.promise(() => jj(repository, ['commit', '-m', 'base']))
      yield* Effect.promise(() => jj(repository, ['bookmark', 'create', 'main', '-r', '@']))
      yield* Effect.promise(() => mkdir(join(repository, '.threads')))
      const fromChangeId = (yield* Effect.promise(() =>
        run('jj', [...CONFIG, 'log', '-r', '@', '--no-graph', '-T', 'change_id'], { cwd: repository }),
      )).stdout.trim()
      yield* Effect.promise(() => jj(repository, ['workspace', 'add', threadPath, '--name', 'thread-a1b2c3', '-r', 'main']))
      yield* Effect.promise(() => writeFile(join(threadPath, 'README.md'), '# Reviewed after cleanup\\n'))
      yield* Effect.promise(() => jj(threadPath, ['commit', '-m', 'update']))
      const toChangeId = (yield* Effect.promise(() =>
        run('jj', [...CONFIG, 'log', '-r', '@', '--no-graph', '-T', 'change_id'], { cwd: threadPath }),
      )).stdout.trim()
      const before = yield* reviewWithRealJj({ path: repository, fromChangeId, toChangeId })
      expect(before).toMatchObject({ status: 'ok', range: `${fromChangeId}..${toChangeId}`, fileCount: 1 })
      yield* Effect.promise(() => jj(threadPath, ['bookmark', 'set', 'main', '-r', '@']))
      yield* Effect.promise(() => jj(threadPath, ['new', 'main']))
      yield* Effect.promise(() => jj(repository, ['workspace', 'forget', 'thread-a1b2c3']))
      yield* Effect.promise(() => rm(threadPath, { recursive: true, force: true }))
      const after = yield* reviewWithRealJj({ path: repository, fromChangeId, toChangeId })
      expect(after).toMatchObject({ status: 'ok', range: `${fromChangeId}..${toChangeId}`, fileCount: 1 })
      expect(after.status === 'ok' ? after.patch : '').toContain('# Reviewed after cleanup')
    }),
  )

  it.skipIf(!available)('builds the revision and diff argv the review passes to jj', () => {
    expect(ReviewWorkspaceModel.revisionArgs('@')).toEqual(['log', '-r', '@', '--no-graph', '-T', 'commit_id.short()'])
    expect(ReviewWorkspaceModel.diffArgs('main')).toEqual(['diff', '--git', '--from', 'main', '--to', '@'])
    expect(ReviewWorkspaceModel.diffArgs('change_id("base")', 'change_id("head")')).toEqual([
      'diff',
      '--git',
      '--from',
      'change_id("base")',
      '--to',
      'change_id("head")',
    ])
  })
})
