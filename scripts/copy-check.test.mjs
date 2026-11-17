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
    ['MCP Servers: ${translate(key)}', 'mcp-servers: ${count} reloaded'],
  )
  const findings = findingsInStrings({ file: 'plugins/@dshfiles/mcp-servers/src/client.tsx', prefix, strings })
  assert.deepEqual(
    findings.map(finding => `${finding.term}:${finding.text}`),
    ['plugin-prefix:MCP Servers: ${translate(key)}'],
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

test('reads label-keyed values of plain .ts label tables, not tool or API descriptions', () => {
  const table = [
    'export const groups = [',
    "  { id: 'general', label: 'General session', description: 'Each conversation and its tabs.' },",
    "  { id: 'empty', emptyTitle: 'No sessions yet', name: 'internal session' },",
    ']',
  ].join('\n')
  assert.deepEqual(
    copyInPlainTs(table, extractStrings(table), 'plugins/@dshfiles/demo/src/groups.ts').map(entry => entry.text),
    ['General session', 'Each conversation and its tabs.', 'No sessions yet'],
  )
  const tools = [
    "const tool = defineTool({ name: 'list_sessions', description: 'List every live session.' })",
    "const row = { label: 'Open session' }",
  ].join('\n')
  assert.deepEqual(
    copyInPlainTs(tools, extractStrings(tools), 'plugins/@dshfiles/demo/src/tools.ts').map(entry => entry.text),
    ['Open session'],
  )
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

const ruleHits = (rule, texts) =>
  findingsInStrings({ file: 'plugins/@dshfiles/demo/src/a.tsx', prefix, strings: texts.map((text, line) => ({ text, line })) })
    .filter(finding => finding.term === rule)
    .map(finding => finding.text)

test('host-process: a capital Host inside a sentence is the server process; a lower-case host is a machine', () => {
  assert.deepEqual(
    ruleHits('host-process', [
      'Restart the Host to apply this change',
      'Host plugin missing, update DSH',
      'Runs on this host',
      'Hosts & network',
      'Host key fingerprint for the remote',
      'Add a remote host first',
      'Open Observe › Hosts, or check the Hosts page',
      'Scratch DSH Hosts are using memory',
    ]),
    ['Restart the Host to apply this change', 'Host plugin missing, update DSH', 'Scratch DSH Hosts are using memory'],
  )
})

test('package-name: a package name in a sentence, not an import specifier or a command', () => {
  assert.deepEqual(
    ruleHits('package-name', [
      '@dshfiles/backlog is not installed. Enable it in Plugins.',
      'Install @deepseek-ai/dsh 0.2.2 or later',
      '@dshfiles/plugin-ui/icons',
      "import { Button } from '@dshfiles/plugin-ui'",
      'pnpm --dir plugins/@dshfiles/backlog test',
      '@dshfiles/chat code fences',
      'Open Backlog to add a task',
    ]),
    ['@dshfiles/backlog is not installed. Enable it in Plugins.', 'Install @deepseek-ai/dsh 0.2.2 or later'],
  )
})

test('raw-error-echo: a message that ends by echoing an error, not a labelled value', () => {
  const source = [
    'const a = `Could not save: ${error instanceof Error ? error.message : String(error)}`',
    'const b = `Failed: ${err}.`',
    "const c = 'Could not load the backlog: {message}'",
    'const d = `Thread: ${title}`',
    'const e = `Could not save: ${error.message}. Retry, or check the disk.`',
    'const f = `${label}: ${message}`',
    'const g = `failed:${snapshot.error}`',
    "const h = 'Next: {message}'",
  ].join('\n')
  const findings = findingsInStrings({ file: 'plugins/@dshfiles/demo/src/a.tsx', prefix, strings: extractStrings(source) })
  assert.deepEqual(
    findings.filter(finding => finding.term === 'raw-error-echo').map(finding => finding.line),
    [1, 2, 3],
  )
})

test('status-word: a non-canonical state word as a whole label, not inside a sentence or as an enum value', () => {
  assert.deepEqual(
    ruleHits('status-word', ['Running', 'In progress', 'Needs attention', 'Running tests', 'running', '3 completed', 'Working', 'Done']),
    ['Running', 'In progress', 'Needs attention'],
  )
})

test('try-again: the whole label, not the phrase inside a sentence', () => {
  assert.deepEqual(ruleHits('try-again', ['Try again', 'Try again.', 'Retry', 'Check the path, then try again.']), ['Try again', 'Try again.'])
})

test('ascii-ellipsis: three dots after a word, not a range or the ellipsis character', () => {
  assert.deepEqual(
    ruleHits('ascii-ellipsis', ['Loading...', 'Search threads...', 'Saving... please wait', 'Loading…', 'Compare main...HEAD', 'Wait.']),
    ['Loading...', 'Search threads...', 'Saving... please wait'],
  )
})
