import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  fuzzyScore,
  indexFiles,
  indexThreads,
  parseLineNumber,
  parsePaletteQuery,
  rankActions,
  rankFiles,
  rankThreads,
  type ThreadCandidate,
} from './palette.js'

const thread = (overrides: Partial<ThreadCandidate> & { id: string }): ThreadCandidate => ({
  title: overrides.id,
  project: '',
  cwd: '',
  updatedAt: 0,
  ...overrides,
})

test('fuzzy matching prefers substrings and word starts', () => {
  assert.equal(fuzzyScore('xyz', 'sidebar footer'), null)
  const substring = fuzzyScore('foot', 'sidebar footer') ?? 0
  const scattered = fuzzyScore('sbft', 'sidebar footer') ?? 0
  assert.ok(substring > scattered)
  assert.ok((fuzzyScore('sf', 'sidebar footer') ?? 0) > (fuzzyScore('sf', 'stuff') ?? 0))
})

test('empty thread search returns the most recent candidates', () => {
  const threads = [thread({ id: 'a', updatedAt: 1 }), thread({ id: 'b', updatedAt: 3 }), thread({ id: 'c', updatedAt: 2 })]
  assert.deepEqual(
    rankThreads({ index: indexThreads(threads), query: '', limit: 2 }).map(item => item.id),
    ['b', 'c'],
  )
})

test('thread search matches title, project, and id prefix', () => {
  const threads = [
    thread({ id: 'thr_1', title: 'Fix footer layout', project: 'dshfiles', updatedAt: 1 }),
    thread({ id: 'thr_2', title: 'Unrelated', project: 'footer-kit', updatedAt: 5 }),
    thread({ id: 'thr_abc', title: 'Other', project: 'nixfiles', updatedAt: 2 }),
  ]
  assert.deepEqual(
    rankThreads({ index: indexThreads(threads), query: 'footer', limit: 10 }).map(item => item.id),
    ['thr_1', 'thr_2'],
  )
  assert.deepEqual(
    rankThreads({ index: indexThreads(threads), query: 'thr_ab', limit: 10 }).map(item => item.id),
    ['thr_abc'],
  )
  assert.deepEqual(
    rankThreads({ index: indexThreads(threads), query: 'nix', limit: 10 }).map(item => item.id),
    ['thr_abc'],
  )
})

test('file search prefers basename matches and lifts frecent paths', () => {
  const index = indexFiles(['docs/palette-notes.md', 'src/palette.ts', 'src/deep/nested/palette.ts', 'src/sidebar-state.tsx', 'README.md'])
  const none = (): number => 0
  assert.deepEqual(rankFiles({ index, query: 'palette', limit: 10, boost: none }), ['src/palette.ts', 'docs/palette-notes.md', 'src/deep/nested/palette.ts'])
  assert.deepEqual(rankFiles({ index, query: 'sidst', limit: 10, boost: none }), ['src/sidebar-state.tsx'])
  assert.equal(
    rankFiles({ index, query: 'palette', limit: 10, boost: path => (path === 'src/deep/nested/palette.ts' ? 800 : 0) })[0],
    'src/deep/nested/palette.ts',
  )
})

test('empty file search lists frecent paths before walk order', () => {
  const index = indexFiles(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  assert.deepEqual(rankFiles({ index, query: '', limit: 3, boost: path => (path === 'c.ts' ? 20 : 0) }), ['c.ts', 'a.ts', 'b.ts'])
})

test('actions match labels and aliases, preserve ties, and use frecency', () => {
  const actions = [
    { id: 'command:jujutsu.toggleSessionRepository', label: 'Toggle Jujutsu on this thread’s repository', aliases: ['jj', 'source control'] },
    { id: 'action:toggle-sidebar', label: 'Toggle sidebar' },
    { id: 'action:customize-sidebar', label: 'Customize sidebar' },
  ]
  const none = (): number => 0
  assert.deepEqual(
    rankActions({ actions, query: 'jj', boost: none }).map(action => action.id),
    ['command:jujutsu.toggleSessionRepository'],
  )
  assert.deepEqual(
    rankActions({ actions, query: 'sidebar', boost: none }).map(action => action.id),
    ['action:toggle-sidebar', 'action:customize-sidebar'],
  )
  assert.deepEqual(
    rankActions({ actions, query: '', boost: id => (id === 'action:customize-sidebar' ? 80 : 0) }).map(action => action.id),
    ['action:customize-sidebar', 'command:jujutsu.toggleSessionRepository', 'action:toggle-sidebar'],
  )
})

test('palette prefixes route to command, content, and line views', () => {
  assert.deepEqual(parsePaletteQuery('>toggle'), { prefix: '>', text: 'toggle' })
  assert.deepEqual(parsePaletteQuery('#migration plan'), { prefix: '#', text: 'migration plan' })
  assert.deepEqual(parsePaletteQuery(':42'), { prefix: ':', text: '42' })
  assert.deepEqual(parsePaletteQuery('?'), { prefix: '?', text: '' })
  assert.deepEqual(parsePaletteQuery('src/>x'), { prefix: null, text: 'src/>x' })
  assert.equal(parseLineNumber(' 42 '), 42)
  assert.equal(parseLineNumber('0'), null)
  assert.equal(parseLineNumber('4a'), null)
  assert.equal(parseLineNumber(''), null)
})
