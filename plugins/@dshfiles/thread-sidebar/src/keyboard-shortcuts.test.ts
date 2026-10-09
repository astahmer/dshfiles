import assert from 'node:assert/strict'
import { test } from 'vitest'
import { chordFromEvent, formatChord, matchesChord, parseChord, sameAsHostBinding, serializeChord } from './keyboard-shortcuts.js'

const key = (code: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  code,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
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

test('chords format per platform and detect Host bindings on the same physical keys', () => {
  const chord = parseChord('primary+alt+KeyK')
  assert.ok(chord)
  assert.deepEqual(formatChord(chord, true), ['⌘', '⌥', 'K'])
  assert.deepEqual(formatChord(chord, false), ['Ctrl', 'Alt', 'K'])
  assert.equal(sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['alt', 'meta'] }, true), true)
  assert.equal(sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['meta'] }, true), false)
  assert.equal(sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['alt', 'control'] }, false), true)
  assert.equal(sameAsHostBinding(chord, null, true), false)
})
