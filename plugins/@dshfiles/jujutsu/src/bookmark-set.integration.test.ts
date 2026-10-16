import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { JujutsuMutationModel } from './core.ts'

const jjAt = (cwd: string, home: string, argv: readonly string[]): string => {
  const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', ['--color=never', '--no-pager', ...argv], {
    cwd,
    env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 20_000,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error('Jujutsu command failed with exit code ' + String(result.status) + ': ' + result.stderr)
  return result.stdout
}

test('set bookmark creates a name and moves an existing bookmark to any visible revision', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-bookmark-set-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))

  jjAt(repo, home, ['git', 'init', '--no-colocate'])
  jjAt(repo, home, ['config', 'set', '--repo', 'user.name', 'Bookmark Test'])
  jjAt(repo, home, ['config', 'set', '--repo', 'user.email', 'bookmark@example.invalid'])
  const initialCommit = jjAt(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'commit_id']).trim()
  jjAt(repo, home, ['new'])
  const nextCommit = jjAt(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'commit_id']).trim()

  const setBookmark = (commitId: string): void => {
    const argv = JujutsuMutationModel.buildMutationArgv({ kind: 'bookmark-set', bookmark: 'feature/test', destinationId: commitId })
    jjAt(repo, home, argv)
  }

  setBookmark(nextCommit)
  assert.equal(
    jjAt(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '--revisions', 'bookmarks(exact:"feature/test")', '--template', 'commit_id']).trim(),
    nextCommit,
  )

  setBookmark(initialCommit)
  assert.equal(
    jjAt(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '--revisions', 'bookmarks(exact:"feature/test")', '--template', 'commit_id']).trim(),
    initialCommit,
  )
})
