import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CopyCheck } from './copy-check.ts'

const { catalogCopy, compare, copyInPlainTs, countByTermAndPlugin, extractStrings, findingsInStrings, isProse, jsonStrings, pluginOf, pluginPrefixPattern, totalsByTerm } = CopyCheck

const prefix = pluginPrefixPattern(['jj-integration', 'pulls-review', 'thread-sidebar', 'mcp-servers'])

test('plugin-name prefixes match labels, not log lines', () => {
  assert.ok(prefix.test('JJ Integration: Thread integration'))
  assert.ok(prefix.test('pulls.review: Reviews'))
  assert.ok(prefix.test('Thread Sidebar: Navigation'))
  assert.ok(prefix.test('MCP Servers: Servers'))
  assert.equal(prefix.test('pulls.review: reviewed marks stay unsaved'), false)
  assert.equal(prefix.test('Reviews'), false)
})

test('plugin-name prefixes in template literals count by a title-form head, not a debug slug', () => {
  const strings = extractStrings('const a = `MCP Servers: ${translate(key)}`\nconst b = `mcp-servers: ${count} reloaded`')
  assert.deepEqual(
    strings.map(entry => entry.raw ?? entry.text),
    ['MCP Servers: ${}', 'mcp-servers: ${} reloaded'],
  )
  const findings = findingsInStrings({ file: 'plugins/@dshfiles/mcp-servers/src/client.tsx', prefix, strings })
  assert.deepEqual(
    findings.map(finding => `${finding.term}:${finding.text}`),
    ['plugin-prefix:MCP Servers: ${}'],
  )
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

test('skips non-English locale tables, declared or keyed', () => {
  const source = [
    'export const en = {',
    "  title: 'Open the thread',",
    '}',
    'export const fr = {',
    "  title: 'Ouvrir la conversation',",
    '  nested: {',
    "    more: 'Une conversation',",
    '  },',
    '}',
    'const tables = {',
    "  en: { a: 'English' },",
    "  'zh-CN': {",
    "    a: '会话',",
    '  },',
    '  de: {',
    "    a: 'Konversation',",
    '  },',
    "  es: { b: 'inline' },",
    '}',
    "const after = 'After the tables'",
  ].join('\n')
  const texts = extractStrings(source).map(entry => entry.text)
  assert.deepEqual(texts, ['Open the thread', 'English', 'After the tables'])
})

test('reads settings-schema descriptions from plain .ts files that define settings', () => {
  const source = [
    "import { defineSettings, Schema } from '@dshfiles/dshx'",
    'export const settings = defineSettings({',
    "  namespace: 'demo',",
    '  schema: Schema.object({',
    "    keep: Schema.boolean().default(true).description('Keep each session open'),",
    "    other: Schema.string().role('secret-ref'),",
    '  }),',
    '})',
  ].join('\n')
  const strings = extractStrings(source)
  assert.equal(strings.find(entry => entry.text === 'Keep each session open')?.key, 'description()')
  assert.equal(strings.find(entry => entry.text === 'demo')?.key, 'namespace')
  assert.deepEqual(
    copyInPlainTs(source, strings).map(entry => entry.text),
    ['Keep each session open'],
  )
  // A tool parameter description outside a settings file is model-facing, not Settings copy.
  const tool = "const params = Schema.object({ id: Schema.string().description('The session id') })"
  assert.deepEqual(copyInPlainTs(tool, extractStrings(tool)), [])
})

test('reads the catalog text users read: title, summary, firstAction and doneWhen', () => {
  const catalog = {
    features: [
      {
        title: 'Resume a session',
        summary: 'Pick up the thread where it stopped.',
        details: 'Internal: reads the session store.',
        onboarding: { firstAction: 'Open the conversation list.', doneWhen: 'The thread opens.' },
      },
      { title: 'Search' },
    ],
  }
  const strings = catalogCopy(catalog)
  assert.deepEqual(
    strings.map(entry => entry.text),
    ['Resume a session', 'Pick up the thread where it stopped.', 'Open the conversation list.', 'The thread opens.', 'Search'],
  )
  const terms = findingsInStrings({ file: 'plugins/@dshfiles/demo/dshx.features.json', prefix, strings }).map(finding => finding.term)
  assert.deepEqual(terms, ['session', 'conversation'])
})

test('reads every string of a locale/en.json table', () => {
  const table = { meta: { title: 'Conversation cleanup', description: 'Delete cold sessions.' }, labels: ['One', { two: 'Two' }], count: 3 }
  assert.deepEqual(
    jsonStrings(table).map(entry => entry.text),
    ['Conversation cleanup', 'Delete cold sessions.', 'One', 'Two'],
  )
})

test('only prose counts; identifiers and class strings do not', () => {
  assert.ok(isProse('Open session'))
  assert.equal(isProse('session'), false)
  assert.equal(isProse('dshx:flex dshx:gap-2'), false)
  assert.equal(isProse('@dshfiles/thread-sidebar'), false)
})

test('counts findings per term and plugin and ratchets on increases only', () => {
  const findings = findingsInStrings({
    file: 'plugins/@dshfiles/demo/src/x.tsx',
    prefix,
    strings: [
      { text: 'Open session', line: 1 },
      { text: 'New chat here', line: 2 },
      { text: 'JJ Integration: Threads', line: 3 },
      { text: 'Land this thread', line: 4 },
    ],
  })
  const totals = totalsByTerm(findings)
  assert.equal(totals.session, 1)
  assert.equal(totals['new-chat'], 1)
  assert.equal(totals['plugin-prefix'], 1)
  assert.equal(totals.integrate, 0)
  const counts = countByTermAndPlugin(findings)
  assert.deepEqual(counts, { 'new-chat/demo': 1, 'plugin-prefix/demo': 1, 'session/demo': 1 })
  assert.deepEqual(compare({ baseline: counts, current: counts }), { increased: [], decreased: [] })
  assert.deepEqual(compare({ baseline: { ...counts, 'session/demo': 0 }, current: counts }).increased, ['session/demo: 1 > baseline 0'])
  // A drop in one plugin does not leave room for a rise in another.
  assert.deepEqual(compare({ baseline: { ...counts, 'session/other': 3 }, current: counts }).decreased, ['session/other: 0 < baseline 3'])
  assert.equal(compare({ baseline: { ...counts, 'session/demo': 0, 'session/other': 3 }, current: counts }).increased.length, 1)
})

test('attributes a file to its plugin directory', () => {
  assert.equal(pluginOf('plugins/@dshfiles/thread-sidebar/src/locales.ts'), 'thread-sidebar')
  assert.equal(pluginOf('plugins/@dshfiles/chat/dshx.features.json'), 'chat')
})
