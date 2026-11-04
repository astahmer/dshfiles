import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { Mutation } from './api.js'
import { Result, Schema } from 'effect'
import { JujutsuMutationModel, JujutsuOutputModel, JujutsuPathModel } from './core.ts'
import { RevisionGraphModel } from './graph.ts'

const id = 'a'.repeat(40)
const otherId = 'b'.repeat(40)

test('revision and repository inputs reject expressions and relative cwd values', () => {
  assert.throws(() => Result.getOrThrow(JujutsuPathModel.validatedRepositoryPath('repo')), /absolute/)
  assert.throws(() => Result.getOrThrow(JujutsuPathModel.validatedRepositoryPath('/')), /filesystem root/)
  assert.equal(Result.getOrThrow(JujutsuPathModel.validatedRepositoryPath('/tmp/project/../project')), '/tmp/project')
  assert.equal(JujutsuPathModel.isSafeSplitPath('src/main.ts'), true)
  assert.equal(JujutsuPathModel.isSafeSplitPath('dir with space/café [1]*?.txt'), true)
  assert.equal(JujutsuPathModel.isSafeSplitPath('../secret'), false)
  assert.equal(JujutsuPathModel.isSafeSplitPath('/absolute/path'), false)
  assert.equal(JujutsuPathModel.isSafeSplitPath('src/*.ts'), true)
  assert.equal(JujutsuPathModel.isSafeSplitPath('src/../secret'), false)
  assert.equal(JujutsuPathModel.isSafeSplitPath('bad\0name'), false)
  assert.equal(JujutsuPathModel.isSafeSplitPath('bad\nname'), false)
})

test('mutation strings remain single argv values and never become shell commands', () => {
  const message = 'repair $(touch /tmp/nope); `not a shell`\nsecond line'
  const action: Mutation = { kind: 'describe', commitId: id, message }
  const argv = Result.getOrThrow(JujutsuMutationModel.buildMutationArgv(action))
  assert.deepEqual(argv, ['describe', id, '--message', message])
  assert.equal(argv.join(' ').includes(message), true)
  assert.equal(
    argv.some(value => value === 'touch'),
    false,
  )
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'describe', commitId: id, message: 'bad\0arg' })), /null bytes/)
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'describe', commitId: id, message: '' })), [
    'describe',
    id,
    '--message',
    '',
  ])
})

test('split argv quotes each listed path as one exact JJ root-file fileset', () => {
  const action: Mutation = { kind: 'split', commitId: id, paths: ['src/a.ts', 'dir with space/café [1]*?.txt'], message: 'split selected files' }
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv(action)), [
    'split',
    '--revision',
    id,
    '--message',
    'split selected files',
    'root-file:"src/a.ts"',
    'root-file:"dir with space/café [1]*?.txt"',
  ])
  assert.equal(Result.getOrThrow(JujutsuPathModel.rootFileFileset('odd "quoted" \\ path*.txt')), 'root-file:"odd \\"quoted\\" \\\\ path*.txt"')
  assert.equal(
    Result.getOrThrow(JujutsuPathModel.rootFileFileset('literal" | all() | root-file:"second')),
    'root-file:"literal\\" | all() | root-file:\\"second"',
  )
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ ...action, paths: ['src/../secret'] })), /workspace-relative/)
  assert.throws(() => Result.getOrThrow(JujutsuPathModel.rootFileFileset('bad\0name')), /workspace-relative/)
})

test('workspace-add uses a listed revision and one literal isolated destination argument', () => {
  const action: Mutation = { kind: 'workspace-add', parentPath: '/tmp/workspaces', name: 'review-branch-1', commitId: id }
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv(action)), [
    'workspace',
    'add',
    '--name',
    'review-branch-1',
    '--revision',
    id,
    '/tmp/workspaces/review-branch-1',
  ])
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ ...action, parentPath: 'relative' })), /absolute/)
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ ...action, name: '../outside' })), /workspace name/)
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ ...action, commitId: 'not-a-revision' })), /visible revision/)
})

