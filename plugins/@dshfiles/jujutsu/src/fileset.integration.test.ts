import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { z } from 'zod'
import { JujutsuMutationModel, JujutsuOutputModel, JujutsuPathModel } from './core.ts'
import { revisionSchema, type Mutation } from './api.ts'
import { EVOLUTION_TEMPLATE, FILE_STATS_TEMPLATE, REVISION_TEMPLATE } from './jj-templates.ts'
import { RevisionGraphModel } from './graph.ts'

const runJj = (cwd: string, home: string, argv: readonly string[]): string => {
  const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', [...argv], {
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

const lines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .sort()

test('literal root-file filesets select and split exact space, Unicode, and metacharacter paths', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-filesets-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))

  runJj(repo, home, ['git', 'init', '--no-colocate'])
  runJj(repo, home, ['config', 'set', '--repo', 'user.name', 'Fileset Test'])
  runJj(repo, home, ['config', 'set', '--repo', 'user.email', 'fileset@example.invalid'])

  const selected = ['dir with space/café [a]*?.txt', 'literal "quote" and \\ slash [x]*?.txt', 'literal " | all() | root-file:"inject.txt']
  const unselected = ['dir with space/café axbZ.txt', 'literal quote and \\ slash xYzZ.txt', 'untouched.txt']
  for (const [index, path] of [...selected, ...unselected].entries()) {
    await mkdir(dirname(join(repo, path)), { recursive: true })
    await writeFile(join(repo, path), 'content ' + index + '\n')
  }

  runJj(repo, home, ['status'])
  for (const path of selected) {
    assert.deepEqual(lines(runJj(repo, home, ['diff', '--revisions', '@', '--name-only', JujutsuPathModel.rootFileFileset(path)])), [path])
  }

  const commitId = runJj(repo, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim()
  assert.match(commitId, /^[a-f0-9]{40,64}$/)
  runJj(repo, home, JujutsuMutationModel.buildMutationArgv({ kind: 'split', commitId, paths: selected, message: 'selected literal paths' }))

  assert.deepEqual(lines(runJj(repo, home, ['diff', '--revisions', '@-', '--name-only'])), selected.slice().sort())
  assert.deepEqual(lines(runJj(repo, home, ['diff', '--revisions', '@', '--name-only'])), unselected.slice().sort())

  const revisions = (): ReturnType<typeof revisionSchema.parse>[] =>
    JujutsuOutputModel.parseJsonLines(
      runJj(repo, home, ['log', '--no-graph', '--limit', '500', '--revisions', 'all()', '--template', REVISION_TEMPLATE]),
      value => {
        const parsed = revisionSchema.safeParse(value)
        if (!parsed.success) throw new Error(JSON.stringify({ value, issues: parsed.error.issues }))
        return parsed.data
      },
    )
  const workingCopy = revisions().find(revision => revision.workingCopy)
  assert.ok(workingCopy)
  const changedPaths = lines(runJj(repo, home, ['diff', '--revisions', workingCopy.commitId, '--name-only']))
  const patch = runJj(repo, home, ['diff', '--revisions', workingCopy.commitId, '--git'])
  const changes = JujutsuOutputModel.parsePatchStats(patch, changedPaths)
  assert.deepEqual(changes.map(change => change.path).sort(), unselected.slice().sort())
  assert.ok(changes.every(change => change.contentDigest !== null))
  assert.equal(
    changes.reduce((count, change) => count + change.additions, 0),
    unselected.length,
  )

  runJj(repo, home, JujutsuMutationModel.buildMutationArgv({ kind: 'describe', commitId: workingCopy.commitId, message: 'description smoke' }))
  const described = revisions().find(revision => revision.workingCopy)
  assert.ok(described)
  assert.equal(described.description, 'description smoke\n')
  assert.equal(RevisionGraphModel.describeDraftChanged('description smoke', described.description), false)

  const evolution = JujutsuOutputModel.parseJsonLines(
    runJj(repo, home, ['evolog', '--no-graph', '--revisions', described.commitId, '--limit', '30', '--template', EVOLUTION_TEMPLATE]),
    value => {
      assert.equal(typeof value, 'object')
      assert.notEqual(value, null)
      const row = value as { commitId?: unknown; predecessors?: unknown }
      assert.equal(typeof row.commitId, 'string')
      assert.ok(Array.isArray(row.predecessors))
      return { commitId: row.commitId as string, predecessors: row.predecessors as string[] }
    },
  )
  assert.ok(evolution.some(row => row.commitId === described.commitId && row.predecessors.length > 0))
})

