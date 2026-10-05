import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { Mutation } from './api.js'
import {
  buildMutationArgv,
  isRecordedJjGitPush,
  isSafeSplitPath,
  parseJsonLines,
  parsePatchStats,
  PreviewStore,
  redactRemoteOutput,
  rootFileFileset,
  validatedRepositoryPath,
} from './core.ts'
import { describeDraftChanged, graphParentLinks, matchesRevisionSearch } from './graph.ts'

const id = 'a'.repeat(40)
const otherId = 'b'.repeat(40)

test('revision and repository inputs reject expressions and relative cwd values', () => {
  assert.throws(() => validatedRepositoryPath('repo'), /absolute/)
  assert.throws(() => validatedRepositoryPath('/'), /filesystem root/)
  assert.equal(validatedRepositoryPath('/tmp/project/../project'), '/tmp/project')
  assert.equal(isSafeSplitPath('src/main.ts'), true)
  assert.equal(isSafeSplitPath('dir with space/café [1]*?.txt'), true)
  assert.equal(isSafeSplitPath('../secret'), false)
  assert.equal(isSafeSplitPath('/absolute/path'), false)
  assert.equal(isSafeSplitPath('src/*.ts'), true)
  assert.equal(isSafeSplitPath('src/../secret'), false)
  assert.equal(isSafeSplitPath('bad\0name'), false)
  assert.equal(isSafeSplitPath('bad\nname'), false)
})

test('mutation strings remain single argv values and never become shell commands', () => {
  const message = 'repair $(touch /tmp/nope); `not a shell`\nsecond line'
  const action: Mutation = { kind: 'describe', commitId: id, message }
  const argv = buildMutationArgv(action)
  assert.deepEqual(argv, ['describe', id, '--message', message])
  assert.equal(argv.join(' ').includes(message), true)
  assert.equal(
    argv.some(value => value === 'touch'),
    false,
  )
  assert.throws(() => buildMutationArgv({ kind: 'describe', commitId: id, message: 'bad\0arg' }), /null bytes/)
  assert.deepEqual(buildMutationArgv({ kind: 'describe', commitId: id, message: '' }), ['describe', id, '--message', ''])
})

test('split argv quotes each listed path as one exact JJ root-file fileset', () => {
  const action: Mutation = { kind: 'split', commitId: id, paths: ['src/a.ts', 'dir with space/café [1]*?.txt'], message: 'split selected files' }
  assert.deepEqual(buildMutationArgv(action), [
    'split',
    '--revision',
    id,
    '--message',
    'split selected files',
    'root-file:"src/a.ts"',
    'root-file:"dir with space/café [1]*?.txt"',
  ])
  assert.equal(rootFileFileset('odd "quoted" \\ path*.txt'), 'root-file:"odd \\"quoted\\" \\\\ path*.txt"')
  assert.equal(rootFileFileset('literal" | all() | root-file:"second'), 'root-file:"literal\\" | all() | root-file:\\"second"')
  assert.throws(() => buildMutationArgv({ ...action, paths: ['src/../secret'] }), /workspace-relative/)
  assert.throws(() => rootFileFileset('bad\0name'), /workspace-relative/)
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
  assert.equal(matchesRevisionSearch(revision, 'd'.repeat(40)), true)
  assert.equal(matchesRevisionSearch(revision, 'c'.repeat(40)), true)
  assert.equal(matchesRevisionSearch(revision, 'feature-workspace'), true)
  assert.equal(matchesRevisionSearch(revision, 'unmatched'), false)
})

test('JJ canonical trailing newlines do not leave describe action permanently dirty', () => {
  assert.equal(describeDraftChanged('updated description', 'updated description\n'), false)
  assert.equal(describeDraftChanged('changed description', 'updated description\n'), true)
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
  assert.deepEqual(graphParentLinks(top, byId, true), [{ commitId: id, label: 'base', hiddenImmutableCount: 1, terminal: false }])
  assert.deepEqual(graphParentLinks(top, byId, false), [{ commitId: otherId, label: 'middle', hiddenImmutableCount: 0, terminal: false }])
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
  const changes = parsePatchStats(patch, ['src/a.ts', 'b.txt'])
  assert.deepEqual(changes.map(({ path, additions, deletions }) => ({ path, additions, deletions })), [
    { path: 'src/a.ts', additions: 2, deletions: 1 },
    { path: 'b.txt', additions: 1, deletions: 0 },
  ])
  assert.match(changes[0]?.contentDigest ?? '', /^[a-f0-9]{64}$/)
  assert.notEqual(changes[0]?.contentDigest, changes[1]?.contentDigest)
  assert.equal(parsePatchStats(patch, ['src/a.ts', 'b.txt'], true)[1]?.contentDigest, null)
})

test('revision parser fails closed on malformed JSONL', () => {
  assert.deepEqual(
    parseJsonLines('{"ok":true}\n', value => value),
    [{ ok: true }],
  )
  assert.throws(() => parseJsonLines('{oops}\n', value => value), /unreadable revision record/)
})

test('last-push detection requires JJ operation argv metadata', () => {
  assert.equal(isRecordedJjGitPush('args: jj --color=never --no-pager git push --remote origin'), true)
  assert.equal(isRecordedJjGitPush('args: /nix/store/jj/bin/jj git push'), true)
  assert.equal(isRecordedJjGitPush('args: jj git push --dry-run --remote origin'), false)
  assert.equal(isRecordedJjGitPush('args: jj git push --dry-run=true --remote origin'), false)
  assert.equal(isRecordedJjGitPush('args: jj status'), false)
  assert.equal(isRecordedJjGitPush('message: someone ran git push yesterday'), false)
  assert.equal(isRecordedJjGitPush('args: git push origin main'), false)
  assert.equal(isRecordedJjGitPush(''), false)
})

test('remote preview redacts complete authorization values and credential-shaped values', () => {
  const result = redactRemoteOutput(
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

test('prepared mutations are one-use, expire, and bind to unchanged repo state', () => {
  const store = new PreviewStore()
  const entry = {
    root: '/tmp/repo',
    identity: 'device:inode',
    fingerprint: 'state-1',
    action: { kind: 'rebase', sourceId: id, destinationId: otherId } as const,
    argv: ['rebase', '--source', id, '--destination', otherId],
    title: 'Rebase change',
    summary: 'Preview',
    detail: 'source to destination',
    expiresAt: 5000,
  }
  store.put('preview-1', entry, 1000)
  assert.equal(store.take('preview-1', '/tmp/repo', 'device:inode', 'state-2', 2000), undefined)
  assert.equal(store.take('preview-1', '/tmp/repo', 'device:inode', 'state-1', 2000), undefined)

  store.put('preview-2', entry, 1000)
  assert.equal(store.take('preview-2', '/tmp/other', 'device:inode', 'state-1', 2000), undefined)
  store.put('preview-3', entry, 1000)
  assert.equal(store.take('preview-3', '/tmp/repo', 'device:inode', 'state-1', 5000), undefined)
  store.put('preview-4', entry, 1000)
  assert.equal(store.take('preview-4', '/tmp/repo', 'wrong-inode', 'state-1', 2000), undefined)
  store.put('preview-5', entry, 1000)
  assert.deepEqual(store.take('preview-5', '/tmp/repo', 'device:inode', 'state-1', 2000), entry)
  assert.equal(store.take('preview-5', '/tmp/repo', 'device:inode', 'state-1', 2001), undefined)
})
