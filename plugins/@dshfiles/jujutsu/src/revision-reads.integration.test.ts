import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginApiError } from '@dshfiles/dshx/api'
import { onTestFinished, test } from 'vitest'
import { RevisionReads, type JjRun } from './revision-reads.ts'

const jjAt =
  (cwd: string, home: string) =>
  (argv: readonly string[]): string => {
    const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', ['--color=never', '--no-pager', ...argv], {
      cwd,
      env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      timeout: 20_000,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error('Jujutsu command failed with exit code ' + String(result.status) + '.')
    return result.stdout
  }

const scratchRepo = async (): Promise<{ readonly repo: string; readonly jj: (argv: readonly string[]) => string; readonly run: JjRun }> => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-reads-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const jj = jjAt(repo, home)
  jj(['git', 'init', '--no-colocate'])
  jj(['config', 'set', '--repo', 'user.name', 'Reads Test'])
  jj(['config', 'set', '--repo', 'user.email', 'reads@example.invalid'])
  return { repo, jj, run: async args => ({ stdout: jj(args), truncated: false }) }
}

const workingCopyCommitId = (jj: (argv: readonly string[]) => string): string =>
  jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'commit_id']).trim()

test('details of an @ that another jj process already rewrote still load instead of failing', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'first.txt'), 'one\n')
  jj(['status'])
  const shownCommitId = workingCopyCommitId(jj)

  await writeFile(join(repo, 'second.txt'), 'two\n')
  jj(['status'])
  assert.notEqual(workingCopyCommitId(jj), shownCommitId)
  assert.ok(!jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', 'all()', '--template', 'commit_id ++ "\\n"']).includes(shownCommitId))

  const details = await RevisionReads.details(run, shownCommitId)
  assert.deepEqual(
    details.files.map(file => [file.path, file.status, file.additions]),
    [['first.txt', 'A', 1]],
  )
})

test('details never snapshot the working copy, so a read cannot rewrite @ under other agents', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'tracked.txt'), 'base\n')
  jj(['status'])
  const commitId = workingCopyCommitId(jj)
  const operationsBefore = jj(['--ignore-working-copy', 'operation', 'log', '--no-graph', '--template', 'id ++ "\\n"'])

  await writeFile(join(repo, 'dirty.txt'), 'not yet snapshotted\n')
  await RevisionReads.details(run, commitId)

  assert.equal(workingCopyCommitId(jj), commitId)
  assert.equal(jj(['--ignore-working-copy', 'operation', 'log', '--no-graph', '--template', 'id ++ "\\n"']), operationsBefore)
})

test('an unknown revision reports a readable failure instead of the generic Host error', async () => {
  const { run } = await scratchRepo()
  const missing = 'a'.repeat(40)

  const failure = await RevisionReads.details(run, missing).then(
    () => assert.fail('expected the read to fail'),
    (error: unknown) => RevisionReads.failure(error, 'Could not load revision details.'),
  )

  assert.equal(failure.failure.message, 'Revision aaaaaaaaaaaa is no longer available. Refresh and try again.')
})

test('unexpected errors fall back to a generic message so raw parser or process text never reaches the client', () => {
  assert.equal(
    RevisionReads.failure(new Error('ZodError: [{"path":["files"]}]'), 'Could not load revision details.').failure.message,
    'Could not load revision details.',
  )
  assert.equal(RevisionReads.failure('boom', 'Could not load this repository.').failure.message, 'Could not load this repository.')
  assert.equal(RevisionReads.failure(new Error('Jujutsu command timed out.'), 'fallback').failure.message, 'Jujutsu command timed out.')
})

test('a stale preview reaches the Client as a PluginApiError while unexpected errors stay generic', () => {
  const stale = RevisionReads.publicError(new Error('Preview expired or repository state changed. Refresh and preview again.'))
  assert.ok(stale instanceof PluginApiError)
  assert.equal(stale.message, 'Preview expired or repository state changed. Refresh and preview again.')
  const raw = new Error("ENOENT: no such file or directory, stat '/Users/someone/repo'")
  assert.equal(RevisionReads.publicError(raw), raw)
})
