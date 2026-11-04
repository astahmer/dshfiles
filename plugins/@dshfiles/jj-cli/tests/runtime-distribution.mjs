import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Jj, JjArgs, JjCommandFailed, JjViewReads, redactJjStderr } from '@dshfiles/jj-cli'

// Ordinary Node, not Vite: a TypeScript loader must not conceal missing runtime siblings.
test('the jj CLI library loads built JavaScript with working sibling imports', () => {
  assert.ok(import.meta.resolve('@dshfiles/jj-cli').endsWith('/dist/index.js'))
  assert.equal(Jj.key, '@dshfiles/jj-cli/Jj')
  assert.equal(JjViewReads.key, '@dshfiles/jj-cli/JjViewReads')
  assert.equal(JjArgs.spanName(['--ignore-working-copy', 'workspace', 'list']), 'jj workspace list')
  assert.deepEqual(JjArgs.redact(['describe', '-m', 'private']), ['describe', '-m', '<redacted>'])
  assert.equal(redactJjStderr('https://a:b@h/r'), 'https://<redacted>@h/r')
  assert.equal(new JjCommandFailed({ verb: 'log', args: [], exitCode: 1, stderr: '', stderrTruncated: false })._tag, 'JjCommandFailed')
})