test('workspace-add creates a sibling at the chosen revision and preserves dirty source files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-workspaces-'))
  const repo = join(home, 'repo')
  const parent = join(home, 'workspaces')
  const destination = join(parent, 'review-at-base')
  await mkdir(repo)
  await mkdir(parent)
  onTestFinished(() => rm(home, { recursive: true, force: true }))

  runJj(repo, home, ['git', 'init', '--no-colocate'])
  await writeFile(join(repo, 'base.txt'), 'committed base\n')
  runJj(repo, home, ['status'])
  runJj(repo, home, ['describe', '--message', 'workspace base'])
  const commitId = runJj(repo, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim()
  await writeFile(join(repo, 'draft.txt'), 'keep in source workspace\n')
  const sourceStatus = runJj(repo, home, ['status'])

  const action: Mutation = { kind: 'workspace-add', parentPath: parent, name: 'review-at-base', commitId }
  runJj(repo, home, JujutsuMutationModel.buildMutationArgv(action))

  assert.equal(await realpath(runJj(destination, home, ['root']).trim()), await realpath(destination))
  assert.equal(await readFile(join(destination, 'base.txt'), 'utf8'), 'committed base\n')
  await assert.rejects(readFile(join(destination, 'draft.txt')), { code: 'ENOENT' })
  assert.equal(await readFile(join(repo, 'draft.txt'), 'utf8'), 'keep in source workspace\n')
  assert.match(runJj(repo, home, ['status']), /draft\.txt/)
  assert.match(runJj(repo, home, ['workspace', 'list']), /review-at-base/)
  assert.match(sourceStatus, /draft\.txt/)
})

