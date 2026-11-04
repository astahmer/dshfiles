import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CopyCheck } from './copy-check.ts'

const { compare, countByTerm, extractStrings, findingsInStrings, isProse, pluginPrefixPattern } = CopyCheck

const prefix = pluginPrefixPattern(['jj-integration', 'pulls-review', 'thread-sidebar', 'mcp-servers'])

test('plugin-name prefixes match labels, not log lines', () => {
  assert.ok(prefix.test('JJ Integration: Thread integration'))
  assert.ok(prefix.test('pulls.review: Reviews'))
  assert.ok(prefix.test('Thread Sidebar: Navigation'))
  assert.ok(prefix.test('MCP Servers: Servers'))
  assert.equal(prefix.test('pulls.review: reviewed marks stay unsaved'), false)
  assert.equal(prefix.test('Reviews'), false)
})

test('extracts literals and JSX text but skips comments, console output and type arguments', () => {
  const source = [
    '// New chat in a comment',
    "const a = 'Start a new chat'",
    'console.warn("session store failed")',
    'type T = Snapshot<X> readonly sessions: Y<Z>',
    'const b = <p>Integrate this workspace</p>',
    'const c = `Settle ${name} now`',
  ].join('\n')
  const texts = extractStrings(source).map(entry => entry.text)
  assert.ok(texts.includes('Start a new chat'))
  assert.ok(texts.includes('Integrate this workspace'))
  assert.ok(texts.includes('Settle   now'))
  assert.equal(
    texts.some(text => text.includes('session')),
    false,
  )
  assert.equal(
    texts.some(text => text.includes('comment')),
    false,
  )
})

test('only prose counts; identifiers and class strings do not', () => {
  assert.ok(isProse('Open session'))
  assert.equal(isProse('session'), false)
  assert.equal(isProse('dshx:flex dshx:gap-2'), false)
  assert.equal(isProse('@dshfiles/thread-sidebar'), false)
})

test('counts findings per term and ratchets on increases only', () => {
  const findings = findingsInStrings({
    file: 'x.tsx',
    prefix,
    strings: [
      { text: 'Open session', line: 1 },
      { text: 'New chat here', line: 2 },
      { text: 'JJ Integration: Threads', line: 3 },
      { text: 'Land this thread', line: 4 },
    ],
  })
  const counts = countByTerm(findings)
  assert.equal(counts.session, 1)
  assert.equal(counts['new-chat'], 1)
  assert.equal(counts['plugin-prefix'], 1)
  assert.equal(counts.integrate, 0)
  assert.deepEqual(compare({ baseline: counts, current: counts }), { increased: [], decreased: [] })
  assert.equal(compare({ baseline: { ...counts, session: 0 }, current: counts }).increased.length, 1)
  assert.equal(compare({ baseline: { ...counts, session: 5 }, current: counts }).decreased.length, 1)
})