test('workspace-edit runs jj edit at a named workspace and validates the target revision', () => {
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-edit', name: 'review-branch-1', commitId: id })), ['edit', id])
  assert.throws(
    () => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-edit', name: '../outside', commitId: id })),
    /valid workspace name/,
  )
  assert.throws(
    () => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-edit', name: 'review-branch-1', commitId: 'not-a-revision' })),
    /Invalid revision id/,
  )
})

test('workspace-forget names exactly one workspace and never the default one', () => {
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-forget', name: 'thread-8fac71' })), [
    'workspace',
    'forget',
    'thread-8fac71',
  ])
  assert.throws(
    () => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-forget', name: 'default' })),
    /Workspace default cannot be removed/,
  )
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'workspace-forget', name: '../outside' })), /valid workspace name/)
})

test('revision text search includes full IDs and all requested labels', () => {
  const revision = {
    description: 'Improve sorting',
    changeId: 'c'.repeat(40),
    commitId: 'd'.repeat(40),
    shortestChangeId: 'cc',
    bookmarks: ['main'],
    tags: ['v1.0'],
    workspaces: ['feature-workspace'],
  }
  assert.equal(RevisionGraphModel.matchesRevisionSearch(revision, 'd'.repeat(40)), true)
  assert.equal(RevisionGraphModel.matchesRevisionSearch(revision, 'c'.repeat(40)), true)
  assert.equal(RevisionGraphModel.matchesRevisionSearch(revision, 'n'.repeat(40)), true)
  assert.equal(RevisionGraphModel.matchesRevisionSearch(revision, 'feature-workspace'), true)
  assert.equal(RevisionGraphModel.matchesRevisionSearch(revision, 'unmatched'), false)
})

test('JJ canonical trailing newlines do not leave describe action permanently dirty', () => {
  assert.equal(RevisionGraphModel.describeDraftChanged('updated description', 'updated description\n'), false)
  assert.equal(RevisionGraphModel.describeDraftChanged('changed description', 'updated description\n'), true)
})

test('hiding immutable revisions retains explicit ancestry links to visible parents', () => {
  const base = { commitId: id, parents: [], shortestChangeId: 'base', immutable: false }
  const middle = { commitId: otherId, parents: [id], shortestChangeId: 'middle', immutable: true }
  const topId = 'e'.repeat(40)
  const top = { commitId: topId, parents: [otherId], shortestChangeId: 'top', immutable: false }
  const byId = new Map([
    [id, base],
    [otherId, middle],
    [topId, top],
  ])
  assert.deepEqual(RevisionGraphModel.graphParentLinks(top, byId, true), [{ commitId: id, label: 'base', hiddenParentCount: 1, terminal: false }])
  assert.deepEqual(RevisionGraphModel.graphParentLinks(top, byId, false), [{ commitId: otherId, label: 'middle', hiddenParentCount: 0, terminal: false }])
})

test('diff parser counts patch lines, skips headers, and maps file names', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1,2 @@',
    '-old',
    '+new',
    '+extra',
    'diff --git a/b.txt b/b.txt',
    '--- /dev/null',
    '+++ b/b.txt',
    '+added',
  ].join('\n')
  assert.deepEqual(JujutsuOutputModel.parsePatchStats(patch, ['src/a.ts', 'b.txt']), [
    { path: 'src/a.ts', additions: 2, deletions: 1, contentDigest: '7b577f521ab5cfc984f7b562f17697700de0a3c796709166da15ab470909d489' },
    { path: 'b.txt', additions: 1, deletions: 0, contentDigest: '48f7b673681313e27cddb7fb06cd055a093a676794aed405f8205b14923f2420' },
  ])
})

test('diff review digest changes with exact content and refuses a truncated final file', () => {
  const patch = 'diff --git a/a.txt b/a.txt\n+first\n'
  const first = JujutsuOutputModel.parsePatchStats(patch, ['a.txt'])[0]
  const changed = JujutsuOutputModel.parsePatchStats(patch.replace('first', 'second'), ['a.txt'])[0]
  assert.notEqual(first?.contentDigest, changed?.contentDigest)
  assert.equal(JujutsuOutputModel.parsePatchStats(patch, ['a.txt'], true)[0]?.contentDigest, null)
})

