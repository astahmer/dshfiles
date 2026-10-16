import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JjCommandError, JjUnavailableError, type JjRun, type JjRunInput } from '../src/jj.js'
import { reviewWorkspace } from '../src/review.js'

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
  readonly fail?: Error
}

const fakeRun = (options: FakeOptions): JjRun => {
  return async (input: JjRunInput) => {
    if (options.fail !== undefined) throw options.fail
    if (input.args[0] === 'log') {
      const revision = input.args[2] ?? ''
      return options.revisions.includes(revision)
        ? { stdout: `${revision === '@' ? 'abc1234' : 'def5678'}\n`, truncated: false }
        : (() => {
            throw new JjCommandError('jj-failed')
          })()
    }
    return { stdout: options.patch ?? PATCH, truncated: false }
  }
}

describe('reviewWorkspace', () => {
  let workspace: string

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pulls-review-'))
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('reads the first resolvable base bookmark and groups the diff', async () => {
    const result = await reviewWorkspace({ run: fakeRun({ revisions: ['main', '@'] }), path: workspace })
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
  })

  it('prefers an explicit base and refuses one that does not resolve', async () => {
    const explicit = await reviewWorkspace({ run: fakeRun({ revisions: ['release', '@'] }), path: workspace, base: 'release' })
    expect(explicit).toMatchObject({ status: 'ok', base: 'release' })

    const unknown = await reviewWorkspace({ run: fakeRun({ revisions: ['@'] }), path: workspace, base: 'nope' })
    expect(unknown).toMatchObject({ status: 'failed', reason: 'no-base' })
  })

  it('reports a missing base, a missing workspace and a missing jj without leaking command output', async () => {
    const noBase = await reviewWorkspace({ run: fakeRun({ revisions: ['@'] }), path: workspace })
    expect(noBase).toMatchObject({ status: 'failed', reason: 'no-base' })

    const missing = await reviewWorkspace({ run: fakeRun({ revisions: ['main'] }), path: join(workspace, 'gone') })
    expect(missing).toMatchObject({ status: 'failed', reason: 'workspace-missing' })

    const unavailable = await reviewWorkspace({ run: fakeRun({ revisions: [], fail: new JjUnavailableError('no jj') }), path: workspace })
    expect(unavailable).toMatchObject({ status: 'failed', reason: 'jj-missing' })
  })

  it('classifies a repository failure without surfacing stderr', async () => {
    const notARepo = await reviewWorkspace({ run: fakeRun({ revisions: [], fail: new JjCommandError('not-a-repository') }), path: workspace })
    expect(notARepo).toMatchObject({ status: 'failed', reason: 'not-a-repository' })
    expect(notARepo.status === 'failed' ? notARepo.message : '').not.toContain('stderr')

    const failingDiff: JjRun = async input => {
      if (input.args[0] === 'log') return { stdout: input.args[2] === '@' ? 'abc1234\n' : 'def5678\n', truncated: false }
      throw new JjCommandError('jj-failed')
    }
    const failed = await reviewWorkspace({ run: failingDiff, path: workspace })
    expect(failed).toMatchObject({ status: 'failed', reason: 'jj-failed' })
  })

  it('carries the truncation flag of a bounded diff', async () => {
    const run: JjRun = async input => {
      if (input.args[0] === 'log') return { stdout: input.args[2] === '@' ? 'abc1234\n' : 'def5678\n', truncated: false }
      return { stdout: PATCH, truncated: true }
    }
    const result = await reviewWorkspace({ run, path: workspace })
    expect(result).toMatchObject({ status: 'ok', truncated: true })
  })
})
