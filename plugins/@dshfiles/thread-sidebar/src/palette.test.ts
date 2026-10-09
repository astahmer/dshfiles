import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  chordFromEvent,
  formatChord,
  fuzzyScore,
  indexFiles,
  indexThreads,
  matchesChord,
  parseChord,
  parseLineNumber,
  parsePaletteQuery,
  rankActions,
  rankFiles,
  rankThreads,
  sameAsHostBinding,
  serializeChord,
  type ThreadCandidate,
} from './palette.js'

const thread = (overrides: Partial<ThreadCandidate> & { id: string }): ThreadCandidate => ({
  title: overrides.id,
  project: '',
  cwd: '',
  updatedAt: 0,
  ...overrides,
})

const key = (code: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  code,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
})

test('fuzzy matching accepts ordered subsequences and ranks substrings and word starts first', () => {
  assert.equal(fuzzyScore('xyz', 'sidebar footer'), null)
  const substring = fuzzyScore('foot', 'sidebar footer') ?? 0
  const scattered = fuzzyScore('sbft', 'sidebar footer') ?? 0
  assert.ok(substring > scattered)
  assert.ok((fuzzyScore('sf', 'sidebar footer') ?? 0) > (fuzzyScore('sf', 'stuff') ?? 0))
})

test('an empty thread query lists the most recent threads up to the limit', () => {
  const threads = [thread({ id: 'a', updatedAt: 1 }), thread({ id: 'b', updatedAt: 3 }), thread({ id: 'c', updatedAt: 2 })]
  assert.deepEqual(
    rankThreads({ index: indexThreads(threads), query: '', limit: 2 }).map(item => item.id),
    ['b', 'c'],
  )
})

test('thread search matches title, project, and id prefix, best title match first', () => {
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

test('file search prefers basename matches, then shorter paths, and lifts frecent files', () => {
  const index = indexFiles(['docs/palette-notes.md', 'src/palette.ts', 'src/deep/nested/palette.ts', 'src/sidebar-state.tsx', 'README.md'])
  const none = (): number => 0
  assert.deepEqual(rankFiles({ index, query: 'palette', limit: 10, boost: none }), ['src/palette.ts', 'docs/palette-notes.md', 'src/deep/nested/palette.ts'])
  assert.deepEqual(rankFiles({ index, query: 'sidst', limit: 10, boost: none }), ['src/sidebar-state.tsx'])
  assert.deepEqual(
    rankFiles({ index, query: 'palette', limit: 10, boost: path => (path === 'src/deep/nested/palette.ts' ? 800 : 0) })[0],
    'src/deep/nested/palette.ts',
  )
})

test('an empty file query lists frecent files first, then the walk order, up to the limit', () => {
  const index = indexFiles(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  assert.deepEqual(rankFiles({ index, query: '', limit: 3, boost: path => (path === 'c.ts' ? 20 : 0) }), ['c.ts', 'a.ts', 'b.ts'])
})

test('actions match labels and aliases, keep source order on ties, and rise with frecency', () => {
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

test('a leading prefix picks the palette view and is stripped from the search text', () => {
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

test('chords round-trip, reject unmodified keys, and match exactly', () => {
  const chord = parseChord('shift+primary+KeyP')
  assert.ok(chord)
  assert.equal(serializeChord(chord), 'primary+shift+KeyP')
  assert.equal(parseChord('KeyP'), null)
  assert.equal(parseChord('primary+MetaLeft'), null)
  assert.equal(parseChord('hyper+KeyP'), null)

  assert.equal(chordFromEvent(key('KeyP'), true), null)
  assert.equal(chordFromEvent(key('MetaLeft', { meta: true }), true), null)
  assert.equal(serializeChord(chordFromEvent(key('KeyK', { meta: true }), true) ?? { code: '', modifiers: [] }), 'primary+KeyK')
  assert.equal(serializeChord(chordFromEvent(key('KeyK', { ctrl: true }), false) ?? { code: '', modifiers: [] }), 'primary+KeyK')

  const palette = parseChord('primary+KeyK')
  assert.ok(palette)
  assert.equal(matchesChord(key('KeyK', { meta: true }), palette, true), true)
  assert.equal(matchesChord(key('KeyK', { meta: true, alt: true }), palette, true), false)
  assert.equal(matchesChord(key('KeyK', { ctrl: true }), palette, true), false)
})

test('chords format per platform and detect a Host binding on the same physical keys', () => {
  const chord = parseChord('primary+alt+KeyK')
  assert.ok(chord)
  assert.deepEqual(formatChord(chord, true), ['⌘', '⌥', 'K'])
  assert.deepEqual(formatChord(chord, false), ['Ctrl', 'Alt', 'K'])
  assert.equal(sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['alt', 'meta'] }, true), true)
  assert.equal(sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['meta'] }, true), false)
  assert.equal(sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['alt', 'control'] }, false), true)
  assert.equal(sameAsHostBinding(chord, null, true), false)
})