test('workspace-edit moves one workspace without moving another on the same revision', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-workspace-edit-'))
  const repo = join(home, 'repo')
  const parent = join(home, 'workspaces')
  const firstWorkspace = join(parent, 'review-a')
  const secondWorkspace = join(parent, 'review-b')
  await mkdir(repo)
  await mkdir(parent)
  onTestFinished(() => rm(home, { recursive: true, force: true }))

  runJj(repo, home, ['git', 'init', '--no-colocate'])
  await writeFile(join(repo, 'base.txt'), 'base\n')
  runJj(repo, home, ['status'])
  const baseId = runJj(repo, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim()
  runJj(repo, home, ['workspace', 'add', '--name', 'review-a', '--revision', baseId, firstWorkspace])
  runJj(repo, home, ['workspace', 'add', '--name', 'review-b', '--revision', baseId, secondWorkspace])
  const firstWorkingCopyId = runJj(firstWorkspace, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim()
  runJj(secondWorkspace, home, ['edit', firstWorkingCopyId])
  assert.equal(runJj(secondWorkspace, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim(), firstWorkingCopyId)
  runJj(repo, home, ['new', baseId])
  const destinationId = runJj(repo, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim()
  assert.notEqual(destinationId, baseId)

  const action: Mutation = { kind: 'workspace-edit', name: 'review-b', commitId: destinationId }
  runJj(secondWorkspace, home, JujutsuMutationModel.buildMutationArgv(action))
  const workingCopyId = (cwd: string): string => runJj(cwd, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim()

  assert.deepEqual(
    { first: workingCopyId(firstWorkspace), second: workingCopyId(secondWorkspace), default: workingCopyId(repo) },
    { first: firstWorkingCopyId, second: destinationId, default: destinationId },
  )
}, 20_000)

test('workspace-forget unregisters a secondary workspace and leaves its folder and files in place', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-forget-'))
  const repo = join(home, 'repo')
  const parent = join(home, 'workspaces')
  const destination = join(parent, 'review-at-base')
  await mkdir(repo)
  await mkdir(parent)
  onTestFinished(() => rm(home, { recursive: true, force: true }))

  runJj(repo, home, ['git', 'init', '--no-colocate'])
  await writeFile(join(repo, 'base.txt'), 'base\n')
  const commitId = runJj(repo, home, ['log', '--no-graph', '--revisions', '@', '--template', 'self.commit_id().short(64)']).trim()
  runJj(repo, home, JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-add', parentPath: parent, name: 'review-at-base', commitId }))
  await writeFile(join(destination, 'note.txt'), 'kept on disk\n')
  runJj(destination, home, ['status'])

  runJj(repo, home, JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-forget', name: 'review-at-base' }))

  assert.doesNotMatch(runJj(repo, home, ['workspace', 'list']), /review-at-base/)
  assert.equal(await readFile(join(destination, 'note.txt'), 'utf8'), 'kept on disk\n')
  assert.match(runJj(destination, home, ['root']), new RegExp(destination.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}, 20_000)

test('the workspace list template names every workspace and its folder', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-workspace-paths-'))
  const repo = join(home, 'repo')
  const destination = join(home, 'review-ws')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))

  runJj(repo, home, ['git', 'init', '--no-colocate'])
  runJj(repo, home, ['workspace', 'add', destination, '--name', 'review-ws', '-r', '@'])

  const listing = runJj(repo, home, ['workspace', 'list', '-T', 'name ++ "\\t" ++ root ++ "\\n"'])
  const workspaces = new Map(
    listing
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [name = '', path = ''] = line.split('\t')
        return [name, path] as const
      }),
  )
  assert.equal(await realpath(workspaces.get('default') ?? ''), await realpath(repo))
  assert.equal(await realpath(workspaces.get('review-ws') ?? ''), await realpath(destination))
}, 20_000)

test('file stats template, file moves, and restore act on exact listed files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-moves-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  runJj(repo, home, ['git', 'init', '--no-colocate'])
  runJj(repo, home, ['config', 'set', '--repo', 'user.name', 'Move Test'])
  runJj(repo, home, ['config', 'set', '--repo', 'user.email', 'move@example.invalid'])
  await writeFile(join(repo, 'keep.txt'), 'base\n')
  runJj(repo, home, ['commit', '--message', 'base'])
  await writeFile(join(repo, 'keep.txt'), 'base\nchanged\n')
  await writeFile(join(repo, 'moved file.txt'), 'new\n')
  await writeFile(join(repo, 'discard.txt'), 'scratch\n')
  runJj(repo, home, ['status'])
  const ids = (revset: string): string => runJj(repo, home, ['log', '--no-graph', '--revisions', revset, '--template', 'self.commit_id().short(64)']).trim()

  const stats = JujutsuOutputModel.parseJsonLines(runJj(repo, home, ['log', '--no-graph', '--revisions', '@', '--template', FILE_STATS_TEMPLATE]), value => {
    const row = z.object({ files: z.array(z.object({ path: z.string(), status: z.string(), additions: z.number(), deletions: z.number() })) }).parse(value)
    return row.files.map(file => ({ ...file, status: JujutsuOutputModel.fileStatusLetter(file.status) }))
  })[0]
  assert.deepEqual(stats, [
    { path: 'discard.txt', status: 'A', additions: 1, deletions: 0 },
    { path: 'keep.txt', status: 'M', additions: 1, deletions: 0 },
    { path: 'moved file.txt', status: 'A', additions: 1, deletions: 0 },
  ])

  runJj(repo, home, JujutsuMutationModel.buildMutationArgv({ kind: 'squash', sourceId: ids('@'), destinationId: ids('@-'), paths: ['moved file.txt'] }))
  assert.deepEqual(lines(runJj(repo, home, ['diff', '--revisions', '@-', '--name-only'])), ['keep.txt', 'moved file.txt'])
  runJj(repo, home, JujutsuMutationModel.buildMutationArgv({ kind: 'restore', commitId: ids('@'), paths: ['discard.txt'] }))
  assert.deepEqual(lines(runJj(repo, home, ['diff', '--revisions', '@', '--name-only'])), ['keep.txt'])
})
