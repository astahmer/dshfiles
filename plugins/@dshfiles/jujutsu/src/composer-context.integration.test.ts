import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { composerReads } from './composer-context-host.ts'
import {
  COMPOSER_BOOKMARKS_TEMPLATE,
  COMPOSER_FILE_TEMPLATE,
  COMPOSER_HEAD_TEMPLATE,
  COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE,
  COMPOSER_WORKSPACE_TEMPLATE,
  ComposerContextModel,
} from './composer-context-core.ts'
import { JujutsuOutputModel } from './core.ts'

const runJj = (cwd: string, home: string, argv: readonly string[]): string => {
  const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', ['--color=never', '--no-pager', ...argv], {
    cwd,
    env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 20_000,
  })
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, 'jj ' + argv.join(' ') + '\n' + result.stderr)
  return result.stdout
}

test('composer templates and ranges read head, bookmarks, totals and files from a real repository', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-composer-'))
  const repo = join(home, 'repo')
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  runJj(home, home, ['git', 'init', '--no-colocate', repo])
  runJj(repo, home, ['config', 'set', '--repo', 'user.name', 'Composer Test'])
  runJj(repo, home, ['config', 'set', '--repo', 'user.email', 'composer@example.invalid'])

  await writeFile(join(repo, 'base.txt'), 'one\ntwo\n')
  runJj(repo, home, ['commit', '-m', 'base'])
  runJj(repo, home, ['bookmark', 'create', 'main', '-r', '@-'])
  await writeFile(join(repo, 'feature.txt'), 'feature\n')
  runJj(repo, home, ['commit', '-m', 'feature'])
  await writeFile(join(repo, 'base.txt'), 'one\nthree\n')
  await writeFile(join(repo, 'new file.txt'), 'hello\n')

  const head = JujutsuOutputModel.parseJsonLines(runJj(repo, home, ['log', '--no-graph', '-r', '@', '-T', COMPOSER_HEAD_TEMPLATE]), value => value)[0]
  expect(head).toMatchObject({ bookmarks: [], empty: false, conflict: false, description: '' })
  expect(runJj(repo, home, ['--ignore-working-copy', 'workspace', 'list', '-T', COMPOSER_WORKSPACE_TEMPLATE]).trim()).toBe('"default"')

  const nearest = runJj(repo, home, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '-r',
    'heads(::@- & bookmarks())',
    '--limit',
    '2',
    '-T',
    COMPOSER_BOOKMARKS_TEMPLATE,
  ])
  expect(nearest.trim()).toBe('["main"]')
  expect(runJj(repo, home, ['--ignore-working-copy', 'bookmark', 'list', '-T', COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE]).trim()).toBe('"main"')
  const baseCommitId = runJj(repo, home, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '-r',
    ComposerContextModel.composerBaseTarget({ kind: 'bookmark', name: 'main' }),
    '--limit',
    '2',
    '-T',
    'commit_id ++ "\\n"',
  ]).trim()
  const revisionCountRevsets = ComposerContextModel.revisionCountRevsets(baseCommitId)
  expect(runJj(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '-r', revisionCountRevsets.ahead, '-T', '"x"']).length).toBe(2)
  expect(runJj(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '-r', revisionCountRevsets.behind, '-T', '"x"']).length).toBe(0)
  const missing = runJj(repo, home, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '-r',
    ComposerContextModel.composerBaseTarget({ kind: 'bookmark', name: 'absent' }),
    '-T',
    'commit_id',
  ])
  expect(missing).toBe('')

  const parentRange = ComposerContextModel.composerDiffRange({ kind: 'parent' })
  expect(ComposerContextModel.parseStatTotals(runJj(repo, home, ['--ignore-working-copy', 'diff', ...parentRange, '--stat']))).toEqual({
    files: 2,
    additions: 2,
    deletions: 1,
  })
  const parentFiles = JujutsuOutputModel.parseJsonLines(
    runJj(repo, home, ['--ignore-working-copy', 'diff', ...parentRange, '-T', COMPOSER_FILE_TEMPLATE]),
    value => value,
  )
  expect(parentFiles).toEqual([
    { path: 'base.txt', status: 'modified' },
    { path: 'new file.txt', status: 'added' },
  ])

  const bookmarkRange = ComposerContextModel.composerDiffRange({ kind: 'bookmark', name: 'main' })
  expect(ComposerContextModel.parseStatTotals(runJj(repo, home, ['--ignore-working-copy', 'diff', ...bookmarkRange, '--stat']))).toEqual({
    files: 3,
    additions: 3,
    deletions: 1,
  })
  expect(ComposerContextModel.parsePatchFileStats(runJj(repo, home, ['--ignore-working-copy', 'diff', ...bookmarkRange, '--git']))).toEqual([
    { path: 'base.txt', additions: 1, deletions: 1 },
    { path: 'feature.txt', additions: 1, deletions: 0 },
    { path: 'new file.txt', additions: 1, deletions: 0 },
  ])

  const featureCommitId = runJj(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '-r', '@-', '-T', 'commit_id']).trim()
  runJj(repo, home, ['new', '-r', 'main', '-m', 'sibling'])
  runJj(repo, home, ['bookmark', 'set', 'main', '-r', '@'])
  runJj(repo, home, ['edit', featureCommitId])
  const siblingCommitId = runJj(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '-r', 'main', '-T', 'commit_id']).trim()
  const divergedRevsets = ComposerContextModel.revisionCountRevsets(siblingCommitId)
  expect(runJj(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '-r', divergedRevsets.ahead, '-T', '"x"']).length).toBe(1)
  expect(runJj(repo, home, ['--ignore-working-copy', 'log', '--no-graph', '-r', divergedRevsets.behind, '-T', '"x"']).length).toBe(1)
}, 15_000)

test('composer reads spawn jj again for view reads only after an operation lands', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-composer-reads-'))
  const repo = join(home, 'repo')
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  runJj(home, home, ['git', 'init', '--no-colocate', repo])
  const spawned: string[] = []
  const read = composerReads(async (_ctx, cwd, args) => {
    spawned.push(args.join(' '))
    return { stdout: runJj(cwd, home, args), truncated: false }
  })
  const ctx = new Context()
  const describeAt = () => read(ctx, repo, ['--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'description'], undefined, { outputLimit: 8_000 })

  expect((await describeAt()).stdout).toBe('')
  expect((await describeAt()).stdout).toBe('')
  expect(spawned).toHaveLength(1)

  runJj(repo, home, ['describe', '-m', 'landed'])
  expect((await describeAt()).stdout).toBe('landed\n')
  expect(spawned).toHaveLength(2)
})
