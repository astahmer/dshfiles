import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Git, GitArgs, GitCommandFailed, redactGitStderr } from '@dshfiles/git-cli'

// Ordinary Node, not Vite: a TypeScript loader must not conceal missing runtime siblings.
test('the git CLI library loads built JavaScript with working sibling imports', () => {
  assert.ok(import.meta.resolve('@dshfiles/git-cli').endsWith('/dist/index.js'))
  assert.equal(Git.key, '@dshfiles/git-cli/Git')
  assert.equal(GitArgs.spanName(['-C', '/tmp/x', 'worktree', 'list']), 'git worktree')
  assert.deepEqual(GitArgs.redact(['commit', '-m', 'private']), ['commit', '-m', '<redacted>'])
  assert.equal(redactGitStderr('https://a:b@h/r'), 'https://<redacted>@h/r')
  assert.equal(new GitCommandFailed({ verb: 'log', args: [], exitCode: 1, stderr: '' })._tag, 'GitCommandFailed')
})