test('revision parser fails closed on malformed JSONL', () => {
  assert.deepEqual(Result.getOrThrow(JujutsuOutputModel.parseJsonLines('{"ok":true}\n', Schema.Unknown)), [{ ok: true }])
  assert.throws(() => Result.getOrThrow(JujutsuOutputModel.parseJsonLines('{oops}\n', Schema.Unknown)), /unreadable revision record/)
})

test('last-push detection requires JJ operation argv metadata', () => {
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush('args: jj --color=never --no-pager git push --remote origin'), true)
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush('args: /nix/store/jj/bin/jj git push'), true)
  assert.equal(
    JujutsuOutputModel.isRecordedJjGitPush("args: jj '--color=never' --no-pager git push --remote origin"),
    true,
    'jj 0.46 records argv shell-quoted',
  )
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush("args: jj '--color=never' git push '--dry-run'"), false)
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush('args: jj git push --dry-run --remote origin'), false)
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush('args: jj git push --dry-run=true --remote origin'), false)
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush('args: jj status'), false)
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush('message: someone ran git push yesterday'), false)
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush('args: git push origin main'), false)
  assert.equal(JujutsuOutputModel.isRecordedJjGitPush(''), false)
})

test('remote preview redacts complete authorization values and credential-shaped values', () => {
  const result = JujutsuOutputModel.redactRemoteOutput(
    [
      'https://user:pass@example.test/repo?token=abc',
      'Authorization: Bearer SENTINEL',
      'Proxy-Authorization: Basic PROXY_SENTINEL',
      'authorization=Bearer ASSIGNMENT_SENTINEL',
      'access_token=TOKEN_SENTINEL',
    ].join('\n'),
  )
  assert.equal(result.includes('user:pass'), false)
  assert.equal(result.includes('token=abc'), false)
  assert.equal(result.includes('Bearer SENTINEL'), false)
  assert.equal(result.includes('SENTINEL'), false)
  assert.equal(result.includes('PROXY_SENTINEL'), false)
  assert.equal(result.includes('ASSIGNMENT_SENTINEL'), false)
  assert.equal(result.includes('TOKEN_SENTINEL'), false)
  assert.equal(result.includes('[redacted]'), true)
})

test('revision actions build fixed argv with literal file filesets', () => {
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'squash', sourceId: id, destinationId: otherId })), [
    'squash',
    '--from',
    id,
    '--into',
    otherId,
    '--use-destination-message',
  ])
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'squash', sourceId: id, destinationId: otherId, paths: ['a b.ts'] })), [
    'squash',
    '--from',
    id,
    '--into',
    otherId,
    '--use-destination-message',
    'root-file:"a b.ts"',
  ])
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'restore', commitId: id, paths: ['src/x.ts'] })), [
    'restore',
    '--changes-in',
    id,
    'root-file:"src/x.ts"',
  ])
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'abandon', commitIds: [id, id, otherId] })), ['abandon', id, otherId])
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'revert', commitId: id, destinationId: otherId })), [
    'revert',
    '--revision',
    id,
    '--onto',
    otherId,
  ])
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'commit', commitId: id, message: 'ship it' })), [
    'commit',
    '--message',
    'ship it',
  ])
  assert.deepEqual(Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'bookmark-set', bookmark: 'feature/x', destinationId: id })), [
    'bookmark',
    'set',
    '--allow-backwards',
    '--revision',
    id,
    'feature/x',
  ])
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'restore', commitId: id, paths: ['../escape'] })), /workspace-relative/)
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'bookmark-delete', bookmark: '-r' })), /bookmark/)
  assert.throws(() => Result.getOrThrow(JujutsuMutationModel.buildMutationArgv({ kind: 'edit', commitId: '@' })), /revision id/)
})
